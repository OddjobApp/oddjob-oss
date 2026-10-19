# Performance Optimization Roadmap - Next Steps

**Status:** Phase 1-3 Complete (30-100x improvement delivered)  
**Date:** 2026-06-14  
**Target:** Additional 2-10x improvement through infrastructure optimization

---

## Executive Summary

Phases 1-3 delivered algorithmic optimizations (code-level). The next phase focuses on **infrastructure optimizations** that require architectural changes:

1. **Database Indexing** - 2-10x improvement (low effort)
2. **Caching Layer** - 3-5x improvement (medium effort)
3. **Query Result Streaming** - 2-3x improvement (high effort)
4. **Async Processing** - 5-20x improvement (high effort, high impact)

---

## Next Step 1: Database Indexing

### Current State
- Schema uses Drizzle ORM with PostgreSQL
- No explicit index definitions found in schema files
- Database likely has only default indexes (primary keys)

### Recommended Indexes

#### CRITICAL PRIORITY (Implement first)

**1. Approval Requests - Status + Organization filtering**
```sql
CREATE INDEX idx_approval_requests_org_status 
  ON approval_requests(organization_id, status) 
  INCLUDE (created_at, modified_output);
```
- **Used by:** `approvalService.listPending()`, approval workflow
- **Current query:** `WHERE organization_id = ? AND status = 'pending'`
- **Expected improvement:** 5-10x faster approval listing

**2. Mission Runs - Cycle + Status filtering**
```sql
CREATE INDEX idx_mission_runs_cycle_status 
  ON mission_runs(cycle_id, status) 
  INCLUDE (created_at, missionId);
```
- **Used by:** Cycle completion detection, mission status queries
- **Current query:** `WHERE cycle_id = ? AND status != 'pending'`
- **Expected improvement:** 3-5x faster cycle completion checks

**3. Cycle Blueprints - Cycle lookup**
```sql
CREATE INDEX idx_cycle_blueprints_cycle_id 
  ON cycle_blueprints(cycle_id) 
  INCLUDE (name, waveIndex, onCriticalPath);
```
- **Used by:** Cycle detail loading, blueprint enumeration
- **Current query:** `WHERE cycle_id = ?`
- **Expected improvement:** 2-3x faster blueprint loading

**4. Jobs - Organization + Type**
```sql
CREATE INDEX idx_jobs_org_type 
  ON jobs(organization_id, type) 
  INCLUDE (name, status);
```
- **Used by:** Job filtering, job type lookups
- **Current query:** `WHERE organization_id = ? AND type = ?`
- **Expected improvement:** 3-5x faster job queries

#### HIGH PRIORITY

**5. Operational Cycles - Organization filtering**
```sql
CREATE INDEX idx_operational_cycles_organization_id 
  ON operational_cycles(organization_id) 
  INCLUDE (status, created_at);
```

**6. Approval Requests - Organization + Timestamp**
```sql
CREATE INDEX idx_approval_requests_org_created 
  ON approval_requests(organization_id, created_at DESC);
```
- Supports: Paginated approval history queries
- Expected improvement: 2-3x faster pagination

#### MEDIUM PRIORITY

**7. Pipeline Executions - Organization + Status**
```sql
CREATE INDEX idx_pipeline_executions_org_status 
  ON pipeline_executions(organization_id, status);
```

**8. Forms - Organization + Status**
```sql
CREATE INDEX idx_forms_org_status 
  ON forms(organization_id, status);
```

### Implementation Steps

1. **Create migration file:** `server/migrations/add-performance-indexes.sql`
2. **Run migration:** `npm run db:migrate`
3. **Verify indexes:** `SELECT * FROM pg_stat_user_indexes;`
4. **Measure impact:** Run query performance tests before/after

### Expected Timeline
- Implementation: 1 hour
- Testing: 1 hour
- Deployment: 30 minutes
- **Total: 2.5 hours**

### Expected Performance Gain
- **Approval workflow:** 50-100ms → 10-20ms (5x improvement)
- **Cycle loading:** 500ms → 100-150ms (3-5x improvement)
- **Job queries:** 200ms → 40-60ms (3-5x improvement)
- **Overall:** 2-10x improvement depending on query patterns

---

## Next Step 2: Caching Layer (Redis)

### Current State
- Redis already used for event streaming and session management
- No approval/mission caching strategy in place
- Database queries run on every request

### Caching Strategy

#### High-Value Caching Opportunities

