# External Integrations

**Analysis Date:** 2026-07-14

## APIs & External Services

**No External APIs:**
- This is a self-contained betting platform with no third-party service integrations
- All market data, user management, wager processing, and leaderboard calculations are handled internally
- No payment processor, SMS provider, email service, or analytics integration

## Data Storage

**Databases:**
- PostgreSQL (primary database)
  - Connection: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` environment variables configured in `src/config/env.js`
  - Client: node-postgres (`pg` v8.11.3) with connection pool in `src/config/database.js`
  - Pool: 20 max concurrent connections, 30s idle timeout, 2s connection timeout
  - Schema: Auto-created via migration scripts in `scripts/migrate.js` on startup
  - Tables: `users`, `wallets`, `markets`, `wagers`, `roles`, `permissions`, `role_permissions`, `audit_logs`, `sessions`

**File Storage:**
- Local filesystem only
  - Static assets served from `public/` directory via Express in `server.js` (line 95)
  - No cloud storage integration (S3, GCS, etc.)

**Caching:**
- Redis (session and cache backend)
  - Connection: `REDIS_URL` environment variable configured in `src/config/env.js` (default: `redis://localhost:6379`)
  - Client: redis v4.6.14 with auto-reconnect strategy in `src/config/redis.js` (max 10 retries)
  - Default TTL: 300s (5 min), configurable via `REDIS_CACHE_TTL` env var
  - Usage: Session storage (`session:*` keys), cache entries, pattern-based deletions

## Authentication & Identity

**Auth Provider:**
- Custom implementation (no OAuth, SAML, or third-party provider)
  - Users register with username/email/password in `src/services/authService.js`
  - Password validation via bcryptjs v2.4.3 (10 rounds configurable)
  - Session management: JWT tokens + Redis session store for dual-layer timeout
  - Implementation: `src/services/authService.js`, `src/middleware/auth.js`

**Authorization:**
- Role-based access control (RBAC)
  - Roles: `user` (limited), `admin` (full access)
  - Permissions: `create_market`, `edit_market`, `resolve_market`, `manage_users`, `view_audit_logs`, `change_password`
  - Default roles and permissions created on first startup in `server.js` (lines 167-224)

## Monitoring & Observability

**Error Tracking:**
- None (no external service like Sentry, DataDog, etc.)
- Errors logged to console via custom logger

**Logs:**
- Console-based logging (stdout)
  - Logger: `src/utils/logger.js` with levels: error, warn, info, debug
  - Level controlled via `LOG_LEVEL` environment variable (default: info)
  - Includes request timing in development mode (logs response times in `server.js` lines 46-55)
  - No persistence layer (logs not stored to file or database)

## CI/CD & Deployment

**Hosting:**
- Not detected — Application is designed for manual deployment or self-hosted environments
- Supports Docker/containerization (Express listens on configurable PORT, supports proxy headers)

**CI Pipeline:**
- None detected — No GitHub Actions, GitLab CI, Jenkins, or similar
- Manual deployment workflow expected (git pull + npm start)

## Environment Configuration

**Required env vars:**
- `JWT_SECRET` — CRITICAL for security, must be unique per deployment
- `DB_PASSWORD` — PostgreSQL password
- `DB_USER` — PostgreSQL username
- `DB_HOST` — PostgreSQL hostname

**Optional env vars with defaults:**
- `NODE_ENV` (default: development)
- `PORT` (default: 3000)
- `DB_PORT` (default: 5432)
- `DB_NAME` (default: apostae)
- `DB_SSL` (default: false)
- `REDIS_URL` (default: redis://localhost:6379)
- `REDIS_CACHE_TTL` (default: 300s)
- `JWT_EXPIRES_IN` (default: 8h)
- `BCRYPT_ROUNDS` (default: 10)
- `SESSION_TIMEOUT` (default: 1800000ms = 30 min inactivity)
- `SESSION_ABSOLUTE_TIMEOUT` (default: 1800000ms = 30 min max)
- `LOG_LEVEL` (default: info)

**Secrets location:**
- `.env` file (git-ignored)
- `.env.production` file for production (also git-ignored)
- No external secrets manager (AWS Secrets Manager, HashiCorp Vault, etc.)

## Webhooks & Callbacks

**Incoming:**
- None detected — No webhook endpoints that receive external events

**Outgoing:**
- None detected — Application does not send data to external services

## Data Flow Summary

1. **User Authentication:** Client login → AuthService validates credentials → JWT + Redis session created → Token returned to frontend
2. **Session Validation:** Each request carries JWT bearer token → Middleware validates JWT signature + Redis session existence + absolute timeout
3. **Market Operations:** Markets created via API → Stored in PostgreSQL → Scheduler checks closes_at/reveal_at every 10s → Auto-closes/resolves when time triggers
4. **Wagers:** Users place bets → WagerService validates + deducts wallet balance → Records in PostgreSQL → Wager status tracked
5. **Leaderboard:** Query-based (no real-time sync) → Rankings calculated on-demand from wagers/wallets tables

---

*Integration audit: 2026-07-14*
