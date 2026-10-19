# Slice-24 Evaluation: Executive Reporting and Time-Series Metrics

## Current Implementation Status

### ✅ Already Implemented

1. **Execution Data Structure** (`shared/schema.ts:426-451`)
   - `pipelineStepExecutions` table exists and stores job execution records
   - Has `executedAt`, `completedAt`, `status`, `output` fields
   - Links to `jobId` for job-level aggregation

2. **Job Detail Page** (`client/src/components/JobDetail.tsx`)
   - Exists and displays job information
   - Has test run functionality
   - No performance metrics currently displayed

### ❌ Missing/Incomplete Features

1. **Schema Extensions - Missing Cost and Resource Fields**
   - **Issue**: `pipelineStepExecutions` table doesn't have `costEstimate` or `resourceUtilization` fields
   - **Current Schema**: Only has basic execution fields (status, output, timestamps)
   - **Spec Requirement**: 
     - `costEstimate`: numeric field for cost tracking
     - `resourceUtilization`: JSONB field for CPU/memory metrics
   - **Location**: `shared/schema.ts:426-451`
   - **Impact**: Cannot track costs or resource usage for reporting

2. **Reporting API Endpoints - Not Implemented**
   - **Issue**: No API endpoints for aggregated reporting
   - **Spec Requirement**: Three new endpoints:
     - `GET /api/reporting/metrics-by-day?days=30` - Daily metrics aggregation
     - `GET /api/reporting/top-jobs-by-cost?limit=10` - Top jobs by cost
     - `GET /api/reporting/jobs/:id/summary` - Job summary metrics
   - **Location**: `server/routes.ts` - needs new endpoints
   - **Current**: Only has basic execution listing at `/api/executions`

3. **Job Detail Page - Missing Performance Metrics**
   - **Issue**: Job detail page doesn't show performance metrics
   - **Current Behavior**: Only shows job configuration and test results
   - **Spec Requirement**: Display metrics card with:
     - Success Rate (%)
     - Average Duration (seconds)
     - Average Cost ($)
     - Max CPU (%)
   - **Location**: `client/src/components/JobDetail.tsx:450+`
   - **Expected**: New metrics section below job configuration

4. **Data Aggregation Logic - Not Implemented**
   - **Issue**: No logic to aggregate execution data for reporting
   - **Spec Requirement**: 
     - Aggregate executions by date for time-series
     - Calculate costs per job
     - Calculate success rates, averages, max values
   - **Location**: New endpoints in `server/routes.ts`

5. **Mock Data Generation - Not Applicable**
   - **Issue**: Spec references `MOCK_EXECUTIONS` and `createMockExecution`
   - **Current**: Codebase uses real database, not mock data
   - **Note**: This is a documentation mismatch - implementation should use real database queries instead of mock data

## Required Changes

### 1. Update Database Schema

**File**: `shared/schema.ts:426-451`

- Add `costEstimate` field to `pipelineStepExecutions` table:
  ```typescript
  costEstimate: real("cost_estimate").default(0.0), // Cost in dollars
  ```
- Add `resourceUtilization` field to `pipelineStepExecutions` table:
  ```typescript
  resourceUtilization: jsonb("resource_utilization").default(sql`'{}'::jsonb`), // { cpu_max: number, mem_avg: number }
  ```
- Update TypeScript types automatically via Drizzle inference

**Note**: These fields should be optional/nullable to support existing executions without migration issues.

### 2. Implement Reporting API Endpoints

**File**: `server/routes.ts`

#### Endpoint 1: Daily Metrics (`GET /api/reporting/metrics-by-day`)
- Accept optional `days` query parameter (default: 30)
- Query `pipelineStepExecutions` grouped by date
- Count completed vs failed executions per day
- Return array: `[{ date: string, completed: number, failed: number }]`
- Use SQL `DATE()` function or PostgreSQL date truncation

#### Endpoint 2: Top Jobs by Cost (`GET /api/reporting/top-jobs-by-cost`)
- Accept optional `limit` query parameter (default: 10)
- Aggregate `costEstimate` by `jobId`
- Join with `jobs` table to get job names
- Sum costs, count executions per job
- Sort by total cost descending
- Return array: `[{ jobId: number, name: string, totalCost: number, count: number }]`

#### Endpoint 3: Job Summary (`GET /api/reporting/jobs/:id/summary`)
- Get all executions for specific job (`jobId`)
- Calculate:
  - `totalRuns`: Count of executions
  - `successRate`: Percentage of completed executions
  - `avgDuration`: Average of `completedAt - executedAt` in seconds
  - `avgCost`: Average of `costEstimate`
  - `maxCpu`: Maximum value from `resourceUtilization.cpu_max`
- Return object with all metrics
- Handle case where no executions exist (return zeros)

### 3. Update Job Detail Page UI

