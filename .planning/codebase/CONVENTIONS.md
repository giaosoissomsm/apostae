# Coding Conventions

**Analysis Date:** 2026-07-14

## Naming Patterns

**Files:**
- Service files: `camelCase` + `Service.js` suffix (e.g., `authService.js`, `userService.js`, `marketService.js`)
- Controller files: `camelCase` + `Controller.js` suffix (e.g., `authController.js`, `usersController.js`)
- Repository files: `camelCase` + `Repository.js` suffix (e.g., `userRepository.js`, `marketRepository.js`)
- Middleware files: `camelCase.js` (e.g., `auth.js`, `errorHandler.js`)
- Route files: lowercase plural or single name (e.g., `auth.js`, `users.js`, `markets.js`)
- Utility files: descriptive lowercase (e.g., `logger.js`, `errors.js`)
- Configuration files: descriptive lowercase (e.g., `database.js`, `redis.js`, `env.js`)

**Functions:**
- Route handlers: `camelCase` (e.g., `register`, `login`, `listUsers`, `createMarket`)
- Service methods: `camelCase` (e.g., `getUser`, `listMarkets`, `closeMarket`, `resolveMarket`)
- Repository methods: `camelCase` with `find`/`create`/`update`/`delete` prefixes (e.g., `findById`, `findByUsername`, `create`, `updatePassword`, `softDelete`)
- Middleware functions: `camelCase` (e.g., `requireAuth`, `requireAdmin`, `catchAsync`)
- Helper functions: `camelCase` with action verbs (e.g., `normalizeDateTime`, `parseSchedule`, `sanitizeMarket`, `isValidOdds`)

**Variables:**
- Local variables: `camelCase` (e.g., `userId`, `sessionId`, `passwordHash`, `isAdmin`, `userAgent`)
- SQL parameters: `camelCase` when destructuring (e.g., `{ username, email, password }`)
- Database column aliases: `snake_case` matching database schema (e.g., `role_name`, `created_at`, `password_hash`)
- Boolean flags: prefix with `is` or `has` (e.g., `isActive`, `isAdmin`, `isOperational`, `hasPermission`)

**Types & Classes:**
- Error classes: `PascalCase` (e.g., `ValidationError`, `AuthenticationError`, `NotFoundError`, `ConflictError`)
- Service/Repository classes: `PascalCase` (e.g., `UserService`, `AuthService`, `UserRepository`)
- Exported instances: lowercase singleton references (e.g., `module.exports = new UserRepository()`)

**Constants:**
- Environment variables: `UPPER_SNAKE_CASE` (e.g., `NODE_ENV`, `JWT_SECRET`, `SESSION_TIMEOUT`)
- Application constants: `UPPER_SNAKE_CASE` (e.g., `TICK_MS`, `BCRYPT_ROUNDS`)
- Module-level configuration: `camelCase` objects (e.g., `levels`, `levels.error`, `currentLevel`)

## Code Style

**Formatting:**
- No formatter configured (no ESLint/Prettier)
- Indentation: 2 spaces (inferred from codebase)
- Line length: No strict limit observed (~100-120 typical)
- Semicolons: Always used
- Quotes: Single quotes for strings (Node.js convention)
- Object/array literals: Inline for small values, multi-line for large structures

**Linting:**
- No linter configured
- Code relies on manual review for style consistency

## Import Organization

**Order:**
1. External dependencies first (express, pg, redis, bcryptjs, etc.)
2. Internal configuration imports (env, database, redis)
3. Internal utilities and middleware (logger, errors, errorHandler)
4. Internal services/repositories
5. Controllers/routes

**Example from `src/services/authService.js`:**
```javascript
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const { query } = require('../config/database');
const redis = require('../config/redis');
const env = require('../config/env');
const userRepository = require('../repositories/userRepository');
const { ValidationError, AuthenticationError, ConflictError, NotFoundError } = require('../utils/errors');
const logger = require('../utils/logger');
```

**Path Aliases:**
- No path aliases configured
- Relative paths use `../` convention (e.g., `require('../config/env')`)

## Error Handling

**Patterns:**
- Custom error classes in `src/utils/errors.js` extend base `AppError` class
- All custom errors include `statusCode` property and `isOperational = true` flag
- Specific error types for different scenarios:
  - `ValidationError` (400) - Input validation failures
  - `AuthenticationError` (401) - Auth token/credential issues
  - `AuthorizationError` (403) - Permission denied
  - `NotFoundError` (404) - Resource not found
  - `ConflictError` (409) - Data conflicts (duplicate username, etc.)
  - `RateLimitError` (429) - Rate limit exceeded

**Error Handler Middleware:**
- Centralized error handling in `src/middleware/errorHandler.js`
- Catches async errors via `catchAsync` wrapper function
- Special handling for Joi validation errors
- Special handling for PostgreSQL errors (codes starting with `P`)
- 500+ errors logged with full stack trace and context
- Non-500 errors logged as warnings