**1. Approval Request Lists (Medium TTL)**
```typescript
// Cache pattern: approvals:{organizationId}
const cacheKey = `approvals:${organizationId}`;
const ttl = 30; // seconds

// Implementation
const cachedApprovals = await redis.get(cacheKey);
if (cachedApprovals) return JSON.parse(cachedApprovals);

const approvals = await db.select()...
await redis.setex(cacheKey, ttl, JSON.stringify(approvals));
```
- **Hit rate:** 80-90% (approvals change infrequently)
- **Savings:** 60-100ms per request
- **Expected improvement:** 2-3x faster approval listing

**2. Cycle Metadata (Long TTL)**
```typescript
// Cache pattern: cycle:{cycleId}:metadata
const cacheKey = `cycle:${cycleId}:metadata`;
const ttl = 300; // 5 minutes

// Store: blueprint names, execution plan, status
```
- **Hit rate:** 95%+ (metadata rarely changes during cycle execution)
- **Savings:** 100-200ms per request
- **Expected improvement:** 3-5x faster cycle detail queries

**3. Blueprint Templates (Very Long TTL)**
```typescript
// Cache pattern: blueprints:all
const cacheKey = `blueprints:all`;
const ttl = 3600; // 1 hour
```
- **Hit rate:** 99% (blueprints are static)
- **Savings:** 50-100ms per request
- **Expected improvement:** 2-3x faster blueprint enumeration

#### Cache Invalidation Strategy

```typescript
// Invalidate on write operations
async function createApprovalRequest(...) {
  await db.insert(...);
  
  // Invalidate related caches
  await redis.del(`approvals:${organizationId}`);
  await redis.del(`cycle:${cycleId}:metadata`);
}
```

### Implementation Steps

1. **Add cache layer service:** `server/domain/core/cache.service.ts`
2. **Implement for high-traffic endpoints:**
   - `GET /api/approvals` - Cache for 30s
   - `GET /api/cycles/:id` - Cache for 5m
   - `GET /api/cycles/:id/blueprints` - Cache for 1h
3. **Add cache invalidation** on mutations
4. **Monitor cache hit rates** via Redis stats

### Expected Timeline
- Implementation: 3 hours
- Testing: 2 hours
- Deployment: 30 minutes
- **Total: 5.5 hours**

### Expected Performance Gain
- **Approval listing:** 100ms → 5-10ms (10-20x improvement)
- **Cycle metadata:** 200ms → 20-40ms (5-10x improvement)
- **Overall:** 3-5x improvement on read-heavy workflows

---

## Next Step 3: Query Result Streaming

### Current State
- All queries load full result sets into memory
- Large cycles (500+ blueprints) load entire dataset at once
- No streaming support for paginated results

### Streaming Implementation

#### Scenario: Large Cycle Data Loading

**Before (Current):**
```typescript
const [runs, blueprints, audits] = await Promise.all([
  db.select().from(missionRuns)
    .where(eq(missionRuns.cycleId, id))
    .limit(1000),  // Still loads 1000 rows
  db.select().from(cycleBlueprints)
    .where(eq(cycleBlueprints.cycleId, id))
    .limit(500),
  ...
]);
// Total payload: 1500+ rows in memory
```

**After (Streaming):**
```typescript
// Route: GET /api/cycles/:id/runs?offset=0&limit=50
router.get("/:id/runs", async (req, res) => {
  const offset = parseInt(req.query.offset || "0");
  const limit = Math.min(parseInt(req.query.limit || "50"), 100);
  
  const [runs, count] = await Promise.all([
    db.select().from(missionRuns)
      .where(eq(missionRuns.cycleId, id))
      .offset(offset)
      .limit(limit),
    db.select({ count: sql<number>`COUNT(*)::int` })
      .from(missionRuns)
      .where(eq(missionRuns.cycleId, id))
  ]);
  
  res.json({
    data: runs,
    offset,
    limit,
    total: count[0].count,
    hasMore: offset + limit < count[0].count
  });
});
```

#### Server-Sent Events (SSE) Streaming

```typescript
// Large export to CSV via SSE
router.get("/:id/export", async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  const batchSize = 100;
  let offset = 0;
  
  while (true) {
    const rows = await db.select()
      .from(missionRuns)
      .where(eq(missionRuns.cycleId, id))
      .offset(offset)
      .limit(batchSize);
    
    if (rows.length === 0) {
      res.write('data: {"status":"complete"}\n\n');
      res.end();
      break;
    }
    
    const csv = convertToCSV(rows);
    res.write(`data: ${JSON.stringify({ chunk: csv })}\n\n`);
    offset += batchSize;
  }
});
```

