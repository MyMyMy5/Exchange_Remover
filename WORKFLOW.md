# Exchange Remover - Complete Workflow Documentation

## Overview

Exchange Remover is a full-stack application for searching and purging malicious emails across an entire Exchange organization. It consists of a Node.js/Express backend that interfaces with Exchange Web Services (EWS) and PowerShell scripts, plus a React frontend for operations teams.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         React Frontend                          │
│  (Vite + React Router + TanStack Query + React Hook Form)      │
└────────────────┬────────────────────────────────────────────────┘
                 │ HTTP/REST + SSE
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Express.js Backend                         │
│              (CORS + Request Context + Logging)                 │
└────────────────┬────────────────────────────────────────────────┘
                 │
        ┌────────┴────────┐
        ▼                 ▼
┌──────────────┐   ┌──────────────────┐
│  EWS Client  │   │  PowerShell      │
│  (ews-js-api)│   │  Script Executor │
└──────┬───────┘   └────────┬─────────┘
       │                    │
       ▼                    ▼
┌──────────────┐   ┌──────────────────┐
│   Exchange   │   │  Exchange Mgmt   │
│   Server     │   │  Shell (PS.ps1)  │
└──────────────┘   └──────────────────┘
```

---

## Backend Components

### 1. Server Entry Point (`server.js`)

**Purpose**: Bootstrap the Express application with middleware and error handling.

**Flow**:
1. Load environment variables from `.env`
2. Configure CORS based on `ALLOWED_ORIGINS`
3. Apply middleware stack:
   - `requestContext` - Assigns unique UUID to each request
   - `cors` - Handles cross-origin requests
   - `express.json` - Parses JSON payloads
   - `requestLogger` - Logs all incoming requests
4. Mount routes under `/api`
5. Global error handler catches and formats errors with request IDs
6. Listen on configured port (default: 5000)

**Key Features**:
- Graceful error handling with structured responses
- Request ID tracking for debugging
- Health check endpoint at `/healthz`

---

### 2. Exchange Service (`services/exchangeService.js`)

**Purpose**: Core business logic for interacting with Exchange Web Services.

#### Configuration
Reads from environment variables:
- `EWS_URL` or `EWS_AUTODISCOVER_EMAIL` - Exchange endpoint
- `EWS_USERNAME` / `EWS_PASSWORD` - Service account credentials
- `EWS_DOMAIN` - Optional domain for authentication
- `EWS_VERSION` - Exchange version (2010/2013/2016/2019)
- `DEFAULT_FOLDERS` - Folders to search (Inbox, JunkEmail, etc.)
- `DEFAULT_MAX_RESULTS` - Max results per mailbox
- `EWS_PAGE_SIZE` - Pagination size for EWS queries
- `EWS_MAX_CONCURRENCY` - Parallel mailbox processing limit

#### Key Functions

**`createService(context)`**
- Initializes EWS client with credentials
- Handles autodiscovery or direct URL configuration
- Returns authenticated ExchangeService instance

**`getSearchableMailboxes(context)`**
- Calls `GetSearchableMailboxes` EWS API
- Returns list of mailboxes the service account can impersonate
- Filters to only searchable mailboxes

**`searchMessages(filters, context)`**
- **Input**: `{ sender, subject, body, keywords, receivedFrom, receivedTo, hasAttachments, importance, folders, maxPerMailbox }`
- **Process**:
  1. Fetch all searchable mailboxes
  2. Build AQS (Advanced Query Syntax) query from filters
  3. Use `PQueue` to process mailboxes concurrently (respects `EWS_MAX_CONCURRENCY`)
  4. For each mailbox:
     - Impersonate the mailbox user
     - Search specified folders using `FindItems`
     - Paginate through results up to `maxPerMailbox` limit
     - Extract message metadata (subject, sender, received date, body preview, etc.)
  5. Aggregate results and failures
- **Output**: 
  ```json
  {
    "summary": {
      "totalMailboxesScanned": 150,
      "mailboxesWithMatches": 12,
      "totalMessages": 47
    },
    "query": "from:\"malicious@example.com\" AND received>=2024-01-01",
    "results": [
      {
        "mailbox": "user@company.com",
        "displayName": "John Doe",
        "totalMatches": 3,
        "matches": [
          {
            "id": "AAMkAG...",
            "subject": "Urgent Invoice",
            "from": "malicious@example.com",
            "receivedAt": "2024-01-15T10:30:00Z",
            "bodyPreview": "Please wire funds...",
            "folder": "Inbox"
          }
        ]
      }
    ],
    "failures": []
  }
  ```

**`deleteMessages(filters, context)`**
- **Input**: Same as search, plus `{ deleteMode, simulate }`
- **Process**:
  1. Similar to search: fetch mailboxes, build query, process concurrently
  2. For each mailbox:
     - Find matching items
     - If `simulate=false`, call `DeleteItems` with specified mode:
       - `SoftDelete` - Move to Recoverable Items
       - `MoveToDeletedItems` - Move to Deleted Items folder
       - `HardDelete` - Permanently remove
  3. Track deletion counts per mailbox
- **Output**: Similar to search, but includes `deleted` count per mailbox

**Query Builder (`utils/queryBuilder.js`)**
- Constructs AQS queries for EWS
- Escapes special characters
- Combines filters with AND logic
- Example: `from:"sender@example.com" AND subject:"Invoice" AND received>=2024-01-01`

---

### 3. API Routes (`routes/exchangeRoutes.js`)

**Endpoints**:

#### `GET /api/mailboxes`
- Returns list of searchable mailboxes
- Used by frontend to display mailbox count

#### `POST /api/search`
- Validates request body with Joi schema
- Requires `sender` or `subject` filter
- Calls `searchMessages` service
- Returns search results with request ID

#### `POST /api/delete`
- Validates request body (requires `sender`)
- Calls `deleteMessages` service
- Supports `simulate` flag (default: true)
- Returns deletion results

#### `POST /api/purge-sender`
- **Advanced PowerShell-based purge operation**
- Validates complex payload with date ranges and subject filters
- Spawns PowerShell process to execute `PS.ps1` script
- Supports two response modes:
  1. **Standard**: Waits for completion, returns full output
  2. **Streaming (SSE)**: Real-time output via Server-Sent Events
- **Parameters**:
  - `senderEmail` (required)
  - `subjectContains` or `subjectEqual` (optional, mutually exclusive)
  - `receivedFrom` / `receivedTo` (optional date range)
  - `simulate` (default: true)
  - `allowHardDelete` (default: false)
  - `method` (ComplianceSearch or SearchMailbox)
  - `daysBack` (default: 30)

**Streaming Flow**:
1. Client requests with `?stream=true` or `Accept: text/event-stream`
2. Server spawns PowerShell child process
3. Tracks active purges in `activePurges` Map
4. Streams stdout/stderr as SSE events:
   - `start` - Purge initiated
   - `stdout` - PowerShell output chunk
   - `stderr` - Error output chunk
   - `end` - Completion with exit code and log entry
   - `error` - Fatal error
5. Logs execution to `logStore` for audit trail

#### `POST /api/purge-sender/cancel`
- Cancels running purge by request ID
- Kills PowerShell child process
- Returns cancellation status

#### `GET /api/purge-logs`
- Returns last 500 purge execution logs
- Includes timestamps, filters, exit codes, affected mailboxes

---

### 4. PowerShell Script (`PS.ps1`)

**Purpose**: Advanced email purge using Exchange Management Shell cmdlets.

**Workflow**:

1. **Prerequisites Check**
   - Load Exchange Management Shell
   - Verify required roles (Mailbox Search, Import Export)
   - Validate date formats and parameter conflicts

2. **Date Range Calculation**
   - Parse `FromDate` / `ToDate` (DD/MM/YYYY format)
   - Fallback to `DaysBack` if dates not provided
   - Build effective date range for search

3. **Build Search Query**
   - Construct KQL query: `kind:email AND From:sender@example.com`
   - Add date filters: `Received>=01/01/2024 AND Received<02/01/2024`
   - Add subject filters if specified

4. **Find Candidate Mailboxes**
   - Query `Get-MessageTrackingLog` for DELIVER events from sender
   - Extract unique recipient addresses
   - Resolve to mailbox objects
   - Fallback to all mailboxes if tracking logs unavailable

5. **Verify Active Messages**
   - Use `Search-Mailbox -EstimateResultOnly -SearchDumpster:$false`
   - Excludes Recoverable Items to focus on active messages
   - Returns only mailboxes with current matches

6. **Execute Deletion**
   - **ComplianceSearch Method** (recommended):
     1. Create `New-ComplianceSearch` with target mailboxes and query
     2. `Start-ComplianceSearch` and poll until completed
     3. Create `New-ComplianceSearchAction -Purge -PurgeType SoftDelete`
     4. Monitor purge action until completed
     5. If items remain and `AllowHardDelete=true`, run Search-Mailbox cleanup
   - **SearchMailbox Method** (legacy):
     1. Iterate each mailbox
     2. `Search-Mailbox -DeleteContent -Force` (hard delete)
     3. Limited to 10,000 items per mailbox

7. **Logging**
   - Writes structured logs to specified log file
   - Outputs to stdout for streaming capture
   - Includes affected mailbox list and item counts

**Key Features**:
- WhatIf mode for dry runs
- Preserves Recoverable Items by default (unless `AllowHardDelete`)
- Handles large organizations efficiently with ComplianceSearch
- Detailed progress logging

---

### 5. Log Store (`utils/logStore.js`)

**Purpose**: Persist purge execution history to JSONL file.

**Storage**:
- Default location: `backend/data/purge-actions.jsonl`
- Configurable via `PURGE_LOG_DIR` / `PURGE_LOG_FILE` env vars
- Each line is a JSON object with unique ID and timestamp

**Log Entry Structure**:
```json
{
  "id": "uuid",
  "timestamp": "2024-01-15T10:30:00Z",
  "requestId": "request-uuid",
  "senderEmail": "malicious@example.com",
  "subjectMode": "contains",
  "subjectValue": "Invoice",
  "receivedFrom": "2024-01-01T00:00:00Z",
  "receivedTo": "2024-01-31T23:59:59Z",
  "simulate": false,
  "allowHardDelete": false,
  "mode": "soft-delete",
  "method": "ComplianceSearch",
  "exitCode": 0,
  "status": "completed",
  "cancelled": false,
  "completedAt": "2024-01-15T10:35:00Z",
  "durationMs": 300000,
  "affectedMailboxes": ["user1@company.com", "user2@company.com"]
}
```

---

## Frontend Components

### 1. Application Structure (`App.jsx`)

**Routing**:
- `/search` - Search messages page
- `/delete` - Delete messages page
- `/logs` - Purge logs page
- Default redirect to `/search`

**Layout** (`components/Layout.jsx`):
- Navigation tabs between pages
- Consistent header and styling

---

### 2. Search Page (`pages/SearchPage.jsx` + `components/SearchSection.jsx`)

**User Flow**:

1. **Form Input**:
   - Sender email (optional)
   - Subject contains (optional)
   - Body contains (optional)
   - Keywords (comma-separated)
   - Date range (receivedFrom/To)
   - Attachments filter (all/with/without)
   - Importance level
   - Target folders (checkboxes: Inbox, JunkEmail, DeletedItems, SentItems)
   - Max results per mailbox (1-2000)

2. **Validation**:
   - At least sender or subject required
   - Date range validation (from <= to)

3. **Execution**:
   - Calls `POST /api/search` via TanStack Query mutation
   - Shows loading state during search
   - Displays mailbox count from `useMailboxes` hook

4. **Results Display**:
   - **Summary Metrics**: Total mailboxes scanned, mailboxes with matches, total messages
   - **Results List**: Expandable per-mailbox view
     - Mailbox email and display name
     - Match count
     - Table of messages with subject, sender, received date, folder, body preview
   - **Failures**: Lists mailboxes that couldn't be queried with error details
   - **Request ID**: For troubleshooting

---

### 3. Delete Page (`pages/DeletePage.jsx` + `components/DeleteSection.jsx`)

**User Flow**:

1. **Form Input**:
   - Sender email (required)
   - Subject filter mode: contains / equals / none
   - Subject value (disabled if mode=none)
   - Date range (sent on or after / before)
   - Deletion mode:
     - **Soft delete** (default): Move to Recoverable Items
     - **Hard delete**: Permanent removal (requires simulation disabled)
   - Simulate checkbox (default: enabled)

2. **Simulation Mode**:
   - When enabled:
     - Runs preview search via `POST /api/search`
     - Displays table of messages that would be deleted
     - Shows first 200 results
     - Hard delete option disabled
   - When disabled:
     - Shows confirmation modal requiring "DELETE" input
     - Executes live purge

3. **Execution**:
   - Calls `POST /api/purge-sender?stream=true`
   - Establishes SSE connection for real-time output
   - Displays live stdout/stderr in formatted log viewer
   - Color-codes log levels (INFO/WARNING/ERROR/SUCCESS)
   - Highlights key events (target mailboxes, affected mailboxes, verification)

4. **Cancellation**:
   - Cancel button appears during execution
   - Calls `POST /api/purge-sender/cancel` with request ID
   - Terminates PowerShell process
   - Shows cancellation status

5. **Results**:
   - Exit code and status (completed/failed/cancelled)
   - Log file path
   - Affected mailboxes list
   - Duration and timestamp
   - Persisted to logs database

---

### 4. Logs Page (`pages/LogsPage.jsx` + `components/LogsSection.jsx`)

**Features**:
- Fetches logs via `GET /api/purge-logs`
- Displays last 500 purge executions
- Sortable/filterable table:
  - Timestamp
  - Sender email
  - Subject filter
  - Date range
  - Mode (simulation/soft-delete/hard-delete)
  - Status (completed/failed/cancelled)
  - Exit code
  - Duration
  - Affected mailboxes count
- Expandable detail view per log entry
- Auto-refresh capability

---

## Data Flow Examples

### Example 1: Search Workflow

```
User fills search form
  ↓
