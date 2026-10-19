# Regression Test Suite

This directory contains automated and manual regression tests to verify all functionality still works after adding the Pipeline Version Control feature.

## Quick Start

### Automated Tests

Run the automated test suite:

```bash
npm run test:regression
```

**Prerequisites:**
- Server must be running (`npm run dev`)
- Test user account must exist (default: username=`testuser`, password=`testpassword`)

**Environment Variables:**
- `API_URL` - Base URL for API (default: `http://localhost:5000`)
- `TEST_USERNAME` - Test username (default: `testuser`)
- `TEST_PASSWORD` - Test password (default: `testpassword`)

**Example:**
```bash
API_URL=http://localhost:5000 TEST_USERNAME=admin TEST_PASSWORD=secret npm run test:regression
```

### Manual Tests

Use the checklist in `REGRESSION_TEST_CHECKLIST.md` for manual testing. This is useful for:
- UI/UX testing
- Visual verification
- Browser-specific issues
- Detailed exploratory testing

## Test Coverage

### Phase 1: Critical Paths (Must Pass)
- ✅ Authentication (login, logout, session)
- ✅ Dashboard statistics
- ✅ Jobs CRUD (all job types)
- ✅ Pipelines CRUD
- ✅ Pipeline execution
- ✅ Pipeline Version Control (NEW)

### Phase 2: Secondary Features
- ✅ Schedules management
- ✅ Scheduled jobs
- ✅ Credentials management
- ✅ Users management

### Phase 3: Supporting Features
- ✅ Monitoring
- ✅ Alerts
- ✅ Knowledge Store
- ✅ AI Cost Center & Token Observability (NEW)

### Phase 4: Security & Error Handling
- ✅ CSRF protection
- ✅ Authentication requirements
- ✅ Error handling (404, validation, network)
- ✅ Data integrity (cascades, transactions)

## Test Results

The automated test suite will output:
- ✅ Passed tests with timing
- ❌ Failed tests with error messages
- ⏭️ Skipped tests (for optional features)
- Summary statistics at the end

**Example Output:**
```
🧪 Starting Regression Test Suite...

Base URL: http://localhost:5000

📋 Testing Authentication...
  ✅ Login with valid credentials (234ms)
  ✅ Get current user (45ms)
  ✅ Logout (12ms)

📋 Testing Dashboard...
  ✅ Dashboard stats endpoint (67ms)

...

============================================================
📊 TEST SUMMARY
============================================================
Total Tests: 45
✅ Passed: 44
❌ Failed: 0
⏭️  Skipped: 1

Success Rate: 97.8%

✅ All tests passed!
```

## Troubleshooting

### Tests Fail to Connect
- Ensure server is running: `npm run dev`
- Check the port matches (default: 5000)
- Verify API_URL environment variable

### Authentication Fails
- Ensure test user exists in database
- Check username/password are correct
- Verify session storage is working

### CSRF Token Issues
- Tests automatically fetch and use CSRF tokens
- If failing, check CSRF protection middleware is configured correctly

### Database Issues
- Ensure migrations are applied: `npm run db:push`
- Check database connection in `.env`
- Verify schema includes `pipeline_versions` table

## Running Specific Test Phases

You can modify `scripts/regression-tests.ts` to run only specific phases by commenting out sections in the `run()` method:

```typescript
async run(): Promise<void> {
  // Only run Phase 1
  await this.testAuthentication();
  await this.testDashboard();
  await this.testJobsCRUD();
  await this.testPipelinesCRUD();
  await this.testPipelineExecution();
  await this.testPipelineVersionControl();
  
  // Comment out other phases...
}
```

## Continuous Integration

To run tests in CI/CD:

```yaml
# Example GitHub Actions workflow
- name: Run Regression Tests
  run: |
    npm run dev &
    sleep 10  # Wait for server to start
    npm run test:regression
  env:
    API_URL: http://localhost:5000
    TEST_USERNAME: ${{ secrets.TEST_USERNAME }}
    TEST_PASSWORD: ${{ secrets.TEST_PASSWORD }}
```

## Adding New Tests

To add new regression tests:

1. Add a new test method to `RegressionTestSuite` class
2. Use `this.runTest()` helper for each test case
3. Call the new method from `run()` method
4. Follow existing patterns for authentication and error handling

**Example:**
```typescript
private async testNewFeature(): Promise<void> {
  console.log('📋 Testing New Feature...');
  
  await this.ensureAuthenticated();

  await this.runTest('Test new feature endpoint', async () => {
    const response = await fetch(`${BASE_URL}/api/new-feature`, {
      credentials: 'include',
      headers: { Cookie: this.sessionCookie },
    });

    if (!response.ok) {
      throw new Error(`Failed: ${response.status}`);
    }
  });

  console.log('');
}
```

## Notes

- Tests create real data in the database (jobs, pipelines, etc.)
- Tests are designed to clean up after themselves where possible
- Some tests may be skipped if optional features aren't configured
- Manual testing is still recommended for UI/UX verification

