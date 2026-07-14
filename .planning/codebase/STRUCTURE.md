# Codebase Structure

**Analysis Date:** 2026-07-14

## Directory Layout

```
apostas/
├── server.js                    # HTTP server entry point — initializes app, routes, database, scheduler
├── package.json                 # Dependencies: express, pg, redis, bcryptjs, jsonwebtoken, cors, joi
├── package-lock.json            # Locked dependency versions
│
├── src/
│   ├── config/                  # Configuration and connection pools
│   │   ├── env.js               # Environment variables (NODE_ENV, PORT, DB_*, JWT_*, SESSION_*, etc.)
│   │   ├── database.js          # PostgreSQL pool, query wrapper, transaction helper
│   │   └── redis.js             # Redis client with connect/get/set/del/expire/ttl methods
│   │
│   ├── middleware/              # Express middleware functions
│   │   ├── auth.js              # requireAuth (JWT + session validation), requireAdmin, requirePermission
│   │   └── errorHandler.js      # Centralized error handler, catchAsync wrapper
│   │
│   ├── routes/                  # Express route handlers (mount points, middleware chains)
│   │   ├── auth.js              # POST /api/auth/register, /login, /logout; PUT /password
│   │   ├── users.js             # GET /api/users/me, /api/users (admin), POST, PUT, DELETE
│   │   ├── markets.js           # GET /api/markets, POST (admin), PUT /status, /resolve, DELETE
│   │   ├── wagers.js            # POST /api/wagers, GET /wagers/user/:username, DELETE
│   │   ├── leaderboard.js       # GET /api/leaderboard (ranking by wallet balance)
│   │   └── sessions.js          # GET /api/sessions/current (client reads session TTL)
│   │
│   ├── controllers/             # HTTP request handlers (parse input, call services, return responses)
│   │   ├── authController.js    # register, login, logout, changePassword, adminChangePassword, forcePasswordChange
│   │   ├── usersController.js   # getMe, getMyWagers, listUsers, createUser, searchUsers, getUserStats, getUser, setUserStatus, setUserRole, deleteUser, getAuditLogs
│   │   ├── marketsController.js # listMarkets, createMarket, updateMarketStatus, resolveMarket, deleteMarket
│   │   ├── wagersController.js  # placeWager, getUserWagers, cancelWager
│   │   └── sessionsController.js # getCurrentSession (returns TTL info)
│   │
│   ├── services/                # Business logic layer (validation, orchestration, transactions)
│   │   ├── authService.js       # register, login, logout, changePassword, adminChangePassword, forcePasswordChange
│   │   ├── userService.js       # User CRUD, permissions, statistics
│   │   ├── marketService.js     # listMarkets, createMarket, closeMarket, resolveMarket, deleteMarket
│   │   └── wagerService.js      # placeWager, cancelWager, calculatePayouts
│   │
│   ├── repositories/            # Data access layer (parameterized SQL, CRUD operations)
│   │   ├── userRepository.js    # create, findById, findByUsername, findByEmail, findAll, update, updatePassword, updateRole, softDelete, getUserPermissions, hasPermission, getStats
│   │   ├── marketRepository.js  # findAll, findById, create, updateStatus, resolve, delete, findDueToClose, findDueToReveal
│   │   ├── wagerRepository.js   # create, findById, findPendingByMarket, updateStatus, findByUserId, findByUsername
│   │   └── walletRepository.js  # getBalance, debit, credit, transfer
│   │
│   ├── migrations/              # Database schema (SQL DDL executed on startup)
│   │   ├── 001_initial.js       # Creates roles, users, permissions, role_permissions, markets, wagers, sessions, audit_logs, settings tables
│   │   └── 002_wallet.js        # Creates wallets table
│   │
│   ├── utils/                   # Shared utilities
│   │   ├── logger.js            # Structured logging (error, warn, info, debug levels)
│   │   └── errors.js            # Custom error classes (AppError, ValidationError, AuthenticationError, AuthorizationError, NotFoundError, ConflictError, RateLimitError)
│   │
│   └── scheduler.js             # Background scheduler (runs tick every 10s to auto-close/reveal markets)
│
├── public/                      # Frontend static assets (served by Express.static)
│   ├── index.html               # Main dashboard SPA (markets, my wagers, ranking tabs)
│   ├── admin.html               # Admin panel (market management, user management)
│   ├── login.html               # Login form
│   ├── profile.html             # User profile and settings
│   ├── password-expires.html    # Forced password change page
│   │
│   ├── js/                      # Frontend JavaScript (vanilla JS, no frameworks)
│   │   ├── api.js               # API client (fetch wrapper, token management)
│   │   ├── dashboard.js         # Dashboard logic (market list, wager placement, ranking)
│   │   ├── admin.js             # Admin panel logic (market CRUD, user management)
│   │   ├── profile.js           # Profile page logic
│   │   ├── session-timeout.js   # Client-side session timeout warning (polls /api/sessions/current)
│   │   └── password-expires.js  # Forced password change handler
│   │
│   └── css/
│       └── style.css            # Global stylesheet (typography, layout, components)
│
├── scripts/                     # Utilities (migrations, seeding)
│   ├── migrate.js               # Runs pending migrations from src/migrations/
│   └── seed.js                  # Seeds initial data (optional)
│
├── .env                         # Environment variables (git-ignored; never commit secrets)
├── .env.example                 # Template for .env with placeholder values
├── .env.production              # Production env config (git-ignored)
│
├── .planning/
│   └── codebase/                # Codebase analysis documents (this file, ARCHITECTURE.md)
│
└── data/                        # Optional local SQLite/temporary data files
```