Frontend validates (sender or subject required)
  ↓
POST /api/search { sender: "malicious@example.com", folders: ["Inbox"] }
  ↓
Backend validates with Joi schema
  ↓
exchangeService.searchMessages()
  ├─ getSearchableMailboxes() → 150 mailboxes
  ├─ buildAqsQuery() → 'from:"malicious@example.com"'
  ├─ PQueue processes 4 mailboxes concurrently
  │   ├─ Mailbox 1: impersonate → FindItems(Inbox) → 3 matches
  │   ├─ Mailbox 2: impersonate → FindItems(Inbox) → 0 matches
  │   ├─ Mailbox 3: impersonate → FindItems(Inbox) → 5 matches
  │   └─ Mailbox 4: impersonate → FindItems(Inbox) → ERROR (logged)
  └─ Aggregate results
  ↓
Response: { summary, results: [Mailbox1, Mailbox3], failures: [Mailbox4] }
  ↓
Frontend displays:
  - Summary: 150 scanned, 2 with matches, 8 total messages
  - Expandable list per mailbox with message table
  - Failure banner for Mailbox 4
```

### Example 2: Delete Workflow (Simulation)

```
User fills delete form with simulate=true
  ↓
Frontend calls POST /api/search (preview)
  ↓
Displays 200 messages that would be deleted
  ↓
