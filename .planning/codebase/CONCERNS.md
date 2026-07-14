# Codebase Concerns

**Analysis Date:** 2026-07-14

## Tech Debt

**Redis blocking operations (Session invalidation):**
- Issue: `redis.client.keys("session:*")` called without pagination in `authService` (line 174), `userService` (lines 96, 178). This is O(n) blocking operation that can freeze event loop in production with many concurrent sessions.
- Files: `src/services/authService.js`, `src/services/userService.js`
- Impact: Under heavy load, session invalidation (password change, user deactivation, admin password change) will block all other Redis operations and hang the server.
- Fix approach: Replace with Redis SCAN cursor-based iteration or use a session registry pattern (secondary data structure indexed by user_id). Alternatively, use Redis Streams or implement session invalidation list.

**Hardcoded default admin credentials:**
- Issue: Bootstrap creates admin user with hardcoded password "admin123" in `server.js` (lines 230-254). Password is also hardcoded in logs as warning text.
- Files: `server.js`, `src/config/env.js` references
- Impact: High security risk if database is cloned or reset in production. Credentials in application startup logs.
- Fix approach: Generate random temporary password, require change on first login. Store initial credentials in secure vault, not code. Remove from logs.

**Missing test coverage:**
- Issue: `package.json` test script is dummy: `"test": "echo \"Add tests later"`. No tests for critical financial operations (wagers, market resolution, wallet balance).
- Files: `package.json`, entire `src/` directory
- Impact: Cannot detect regressions in wallet calculations, race conditions, or financial consistency. Market resolution (distributing winnings) completely untested.
- Fix approach: Implement Jest/Vitest suite covering: transaction atomicity, concurrent wager placement, market resolution payment logic, wallet balance integrity, session security.

**Inefficient batch payment in market resolution:**
- Issue: `resolveMarket()` in `src/services/marketService.js` (lines 111-131) iterates through all pending wagers and updates each wallet individually in a loop. For market with N wagers, this creates N separate UPDATE queries within a transaction.
- Files: `src/services/marketService.js:111-131`
- Impact: Slow market resolution for high-volume markets. If transaction fails mid-way, partial payment state could occur. Long transaction lock times.
- Fix approach: Use batch UPDATE with CASE statements or aggregate wallets-to-update map, then issue single UPDATE per unique wallet.

**Scheduler race condition and retry handling:**
- Issue: `src/scheduler.js` runs every 10 seconds, checking `closes_at` and `reveal_at`. No distributed lock. If admin manually resolves market while scheduler is processing same market, concurrent updates could occur. If `resolveMarket()` fails, market is never retried.
- Files: `src/scheduler.js`
- Impact: Possible double-resolution of market or stuck markets if resolver crashes mid-operation. 10-second tick granularity means market close can be delayed up to 10 seconds.
- Fix approach: Implement distributed lock (Redis SET NX) before market operation. Add error logging and retry queue. Consider finer-grained scheduler tick (1 second) or event-driven approach.

**Unused locked_balance field:**
- Issue: `wallet` table has `locked_balance` column (migration line 13) but it's never used in code. This was presumably planned for "pending" wager amounts but not implemented.
- Files: `src/migrations/002_wallet.js`, unused in `src/repositories/walletRepository.js`, `src/services/`
- Impact: True available balance calculation is wrong if someone places wager but doesn't have enough for additional wagers (locked balance not held). User could place multiple wagers exceeding true balance.
- Fix approach: Implement locked_balance accounting: increment when wager placed, decrement when resolved/refunded. Update balance check in `placeWager()` to check `balance >= amount` after `balance - locked_balance`.

## Known Bugs

**Potential double-spend if transaction rolls back silently:**
- Symptoms: User wallet balance might be updated but wager record not created if error occurs between wallet update and wager insert.
- Files: `src/services/wagerService.js:20-54`, `src/services/marketService.js:102-136`
- Trigger: Network interruption or database error after wallet UPDATE but before INSERT wager completes.
- Workaround: Transactions with proper rollback handling are in place (see `src/config/database.js:48-61`), but error from INSERT would rollback wallet adjustment. However, client retry on 5xx could reprocess same wager. No idempotency token.

**Session table in migrations but never used:**
- Symptoms: `sessions` table created in migration 001 (line 88-99) but application uses only Redis for sessions. Orphaned table.
- Files: `src/migrations/001_initial.js:88-99`, but session logic is in Redis (`src/config/redis.js`)
- Trigger: Looking at database schema reveals unused table.
- Workaround: Either remove table from migration or use it. Current design using Redis is better for performance, but DB table wastes space.

## Security Considerations

**Open CORS configuration:**
- Risk: `app.use(cors())` in `server.js` (line 41) has no configuration, accepts requests from any origin. Allows Cross-Site Request Forgery from any website.
- Files: `server.js:41`
- Current mitigation: JWT token required for authenticated endpoints, but public endpoints like `/api/auth/register` and `/api/auth/login` are vulnerable to CSRF. Browser will include credentials (if cookie-based auth used) for any origin.
- Recommendations: Configure CORS to explicit whitelist: `cors({origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000']})`. Implement CSRF tokens for state-changing operations. Add SameSite cookie attribute if using cookies.

