# Testing Patterns

**Analysis Date:** 2026-07-14

## Test Framework

**Current State: No Testing Framework Configured**

**Runner:**
- None installed
- `package.json` test script: `"test": "echo \"Add tests later\""`
- No test dependencies in `package.json`

**Available Options for Future Implementation:**
- Jest: Standard choice for Node.js (well-suited for Express/async code)
- Vitest: Modern alternative with Vite integration (faster)
- Mocha: Minimal, flexible test runner (requires separate assertion library)

**Assertion Library:**
- None currently installed
- Joi (validation library, v17.12.0) is in dependencies but not used for testing

**Run Commands (When Tests Are Implemented):**
```bash
npm test              # Run all tests
npm test -- --watch  # Watch mode
npm test -- --coverage  # Coverage report
```

## Test File Organization

**Current State: No Test Files Exist**

**When Implemented, Use This Pattern:**

**Location:**
- Co-locate test files with source code, OR
- Create parallel `test/` directory mirroring `src/` structure
- Recommended: Co-located (simpler imports, keeps tests close to code)

**Naming:**
- Pattern: `[FileName].test.js` or `[FileName].spec.js`
- Examples: `authService.test.js`, `userController.test.js`

**Structure Example (when implemented):**
```
src/
├── services/
│   ├── authService.js
│   └── authService.test.js
├── controllers/
│   ├── authController.js
│   └── authController.test.js
├── repositories/
│   ├── userRepository.js
│   └── userRepository.test.js
└── middleware/
    ├── auth.js
    └── auth.test.js
```

## Test Structure

**When Implemented, Use This Pattern:**

**Suite Organization:**
```javascript
describe('AuthService', () => {
  describe('register()', () => {
    it('should create a new user with hashed password', async () => {
      // Arrange
      const username = 'testuser';
      const email = 'test@example.com';
      const password = 'password123';

      // Act
      const result = await authService.register(username, email, password);

      // Assert
      expect(result).toHaveProperty('id');
      expect(result.username).toBe(username);
    });

    it('should throw ValidationError if username is too short', async () => {
      // Arrange, Act, Assert
      await expect(authService.register('ab', 'test@example.com', 'password123'))
        .rejects.toThrow(ValidationError);
    });
  });

  describe('login()', () => {
    // login tests
  });
});
```

**Patterns to Implement:**

**Setup Pattern:**
```javascript
let authService;
let userRepository;

beforeEach(() => {
  // Reset mocks
  jest.clearAllMocks();
});

afterEach(async () => {
  // Cleanup (disconnect DB, clear Redis, etc.)
  await redis.flushAll();
});
```

**Teardown Pattern:**
```javascript
afterAll(async () => {
  // Close database connections, Redis, etc.
  await pool.end();
  await redis.client.quit();
});
```

**Assertion Pattern:**
- Use Jest matchers: `expect(value).toBe()`, `expect(value).toEqual()`
- For async operations: `await expect(promise).rejects.toThrow()`
- For status codes: `expect(response.status).toBe(201)`

## Mocking

**Framework:** Jest (when implemented)

**Patterns to Implement:**

**Database Mocking:**
```javascript
jest.mock('../config/database', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
  pool: {
    query: jest.fn(),
    end: jest.fn(),
  },
}));
```

**Redis Mocking:**
```javascript
jest.mock('../config/redis', () => ({
  get: jest.fn(),
  setex: jest.fn(),
  del: jest.fn(),
  client: {
    quit: jest.fn(),
  },
}));
```

**Dependencies Mocking:**
```javascript
jest.mock('bcryptjs', () => ({
  hashSync: jest.fn(password => `hashed_${password}`),
  compareSync: jest.fn((password, hash) => hash === `hashed_${password}`),
}));
```

**Example Repository Mock Setup:**
```javascript
describe('AuthService', () => {
  let authService;
  let mockUserRepository;

  beforeEach(() => {
    mockUserRepository = {
      findByUsername: jest.fn(),
      findByEmail: jest.fn(),
      create: jest.fn(),
    };
    jest.doMock('../repositories/userRepository', () => mockUserRepository);
    authService = require('../services/authService');
  });

  it('should verify existing user before registration', async () => {
    mockUserRepository.findByUsername.mockResolvedValue({ id: 1, username: 'existing' });
    
    await expect(authService.register('existing', 'new@example.com', 'password'))
      .rejects.toThrow(ConflictError);
  });
});
```

**What to Mock:**
- Database queries (`query`, `transaction`)
- Redis operations (`get`, `setex`, `del`, `ttl`)
- External services/APIs
- Date/time (`Date.now()`, `new Date()`)
- UUID generation

**What NOT to Mock:**
- Error classes (`ValidationError`, `AuthenticationError`, etc.)
- Logger (or spy on it to verify calls)
- Utility functions (`normalizeDateTime`, `parseSchedule`, etc.)
- Configuration loading

## Fixtures and Factories

**When Implemented, Use This Pattern:**

**Test Data Factories:**
```javascript
// test/factories/userFactory.js
function createUser(overrides = {}) {
  return {
    id: 1,
    username: 'testuser',
    email: 'test@example.com',
    password_hash: 'hashed_password',
    role_id: 1,
    is_active: true,
    created_at: new Date(),
    ...overrides,
  };
}

function createAdmin(overrides = {}) {
  return createUser({ role_id: 2, ...overrides });
}

module.exports = { createUser, createAdmin };
```

**Market Fixture Example:**
```javascript
function createMarket(overrides = {}) {
  return {
    id: 1,
    question: 'Will Bitcoin reach $100k?',
    description: 'End of 2025',
    odds_yes: 1.95,
    odds_no: 1.95,
    status: 'open',
    created_at: new Date(),
    ...overrides,
  };
}

module.exports = { createMarket };
```