User reviews and disables simulate
  ↓
Confirmation modal: "Type DELETE to confirm"
  ↓
User confirms
  ↓
POST /api/purge-sender?stream=true {
  senderEmail: "malicious@example.com",
  simulate: false,
  allowHardDelete: false,
  method: "ComplianceSearch"
}
  ↓
Backend spawns PowerShell process
  ↓
SSE stream starts:
  event: start → { requestId, logFile, startedAt }
  event: stdout → "[INFO] Loading Exchange Management Shell"
  event: stdout → "[INFO] Found 12 candidate mailboxes"
  event: stdout → "[INFO] Verification complete. 8 mailboxes contain active messages"
  event: stdout → "[INFO] Creating compliance search..."
  event: stdout → "[INFO] Search completed. Found 47 items in 8 locations"
  event: stdout → "[INFO] Purge action completed"
  event: end → { exitCode: 0, status: "completed", logEntry }
  ↓
Frontend displays:
  - Live log output with color coding
  - Completion banner with exit code
  - Log file path
  - Affected mailboxes list
  ↓
Log entry persisted to purge-actions.jsonl
  ↓
Logs page auto-refreshes to show new entry
```

### Example 3: Cancellation Workflow

```
User starts purge operation
  ↓
PowerShell process running (requestId: abc-123)
  ↓