**File**: `client/src/components/JobDetail.tsx`

- Add new `useQuery` hook to fetch job summary:
  ```typescript
  const { data: summaryMetrics } = useQuery({
    queryKey: ['/api/reporting/jobs', jobId, 'summary'],
    queryFn: async () => {
      const res = await fetch(`/api/reporting/jobs/${jobId}/summary`);
      if (!res.ok) throw new Error('Failed to fetch metrics');
      return res.json();
    },
    enabled: !!jobId && !isEditing,
  });
  ```
- Add metrics display section after job configuration:
  - Show only when `summaryMetrics` exists and `totalRuns > 0`
  - Display 4 metric cards in a grid:
    - Success Rate (green, percentage)
    - Avg. Duration (gray, seconds)
    - Avg. Cost (indigo, dollars)
    - Max CPU (yellow, percentage)
  - Include description: "Aggregated statistics from X historical runs"

### 4. Update Pipeline Executor to Record Metrics

**File**: `server/pipeline-executor.ts`

- When creating `pipelineStepExecution`, include:
  - `costEstimate`: Calculate based on job type and duration
    - For AI jobs: duration * 0.01 + random(0, 0.5) for success, random(0, 2.0) for failure
    - For API/CURL jobs: duration * 0.005 + random(0, 0.2)
    - For other jobs: duration * 0.001
  - `resourceUtilization`: Generate mock metrics
    - `cpu_max`: Random(0, 95)
    - `mem_avg`: Random(0, 60)
- Update `createPipelineStepExecution` calls to include these fields

**Note**: In a real system, these would come from actual monitoring/metrics collection, but for MVP we can generate reasonable estimates.

### 5. Update Storage Interface

**File**: `server/storage.ts`

- Update `createPipelineStepExecution` interface to accept:
  ```typescript
  costEstimate?: number;
  resourceUtilization?: { cpu_max?: number; mem_avg?: number };
  ```
- Update implementation to store these fields

## Implementation Notes

- **Database Migration**: Adding new columns to existing table requires migration
- **Backward Compatibility**: New fields should be nullable with defaults
- **Cost Calculation**: Cost calculation logic should be configurable per job type
- **Resource Metrics**: In production, these would come from actual monitoring (Prometheus, CloudWatch, etc.)
- **Performance**: Reporting queries should use database indexes on `jobId`, `executedAt`, `status`
- **Caching**: Consider caching aggregated metrics for frequently accessed reports
- **Time Zones**: Date aggregation should respect user timezone or use UTC consistently

## Data Model Considerations

The spec references `MOCK_EXECUTIONS` which suggests a mock-based approach, but the current codebase uses:
- `pipelineStepExecutions` - Individual job executions within pipelines
- These represent the actual execution records that should be used for reporting

**Key Difference**: 
- Spec assumes standalone execution records
- Current codebase has executions tied to pipeline steps
- Solution: Use `pipelineStepExecutions` as the source of truth for job-level metrics

## API Design

### Endpoint Structure
```
GET /api/reporting/metrics-by-day?days=30
GET /api/reporting/top-jobs-by-cost?limit=10
GET /api/reporting/jobs/:id/summary
```

### Response Formats

**Metrics by Day:**
```json
[
  { "date": "2024-01-01", "completed": 45, "failed": 3 },
  { "date": "2024-01-02", "completed": 52, "failed": 1 }
]
```

**Top Jobs by Cost:**
```json
[
  { "jobId": 1, "name": "AI Analysis Job", "totalCost": 125.50, "count": 150 },
  { "jobId": 2, "name": "Data Sync", "totalCost": 89.20, "count": 200 }
]
```

**Job Summary:**
```json
{
  "totalRuns": 150,
  "successRate": 96.7,
  "avgDuration": 45.2,
  "avgCost": 0.84,
  "maxCpu": 87.5
}
```

## UI/UX Considerations

- Metrics should load asynchronously (don't block job detail page)
- Show loading skeleton while fetching metrics
- Display "No data available" if job has no executions
- Format numbers appropriately (2 decimal places for costs, 1 for percentages)
- Use color coding (green for success rate, yellow for CPU, etc.)
- Make metrics section collapsible/expandable for better UX
- Consider adding charts for time-series visualization (future enhancement)

## Dependencies

- Requires database schema migration for new fields
- Uses existing `pipelineStepExecutions` table structure
- Uses existing React Query for data fetching
- Uses existing UI components (Card, etc.)
- May need date manipulation library (date-fns already used)

## Testing Considerations

- Test with jobs that have no executions (should return zeros)
- Test with jobs that have mixed success/failure rates
- Test date aggregation across timezone boundaries
- Test cost aggregation with various cost values
- Test resource utilization extraction from JSONB
- Test API endpoints with different query parameters
- Test UI rendering with various metric values
- Test error handling for API failures

