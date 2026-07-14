<!-- GSD:project-start source:PROJECT.md -->

## Project

**ApostaE**

ApostaE is a Node.js/Express betting platform where users deposit into a wallet, place wagers on markets (currently binary Sim/Não), and get paid out when markets resolve. It has PostgreSQL persistence, Redis caching, a layered Controller/Service/Repository architecture, and an admin panel for managing markets. This milestone expands it with notifications, partial cashout, richer market types, and fee-based cancellation.

**Core Value:** Money movement (wallet balance, wagers, cashouts, cancellations) must always be correct and auditable — a user's balance must never diverge from the sum of their recorded transactions, even under concurrent access.

### Constraints

- **Security**: Every new endpoint must validate permissions server-side only, never trust client-submitted values (amounts, IDs, status), guard against IDOR, use parameterized queries — per requisitos.txt's OWASP ASVS/Top 10 checklist
- **Financial integrity**: Every operation touching balance/wallet/wager/cashout/cancellation must run inside a PostgreSQL transaction; every balance change must produce a corresponding audit/movement record — no direct balance mutation
- **Concurrency**: Must be safe under simultaneous cashouts, simultaneous cancellations, concurrent market updates, concurrent balance changes — use locking/transactions where needed
- **Process**: One feature fully implemented, reviewed, and tested before starting the next (requisitos.txt) — the roadmap should reflect this as sequential phases, not parallel ones
- **Architecture**: New code must follow the existing Controller/Service/Repository layering and conventions documented in `.planning/codebase/CONVENTIONS.md`

<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->

## Technology Stack

## Languages

- JavaScript (Node.js runtime) — Backend API and core business logic in `src/`, `server.js`
- HTML5 — Frontend templates in `public/*.html`
- CSS3 — Styling in `public/css/style.css`
- JavaScript (Vanilla ES6) — Frontend client code in `public/js/`

## Runtime

- Node.js (version unspecified, assumed 16.x+)
- CommonJS modules (`"type": "commonjs"` in `package.json`)
- npm
- Lockfile: `package-lock.json` present (61KB)

## Frameworks

- Express.js ^4.19.2 — HTTP server and routing in `server.js`, `src/routes/*`
- CORS ^2.8.5 — Cross-origin request handling in `server.js` (line 41)
- pg (node-postgres) ^8.11.3 — PostgreSQL driver in `src/config/database.js`
- redis ^4.6.14 — Redis client for caching and sessions in `src/config/redis.js`
- jsonwebtoken ^9.0.2 — JWT token generation and validation in `src/services/authService.js` (lines 1, 91-94)
- bcryptjs ^2.4.3 — Password hashing (10 rounds) in `src/services/authService.js` (lines 39, 168)
- express-rate-limit ^7.1.5 — Rate limiting middleware (integrated via npm dependency)
- joi ^17.12.0 — Request validation framework (loaded via npm, used in middleware/routes)
- dotenv ^16.4.5 — Environment variable loading in `src/config/env.js` (line 1)
- uuid ^9.0.1 — Session ID generation in `src/services/authService.js` (line 4, 74)
- nodemon ^3.0.2 — Development file watcher (dev dependency only)

## Key Dependencies

- pg ^8.11.3 — PostgreSQL connection pooling and query execution. Connection pool max 20 concurrent connections configured in `src/config/database.js` (line 16). Uses prepared statements to prevent SQL injection.
- redis ^4.6.14 — Session storage and cache backend. Configured with reconnect strategy (max 10 retries) in `src/config/redis.js` (lines 6-14). Default TTL 300s (5 min) for cache, configurable via `REDIS_CACHE_TTL` env var.
- jsonwebtoken ^9.0.2 — Stateless JWT authentication tokens. Secret loaded from `JWT_SECRET` env var. Expiry configured via `JWT_EXPIRES_IN` env var (default 8h).
- bcryptjs ^2.4.3 — Password hashing with configurable rounds (default 10) via `BCRYPT_ROUNDS` env var in `src/config/env.js`.
- express-rate-limit ^7.1.5 — Throttles request rates (implementation in middleware, prevents abuse).

## Configuration

- `.env` file (not committed, contains secrets)
- `.env.example` file documents required variables
- Environment variables define all runtime configuration via `src/config/env.js`
- No build step required (CommonJS modules loaded directly)
- Frontend is static files served from `public/`
- Database migrations run on server startup via `scripts/migrate.js`

## Platform Requirements

