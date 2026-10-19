# Phase 4: Integration Testing Guide

**Period:** Jul 12-13, 2026  
**Purpose:** Comprehensive testing of all Phase 4 components before production  
**Scope:** Queue service, workers, endpoint integrations, scheduled jobs

---

## 🎯 Testing Overview

### Test Suite Structure

```
tests/integration/
├── phase-4-queue.integration.test.ts       (Queue service tests)
├── phase-4-workers.integration.test.ts     (Worker implementation tests)
├── phase-4-endpoints.integration.test.ts   (Endpoint integration tests)
├── jest.config.js                          (Jest configuration)
└── setup.ts                                (Test environment setup)
```

### Test Coverage

| Component | Tests | Coverage |
|-----------|-------|----------|
| Queue Service | 40+ | Job submission, status, cancellation, stats |
| Workers | 30+ | Cycle synthesis, notifications, postmortem, analytics |
| Endpoints | 25+ | Launch, approval, abort, scheduled jobs |
| Performance | 15+ | Latency, throughput, concurrent submissions |
| **Total** | **110+** | **All critical paths** |

---

## 📋 Prerequisites

### 1. Environment Setup

```bash
# Copy test environment file
cp .env.example .env.test

# Set required variables
export NODE_ENV=test
export REDIS_HOST=localhost
export REDIS_PORT=6379
export TEST_DATABASE_URL=postgresql://user:pass@localhost/oddjob_test
export DATABASE_URL=$TEST_DATABASE_URL
```

### 2. Database Setup

```bash
# Create test database
createdb oddjob_test

# Run migrations
npm run migrate:test

# Seed test data (optional)
npm run seed:test
```

### 3. Redis Setup

```bash
# Start Redis (if not running)
redis-server

# Or via Docker
docker run -d -p 6379:6379 redis:7-alpine
```

### 4. Dependencies

```bash
# Install test dependencies
npm install --save-dev jest @jest/globals ts-jest supertest @types/jest

# Ensure production dependencies are installed
npm install
```

---

## 🚀 Running Tests

### Run All Phase 4 Tests

```bash
# Run all integration tests
npm run test:integration:phase4

# Or using Jest directly
npx jest tests/integration/phase-4-*.integration.test.ts --config tests/integration/jest.config.js
```

### Run Specific Test Suites

```bash
# Queue service tests only
npx jest tests/integration/phase-4-queue.integration.test.ts

# Worker tests only
npx jest tests/integration/phase-4-workers.integration.test.ts

# Endpoint tests only
npx jest tests/integration/phase-4-endpoints.integration.test.ts
```

### Run with Coverage Report

```bash
# Generate coverage report
npx jest tests/integration/phase-4-*.integration.test.ts \
  --coverage \
  --coverageDirectory=coverage/phase-4

# View HTML coverage report
open coverage/phase-4/lcov-report/index.html
```

### Run with Verbose Output

```bash
# Show detailed test output
npx jest tests/integration/phase-4-*.integration.test.ts --verbose

# Show test names and timings
npx jest tests/integration/phase-4-*.integration.test.ts --verbose --listTests
```

---

## 📊 Test Categories

### 1. Queue Service Tests (40+ tests)

**File:** `phase-4-queue.integration.test.ts`

**Coverage:**
- ✅ Job submission (high/normal/low priority)
- ✅ Retry configuration (exponential backoff)
- ✅ Job status tracking
- ✅ Job cancellation
- ✅ Queue statistics
- ✅ Organization scoping
- ✅ Multiple queue isolation
- ✅ Error handling

**Expected Results:**
- All jobs submitted successfully
- Status tracking accurate
- Queue stats reflect submitted jobs
- Cancellation works for pending jobs
- Org scoping prevents cross-org access

### 2. Worker Tests (30+ tests)

**File:** `phase-4-workers.integration.test.ts`

**Coverage:**
- ✅ Cycle synthesis worker
  - Blueprint validation
  - DAG validation
  - Data flow validation
  - Metadata enrichment
  - Progress tracking
  
- ✅ Approval notification worker
  - Notification type templates
  - Multi-recipient support
  - Missing recipient handling
  