## Directory Purposes

**src/config:**
- Purpose: Centralize all configuration (env vars, connection pools)
- Contains: Environment variables with defaults, PostgreSQL pool with prepared statement support, Redis client with helper methods
- Key files: `env.js`, `database.js`, `redis.js`
- All config in one place ensures single source of truth for server settings

**src/middleware:**
- Purpose: Cross-cutting concerns (authentication, error handling, logging)
- Contains: Middleware functions that wrap request handlers
- Key files: `auth.js` (requireAuth validates JWT + Redis session, checks role/permissions), `errorHandler.js` (centralized error handling, catchAsync wrapper)
- Applied globally (CORS, body parsing) and per-route (requireAuth, requireAdmin)

**src/routes:**
- Purpose: Map HTTP verbs and paths to controller handlers
- Contains: Express Router instances with GET/POST/PUT/DELETE/PATCH definitions
- Key files: One file per resource (auth, users, markets, wagers, leaderboard, sessions)
- Middleware chains applied here (e.g., requireAuth, requireAdmin on protected endpoints)
- No business logic; just routing

**src/controllers:**
- Purpose: Parse HTTP requests, call services, format responses
- Contains: Handler functions (async) that receive req/res/next
- Key files: One file per resource matching routes/
- Wrapped with `catchAsync` to prevent unhandled promise rejections
- Minimal logic; delegates to services

**src/services:**
- Purpose: Implement domain logic (validation, business rules, orchestration)
- Contains: Class-based services with methods for each operation
- Key files: authService, userService, marketService, wagerService
- Coordinates repositories and cross-cutting concerns (logging, error translation)
- Throws domain-specific errors (ValidationError, ConflictError)
- May use transactions for atomic multi-step operations

**src/repositories:**
- Purpose: Abstract database access with prepared statements
- Contains: Class-based repositories with CRUD methods
- Key files: userRepository, marketRepository, wagerRepository, walletRepository
- All SQL uses $1, $2, $3 parameterization (prevents SQL injection)
- Accepts optional `client` parameter for transaction support
- Returns raw row(s) from database; no type/shape validation
- No business logic; just data access