- Node.js 16.x or higher (tested with implicit Node version in npm scripts)
- PostgreSQL 10+ (uses standard SQL with no vendor-specific features)
- Redis 5+ (uses basic key-value operations)
- npm (for package management)
- Node.js 16.x or higher (LTS recommended)
- PostgreSQL 10+ (same as development)
- Redis 5+ (same as development)
- Reverse proxy recommended (Express trusts `X-Forwarded-For` from `172.16.0.0/12` internal networks in `server.js` line 35)
- Graceful shutdown support (SIGTERM/SIGINT handlers in `server.js` lines 156-157)

## Special Features

- `GET /health` — Tests PostgreSQL and Redis connectivity in `server.js` (lines 61-78)
- Market closure and resolution jobs run every 10 seconds via `src/scheduler.js`
- No external job queue required (in-process timer)
- Dual-layer timeout: inactivity timeout (renewed per request) + absolute session timeout (prevents hijacking)
- Sessions stored in Redis, not database (fast, non-persistent across restarts)

<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

## Naming Patterns

- Service files: `camelCase` + `Service.js` suffix (e.g., `authService.js`, `userService.js`, `marketService.js`)
- Controller files: `camelCase` + `Controller.js` suffix (e.g., `authController.js`, `usersController.js`)
- Repository files: `camelCase` + `Repository.js` suffix (e.g., `userRepository.js`, `marketRepository.js`)
- Middleware files: `camelCase.js` (e.g., `auth.js`, `errorHandler.js`)
- Route files: lowercase plural or single name (e.g., `auth.js`, `users.js`, `markets.js`)
- Utility files: descriptive lowercase (e.g., `logger.js`, `errors.js`)
- Configuration files: descriptive lowercase (e.g., `database.js`, `redis.js`, `env.js`)
- Route handlers: `camelCase` (e.g., `register`, `login`, `listUsers`, `createMarket`)
- Service methods: `camelCase` (e.g., `getUser`, `listMarkets`, `closeMarket`, `resolveMarket`)
- Repository methods: `camelCase` with `find`/`create`/`update`/`delete` prefixes (e.g., `findById`, `findByUsername`, `create`, `updatePassword`, `softDelete`)
- Middleware functions: `camelCase` (e.g., `requireAuth`, `requireAdmin`, `catchAsync`)
- Helper functions: `camelCase` with action verbs (e.g., `normalizeDateTime`, `parseSchedule`, `sanitizeMarket`, `isValidOdds`)
- Local variables: `camelCase` (e.g., `userId`, `sessionId`, `passwordHash`, `isAdmin`, `userAgent`)
- SQL parameters: `camelCase` when destructuring (e.g., `{ username, email, password }`)
- Database column aliases: `snake_case` matching database schema (e.g., `role_name`, `created_at`, `password_hash`)
- Boolean flags: prefix with `is` or `has` (e.g., `isActive`, `isAdmin`, `isOperational`, `hasPermission`)
- Error classes: `PascalCase` (e.g., `ValidationError`, `AuthenticationError`, `NotFoundError`, `ConflictError`)
- Service/Repository classes: `PascalCase` (e.g., `UserService`, `AuthService`, `UserRepository`)
- Exported instances: lowercase singleton references (e.g., `module.exports = new UserRepository()`)
- Environment variables: `UPPER_SNAKE_CASE` (e.g., `NODE_ENV`, `JWT_SECRET`, `SESSION_TIMEOUT`)
- Application constants: `UPPER_SNAKE_CASE` (e.g., `TICK_MS`, `BCRYPT_ROUNDS`)
- Module-level configuration: `camelCase` objects (e.g., `levels`, `levels.error`, `currentLevel`)

## Code Style

- No formatter configured (no ESLint/Prettier)
- Indentation: 2 spaces (inferred from codebase)
- Line length: No strict limit observed (~100-120 typical)
- Semicolons: Always used
- Quotes: Single quotes for strings (Node.js convention)
- Object/array literals: Inline for small values, multi-line for large structures
- No linter configured
- Code relies on manual review for style consistency

## Import Organization

- No path aliases configured
- Relative paths use `../` convention (e.g., `require('../config/env')`)

## Error Handling

- Custom error classes in `src/utils/errors.js` extend base `AppError` class
- All custom errors include `statusCode` property and `isOperational = true` flag
- Specific error types for different scenarios:
- Centralized error handling in `src/middleware/errorHandler.js`
- Catches async errors via `catchAsync` wrapper function
- Special handling for Joi validation errors
- Special handling for PostgreSQL errors (codes starting with `P`)
- 500+ errors logged with full stack trace and context
- Non-500 errors logged as warnings
- `catchAsync()` wrapper converts Promise rejections to Express error handler
- Routes never use explicit try/catch blocks
- All promise chains terminate at error handler middleware