**Example from controller:**
```javascript
const changePassword = catchAsync(async (req, res) => {
  const { current_password, new_password } = req.body;
  await authService.changePassword(req.user.id, current_password, new_password);
  res.json({ ok: true, message: 'Senha alterada' });
});
```

**Async Handling:**
- `catchAsync()` wrapper converts Promise rejections to Express error handler
- Routes never use explicit try/catch blocks
- All promise chains terminate at error handler middleware

## Logging

**Framework:** Custom implementation in `src/utils/logger.js`

**Levels:** error, warn, info, debug (configured via `LOG_LEVEL` env var)

**Patterns:**
- Import logger: `const logger = require('../utils/logger');`
- Usage: `logger.info('Message')`, `logger.error('Message', errorObject)`
- Emergency bootstrap messages use emoji prefixes: 🚀, 📊, 🔴, 🔄, ✓, ✅, ⏹️, ❌
- Audit logging for security events: IP address, user ID, action type
- SQL slow query warnings for queries > 500ms

**Example:**
```javascript
logger.info(`Novo usuário registrado: ${username}`);
logger.error('Falha ao iniciar aplicação', err.message);
logger.warn('Possível tentativa de SQL injection detectada', {
  error: err.message,
  userId: req.user?.id,
  ip: req.ip,
});
```

## Comments

**When to Comment:**
- JSDoc for all exported functions and class methods
- Inline comments for complex logic or non-obvious code
- Block comments for sections in main files (marked with `=====` dividers)
- Comments in Portuguese (codebase language)

**JSDoc/TSDoc:**
- Full JSDoc comments on all service/controller methods
- Format: `/** Description */` for single-line, multi-line for parameters
- Parameter descriptions included for complex methods

**Example:**
```javascript
/**
 * Registra novo usuário
 */
async register(username, email, password) {
  // Validação básica
  if (!username || username.length < 3 || username.length > 50) {
    throw new ValidationError('Usuário deve ter 3-50 caracteres');
  }
  // ...
}
```

## Function Design

**Size:**
- Average function length: 20-50 lines for service methods
- Controllers keep route handlers short (typically 10-20 lines)
- Larger functions (>100 lines) break into smaller methods

**Parameters:**
- Route handlers destructure from `req.body`, `req.params`, `req.query`
- Service methods accept specific parameters or options objects
- Repository methods use options object pattern for pagination/filtering

**Return Values:**
- Controllers return JSON via `res.json()` or `res.status(code).json()`
- Services return domain objects or results with pagination metadata
- Repositories return raw database results or null
- All async functions return Promises

**Example repository pattern:**
```javascript
async findAll(options = {}) {
  const { page = 1, limit = 20, search = '', sortBy = 'created_at' } = options;
  // ... query logic ...
  return {
    data: dataResult.rows,
    pagination: { total, page, limit, pages },
  };
}
```

## Module Design

**Exports:**
- Services/Repositories: Export class instance (singleton pattern)
  ```javascript
  class UserRepository { /* ... */ }
  module.exports = new UserRepository();
  ```
- Controllers: Export object with named functions
  ```javascript
  module.exports = { register, login, logout, changePassword };
  ```
- Routes: Export Express router
  ```javascript
  module.exports = router;
  ```
- Utilities: Export named functions or objects
  ```javascript
  module.exports = { errorHandler, catchAsync };
  ```

**Barrel Files:**
- Not used in this codebase
- Each module exports only what it needs

## Database Patterns

**Query Style:**
- All queries use parameterized statements: `$1`, `$2`, etc.
- Parameters passed as array: `query(sql, [param1, param2])`
- Never string interpolation for user input

**SQL Formatting:**
- Multi-line queries use template literals with indentation
- SQL keywords UPPERCASE
- Column names LOWERCASE or snake_case
- Queries often include comments with business logic

**Example:**
```javascript
const sql = `
  INSERT INTO users (username, email, password_hash, role_id)
  VALUES ($1, $2, $3, $4)
  RETURNING id, username, email, role_id, is_active, created_at;
`;
const result = await query(sql, [username, email, passwordHash, roleId]);
```

**Transactions:**
- Used for multi-step operations that must all succeed or fail together
- Pattern: pass `client` parameter to repository methods
- Repository methods accept optional `client` parameter for transaction use

## Type Coercion & Validation

**Patterns:**
- Route params parsed explicitly: `parseInt(req.params.userId, 10)`
- Query strings parsed: `parseInt(page, 10)`, `isActive === 'true' ? true : false`
- Manual validation in services and controllers
- Custom ValidationError thrown with descriptive messages
- No centralized validation schema (Joi installed but not used)

---

*Convention analysis: 2026-07-14*