**src/migrations:**
- Purpose: Version-controlled database schema
- Contains: SQL DDL statements in arrays
- Key files: 001_initial.js (tables), 002_wallet.js (wallets table)
- Executed on startup via `runPendingMigrations()` in server.js
- Tracks applied migrations in migrations table

**src/utils:**
- Purpose: Shared utilities used across layers
- Contains: Logger, error class hierarchy
- Key files: `logger.js` (structured logging), `errors.js` (AppError, ValidationError, AuthenticationError, etc.)
- No database or service dependencies

**public/:**
- Purpose: Frontend single-page application and static assets
- Contains: HTML pages, CSS, vanilla JavaScript
- Client-side routing handled by tabs/href (not Next.js/Vue/React)
- API client wrapper in `js/api.js` handles fetch, token management

**scripts/:**
- Purpose: Build and setup utilities
- Contains: Migration runner, optional seed scripts
- Usage: `npm run migrate`, `npm run seed`

## Key File Locations

**Entry Points:**
- `server.js`: HTTP server — initializes Express, routes, database, Redis, migrations, scheduler
- `src/config/env.js`: All environment variables with defaults and production validation
- `src/scheduler.js`: Background task runner — auto-closes and auto-reveals markets every 10 seconds

**Core Logic:**
- `src/services/authService.js`: User registration, login, logout, session management
- `src/services/marketService.js`: Market CRUD, resolution logic, wager payout calculation
- `src/services/wagerService.js`: Wager placement, cancellation, validation

**Data Access:**
- `src/repositories/userRepository.js`: User CRUD, permissions queries
- `src/repositories/marketRepository.js`: Market queries including auto-close/reveal lookups
- `src/repositories/wagerRepository.js`: Wager queries with market joins

**Authentication & Middleware:**
- `src/middleware/auth.js`: JWT validation, session checks, permission validation
- `src/middleware/errorHandler.js`: Centralized error handling and error logging

**Database & Config:**
- `src/config/database.js`: PostgreSQL pool, query wrapper, transaction helper
- `src/config/redis.js`: Redis client with session storage helpers
- `src/migrations/001_initial.js`: All core tables (users, markets, wagers, audit_logs, etc.)

**Frontend:**
- `public/index.html`: Dashboard SPA (markets, wagers, ranking)
- `public/admin.html`: Admin panel
- `public/js/api.js`: Centralized API client (fetch wrapper, error handling)
- `public/js/dashboard.js`: Dashboard logic and market rendering
- `public/js/session-timeout.js`: Client-side session timeout tracking

## Naming Conventions

**Files:**
- Routes: `{resource}Routes.js` (e.g., `authRoutes.js`, `marketsRoutes.js`)
- Controllers: `{resource}Controller.js` (e.g., `authController.js`, `usersController.js`)
- Services: `{resource}Service.js` (e.g., `marketService.js`, `wagerService.js`)
- Repositories: `{resource}Repository.js` (e.g., `userRepository.js`, `walletRepository.js`)
- Migrations: `{number}_{description}.js` (e.g., `001_initial.js`, `002_wallet.js`)
- Middleware: `{purpose}.js` (e.g., `auth.js`, `errorHandler.js`)
- Database config: `{service}.js` (e.g., `database.js`, `redis.js`)

**Directories:**
- Camel case for feature directories: `src/config`, `src/routes`, `src/controllers`, `src/services`, `src/repositories`
- Kebab case for content directories: `public/css`, `public/js`

**Functions:**
- Camel case: `register()`, `login()`, `listMarkets()`, `findById()`
- Prefixes indicate type:
  - `find*` — repository queries (e.g., `findById`, `findByUsername`, `findAll`)
  - `list*` — service/controller queries with filters/pagination (e.g., `listMarkets`, `listUsers`)
  - `create*` — creation operations (e.g., `createMarket`, `createUser`)
  - `update*` — updates (e.g., `updateMarketStatus`, `updatePassword`)
  - `delete*` — deletions (e.g., `deleteMarket`, `deleteUser`)