- ✅ Postmortem analysis worker
  - Root cause analysis
  - Failure type classification
  - Recommendation generation
  
- ✅ Analytics worker
  - Metric computation
  - Percentile calculation (p95, p99)
  - Multiple time ranges

**Expected Results:**
- Workers process jobs successfully
- Metadata updated correctly
- Analytics computed accurately
- Error handling prevents crashes

### 3. Endpoint Integration Tests (25+ tests)

**File:** `phase-4-endpoints.integration.test.ts`

**Coverage:**
- ✅ Cycle launch → synthesis job submission
- ✅ Approval creation → notification job submission
- ✅ Cycle abort → postmortem job submission
- ✅ Job status tracking via API
- ✅ Scheduled job submission
- ✅ End-to-end workflows

**Expected Results:**
- Jobs submitted on endpoint calls
- Responses include job IDs
- Status can be tracked
- Fallback to sync if queue fails

### 4. Performance Tests (15+ tests)

**File:** Included in endpoint tests

**Coverage:**
- ✅ Job submission latency (< 50ms)
- ✅ Status retrieval latency (< 50ms)
- ✅ Concurrent submission handling
- ✅ Queue throughput

**Expected Results:**
- All operations complete within SLA
- Concurrent requests handled correctly
- No timeouts or bottlenecks

---

## ✅ Test Execution Checklist

### Pre-Test Verification

- [ ] Database is running and accessible
- [ ] Redis is running and accessible
- [ ] Environment variables are set
- [ ] Test database is clean (optional: clear before tests)
- [ ] Dependencies are installed
- [ ] Code compiles without errors

### During Test Execution

```bash
# Run tests with monitoring
npm run test:integration:phase4 -- --verbose --bail

# Watch mode (re-run on code changes)
npm run test:integration:phase4 -- --watch
```

### Post-Test Verification

- [ ] All tests pass (green checkmarks)
- [ ] No skipped tests (unless intentional)
- [ ] No console errors or warnings
- [ ] Coverage meets thresholds (>70%)
- [ ] Performance benchmarks met
- [ ] No memory leaks detected

---

## 🐛 Troubleshooting

### Database Connection Errors

```
Error: connect ECONNREFUSED 127.0.0.1:5432
```

**Solution:**
```bash
# Check PostgreSQL is running
psql postgres://user:pass@localhost/oddjob_test

# Or start PostgreSQL
brew services start postgresql
```

### Redis Connection Errors

```
Error: connect ECONNREFUSED 127.0.0.1:6379
```

**Solution:**
```bash
# Check Redis is running
redis-cli ping

# Start Redis
redis-server
```

### Test Timeout Errors

```
jest.useFakeTimers() is not available in this environment
```

**Solution:**
```bash
# Increase test timeout in jest.config.js
testTimeout: 60000  // Increase from 30000
```

### Import/Module Errors

```
Cannot find module '@domain/queue/queue.service.js'
```

**Solution:**
```bash
# Rebuild TypeScript
npm run build

# Check moduleNameMapper in jest.config.js matches tsconfig paths
```

---

## 📈 Expected Test Results

### Queue Service Tests
```
PASS  tests/integration/phase-4-queue.integration.test.ts
  Queue Service Integration Tests
    Job Submission
      ✓ should submit a job with high priority (45ms)
      ✓ should submit a job with retry configuration (38ms)
      ✓ should submit a job with delay (42ms)
      ✓ should reject invalid queue names gracefully (15ms)
    Job Status Tracking
      ✓ should retrieve job status (32ms)
      ✓ should return null for non-existent job (28ms)
      ✓ should track progress updates (35ms)
    Queue Statistics
      ✓ should retrieve queue statistics (40ms)
      ✓ should show correct waiting count (52ms)

Test Suites: 1 passed, 1 total
Tests:       40 passed, 40 total
```

### Worker Tests
```
PASS  tests/integration/phase-4-workers.integration.test.ts
  Cycle Synthesis Worker
    ✓ should process cycle synthesis job (120ms)
    ✓ should handle invalid cycle gracefully (85ms)
  Approval Notification Worker
    ✓ should process approval notification job (95ms)
  Postmortem Analysis Worker
    ✓ should process postmortem analysis job (110ms)
  Analytics Aggregation Worker
    ✓ should aggregate analytics for organization (180ms)

Test Suites: 1 passed, 1 total
Tests:       30 passed, 30 total
```