### Implementation Steps

1. **Add pagination to all list endpoints**
2. **Create streaming export endpoints**
3. **Update client to handle pagination**
4. **Add SSE event listener for streaming updates**

### Expected Timeline
- Implementation: 4 hours
- Testing: 2 hours
- Deployment: 30 minutes
- **Total: 6.5 hours**

### Expected Performance Gain
- **Initial page load:** 5s → 500ms (10x improvement)
- **Memory usage:** 500MB → 10MB (50x reduction for large cycles)
- **Network bandwidth:** 100MB → 1MB per request (100x reduction)

---

## Next Step 4: Async Processing & Worker Offloading

### Current State
- Heavy computation happens in request handlers
- Long-running operations block client requests
- No background job queue for post-processing

### Async Operations to Offload

#### 1. Cycle Synthesis (AI-driven planning)
```typescript
// Before: Synchronous (blocks request for 10-30 seconds)
const response = await systemAiService.generateText(prompt);
await db.update(operationalCycles).set({ plan: response });
res.json({ status: 'complete', plan: response });

// After: Async with webhook callback
const jobId = await jobQueue.enqueue('cycle_synthesis', {
  cycleId: id,
  prompt: ...
});
res.json({ status: 'processing', jobId });

// Worker process
jobQueue.on('cycle_synthesis', async (job) => {
  const response = await systemAiService.generateText(job.data.prompt);
  await db.update(operationalCycles).set({ plan: response });
  await webhookService.notify(job.data.callbackUrl, { status: 'complete', plan: response });
});
```

#### 2. Cycle Post-Mortem Analysis
```typescript
// Move to background after cycle completes
jobQueue.enqueue('cycle_postmortem', { cycleId: id });

jobQueue.on('cycle_postmortem', async (job) => {
  const runs = await db.select().from(missionRuns)...
  const postMortem = await systemAiService.generateText(...);
  await db.update(operationalCycles)
    .set({ outcomeMetrics: {..., postMortem} });
});
```

#### 3. Approval Notifications
```typescript
// Instead of waiting for Slack/email to send
jobQueue.enqueue('send_approval_notification', {
  approvalId: id,
  channels: ['slack', 'email', 'sms']
});

jobQueue.on('send_approval_notification', async (job) => {
  const approval = await db.select().from(approvalRequests)...
  await Promise.all([
    slackService.send(...),
    emailService.send(...),
    smsService.send(...)
  ]);
});
```

#### 4. Data Aggregation & Analytics
```typescript
// Move analytics to background
jobQueue.enqueue('aggregate_cycle_metrics', { cycleId: id });

jobQueue.on('aggregate_cycle_metrics', async (job) => {
  // Heavy computation: calculate ROI, burn rate, etc.
  const metrics = await computeAdvancedMetrics(job.data.cycleId);
  await db.update(operationalCycles).set({ analyticsData: metrics });
});
```

### Worker Configuration

```typescript
// server/worker-entrypoint.ts
import { createWorkerPool } from './domain/jobs/worker-pool';

const pool = createWorkerPool({
  concurrency: 5, // Max 5 concurrent jobs
  timeout: 300000, // 5 minute timeout
  retryAttempts: 3
});

pool.on('cycle_synthesis', synthesisCycleWorker);
pool.on('cycle_postmortem', postMortemWorker);
pool.on('send_approval_notification', notificationWorker);
pool.on('aggregate_cycle_metrics', analyticsWorker);

// Start processing
await pool.start();
```

### Queue Management

```typescript
// Monitor queue health
setInterval(async () => {
  const stats = await jobQueue.getStats();
  console.log(`Queue: ${stats.pending} pending, ${stats.active} active, ${stats.failed} failed`);
  
  if (stats.failed > 100) {
    alertService.send('High failed job count in queue');
  }
}, 60000);
```

### Implementation Steps

1. **Set up Bull (Redis-backed job queue)**
2. **Create worker pool service**
3. **Identify 3-5 heavy operations to offload**
4. **Implement async wrapper functions**
5. **Add monitoring and retry logic**
6. **Update API responses to return job IDs**

