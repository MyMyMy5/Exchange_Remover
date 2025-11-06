# Exchange Message Management UI

End-to-end tooling to search and purge malicious messages across every Exchange mailbox from a single management UI. The
stack consists of an Express API that talks to Exchange Web Services (EWS) and a React frontend used by operations
teams.

## Repository structure

- `backend/` � Node.js service exposing search and delete endpoints backed by EWS.
- `frontend/` � React/Vite UI for analysts to run searches and deletions.
- `AGENTS.md` � Specification provided by the project owner.

## Prerequisites

- Node.js 18 or newer on the machine that will host the UI/API.
- A service account in Exchange with application impersonation rights over the mailboxes you need to manage.
- EWS connectivity from the API host to the Exchange server (for on-prem environments this is typically
  `https://<exchange-host>/EWS/Exchange.asmx`).
- Optional: trusted certificate chain, or set `EWS_IGNORE_SSL=true` during development.

## Backend setup (`backend/`)

1. Copy `.env.example` to `.env` and set the fields:
   - `EWS_URL` or `EWS_AUTODISCOVER_EMAIL` (one is required).
   - `EWS_USERNAME` / `EWS_PASSWORD` (service account credentials).
   - `EWS_DOMAIN` if you are using domainackslash style auth instead of UPN.
   - `ALLOWED_ORIGINS` to the URL where the frontend will be served.
2. Install dependencies and start the server:

   ```powershell
   cd backend
   npm install
   npm run dev # or npm start for production
   ```

3. The API serves three routes under `/api`:
   - `GET /api/mailboxes` � discovery helper (returns primary SMTP and display name for searchable mailboxes).
   - `POST /api/search` � accepts filters and returns matching messages per mailbox.
   - `POST /api/delete` � accepts filters plus `deleteMode`/`simulate` flags to dry-run or execute deletions.

> **Note:** The service relies on EWS impersonation to iterate every mailbox. Ensure the service account has
> `ApplicationImpersonation` (or equivalent) rights. For CU22+ servers this typically means running something like:
>
> ```powershell
> New-ManagementRoleAssignment -Name "UI-Impersonation" -Role ApplicationImpersonation -User administrator
> ```

## Frontend setup (`frontend/`)

1. Copy `.env.example` to `.env` and set `VITE_API_BASE_URL` to the backend URL (for local dev: `http://localhost:5000/api`).
2. Install dependencies and start Vite:

   ```powershell
   cd frontend
   npm install
   npm run dev
   ```

3. Open the browser at the host/port shown in the terminal (default `http://localhost:5173`).

The UI exposes two panels:

- **Search Messages** � run targeted searches (sender, subject, date range, folder filters, etc.) and inspect per-mailbox
  results before taking action.
- **Delete Messages** � perform organisation-wide simulations or live deletions. The simulation flag is on by default;
  disable it once you are confident in the filters.

## Operational guidance

- Always begin with a search to verify the sender/address combination before deleting.
- Keep `simulate` enabled for the first run in the Delete panel�this mirrors the deletion logic but does not remove the
  items, giving you counts per mailbox.
- Use mailbox failures surfaced in the UI to adjust permissions or remediate connectivity issues before re-running the
  workflow.
- Adjust `DEFAULT_FOLDERS`, `DEFAULT_MAX_RESULTS`, and `EWS_MAX_CONCURRENCY` in the backend `.env` to tune performance for
  large environments.

## Testing

There are no automated tests bundled because the implementation depends on a live Exchange environment. You can manually
verify flows by creating test mailboxes and sending known messages, then running the search/delete workflows.

## Security considerations

- Store the backend `.env` securely; it contains high privilege credentials.
- Prefer HTTPS everywhere and trusted certificates.
- Restrict network access to the API to trusted management subnets or wrap it with additional authentication (e.g.,
  reverse proxy with SSO).
- Review audit logs after deletions to ensure traceability for incident response.
