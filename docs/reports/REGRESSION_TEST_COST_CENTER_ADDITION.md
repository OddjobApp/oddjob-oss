# AI Cost Center Feature - Added to Regression Test Plan

## Summary

The AI Cost Center & Token Observability Dashboard feature has been added to the regression test plan to ensure comprehensive testing after implementation.

## Test Coverage Added

### Manual Test Checklist (`REGRESSION_TEST_CHECKLIST.md`)

Added new section: **"AI Cost Center & Token Observability (NEW FEATURE)"** with 18 test cases:

1. Cost dashboard page navigation and display
2. Daily cost trend chart
3. Cost by model pie chart
4. Top spending pipelines table
5. Organization context filtering
6. Automatic usage logging
7. Cost calculation accuracy
8. Token count logging
9. Pipeline budget field in form
10. Budget status display
11. Budget progress visualization
12. Circuit breaker functionality
13. Budget warnings
14. Pipeline cost analytics endpoint
15. Organization filtering in analytics
16. Usage ingestion endpoint

### Automated Test Script (`scripts/regression-tests.ts`)

Added new method: `testAICostCenter()` with 3 automated tests:

1. **Get cost dashboard analytics** - Validates `/api/analytics/cost-dashboard` endpoint
   - Checks response structure (dailyCosts, modelCosts, topPipelines, totalSpend)
   - Validates array formats

2. **Get pipeline cost analytics** - Validates `/api/pipelines/:id/cost-analytics` endpoint
   - Checks pipeline ID matching
   - Validates current month spend
   - Validates daily costs array

3. **Ingest usage data** - Tests `/api/analytics/usage` endpoint
   - Creates test usage log entry
   - Validates recording success

### Quick Smoke Test Updated

Added cost dashboard check to 5-minute smoke test:
- Cost dashboard loads and displays data

### Data Integrity Tests Expanded

Added 3 new data integrity checks:
- AI usage logs preserved on pipeline deletion
- Cost calculation accuracy across providers
- Token count preservation in logs

## Test Execution

### Manual Testing

Use the updated `REGRESSION_TEST_CHECKLIST.md`:
1. Work through Phase 3 → AI Cost Center section
2. Check off each test case as completed
3. Document any issues found

### Automated Testing

The automated test suite will run these tests when you execute:
```bash
npm run test:regression
```

Tests are integrated into Phase 3 of the test execution flow.

## What's Being Tested

### Backend Endpoints
- ✅ POST `/api/analytics/usage` - Usage ingestion
- ✅ GET `/api/analytics/cost-dashboard` - Dashboard analytics
- ✅ GET `/api/pipelines/:id/cost-analytics` - Pipeline-specific analytics

### Frontend Components
- ✅ Cost dashboard page (`/analytics`)
- ✅ Pipeline budget field in forms
- ✅ Budget status display in pipeline detail

### Core Functionality
- ✅ Automatic usage logging in pipeline executor
- ✅ Cost calculation across providers (OpenAI, Anthropic, Google)
- ✅ Organization context filtering
- ✅ Circuit breaker logic (budget enforcement)

### Data Integrity
- ✅ Usage logs persist correctly
- ✅ Costs calculated accurately
- ✅ Token counts preserved

## Integration with Existing Tests

The AI Cost Center tests are integrated alongside existing feature tests:
- Runs after Pipeline Execution tests (uses test pipeline)
- Runs before Security tests
- Part of Phase 3 (Supporting Features)

## Next Steps

1. **Run Regression Tests**: Execute `npm run test:regression` to verify all tests pass
2. **Manual Testing**: Use the checklist for UI/UX verification
3. **Review Results**: Check that all 18 manual test cases and 3 automated tests pass
4. **Document Issues**: Report any failures in the test results summary

## Test Dependencies

The AI Cost Center tests depend on:
- Authentication working (uses `testAuthentication()`)
- Pipelines existing (uses `testPipelineId` from pipeline creation)
- Jobs existing (for AI API call jobs)
- Organization context working (for filtering tests)

All dependencies are satisfied by earlier test phases.