**Location:**
- `test/fixtures/` directory
- OR `test/factories/` directory (factory pattern)
- Import in test files: `const { createUser } = require('../../test/factories/userFactory');`

## Coverage

**Requirements:** None currently enforced

**When Implemented, Target:**
- Unit tests: aim for 80%+ coverage of services/repositories
- Integration tests: cover critical paths (auth flow, market resolution, wagering)
- E2E tests: cover user journeys (register → login → place wager → resolve)

**View Coverage:**
```bash
npm test -- --coverage
```

**Coverage Thresholds (Suggested):**
```javascript
// jest.config.js
module.exports = {
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
};
```

## Test Types

**Unit Tests:**
- Scope: Individual functions and methods in isolation
- Approach: Mock all external dependencies (DB, Redis, external services)
- Examples: Service methods, repository queries (mocked), utility functions
- Files: `src/services/*.test.js`, `src/utils/*.test.js`

**Example Unit Test:**
```javascript
describe('marketService.isValidOdds()', () => {
  it('should accept odds between 1.01 and 1000', () => {
    expect(isValidOdds(1.01)).toBe(true);
    expect(isValidOdds(100)).toBe(true);
    expect(isValidOdds(1000)).toBe(true);
  });

  it('should reject odds below 1.01 or above 1000', () => {
    expect(isValidOdds(1.00)).toBe(false);
    expect(isValidOdds(1001)).toBe(false);
    expect(isValidOdds(-5)).toBe(false);
  });
});
```

**Integration Tests:**
- Scope: Multiple services working together with mocked DB/Redis
- Approach: Test complete workflows without hitting real database
- Examples: Full auth flow (register → login → logout), market creation to resolution
- Files: `test/integration/*.test.js`

**Example Integration Test:**
```javascript
describe('Auth Flow (Integration)', () => {
  it('should register user, login, and create session', async () => {
    // 1. Register
    const user = await authService.register('newuser', 'new@example.com', 'password123');
    expect(user.id).toBeDefined();

    // 2. Login
    const loginResult = await authService.login('newuser', 'password123', '127.0.0.1', 'Mozilla');
    expect(loginResult.token).toBeDefined();

    // 3. Verify session in Redis (mocked)
    const session = await redis.get(`session:${loginResult.sessionId}`);
    expect(session.userId).toBe(user.id);
  });
});
```

**E2E Tests:**
- Current State: Not implemented
- Approach: Test full HTTP endpoints with real/test database
- Framework: Supertest (for testing Express routes)
- Installation: `npm install --save-dev supertest`

**Example E2E Test (Future):**
```javascript
const request = require('supertest');
const app = require('../../server');

describe('POST /api/auth/register', () => {
  it('should register a new user', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'testuser',
        email: 'test@example.com',
        password: 'password123',
      });

    expect(response.status).toBe(201);
    expect(response.body.user.username).toBe('testuser');
  });

  it('should reject duplicate username', async () => {
    // Create first user
    await request(app)
      .post('/api/auth/register')
      .send({ username: 'duplicate', email: 'first@example.com', password: 'pass123' });

    // Try to create second with same username
    const response = await request(app)
      .post('/api/auth/register')
      .send({ username: 'duplicate', email: 'second@example.com', password: 'pass123' });

    expect(response.status).toBe(409);
    expect(response.body.error).toContain('já está em uso');
  });
});
```

## Common Patterns

**Async Testing:**
```javascript
// For async functions that should succeed
it('should fetch user by ID', async () => {
  const user = await userRepository.findById(1);
  expect(user).toBeDefined();
  expect(user.username).toBe('testuser');
});

// For promises that should reject
it('should throw NotFoundError for nonexistent user', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });
  
  await expect(userRepository.findById(999))
    .rejects.toThrow(NotFoundError);
});
```

**Error Testing:**
```javascript
describe('AuthService.register()', () => {
  it('should throw ValidationError for short username', async () => {
    const error = await authService.register('ab', 'test@example.com', 'password')
      .catch(e => e);
    
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.statusCode).toBe(400);
    expect(error.message).toContain('3-50 caracteres');
  });

  it('should throw ConflictError for duplicate username', async () => {
    mockUserRepository.findByUsername.mockResolvedValueOnce({ id: 1 });
    
    const error = await authService.register('existing', 'new@example.com', 'password')
      .catch(e => e);
    
    expect(error).toBeInstanceOf(ConflictError);
    expect(error.statusCode).toBe(409);
  });
});
```

**Database Transaction Testing:**
```javascript
it('should rollback on error during transaction', async () => {
  const mockTransaction = jest.fn().mockRejectedValueOnce(new Error('DB Error'));
  jest.doMock('../config/database', () => ({
    transaction: mockTransaction,
  }));

  await expect(marketService.resolveMarket(1, 'yes'))
    .rejects.toThrow('DB Error');
  
  expect(mockTransaction).toHaveBeenCalledWith(expect.any(Function));
});
```

**Middleware Testing:**
```javascript
describe('requireAuth middleware', () => {
  let req, res, next;

  beforeEach(() => {
    req = {
      headers: { authorization: 'Bearer valid-token' },
      user: undefined,
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    next = jest.fn();
  });

  it('should attach user to request on valid token', async () => {
    // Mock JWT verification and Redis session
    jest.doMock('jsonwebtoken', () => ({
      verify: jest.fn(() => ({ userId: 1, sessionId: 'abc123' })),
    }));

    await requireAuth(req, res, next);

    expect(req.user).toBeDefined();
    expect(req.user.id).toBe(1);
    expect(next).toHaveBeenCalled();
  });

  it('should return 401 if token is missing', async () => {
    req.headers.authorization = '';

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
```

---

*Testing analysis: 2026-07-14*
