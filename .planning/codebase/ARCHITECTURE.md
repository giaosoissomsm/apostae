<!-- refreshed: 2026-07-14 -->
# Architecture

**Analysis Date:** 2026-07-14

## System Overview

ApostaE is a Node.js betting platform implementing a three-tier request-response architecture with asynchronous scheduled tasks. The system routes HTTP requests through middleware, controllers, services, and repositories to PostgreSQL/Redis backends, serving both a REST API and SPA frontend.

```text
┌─────────────────────────────────────────────────────────────────────┐
│                        Frontend (SPA)                               │
│  `public/index.html`, `public/admin.html` — Client-side routing    │
└────────┬────────────────────────────────────────────────────────────┘
         │
         │ HTTP Requests
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Express Server (server.js)                       │
│              Routes → Middleware → Controllers                      │
│  `src/routes/auth.js`, `src/routes/markets.js`, etc.               │
├─────────────────────────────────────────────────────────────────────┤
│  Middleware Layer (Authentication, Error Handling, CORS)           │
│  `src/middleware/auth.js` - JWT + Session validation                │
│  `src/middleware/errorHandler.js` - Centralized error handling      │
└────────┬────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│               Controllers (Business Logic Handlers)                 │
│  `src/controllers/authController.js`                                │
│  `src/controllers/marketsController.js`                             │
│  `src/controllers/wagersController.js`                              │
│  `src/controllers/usersController.js`                               │
├─────────────────────────────────────────────────────────────────────┤
│                   Services (Domain Logic)                           │
│  `src/services/authService.js` - User registration, login, sessions │
│  `src/services/marketService.js` - Market CRUD, resolution logic    │
│  `src/services/wagerService.js` - Wager placement, payouts          │
│  `src/services/userService.js` - User management                    │
├─────────────────────────────────────────────────────────────────────┤
│                 Repositories (Data Access Layer)                    │
│  `src/repositories/userRepository.js`                               │
│  `src/repositories/marketRepository.js`                             │
│  `src/repositories/wagerRepository.js`                              │
│  `src/repositories/walletRepository.js`                             │
└────────┬────────────────────────────────────────────────────────────┘
         │
         ├──────────────────┬──────────────────┐
         │                  │                  │
         ▼                  ▼                  ▼
    ┌─────────┐        ┌────────┐        ┌─────────┐
    │PostgreSQL        │ Redis  │        │Scheduler │
    │Database  │       │ Cache  │        │Service  │
    │`server.js`:      │Session │        │`scheduler.js`│
    │config/database.js│Storage│        │Auto-close/  │
    └─────────┘        └────────┘        │reveal mkts  │
                                         └─────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| **Routes** | Map HTTP verbs/paths to controllers | `src/routes/*.js` |
| **Controllers** | Parse requests, call services, format responses | `src/controllers/*.js` |
| **Services** | Implement domain logic, validation, orchestration | `src/services/*.js` |
| **Repositories** | Encapsulate database queries with prepared statements | `src/repositories/*.js` |
| **Middleware** | Authentication, error handling, CORS, request logging | `src/middleware/*.js` |
| **Config** | Database pools, Redis clients, environment variables | `src/config/*.js` |
| **Utils** | Custom error classes, logger | `src/utils/*.js` |
| **Scheduler** | Background task runner for market auto-close/reveal | `src/scheduler.js` |
| **Frontend** | Single-page app with vanilla JS, API client | `public/**` |

## Pattern Overview

**Overall:** Layered MVC with Service and Repository patterns

**Key Characteristics:**
- **Request-Response Cycle:** All API calls follow Route → Controller → Service → Repository → Database
- **Service Orchestration:** Services contain business logic and coordinate between repositories and cross-cutting concerns
- **Error Standardization:** Custom error classes (ValidationError, AuthenticationError, etc.) with HTTP status codes
- **Async/Await:** All async operations use promises; `catchAsync` wrapper prevents unhandled rejections
- **Middleware Stack:** Express middleware for auth, error handling, logging (development only)
- **Soft Deletes:** Users and audit-related records use `deleted_at` timestamps instead of hard deletes
- **Optimistic Concurrency:** Markets and wagers use transactions with FOR UPDATE locks during resolution

## Layers

**Routes Layer:**
- Purpose: Map HTTP verbs/paths to controller handlers
- Location: `src/routes/`
- Contains: Express Router instances defining endpoints, middleware chains (requireAuth, requireAdmin)
- Depends on: Controllers, middleware
- Used by: Express app (`server.js`)
- Pattern: One route file per resource (auth, users, markets, wagers, leaderboard, sessions)

**Controllers Layer:**
- Purpose: Handle HTTP request/response, parse input, delegate to services
- Location: `src/controllers/`
- Contains: Handler functions wrapped with `catchAsync` to prevent unhandled promise rejections
- Depends on: Services, error handlers
- Used by: Routes
- Pattern: One controller per resource with methods like `register`, `login`, `listMarkets`, etc.

**Services Layer:**
- Purpose: Implement domain logic, validation, transaction coordination
- Location: `src/services/`
- Contains: Class-based services (instantiated as singletons) with methods for business operations
- Depends on: Repositories, utilities (logger, errors, config)
- Used by: Controllers
- Pattern: Services call repositories for data access; handle cross-cutting concerns like logging, error translation
- Example: `authService.login()` validates credentials, creates session in Redis, generates JWT, logs audit event

**Repositories Layer:**
- Purpose: Abstract database access with prepared statements and query builders
- Location: `src/repositories/`
- Contains: Class-based repositories with CRUD methods
- Depends on: Database config (pool, transaction helpers)
- Used by: Services
- Pattern: Repositories accept optional `client` parameter for transaction support; use parameterized queries exclusively
- Transactions: Called from services via `transaction()` helper for multi-step operations like market resolution

**Middleware Layer:**
- Purpose: Cross-cutting concerns (auth, error handling, logging)
- Location: `src/middleware/`
- Contains: Express middleware functions and helpers
- Key files:
  - `auth.js`: `requireAuth` validates JWT + Redis session; `requireAdmin` checks role; `requirePermission` (permission-based)
  - `errorHandler.js`: Centralized error handler (must be registered last) and `catchAsync` wrapper
- Depends on: Config (JWT secret, env)
- Used by: Routes and Express app
- Session model: JWT payload contains `sessionId`; session data stored in Redis with TTL; timed out on inactivity or reached absolute timeout

**Configuration Layer:**
- Purpose: Centralize environment variables and connection pools
- Location: `src/config/`
- Contains:
  - `env.js`: All env vars with defaults; validates required vars in production
  - `database.js`: PostgreSQL pool with query wrapper, transaction helper, client getter
  - `redis.js`: Redis client with connect/get/set/del/delPattern/expire/ttl helpers
- Depends on: dotenv
- Used by: All other layers

**Utilities:**
- Location: `src/utils/`
- Logger: `logger.js` — Structured logging with levels (error, warn, info, debug)
- Errors: `errors.js` — Error class hierarchy (AppError, ValidationError, AuthenticationError, etc.) with standardized HTTP status codes

## Data Flow

### Primary Request Path (HTTP Endpoint)

1. **HTTP Request received** → Express middleware stack
   - CORS enabled globally
   - JSON/URL-encoded body parsing (10MB limit)
   - Dev logging (optional)

2. **Route matching** (`src/routes/*.js`)
   - Maps to controller handler
   - Middleware chain applied (e.g., requireAuth on /api/users)

3. **Authentication Check** (`src/middleware/auth.js` — requireAuth)
   - Extracts Bearer token from Authorization header
   - Verifies JWT signature using JWT_SECRET
   - Validates sessionId exists in Redis and hasn't timed out
   - Checks session age against SESSION_ABSOLUTE_TIMEOUT (max lifetime from login)
   - Queries user record to verify not deleted/deactivated
   - Renews session TTL in Redis (inactivity timeout)
   - Attaches `req.user` and `req.sessionId` to request

4. **Permission Check** (if requireAdmin or requirePermission)
   - Checks role_id (2 = admin) or joins role_permissions/permissions tables

5. **Controller Handler** (`src/controllers/*.js`)
   - Parses request parameters, body, query string
   - Calls service method(s)
   - Catches exceptions (wrapped by catchAsync)
   - Returns JSON response

6. **Service Method** (`src/services/*.js`)
   - Validates input using custom logic or Joi schema
   - Throws domain-specific errors (ValidationError, ConflictError, etc.)
   - Calls one or more repository methods
   - May coordinate transactions via `transaction()` helper
   - Logs significant events via logger

7. **Repository Query** (`src/repositories/*.js`)
   - Builds parameterized SQL (prevents SQL injection)
   - Executes via pool or transaction client
   - Returns raw rows from database

8. **Response Sent** to client
   - 2xx status with JSON body
   - Error responses: status code from error.statusCode, JSON error object

9. **Error Handling** (if exception thrown)
   - Caught by `catchAsync` wrapper or Express error handler
   - Passed to `errorHandler` middleware (last in stack)
   - Logs error (500s logged as errors, 4xx as warnings)
   - Returns JSON error response with status code

### Scheduler Flow (Automatic Market State Transitions)

1. **Server Startup** (`server.js` bootstrap)
   - Calls `startScheduler()` from `src/scheduler.js`
   - Immediately runs `tick()` once (catch up on markets that passed timeout while offline)
   - Sets `setInterval(tick, 10000)` — runs every 10 seconds

2. **Scheduler Tick** (`src/scheduler.js` tick function)
   - Queries `marketRepository.findDueToClose()` — markets with status='open' and closes_at ≤ now
   - For each: Calls `marketService.closeMarket(marketId)` → updates status to 'closed'
   - Queries `marketRepository.findDueToReveal()` — markets with reveal_at ≤ now and scheduled_outcome set
   - For each: Calls `marketService.resolveMarket(marketId, scheduledOutcome)` → resolves and pays out wagers

3. **Market Resolution** (transaction inside service)
   - Fetches all pending wagers for market
   - Calculates payouts (amount × odds_at_time for winners)
   - Updates wallet balances in atomic transaction
   - Updates wager statuses (won/lost/refunded)

**State Management:**
- Request state: Attached to `req` object (user, sessionId, permissions)
- Session state: Stored in Redis with TTL (expires on inactivity or max session age)
- Database state: Persistent in PostgreSQL; queries always parameterized
- No module-level mutable singletons except connection pools (pool, redis.client)

## Key Abstractions

**Session Model:**
- Purpose: Track authenticated user activity with dual timeout (inactivity + absolute max age)
- Implementation:
  - JWT contains userId and sessionId
  - Session data (userId, username, roleId, createdAt) stored in Redis as `session:{sessionId}`
  - inactivity timeout: SESSION_TIMEOUT (default 30 min) — renewed per request
  - absolute timeout: SESSION_ABSOLUTE_TIMEOUT (default 30 min) — fixed from login, blocks extension
  - Logout invalidates Redis key
  - Password change invalidates all user's sessions
  
**Market Lifecycle:**
- States: open → closed → resolved
- Transitions:
  - open → closed: Manual admin action or scheduler (closes_at reached)
  - closed → resolved: Admin specifies outcome, or scheduler uses scheduled_outcome
  - Resolution triggers payout calculation (winners get amount × odds_at_time)
- Sensitive data: scheduled_outcome hidden from non-admins to prevent spoilers

**Wager Model:**
- Immutable once created (amount, choice, odds_at_time, potential_payout captured at creation)
- Status transitions: pending → (won|lost|refunded|voided) once market resolves
- Refunded: If market deleted while pending
- Voided: If market marked as disputed/invalid

**User Role & Permission System:**
- Roles: user (1) = limited permissions; admin (2) = all permissions
- Permissions: Granular capabilities (create_market, edit_market, resolve_market, manage_users, view_audit_logs, change_password)
- Joined via role_permissions bridge table
- Queried on-demand in requirePermission middleware

## Entry Points

**HTTP Server:**
- Location: `server.js`
- Triggers: `npm start` or `npm run dev`
- Responsibilities:
  1. Loads environment config
  2. Creates Express app, configures middleware
  3. Mounts route handlers (/api/auth, /api/markets, etc.)
  4. Serves static frontend from `public/`
  5. Connects to PostgreSQL and Redis
  6. Runs pending migrations
  7. Initializes default roles, permissions, admin user
  8. Starts scheduler
  9. Binds to PORT and awaits requests
  10. Handles SIGTERM/SIGINT gracefully

**Scheduler:**
- Location: `src/scheduler.js` → launched by `server.js`
- Triggers: Every 10 seconds
- Responsibilities: Auto-close and auto-reveal markets based on configured timestamps

**Frontend Routes (SPA):**
- `/` - Dashboard (markets, my wagers, ranking)
- `/admin.html` - Admin panel (market creation, user management)
- `/profile.html` - User profile and settings
- `/login.html` - Login form (served on 401 by backend)
- Client-side router handles hash-based navigation (Vue/React not used; vanilla JS)

## Architectural Constraints

- **Threading:** Node.js single-threaded event loop; async I/O handles concurrency without workers
- **Global state:** 
  - PostgreSQL pool (`src/config/database.js:pool`) — shared across all requests
  - Redis client (`src/config/redis.js:client`) — shared; uses pipeline/watch for atomic ops when needed
  - No module-level mutable singletons except pools
- **Circular imports:** Repositories do not import services; services import repositories to avoid cycles
- **Prepared statements:** All SQL uses $1, $2 parameterization; never string concatenation
- **Transactions:** Market resolution and wager payouts use explicit BEGIN/COMMIT/ROLLBACK with FOR UPDATE locks
- **Session storage:** Redis-only (ephemeral); not persisted to PostgreSQL
- **NUMERIC precision:** PostgreSQL NUMERIC columns auto-converted to float by pool config; frontend uses .toFixed() for display
- **Soft deletes:** Users have deleted_at timestamp; queries filter by deleted_at IS NULL
- **CORS:** Globally enabled (no origin restrictions); consider tightening in production
- **Rate limiting:** Package express-rate-limit imported but not yet integrated into routes

## Anti-Patterns

### Unvalidated Market Closing

**What happens:** Controller accepts market close without checking current state or permissions

**Why it's wrong:** Could close already-resolved markets or allow race conditions

**Do this instead:** `marketService.closeMarket()` (`src/services/marketService.js:75`) validates status='open' before transition; uses transaction with FOR UPDATE lock

### Exposed Scheduled Outcome to Non-Admins

**What happens:** Early versions returned scheduled_outcome in listMarkets response to all users

**Why it's wrong:** Reveals the answer before reveal_at, defeating betting mechanics

**Do this instead:** `sanitizeMarket()` helper (`src/services/marketService.js:48-51`) removes scheduled_outcome when !isAdmin; controller checks `req.user.roleId === 2` before passing flag to service

### Session Timeout Without Absolute Limit

**What happens:** Inactivity timeout alone allows continuous session renewal

**Why it's wrong:** Long-lived tokens vulnerable to session hijacking if credentials leaked

**Do this instead:** Dual timeout model in `src/middleware/auth.js:40-42` enforces both inactivity (renewed per request) and absolute max age (fixed from login); requireAuth checks both via SESSION_TIMEOUT and SESSION_ABSOLUTE_TIMEOUT

### Unencrypted Password Storage

**What happens:** Early design stored passwords as plain text in users table

**Why it's wrong:** Breach exposes all credentials immediately

**Do this instead:** `authService.register()` hashes with bcryptjs (salt rounds from BCRYPT_ROUNDS env); `compareSync()` used during login (`src/services/authService.js:39, 65`)

## Error Handling

**Strategy:** Custom error class hierarchy with standardized HTTP status codes

**Patterns:**
- **ValidationError (400):** User input fails schema or business rule checks (missing field, invalid odds range, duplicate username)
  - Thrown by services and repositories
  - Controller catches via `catchAsync` wrapper
  - Error handler returns 400 JSON with error message and optional details array
  
- **AuthenticationError (401):** Missing/invalid token, expired session, user deleted
  - Thrown in `requireAuth` middleware
  - Returned to client to trigger re-login
  
- **AuthorizationError (403):** User lacks permission or role
  - Thrown in `requireAdmin` and `requirePermission` middleware
  - Returned with "Access denied" message
  
- **NotFoundError (404):** Resource doesn't exist
  - Thrown when repository.findById() returns null and service expects entity to exist
  - Client should show 404 UI

- **ConflictError (409):** State conflict (username already taken, market already resolved)
  - Thrown by services during validation
  - Indicates retry won't help without user action

- **AppError (500):** Base class for operational errors
  - Includes `isOperational` flag to distinguish from programming errors
  - Stack trace included in dev mode only

- **Database/SQL Errors:** Caught and re-thrown as AppError with generic message
  - Details logged but not exposed to client (security)
  - SQL injection attempts detected and logged with user/IP for audit

## Cross-Cutting Concerns

**Logging:** 
- Framework: Console-based with JSON; production-ready for ELK/Datadog
- Levels: error, warn, info, debug; controlled by LOG_LEVEL env
- Key events: User registration, login, logout, password change, market creation, market resolution
- Structured: Includes timestamp, level, message, optional data object

**Validation:** 
- Input: Via custom checks in services (e.g., isValidOdds function in marketService)
- Schema: Joi library imported but not consistently applied yet (marked for migration)
- Timing: Happens in service layer before repository call

**Authentication:** 
- Transport: Bearer token in Authorization header
- Token: JWT with userId and sessionId
- Storage: Session data in Redis; TTL-based expiration
- Renewal: Via POST /api/auth/logout and session timeout at hardcoded 30 min

**Audit Logging:**
- Sensitive actions recorded to audit_logs table: login, logout, password changes, admin actions
- Fields: action, admin_id, target_user_id, ip_address, changes (JSONB), details text, created_at
- Queries: `SELECT * FROM audit_logs` via /api/users/audit-logs/list (admin only)

---

*Architecture analysis: 2026-07-14*