## Logging

- Import logger: `const logger = require('../utils/logger');`
- Usage: `logger.info('Message')`, `logger.error('Message', errorObject)`
- Emergency bootstrap messages use emoji prefixes: 🚀, 📊, 🔴, 🔄, ✓, ✅, ⏹️, ❌
- Audit logging for security events: IP address, user ID, action type
- SQL slow query warnings for queries > 500ms

## Comments

- JSDoc for all exported functions and class methods
- Inline comments for complex logic or non-obvious code
- Block comments for sections in main files (marked with `=====` dividers)
- Comments in Portuguese (codebase language)
- Full JSDoc comments on all service/controller methods
- Format: `/** Description */` for single-line, multi-line for parameters
- Parameter descriptions included for complex methods

## Function Design

- Average function length: 20-50 lines for service methods
- Controllers keep route handlers short (typically 10-20 lines)
- Larger functions (>100 lines) break into smaller methods
- Route handlers destructure from `req.body`, `req.params`, `req.query`
- Service methods accept specific parameters or options objects
- Repository methods use options object pattern for pagination/filtering
- Controllers return JSON via `res.json()` or `res.status(code).json()`
- Services return domain objects or results with pagination metadata
- Repositories return raw database results or null
- All async functions return Promises

## Module Design

- Services/Repositories: Export class instance (singleton pattern)
- Controllers: Export object with named functions
- Routes: Export Express router
- Utilities: Export named functions or objects
- Not used in this codebase
- Each module exports only what it needs

## Database Patterns

- All queries use parameterized statements: `$1`, `$2`, etc.
- Parameters passed as array: `query(sql, [param1, param2])`
- Never string interpolation for user input
- Multi-line queries use template literals with indentation
- SQL keywords UPPERCASE
- Column names LOWERCASE or snake_case
- Queries often include comments with business logic
- Used for multi-step operations that must all succeed or fail together
- Pattern: pass `client` parameter to repository methods
- Repository methods accept optional `client` parameter for transaction use

## Type Coercion & Validation

- Route params parsed explicitly: `parseInt(req.params.userId, 10)`
- Query strings parsed: `parseInt(page, 10)`, `isActive === 'true' ? true : false`
- Manual validation in services and controllers
- Custom ValidationError thrown with descriptive messages
- No centralized validation schema (Joi installed but not used)

<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

## System Overview

