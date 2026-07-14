# Technology Stack

**Analysis Date:** 2026-07-14

## Languages

**Primary:**
- JavaScript (Node.js runtime) — Backend API and core business logic in `src/`, `server.js`

**Secondary:**
- HTML5 — Frontend templates in `public/*.html`
- CSS3 — Styling in `public/css/style.css`
- JavaScript (Vanilla ES6) — Frontend client code in `public/js/`

## Runtime

**Environment:**
- Node.js (version unspecified, assumed 16.x+)
- CommonJS modules (`"type": "commonjs"` in `package.json`)

**Package Manager:**
- npm
- Lockfile: `package-lock.json` present (61KB)

## Frameworks

**Core:**
- Express.js ^4.19.2 — HTTP server and routing in `server.js`, `src/routes/*`
- CORS ^2.8.5 — Cross-origin request handling in `server.js` (line 41)

**Data Access:**
- pg (node-postgres) ^8.11.3 — PostgreSQL driver in `src/config/database.js`
- redis ^4.6.14 — Redis client for caching and sessions in `src/config/redis.js`

**Authentication & Security:**
- jsonwebtoken ^9.0.2 — JWT token generation and validation in `src/services/authService.js` (lines 1, 91-94)
- bcryptjs ^2.4.3 — Password hashing (10 rounds) in `src/services/authService.js` (lines 39, 168)
- express-rate-limit ^7.1.5 — Rate limiting middleware (integrated via npm dependency)

**Validation:**
- joi ^17.12.0 — Request validation framework (loaded via npm, used in middleware/routes)

**Utilities:**
- dotenv ^16.4.5 — Environment variable loading in `src/config/env.js` (line 1)
- uuid ^9.0.1 — Session ID generation in `src/services/authService.js` (line 4, 74)

**Development:**
- nodemon ^3.0.2 — Development file watcher (dev dependency only)

## Key Dependencies

**Critical:**
- pg ^8.11.3 — PostgreSQL connection pooling and query execution. Connection pool max 20 concurrent connections configured in `src/config/database.js` (line 16). Uses prepared statements to prevent SQL injection.
- redis ^4.6.14 — Session storage and cache backend. Configured with reconnect strategy (max 10 retries) in `src/config/redis.js` (lines 6-14). Default TTL 300s (5 min) for cache, configurable via `REDIS_CACHE_TTL` env var.
- jsonwebtoken ^9.0.2 — Stateless JWT authentication tokens. Secret loaded from `JWT_SECRET` env var. Expiry configured via `JWT_EXPIRES_IN` env var (default 8h).
- bcryptjs ^2.4.3 — Password hashing with configurable rounds (default 10) via `BCRYPT_ROUNDS` env var in `src/config/env.js`.

**Infrastructure:**
- express-rate-limit ^7.1.5 — Throttles request rates (implementation in middleware, prevents abuse).

## Configuration

**Environment:**
- `.env` file (not committed, contains secrets)
- `.env.example` file documents required variables
- Environment variables define all runtime configuration via `src/config/env.js`

**Key configs required:**
```
NODE_ENV           # development|production (default: development)
PORT               # HTTP port (default: 3000)
DB_HOST            # PostgreSQL hostname (default: localhost)
DB_PORT            # PostgreSQL port (default: 5432)
DB_NAME            # Database name (default: apostae)
DB_USER            # PostgreSQL user (default: postgres)
DB_PASSWORD        # PostgreSQL password (default: postgres)
DB_SSL             # Enable SSL for PostgreSQL (default: false)
REDIS_URL          # Redis connection string (default: redis://localhost:6379)
REDIS_CACHE_TTL    # Cache expiry in seconds (default: 300)
JWT_SECRET         # Secret for signing JWTs (CRITICAL: must change in production)
JWT_EXPIRES_IN     # JWT token lifetime (default: 8h)
BCRYPT_ROUNDS      # Password hashing iterations (default: 10)
SESSION_TIMEOUT    # Inactivity logout in ms (default: 1800000 = 30 min)
SESSION_ABSOLUTE_TIMEOUT  # Max session duration in ms (default: 1800000 = 30 min, prevents session hijacking)
LOG_LEVEL          # Logging level: error|warn|info|debug (default: info)
```

**Build:**
- No build step required (CommonJS modules loaded directly)
- Frontend is static files served from `public/`
- Database migrations run on server startup via `scripts/migrate.js`

## Platform Requirements

**Development:**
- Node.js 16.x or higher (tested with implicit Node version in npm scripts)
- PostgreSQL 10+ (uses standard SQL with no vendor-specific features)
- Redis 5+ (uses basic key-value operations)
- npm (for package management)

**Production:**
- Node.js 16.x or higher (LTS recommended)
- PostgreSQL 10+ (same as development)
- Redis 5+ (same as development)
- Reverse proxy recommended (Express trusts `X-Forwarded-For` from `172.16.0.0/12` internal networks in `server.js` line 35)
- Graceful shutdown support (SIGTERM/SIGINT handlers in `server.js` lines 156-157)

## Special Features

**Health Check Endpoint:**
- `GET /health` — Tests PostgreSQL and Redis connectivity in `server.js` (lines 61-78)

**Automatic Scheduler:**
- Market closure and resolution jobs run every 10 seconds via `src/scheduler.js`
- No external job queue required (in-process timer)

**Session Management:**
- Dual-layer timeout: inactivity timeout (renewed per request) + absolute session timeout (prevents hijacking)
- Sessions stored in Redis, not database (fast, non-persistent across restarts)

---

*Stack analysis: 2026-07-14*