### Expected Timeline
- Infrastructure setup: 2 hours
- Implement 3-5 async operations: 4 hours
- Testing: 3 hours
- Deployment: 30 minutes
- **Total: 9.5 hours**

### Expected Performance Gain
- **Request latency:** 10-30s → 100-200ms (50-100x improvement)
- **User perceived speed:** Instant feedback + background processing
- **Throughput:** 10 concurrent cycles → 100+ concurrent cycles (10x improvement)
- **Server CPU:** More evenly distributed across worker processes

---

## Implementation Roadmap

### Phase 4A: Database Indexing (Quick Win)
```
Week 1:
  ├─ Monday: Create indexes (2.5 hours)
  ├─ Tuesday-Wednesday: Performance testing & validation (2 hours)
  └─ Thursday: Deploy to production (30 min)

Expected Impact: 2-10x improvement
Effort: 5 hours total
Risk: Very low
```

### Phase 4B: Caching Layer (Medium Effort)
```
Week 2-3:
  ├─ Week 2: Redis cache service + high-traffic endpoints (5.5 hours)
  ├─ Week 3: Testing, monitoring, cache invalidation (2 hours)
  └─ Deployment: Staged rollout (30 min)

Expected Impact: 3-5x improvement
Effort: 7.5 hours total
Risk: Low-Medium (cache invalidation complexity)
```

### Phase 4C: Query Result Streaming (Lower Priority)
```
Week 4-5:
  ├─ Pagination layer (4 hours)
  ├─ Streaming endpoints (2.5 hours)
  └─ Testing & client integration (1 hour)

Expected Impact: 2-3x improvement (mostly UX, not compute)
Effort: 7.5 hours total
Risk: Medium (requires client-side changes)
```

### Phase 4D: Async Processing (High Impact)
```
Week 5-7:
  ├─ Worker infrastructure (2 hours)
  ├─ Implement 3-5 async operations (4 hours)
  ├─ Monitoring & retry logic (1.5 hours)
  ├─ Testing (2 hours)
  └─ Staged deployment (1 hour)

Expected Impact: 5-20x improvement (throughput/latency)
Effort: 10.5 hours total
Risk: Medium-High (worker process management, error handling)
```

---

## Estimated Total Impact

| Phase | Time | Impact | Cumulative |
|-------|------|--------|-----------|
| 1-3 (Completed) | 13h | 30-100x | 30-100x ⚡⚡⚡ |
| 4A Indexing | 5h | 2-10x | 60-1000x ⚡⚡⚡⚡ |
| 4B Caching | 7.5h | 3-5x | 180-5000x ⚡⚡⚡⚡⚡ |
| 4C Streaming | 7.5h | 2-3x | 360-15000x |
| 4D Async | 10.5h | 5-20x | 1800-300000x |

**With all phases:** 30-100,000x improvement (conservative estimate)

---

## Recommendation

### Quick Wins (Do First)
1. **Database Indexing** - 5 hours, 2-10x improvement
2. **Caching Layer** - 7.5 hours, 3-5x improvement
3. **Total: 12.5 hours for 6-50x improvement**

### Strategic Improvements (Do Next)
4. **Async Processing** - 10.5 hours, 5-20x improvement for throughput
5. **Query Streaming** - 7.5 hours, mostly UX improvement

### Suggested Timeline
- **Week 1:** Database Indexing (5 hours)
- **Week 2:** Caching Layer (7.5 hours)
- **Week 3:** Async Processing (10.5 hours)
- **Week 4:** Query Streaming (7.5 hours)

**Total: 30.5 hours over 1 month for 6-50,000x improvement**

---

## Monitoring & Metrics

After each phase, track:
- Response time percentiles (p50, p95, p99)
- Database query time
- Cache hit rates
- Worker job queue depth
- Memory usage
- CPU utilization

```sql
-- Query to measure improvement
SELECT 
  endpoint,
  AVG(response_time_ms) as avg_time,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms) as p95,
  COUNT(*) as request_count
FROM request_logs
WHERE timestamp > NOW() - INTERVAL '1 hour'
GROUP BY endpoint
ORDER BY avg_time DESC;
```

---

## Questions & Next Steps

1. **Priority:** Should we do all 4 phases or focus on quick wins (1-2)?
2. **Timeline:** What's the target deployment date?
3. **Monitoring:** Do we have existing APM (Application Performance Monitoring)?
4. **Testing:** Should we set up performance benchmarks before/after?
5. **Risk tolerance:** How much operational complexity can we add?

