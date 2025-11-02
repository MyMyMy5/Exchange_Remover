# Node Packages Summary - Exchange Remover

## Backend Packages (`npm run dev` in `/backend`)

### Runtime Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| **cors** | ^2.8.5 | Cross-Origin Resource Sharing middleware - allows frontend to communicate with backend API from different origins |
| **dotenv** | ^16.4.5 | Loads environment variables from `.env` file into `process.env` for configuration management |
| **express** | ^4.19.2 | Web application framework - handles HTTP routing, middleware, and request/response processing |
| **ews-javascript-api** | ^0.15.3 | Exchange Web Services client library - communicates with Exchange Server for mailbox operations |
| **http-errors** | ^2.0.0 | Creates HTTP error objects with status codes and messages for consistent error handling |
| **joi** | ^17.12.0 | Schema validation library - validates and sanitizes API request payloads |
| **morgan** | ^1.10.0 | HTTP request logger middleware - logs incoming requests (not actively used, pino preferred) |
| **pino** | ^9.0.0 | High-performance JSON logger - structured logging for all application events |
| **pino-pretty** | ^11.0.0 | Prettifies pino logs for human-readable console output during development |
| **p-queue** | ^8.0.1 | Promise-based queue with concurrency control - manages parallel mailbox processing |
| **uuid** | ^9.0.1 | Generates RFC4122 UUIDs - creates unique request IDs for tracking and debugging |

### Development Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| **eslint** | ^8.57.0 | JavaScript linter - enforces code quality and style standards |
| **eslint-config-prettier** | ^9.1.0 | Disables ESLint rules that conflict with Prettier formatting |
| **eslint-plugin-import** | ^2.29.1 | Validates ES6 import/export syntax and prevents import errors |
| **nodemon** | ^3.1.3 | Auto-restarts Node.js server on file changes during development |

---

## Frontend Packages (`npm run dev` in `/frontend`)

### Runtime Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| **@tanstack/react-query** | ^5.51.1 | Data fetching and state management - handles API calls, caching, and synchronization |
| **axios** | ^1.7.2 | HTTP client - makes REST API requests to backend with interceptors and error handling |
| **clsx** | ^2.1.1 | Utility for constructing className strings conditionally - simplifies dynamic CSS classes |
| **react** | ^18.3.1 | Core React library - component-based UI framework |
| **react-dom** | ^18.3.1 | React DOM renderer - bridges React components to browser DOM |
| **react-hook-form** | ^7.51.3 | Form state management and validation - handles form inputs with minimal re-renders |
| **react-router-dom** | ^6.26.2 | Client-side routing - manages navigation between Search, Delete, and Logs pages |

### Development Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| **@eslint/js** | ^9.9.0 | ESLint JavaScript configuration - base rules for linting |
| **@vitejs/plugin-react** | ^4.3.1 | Vite plugin for React - enables Fast Refresh and JSX transformation |
| **eslint** | ^9.9.0 | JavaScript linter - enforces code quality standards |
| **eslint-config-prettier** | ^9.1.0 | Disables conflicting ESLint rules for Prettier compatibility |
| **eslint-plugin-jsx-a11y** | ^6.9.0 | Accessibility linting for JSX - ensures WCAG compliance |
| **eslint-plugin-react** | ^7.35.0 | React-specific linting rules - enforces React best practices |
| **eslint-plugin-react-hooks** | 6.0.0-rc.1 | Validates React Hooks usage - prevents common Hook mistakes |
| **vite** | ^5.4.2 | Build tool and dev server - fast HMR, optimized bundling, ES modules support |

---

## Package Categories by Function

### Backend

**Web Framework & Middleware**
- `express` - Core HTTP server
- `cors` - Cross-origin request handling
- `morgan` - Request logging (legacy)

**Exchange Integration**
- `ews-javascript-api` - EWS client for mailbox operations

**Validation & Error Handling**
- `joi` - Request payload validation
- `http-errors` - Standardized error objects

**Logging**
- `pino` - Structured JSON logging
- `pino-pretty` - Development log formatting

**Utilities**
- `dotenv` - Environment configuration
- `uuid` - Unique ID generation
- `p-queue` - Concurrency control

**Development**
- `nodemon` - Auto-reload on file changes
- `eslint` + plugins - Code quality enforcement

### Frontend

**UI Framework**
- `react` - Component library
- `react-dom` - DOM rendering

**Routing & Navigation**
- `react-router-dom` - Client-side routing

**Data Management**
- `@tanstack/react-query` - Server state management
- `axios` - HTTP client

**Forms**
- `react-hook-form` - Form state and validation

**Styling**
- `clsx` - Conditional class names

**Build & Development**
- `vite` - Dev server and bundler
- `@vitejs/plugin-react` - React integration
- `eslint` + plugins - Linting and accessibility

---

## Key Package Interactions

### Backend Flow
```
express → cors → dotenv → routes
    ↓
joi (validation) → exchangeService
    ↓
ews-javascript-api + p-queue → Exchange Server
    ↓
pino (logging) → console/file
    ↓
uuid (request tracking) → response headers
```

### Frontend Flow
```
vite (dev server) → react + react-dom
    ↓
react-router-dom (routing) → pages
    ↓
react-hook-form (forms) → validation
    ↓
@tanstack/react-query → axios → backend API
    ↓
clsx (styling) → conditional CSS classes
```

---

## Development Commands

### Backend
```bash
npm run dev    # Start with nodemon (auto-reload)
npm start      # Production mode
npm run lint   # Run ESLint
```

### Frontend
```bash
npm run dev      # Start Vite dev server (HMR enabled)
npm run build    # Production build
npm run preview  # Preview production build
npm run lint     # Run ESLint
```

---

## Version Requirements

Both projects require **Node.js >= 18** as specified in `engines` field.

---

## Notable Package Choices

1. **pino over morgan**: High-performance structured logging vs traditional HTTP logging
2. **p-queue**: Essential for controlling concurrent EWS operations to prevent server overload
3. **TanStack Query**: Modern alternative to Redux for server state management
4. **Vite over Webpack**: Faster dev server with native ES modules
5. **react-hook-form**: Minimal re-renders compared to traditional form libraries
6. **ews-javascript-api**: Only mature JavaScript library for Exchange Web Services

---

## Security Considerations

- **dotenv**: Never commit `.env` files - contains sensitive credentials
- **cors**: Properly configure `ALLOWED_ORIGINS` in production
- **joi**: Always validate user input before processing
- **axios**: Credentials never exposed to frontend (backend proxy pattern)
- **uuid**: Request IDs aid in security audit trails

---

## Performance Impact

**High Performance**:
- `pino` - Minimal overhead logging
- `p-queue` - Prevents resource exhaustion
- `vite` - Fast HMR and optimized builds
- `@tanstack/react-query` - Intelligent caching

**Moderate Performance**:
- `ews-javascript-api` - Depends on Exchange Server response times
- `react-hook-form` - Uncontrolled components reduce re-renders

**Development Only**:
- `nodemon`, `eslint`, `vite` dev server - Not included in production builds