```text

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

- **Request-Response Cycle:** All API calls follow Route → Controller → Service → Repository → Database
- **Service Orchestration:** Services contain business logic and coordinate between repositories and cross-cutting concerns
- **Error Standardization:** Custom error classes (ValidationError, AuthenticationError, etc.) with HTTP status codes
- **Async/Await:** All async operations use promises; `catchAsync` wrapper prevents unhandled rejections
- **Middleware Stack:** Express middleware for auth, error handling, logging (development only)
- **Soft Deletes:** Users and audit-related records use `deleted_at` timestamps instead of hard deletes
- **Optimistic Concurrency:** Markets and wagers use transactions with FOR UPDATE locks during resolution

## Layers

- Purpose: Map HTTP verbs/paths to controller handlers
- Location: `src/routes/`
- Contains: Express Router instances defining endpoints, middleware chains (requireAuth, requireAdmin)
- Depends on: Controllers, middleware
- Used by: Express app (`server.js`)
- Pattern: One route file per resource (auth, users, markets, wagers, leaderboard, sessions)
- Purpose: Handle HTTP request/response, parse input, delegate to services
- Location: `src/controllers/`
- Contains: Handler functions wrapped with `catchAsync` to prevent unhandled promise rejections
- Depends on: Services, error handlers
- Used by: Routes
- Pattern: One controller per resource with methods like `register`, `login`, `listMarkets`, etc.
- Purpose: Implement domain logic, validation, transaction coordination
- Location: `src/services/`
- Contains: Class-based services (instantiated as singletons) with methods for business operations
- Depends on: Repositories, utilities (logger, errors, config)
- Used by: Controllers
- Pattern: Services call repositories for data access; handle cross-cutting concerns like logging, error translation
- Example: `authService.login()` validates credentials, creates session in Redis, generates JWT, logs audit event
- Purpose: Abstract database access with prepared statements and query builders
- Location: `src/repositories/`
- Contains: Class-based repositories with CRUD methods
- Depends on: Database config (pool, transaction helpers)
- Used by: Services
- Pattern: Repositories accept optional `client` parameter for transaction support; use parameterized queries exclusively
- Transactions: Called from services via `transaction()` helper for multi-step operations like market resolution
- Purpose: Cross-cutting concerns (auth, error handling, logging)
- Location: `src/middleware/`
- Contains: Express middleware functions and helpers
- Key files:
- Depends on: Config (JWT secret, env)
- Used by: Routes and Express app
- Session model: JWT payload contains `sessionId`; session data stored in Redis with TTL; timed out on inactivity or reached absolute timeout
- Purpose: Centralize environment variables and connection pools
- Location: `src/config/`
- Contains:
- Depends on: dotenv
- Used by: All other layers
- Location: `src/utils/`
- Logger: `logger.js` — Structured logging with levels (error, warn, info, debug)
- Errors: `errors.js` — Error class hierarchy (AppError, ValidationError, AuthenticationError, etc.) with standardized HTTP status codes

## Data Flow

### Primary Request Path (HTTP Endpoint)

### Scheduler Flow (Automatic Market State Transitions)

- Request state: Attached to `req` object (user, sessionId, permissions)
- Session state: Stored in Redis with TTL (expires on inactivity or max session age)
- Database state: Persistent in PostgreSQL; queries always parameterized
- No module-level mutable singletons except connection pools (pool, redis.client)

## Key Abstractions

- Purpose: Track authenticated user activity with dual timeout (inactivity + absolute max age)
- Implementation:
- States: open → closed → resolved
- Transitions:
- Sensitive data: scheduled_outcome hidden from non-admins to prevent spoilers
- Immutable once created (amount, choice, odds_at_time, potential_payout captured at creation)
- Status transitions: pending → (won|lost|refunded|voided) once market resolves
- Refunded: If market deleted while pending
- Voided: If market marked as disputed/invalid
- Roles: user (1) = limited permissions; admin (2) = all permissions
- Permissions: Granular capabilities (create_market, edit_market, resolve_market, manage_users, view_audit_logs, change_password)
- Joined via role_permissions bridge table
- Queried on-demand in requirePermission middleware

## Entry Points

- Location: `server.js`
- Triggers: `npm start` or `npm run dev`
- Responsibilities:
- Location: `src/scheduler.js` → launched by `server.js`
- Triggers: Every 10 seconds
- Responsibilities: Auto-close and auto-reveal markets based on configured timestamps
- `/` - Dashboard (markets, my wagers, ranking)
- `/admin.html` - Admin panel (market creation, user management)
- `/profile.html` - User profile and settings
- `/login.html` - Login form (served on 401 by backend)
- Client-side router handles hash-based navigation (Vue/React not used; vanilla JS)

## Architectural Constraints

- **Threading:** Node.js single-threaded event loop; async I/O handles concurrency without workers
- **Global state:** 
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

### Exposed Scheduled Outcome to Non-Admins

### Session Timeout Without Absolute Limit

### Unencrypted Password Storage

## Error Handling

- **ValidationError (400):** User input fails schema or business rule checks (missing field, invalid odds range, duplicate username)
- **AuthenticationError (401):** Missing/invalid token, expired session, user deleted
- **AuthorizationError (403):** User lacks permission or role
- **NotFoundError (404):** Resource doesn't exist
- **ConflictError (409):** State conflict (username already taken, market already resolved)
- **AppError (500):** Base class for operational errors
- **Database/SQL Errors:** Caught and re-thrown as AppError with generic message

## Cross-Cutting Concerns

- Framework: Console-based with JSON; production-ready for ELK/Datadog
- Levels: error, warn, info, debug; controlled by LOG_LEVEL env
- Key events: User registration, login, logout, password change, market creation, market resolution
- Structured: Includes timestamp, level, message, optional data object
- Input: Via custom checks in services (e.g., isValidOdds function in marketService)
- Schema: Joi library imported but not consistently applied yet (marked for migration)
- Timing: Happens in service layer before repository call
- Transport: Bearer token in Authorization header
- Token: JWT with userId and sessionId
- Storage: Session data in Redis; TTL-based expiration
- Renewal: Via POST /api/auth/logout and session timeout at hardcoded 30 min
- Sensitive actions recorded to audit_logs table: login, logout, password changes, admin actions
- Fields: action, admin_id, target_user_id, ip_address, changes (JSONB), details text, created_at
- Queries: `SELECT * FROM audit_logs` via /api/users/audit-logs/list (admin only)

<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