**Variables:**
- Camel case: `userId`, `marketId`, `passwordHash`, `oddsYes`, `oddsNo`
- Database columns snake_case: `user_id`, `market_id`, `password_hash`, `odds_yes`, `odds_no`, `created_at`
- Constants UPPER_SNAKE_CASE: `SESSION_TIMEOUT`, `JWT_EXPIRES_IN`, `BCRYPT_ROUNDS`
- Boolean prefixes: `is*`, `has*`, `can*` (e.g., `isActive`, `hasPermission`, `canDelete`)

**Classes:**
- Pascal case: `AuthService`, `MarketRepository`, `ValidationError`, `UserController`
- Singletons exported as `module.exports = new ClassName()`

## Where to Add New Code

**New Feature (e.g., Reports/Analytics):**
1. Create route file: `src/routes/reports.js` — define GET/POST/PUT/DELETE endpoints
2. Create controller: `src/controllers/reportsController.js` — handlers calling services
3. Create service: `src/services/reportService.js` — business logic and validation
4. Create repository: `src/repositories/reportRepository.js` — data queries
5. Add migration: `src/migrations/003_reports.js` — schema for new tables
6. Mount in `server.js`: `app.use('/api/reports', reportRoutes)`
7. Frontend: Add page in `public/` (HTML) and script in `public/js/` (client logic)

**New Endpoint in Existing Resource (e.g., New Market Filter):**
1. Add route handler to `src/routes/markets.js`: `router.get('/by-category/:category', requireAuth, marketsController.listByCategory)`
2. Add controller method in `src/controllers/marketsController.js`
3. Add service method in `src/services/marketService.js`
4. Add repository query in `src/repositories/marketRepository.js`
5. Test via HTTP client (Postman, curl, API test)

**New Middleware (e.g., Rate Limiter):**
1. Create file: `src/middleware/rateLimiter.js`
2. Export middleware function(s)
3. Import in `server.js` or route files
4. Apply globally or per-route: `app.use(rateLimiter)` or `router.use(rateLimiter, handler)`

**Database Schema Change (e.g., Add Column):**
1. Create new migration: `src/migrations/003_add_column_X.js`
2. Define SQL DDL (CREATE/ALTER/DROP)
3. Migration runs automatically on startup
4. Update repository queries to use new column
5. Update services/controllers as needed

**New Utility/Helper (e.g., Date Formatter):**
1. Create file: `src/utils/dateFormatter.js` or add to `src/utils/helpers.js`
2. Export function(s)
3. Import where needed: `const { formatDate } = require('../utils/dateFormatter')`
4. Use across services and controllers

**Frontend Component (e.g., New Form):**
1. Add HTML to `public/index.html` (or new `.html` if separate page)
2. Add CSS to `public/css/style.css`
3. Add JavaScript handler in `public/js/dashboard.js` (or new `public/js/componentName.js`)
4. Use `api.js` fetch wrapper to call backend endpoints
5. Handle response and update DOM

## Special Directories

**data/:**
- Purpose: Local data files (SQLite, temporary data, seeds)
- Generated: Yes (if using local SQLite or custom data files)
- Committed: Depends on use case (usually git-ignored for production DBs)

**.env, .env.production:**
- Purpose: Environment configuration (secrets, database credentials, API keys)
- Generated: No — created manually per deployment
- Committed: No — always git-ignored
- Note: `.env.example` is committed as template

**.planning/codebase/:**
- Purpose: Architecture and structure documentation
- Generated: Yes — produced by GSD analysis tools
- Committed: Yes — reviewed and committed to track codebase evolution
- Contains: ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md, etc.

**node_modules/:**
- Purpose: Installed npm dependencies
- Generated: Yes — created by `npm install`
- Committed: No — git-ignored, listed in package-lock.json

---

*Structure analysis: 2026-07-14*