### Endpoint Tests
```
PASS  tests/integration/phase-4-endpoints.integration.test.ts
  Endpoint Integration Tests
    Cycle Launch with Job Submission
      ✓ should submit synthesis job on cycle launch (65ms)
    Approval Creation with Job Submission
      ✓ should submit notification job on approval creation (55ms)
    Cycle Abort with Postmortem Job
      ✓ should submit postmortem job on cycle abort (60ms)
    Performance Requirements
      ✓ should submit jobs quickly (< 50ms) (32ms)
      ✓ should handle concurrent job submissions (180ms)

Test Suites: 1 passed, 1 total
Tests:       25 passed, 25 total
```

---

## 🎯 Success Criteria

### Must Pass
- ✅ All unit tests pass (100%)
- ✅ No console errors during test execution
- ✅ Job submission latency < 50ms
- ✅ Status retrieval latency < 50ms
- ✅ Concurrent requests handled correctly

### Should Pass
- ✅ Code coverage > 70%
- ✅ Performance benchmarks met
- ✅ Error handling verified
- ✅ Fallback mechanisms tested

### Nice to Have
- ✅ Coverage > 80%
- ✅ Memory profiling completed
- ✅ Load test results documented
- ✅ Performance analysis shared

---

## 📊 Coverage Report

After running tests, generate coverage:

```bash
npm run test:integration:phase4 -- --coverage

# Output:
# =============================== Coverage summary ===============================
# Statements   : 75.2% ( 450/598 )
# Branches     : 72.1% ( 280/388 )
# Functions    : 78.5% ( 95/121 )
# Lines        : 76.3% ( 420/550 )
# ===============================================================================
```

---

## 🔄 Continuous Integration

### GitHub Actions Example

```yaml
name: Phase 4 Integration Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      postgres:
        image: postgres:14
        env:
          POSTGRES_PASSWORD: test
          POSTGRES_DB: oddjob_test
      
      redis:
        image: redis:7-alpine
    
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - run: npm install
      - run: npm run migrate:test
      - run: npm run test:integration:phase4
      - run: npm run test:integration:phase4 -- --coverage
      
      - uses: codecov/codecov-action@v3
        with:
          files: ./coverage/phase-4/coverage-final.json
```

---

## 📝 Test Results Template

### Test Execution Report

```
Phase 4 Integration Testing Report
===================================

Date: 2026-07-12
Environment: Test (PostgreSQL + Redis)
Duration: 5 minutes 30 seconds

Queue Service Tests: ✅ 40/40 passed
Worker Tests: ✅ 30/30 passed
Endpoint Tests: ✅ 25/25 passed
Performance Tests: ✅ 15/15 passed

Total: ✅ 110/110 tests passed

Coverage:
  Statements: 76.3%
  Branches: 72.1%
  Functions: 78.5%
  Lines: 76.3%

Performance:
  Job submission: 32-45ms (target: <50ms) ✅
  Status retrieval: 28-40ms (target: <50ms) ✅
  Concurrent (10 jobs): 180ms (target: <500ms) ✅

Issues Found: None
Ready for: Production Deployment
```

---

## 🚀 Next Steps After Testing

### If All Tests Pass
1. ✅ Mark Phase 4 ready for production
2. ✅ Schedule deployment window
3. ✅ Prepare deployment runbook
4. ✅ Brief operations team

### If Tests Fail
1. ❌ Identify failed test(s)
2. ❌ Review error messages
3. ❌ Fix code or test
4. ❌ Re-run failed tests
5. ❌ Rerun full suite to verify fix

---

## 📞 Support

**Test Issues?**
- Check logs: `npm run test:integration:phase4 -- --verbose`
- Review setup: See Prerequisites section
- Check environment: Verify DATABASE_URL and REDIS_HOST

**Code Issues?**
- Review implementation against strategy docs
- Check error messages in worker logs
- Verify database schema is current

---

**Phase 4 Integration Testing - Ready to Execute** ✅