**Missing security headers:**
- Risk: No Content-Security-Policy, X-Frame-Options, X-Content-Type-Options headers. Application vulnerable to clickjacking, content-type sniffing, XSS.
- Files: `server.js` (middleware section)
- Current mitigation: None
- Recommendations: Add helmet middleware or manually set: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'self'`, `Strict-Transport-Security: max-age=31536000; includeSubDomains`.

**Rate limiting not implemented:**
- Risk: `express-rate-limit` in `package.json` but never used. Endpoints like `/api/auth/login`, `/api/auth/register` vulnerable to brute-force attacks. Account enumeration via login endpoint.
- Files: `package.json` (dependency listed but unused), `server.js` (no rate limiter middleware)
- Current mitigation: None
- Recommendations: Apply rate limiter to auth endpoints: `POST /api/auth/login` (max 5/min per IP), `POST /api/auth/register` (max 3/min per IP). Use memory store for single-server or Redis for multi-server deployments.

**Session key enumeration:**
- Risk: Session keys in Redis follow pattern `session:{uuid}`. If attacker knows user ID structure, they can't guess UUIDs, but if session enumeration endpoint exists or logs leak session IDs, attacker can hijack sessions.
- Files: `src/middleware/auth.js:31`, `src/services/authService.js:74`
- Current mitigation: Uses UUID v4 which is cryptographically random.
- Recommendations: Add session TTL monitoring (already done), implement session binding to IP/User-Agent, audit logs for session creation.

**Cascade delete of user data:**
- Risk: Deleting a user (soft delete with `deleted_at`) cascades to delete wagers (hard delete in migrations). This destroys financial audit trail and prevents reconciliation of historical bets.
- Files: `src/migrations/001_initial.js:73` (ON DELETE CASCADE for wagers)
- Current mitigation: `deleteUser()` soft-deletes user but cascade rule deletes wagers. Code checks for markets created by user to prevent deletion (line 169 in `userService.js`).
- Recommendations: Change CASCADE to SET NULL on wagers.user_id, or implement hard-cascade that marks wagers as orphaned but keeps records. Audit trail must be immutable.

## Performance Bottlenecks

**N+1 query issue in wager retrieval:**
- Problem: `findByUsername()` in `wagerRepository.js` (line 49-57) joins markets for every wager. If user has 1000 wagers, this fetches market data for all 1000. No pagination implemented.
- Files: `src/repositories/wagerRepository.js:49-57`
- Cause: No pagination limit in query. JOIN adds data volume significantly.
- Improvement path: Add pagination (LIMIT/OFFSET), lazy-load market data, or implement cursor-based pagination. Cache frequently accessed market data.

**Slow market listing for high-volume system:**
- Problem: `listMarkets()` in `marketRepository.js` (line 4-7) does `SELECT * FROM markets ORDER BY created_at DESC` with no pagination. Fetches all markets even if only 10 shown on frontend.
- Files: `src/repositories/marketRepository.js:4-7`, `src/controllers/marketsController.js:8-11`
- Cause: No LIMIT clause, no pagination parameters passed from controller.
- Improvement path: Add pagination to markets endpoint. Index on `created_at` (already exists per migration line 65), but need LIMIT/OFFSET in query.

**Slow query warnings not actionable:**
- Problem: `src/config/database.js:35-37` logs queries slower than 500ms to console, but no action taken. Logs are not collected or alerted.
- Files: `src/config/database.js:35-37`
- Cause: Console.warn on every slow query. If production logs aren't collected, issues go unnoticed.
- Improvement path: Integrate with application monitoring (APM), set up slow query alert, configure query timeout limits.

## Fragile Areas

**Market resolution with large wager count:**
- Files: `src/services/marketService.js:96-136`
- Why fragile: Single transaction updating all wagers and wallets. If market has 10,000 wagers, transaction will hold locks on 10,000 rows + 10,000 wallet rows. Concurrent requests blocked. Memory usage grows. Transaction timeout possible.
- Safe modification: Batch process wagers (e.g., 100 at a time in separate transactions), or use PostgreSQL NOTIFY/LISTEN to queue wager processing asynchronously.
- Test coverage: No unit tests for large-scale market resolution. Load test needed.

**Session invalidation under load:**
- Files: `src/services/authService.js:174-179`, `src/services/userService.js:96-102`
- Why fragile: `redis.client.keys()` call can take seconds with millions of sessions. Blocks entire event loop. Multiple concurrent invalidation requests will queue up.
- Safe modification: Implement session registry (set of user IDs with sessions) indexed by Redis, or use SCAN with cursor instead of KEYS.
- Test coverage: No concurrency tests. Stress test needed with 10k+ sessions.

**Wallet balance reconciliation after crash:**
- Files: `src/repositories/walletRepository.js:18-25` (transaction recording)
- Why fragile: If process crashes after wallet UPDATE but before recording transaction, the wallet_transactions audit log is incomplete. Balance is correct but history is missing.
- Safe modification: Ensure transaction recording is atomic with balance update. Consider recording first (with pending status), then update balance.
- Test coverage: No crash recovery tests.

## Scaling Limits

**Redis session storage:**
- Current capacity: Default max pool size 20 connections. If avg session is 200 bytes, and Redis has 1GB available, that's ~5M sessions before out-of-memory.
- Limit: Single Redis instance becomes bottleneck. Network I/O limited. Session SCAN operations will slow down with millions of keys.
- Scaling path: Implement session clustering with Redis Sentinel/Cluster, or migrate to distributed cache (Memcached with consistent hashing), or implement session sharding by user ID.

**Database connection pool:**
- Current capacity: `max: 20` connections in pool. 20 concurrent requests can exhaust pool if any query takes >2s. Pool timeout is 2 seconds.
- Limit: With high traffic, connection queue grows. Requests queue up waiting for available connection. Response latency degrades.
- Scaling path: Increase pool size with load testing (measure typical query duration), implement connection retry logic, move long-running queries to async job queue (Bull/BullMQ).

**Market resolution throughput:**
- Current capacity: Single-threaded Node.js. Market resolution with 1000 wagers takes ~5 seconds (1000 wallet updates). While processing one market, other requests are blocked.
- Limit: Cannot process concurrent market resolutions. Scheduler can't handle multiple markets closing simultaneously.
- Scaling path: Implement async job queue (Bull/RabbitMQ) for market resolution. Process multiple markets in parallel workers.

## Dependencies at Risk

**No major version constraints:**
- Risk: `package.json` uses exact versions (e.g., `"express": "^4.19.2"`). Caret allows minor versions that could introduce breaking changes or security vulnerabilities. No automatic security updates.
- Impact: Security patches for `pg`, `bcryptjs`, `jsonwebtoken` might not be applied if major version constraint needed.
- Migration plan: Switch to npm audit, set up Dependabot or similar for automated PR generation. Test against latest minor versions monthly.

**No automated deployment validation:**
- Risk: Package-lock.json exists but code doesn't validate it's up-to-date. Could ship with outdated dependencies if CI/CD not configured.
- Impact: Production might run untested dependency combinations.
- Migration plan: Implement `npm ci` instead of `npm install` in production deployments. Add `npm audit` to CI pipeline with failure on high/critical vulnerabilities.

## Missing Critical Features

**No idempotency for financial operations:**
- Problem: If user retries a failed wager placement (network timeout, 5xx response), the same wager could be placed twice.
- Blocks: Financial consistency, preventing double-charging.
- Impact: User could be charged twice for one intended bet.

**No concurrent transaction isolation verification:**
- Problem: Code uses transactions for atomicity, but no explicit isolation level set. PostgreSQL defaults to READ COMMITTED. Race conditions possible between concurrent operations.
- Blocks: Guaranteeing wallet balance consistency under high concurrency.

**No automatic market closure enforcement:**
- Problem: If admin forgets to close market before reveal time, scheduler closes it, but there's no notification to user. User might think market is still open.
- Blocks: User experience reliability.

**No cash-out / withdrawal endpoint:**
- Problem: User can only spend credits on wagers, not convert back to real money. System acts as credit-only (which may be intentional for compliance), but no documentation of this limitation.
- Blocks: Real money integration.

## Test Coverage Gaps

**Financial transactions untested:**
- What's not tested: Wallet balance updates, wager placement with concurrent requests, market resolution with large wager counts, refund accuracy.
- Files: `src/services/wagerService.js`, `src/services/marketService.js`, `src/repositories/walletRepository.js`
- Risk: Undetected race conditions in wallet arithmetic. Floating-point rounding errors in odds calculations. Double-spending bugs.
- Priority: **CRITICAL** - These are core financial operations.

**Authentication and session management untested:**
- What's not tested: Session expiration boundaries (inactivity vs absolute timeout), password change invalidating all sessions, concurrent login/logout, JWT token expiration.
- Files: `src/services/authService.js`, `src/middleware/auth.js`
- Risk: Session hijacking, auth bypass, privilege escalation not detected.
- Priority: **HIGH** - Core security.

**Scheduler edge cases untested:**
- What's not tested: Market resolution during scheduler tick, concurrent admin action + scheduler action, scheduler retry on failure, clock skew handling.
- Files: `src/scheduler.js`
- Risk: Orphaned markets, double resolutions, stuck scheduler.
- Priority: **HIGH** - Business continuity.

**Error handling path untested:**
- What's not tested: Network failures, database connection loss, Redis unavailable, PostgreSQL constraint violations (duplicate key, check constraint).
- Files: `src/middleware/errorHandler.js`
- Risk: Unhandled exceptions crash server, partial state persisted, user confusion.
- Priority: **MEDIUM** - Operational reliability.

---

*Concerns audit: 2026-07-14*