User clicks Cancel button
  ↓
POST /api/purge-sender/cancel { requestId: "abc-123" }
  ↓
Backend finds active purge in activePurges Map
  ↓
Calls child.kill() on PowerShell process
  ↓
SSE stream receives:
  event: end → { status: "cancelled", cancelReason: "user_requested" }
  ↓
Frontend displays cancellation banner
  ↓
Log entry saved with cancelled=true
```

---

## Security Considerations

1. **Service Account Permissions**:
   - Requires `ApplicationImpersonation` role to access all mailboxes
   - Credentials stored in backend `.env` (never exposed to frontend)

2. **CORS Protection**:
   - `ALLOWED_ORIGINS` restricts frontend access
   - Credentials mode enabled for secure cookies

3. **Request Tracking**:
   - Every request gets unique UUID for audit trail
   - All operations logged with request ID

4. **Deletion Safety**:
   - Simulation mode enabled by default
   - Confirmation modal for live deletions
   - Soft delete preserves Recoverable Items
   - Hard delete requires explicit flag

5. **PowerShell Execution**:
   - Script path validated before execution
   - Process isolation with spawn
   - Timeout and cancellation support
   - Output sanitization

6. **Audit Trail**:
   - All purge operations logged to JSONL
   - Includes affected mailboxes, filters, timestamps
   - Immutable append-only log

---

## Error Handling

### Backend
- Structured error responses with status codes
- Request ID included in all errors
- Detailed logging with pino logger
- EWS errors wrapped with context

### Frontend
- TanStack Query handles network errors
- User-friendly error messages
- Request ID displayed for support
- Failure details per mailbox

### PowerShell
- Try-catch blocks around all operations
- Graceful fallbacks (e.g., tracking logs → all mailboxes)
- Detailed error logging to file and stdout
- Non-zero exit codes on failure

---

## Performance Optimizations

1. **Concurrent Processing**:
   - Backend uses PQueue to process mailboxes in parallel
   - Configurable concurrency limit (`EWS_MAX_CONCURRENCY`)

2. **Pagination**:
   - EWS queries paginated with configurable page size
   - Prevents memory issues with large result sets

3. **Streaming**:
   - SSE for real-time output without polling
   - Reduces server load and improves UX

4. **Caching**:
   - TanStack Query caches mailbox list
   - Reduces redundant API calls

5. **Efficient Queries**:
   - AQS queries leverage Exchange content index
   - ComplianceSearch method scales to large organizations

---

## Deployment Checklist

### Backend
1. Copy `.env.example` to `.env`
2. Configure EWS credentials and URL
3. Set `ALLOWED_ORIGINS` to frontend URL
4. Install dependencies: `npm install`
5. Start server: `npm start` (production) or `npm run dev` (development)

### Frontend
1. Copy `.env.example` to `.env`
2. Set `VITE_API_BASE_URL` to backend URL
3. Install dependencies: `npm install`
4. Build: `npm run build` or dev: `npm run dev`

### Exchange
1. Create service account
2. Assign `ApplicationImpersonation` role:
   ```powershell
   New-ManagementRoleAssignment -Name "UI-Impersonation" -Role ApplicationImpersonation -User serviceaccount
   ```
3. For SearchMailbox method, also assign:
   - Mailbox Search
   - Mailbox Import Export

### PowerShell Script
1. Ensure Exchange Management Shell available
2. Test script manually before automation
3. Configure log directory permissions

---

## Troubleshooting

### "Mailbox discovery failed"
- Check service account has ApplicationImpersonation role
- Verify EWS_URL or autodiscover email is correct
- Test connectivity to Exchange server

### "Search-Mailbox not available"
- Ensure running from Exchange Management Shell
- Check Mailbox Search role assignment
- Try ComplianceSearch method instead

### "Purge script not found"
- Verify PS.ps1 exists at expected path
- Check file permissions

### "Connection closed during streaming"
- Client disconnected - purge will be cancelled
- Check network stability
- Review firewall/proxy settings for SSE

### "No mailboxes found"
- Message tracking logs may be empty for date range
- Try expanding date range or using all mailboxes
- Check sender email spelling

---

## Summary

Exchange Remover provides a complete solution for email threat remediation:

1. **Search**: Fast, flexible queries across all mailboxes with real-time results
2. **Delete**: Safe, auditable deletions with simulation and confirmation
3. **Purge**: Advanced PowerShell-based operations with streaming output
4. **Audit**: Complete history of all operations with affected mailboxes

The architecture separates concerns cleanly:
- Frontend handles UX and validation
- Backend orchestrates EWS and PowerShell operations
- Exchange services provide the underlying functionality

All operations are logged, tracked, and reversible (when using soft delete), making it suitable for production incident response workflows.
