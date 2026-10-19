# Phase 4 Implementation Plan - Full Infrastructure Optimization

**Duration:** 4 weeks (30.5 hours)  
**Target Impact:** 6-50,000x cumulative improvement (with Phase 1-3)  
**Start Date:** Week of 2026-06-17  
**Status:** Detailed planning phase

---

## Overview

Phase 4 builds on the algorithmic optimizations (Phase 1-3) with **infrastructure-level improvements** that enable higher throughput, lower latency, and better resource utilization.

```
Phase 1-3 (Done):        30-100x (algorithmic)
Phase 4A (Indexing):     +2-10x (database)
Phase 4B (Caching):      +3-5x (memory)
Phase 4C (Streaming):    +2-3x (UX/memory)
Phase 4D (Async):        +5-20x (throughput)

TOTAL: 6-50,000x improvement
```

---

## Week 1: Database Indexing (Phase 4A)

### Goals
- Add 8 recommended indexes to PostgreSQL
- Validate index performance improvements
- Document index strategy for future maintenance

### Day 1-2: Index Strategy & Planning

**Tasks:**
1. Analyze current table statistics
   ```sql
   SELECT schemaname, tablename, n_live_tup, n_dead_tup, 
          last_vacuum, last_autovacuum
   FROM pg_stat_user_tables
   WHERE n_live_tup > 1000
   ORDER BY n_live_tup DESC;
   ```

2. Review current index usage
   ```sql
   SELECT schemaname, tablename, indexname, idx_scan, idx_tup_read
   FROM pg_stat_user_indexes
   ORDER BY idx_scan DESC;
   ```

3. Document baseline metrics:
   - Query time (p50, p95, p99)
   - Database CPU usage
   - I/O operations

**Deliverables:**
- `database_analysis.md` - Current state assessment
- `index_strategy.md` - Which indexes, why, expected impact

### Day 3-4: Create & Deploy Indexes

**Tasks:**
1. Create migration file: `migrations/004_add_performance_indexes.sql`

```sql
-- Phase 4A: Performance Indexes
-- Execution: ~2 minutes total (non-blocking with CONCURRENTLY)

-- CRITICAL: Approval workflow
CREATE INDEX CONCURRENTLY idx_approval_requests_org_status 
  ON approval_requests(organization_id, status) 
  INCLUDE (created_at, modified_output);

-- CRITICAL: Cycle completion detection
CREATE INDEX CONCURRENTLY idx_mission_runs_cycle_status 
  ON mission_runs(cycle_id, status) 
  INCLUDE (created_at, mission_id);

-- CRITICAL: Cycle blueprint enumeration
CREATE INDEX CONCURRENTLY idx_cycle_blueprints_cycle_id 
  ON cycle_blueprints(cycle_id) 
  INCLUDE (name, wave_index, on_critical_path);

-- CRITICAL: Job filtering
CREATE INDEX CONCURRENTLY idx_jobs_org_type 
  ON jobs(organization_id, type) 
  INCLUDE (name, status);

-- HIGH PRIORITY: Cycle organization filtering
CREATE INDEX CONCURRENTLY idx_operational_cycles_org_status 
  ON operational_cycles(organization_id, status) 
  INCLUDE (created_at);

-- HIGH PRIORITY: Approval history pagination
CREATE INDEX CONCURRENTLY idx_approval_requests_org_created 
  ON approval_requests(organization_id, created_at DESC);

-- MEDIUM: Pipeline execution queries
CREATE INDEX CONCURRENTLY idx_pipeline_executions_org_status 
  ON pipeline_executions(organization_id, status);

-- MEDIUM: Form queries
CREATE INDEX CONCURRENTLY idx_forms_org_status 
  ON forms(organization_id, status);

-- Analyze tables for query planner
ANALYZE approval_requests;
ANALYZE mission_runs;
ANALYZE cycle_blueprints;
ANALYZE jobs;
ANALYZE operational_cycles;
ANALYZE pipeline_executions;
ANALYZE forms;
```

2. Execute migration in staging
   ```bash
   npm run db:migrate -- --target 004
   ```

3. Verify indexes created
   ```bash
   npm run db:verify-indexes
   ```

### Day 5: Performance Testing & Validation

**Tasks:**
1. Run performance benchmarks
   ```bash
   npm run perf:test -- --baseline=phase3 --compare=phase4a
   ```

2. Compare metrics:
   - Approval listing query time
   - Cycle detail loading time
   - Job filtering performance
   - Database CPU usage

3. Document results

**Expected Results:**
- Approval listing: 100ms → 10-20ms (5-10x improvement)
- Cycle loading: 300ms → 100-150ms (2-3x improvement)
- Database CPU: 20-30% reduction
- No query plan changes (all use new indexes)

**Deliverables:**
- `phase_4a_results.md` - Performance metrics before/after
- `index_maintenance_guide.md` - How to monitor and maintain indexes

---

## Week 2: Caching Layer (Phase 4B)

### Goals
- Implement Redis caching for high-traffic endpoints
- Create cache invalidation strategy
- Monitor cache hit rates

### Day 1-2: Cache Architecture Design

**Tasks:**
1. Design cache layer service

**File:** `server/domain/core/cache.service.ts`
```typescript
import { redis } from '@server/domain/core/infrastructure/redis/redis-client';

export const cacheService = {
  // Get with fallback to DB
  async getOrFetch<T>(
    key: string,
    fetchFn: () => Promise<T>,
    ttl: number = 300
  ): Promise<T> {
    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached);
    
    const value = await fetchFn();
    await redis.setex(key, ttl, JSON.stringify(value));
    return value;
  },

  // Invalidate single key
  async invalidate(key: string): Promise<void> {
    await redis.del(key);
  },

  // Invalidate pattern (e.g., "approvals:123:*")
  async invalidatePattern(pattern: string): Promise<void> {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) await redis.del(...keys);
  },

  // Set with tags for batch invalidation
  async setWithTags(
    key: string,
    value: any,
    ttl: number,
    tags: string[]
  ): Promise<void> {
    await redis.setex(key, ttl, JSON.stringify(value));
    for (const tag of tags) {
      await redis.sadd(`tag:${tag}`, key);
    }
  },

  // Invalidate all keys with a tag
  async invalidateByTag(tag: string): Promise<void> {
    const keys = await redis.smembers(`tag:${tag}`);
    if (keys.length > 0) {
      await redis.del(...keys);
      await redis.del(`tag:${tag}`);
    }
  }
};
```

2. Define cache key patterns
```typescript
export const CACHE_KEYS = {
  APPROVALS: (orgId: number) => `approvals:org:${orgId}`,
  APPROVALS_DETAIL: (id: number) => `approvals:detail:${id}`,
  CYCLE_METADATA: (cycleId: number) => `cycle:${cycleId}:metadata`,
  CYCLE_BLUEPRINTS: (cycleId: number) => `cycle:${cycleId}:blueprints`,
  BLUEPRINTS_ALL: () => `blueprints:all`,
  JOBS_BY_ORG: (orgId: number) => `jobs:org:${orgId}`,
};

export const CACHE_TTL = {
  APPROVALS: 30, // seconds - changes frequently
  CYCLE_METADATA: 300, // 5 minutes - stable during execution
  BLUEPRINTS: 3600, // 1 hour - static
  JOBS: 600, // 10 minutes - moderate changes
};
```

3. Plan cache invalidation strategy
   - Write operations trigger invalidation
   - Timestamp-based expiration as backup
   - Manual invalidation for edge cases

**Deliverables:**
- `cache_architecture.md` - Design document
- `cache.service.ts` - Cache service implementation

### Day 3-4: Implement Caching in High-Traffic Endpoints

**Task 1: Approval Listing Cache**

**File:** `server/domain/integrations/routes/approvals.ts`

```typescript
router.get("/", requireAuth, asyncHandler(async (req: any, res: Response) => {
  const userId = req.user.id;
  const userEmail = req.user.email;
  const orgId = req.user.defaultOrgId;

  // Cache key for this org
  const cacheKey = CACHE_KEYS.APPROVALS(orgId);
  
  try {
    // Try cache first
    const cached = await cacheService.getOrFetch(
      cacheKey,
      async () => {
        return await approvalService.listPending(userId, userEmail, req.user.adminRole);
      },
      CACHE_TTL.APPROVALS
    );

    res.json(cached);
  } catch (err) {
    // Cache miss or error - fetch fresh
    const list = await approvalService.listPending(userId, userEmail, req.user.adminRole);
    res.json(list);
  }
}));
```

**Task 2: Cycle Metadata Cache**

**File:** `server/routes/operational-cycles.ts`

```typescript
router.get("/:id", requireCycleRead, asyncHandler(async (req: any, res) => {
  const id = validateIdParam(req.params.id);
  const cacheKey = CACHE_KEYS.CYCLE_METADATA(id);

  // Cache cycle metadata
  const cache = await cacheService.getOrFetch(
    cacheKey,
    async () => {
      const [cycle] = await db.select()
        .from(operationalCycles)
        .where(eq(operationalCycles.id, id));
      
      return {
        id: cycle.id,
        name: cycle.name,
        status: cycle.status,
        executionPlan: cycle.executionPlan,
        metadata: cycle.metadata,
        createdAt: cycle.createdAt
      };
    },
    CACHE_TTL.CYCLE_METADATA,
    ['cycle_metadata', `cycle:${id}`]
  );

  res.json({ cycle: cache, ... });
}));
```

**Task 3: Blueprint Templates Cache**

```typescript
router.get("/templates", asyncHandler(async (req: any, res) => {
  const blueprints = await cacheService.getOrFetch(
    CACHE_KEYS.BLUEPRINTS_ALL(),
    async () => {
      return await db.select()
        .from(blueprints)
        .where(eq(blueprints.isTemplate, true))
        .orderBy(blueprints.name);
    },
    CACHE_TTL.BLUEPRINTS
  );

  res.json(blueprints);
}));
```

### Day 5: Cache Invalidation & Monitoring

**Tasks:**
1. Add cache invalidation to write operations

```typescript
// In approvalService.createApprovalRequest()
async createApprovalRequest(input: any) {
  const approval = await db.insert(approvalRequests).values(input);
  
  // Invalidate approval caches
  await cacheService.invalidateByTag(`approvals:org:${input.organizationId}`);
  
  return approval;
}

// In cycle-manager.service.ts
async launchCycle(data: any, userId: string, orgId: number) {
  const cycle = await ... // cycle creation
  
  // Invalidate related caches
  await cacheService.invalidatePattern(`cycle:*:metadata`);
  await cacheService.invalidatePattern(`blueprints:org:${orgId}:*`);
  
  return cycle;
}
```

2. Add cache metrics monitoring
```typescript
// Monitor cache health
setInterval(async () => {
  const info = await redis.info('stats');
  const hitRate = calculateHitRate(info);
  
  logger.info(`[Cache] Hit rate: ${(hitRate * 100).toFixed(2)}%`);
  
  if (hitRate < 0.7) {
    logger.warn('[Cache] Low hit rate - review TTL values');
  }
}, 60000);
```

3. Document cache strategy
   - Key patterns and purposes
   - TTL values and reasoning
   - Invalidation rules
   - Monitoring approach

**Expected Results:**
- Approval listing: 100ms → 5-10ms (10-20x improvement)
- Cycle metadata: 200ms → 10-20ms (10-20x improvement)
- Cache hit rate: 80-95% on steady-state operations
- Memory usage: 50-100MB for cached data

**Deliverables:**
- `cache.service.ts` - Cache implementation
- `cache_invalidation.md` - Invalidation strategy
- Updated routes with caching
- `cache_monitoring.md` - How to monitor hit rates

---

## Week 3: Query Result Streaming (Phase 4C)

### Goals
- Implement pagination for large datasets
- Add Server-Sent Events (SSE) for streaming exports
- Improve UX and memory efficiency

### Day 1-2: Pagination Layer

**Tasks:**
1. Create pagination service

**File:** `server/domain/core/pagination.service.ts`
```typescript
export interface PaginationParams {
  offset?: number;
  limit?: number;
  sort?: string; // fieldname:asc|desc
}

export interface PaginatedResult<T> {
  data: T[];
  offset: number;
  limit: number;
  total: number;
  hasMore: boolean;
  nextOffset?: number;
}

export const paginationService = {
  // Validate and constrain pagination params
  validate(params: PaginationParams): { offset: number; limit: number } {
    const offset = Math.max(0, parseInt(params.offset as any) || 0);
    const limit = Math.min(Math.max(1, parseInt(params.limit as any) || 50), 500); // Max 500
    return { offset, limit };
  },

  // Build paginated response
  buildResponse<T>(
    data: T[],
    offset: number,
    limit: number,
    total: number
  ): PaginatedResult<T> {
    return {
      data,
      offset,
      limit,
      total,
      hasMore: offset + limit < total,
      nextOffset: offset + limit < total ? offset + limit : undefined
    };
  }
};
```

2. Add pagination to high-traffic endpoints

**File:** `server/routes/operational-cycles.ts`

```typescript
// GET /api/cycles/:id/runs - Paginated mission runs
router.get("/:id/runs", requireCycleRead, asyncHandler(async (req: any, res) => {
  const id = validateIdParam(req.params.id);
  const { offset, limit } = paginationService.validate(req.query);

  const [cycle] = await db.select()
    .from(operationalCycles)
    .where(eq(operationalCycles.id, id));

  if (!cycle) return res.status(404).json({ error: "Cycle not found" });

  // Get paginated runs
  const [runs, [{ count }]] = await Promise.all([
    db.select()
      .from(missionRuns)
      .where(and(
        eq(missionRuns.cycleId, id),
        isNull(missionRuns.deletedAt)
      ))
      .orderBy(desc(missionRuns.createdAt))
      .offset(offset)
      .limit(limit),
    db.select({ count: sql<number>`COUNT(*)::int` })
      .from(missionRuns)
      .where(and(
        eq(missionRuns.cycleId, id),
        isNull(missionRuns.deletedAt)
      ))
  ]);

  res.json(paginationService.buildResponse(runs, offset, limit, count));
}));

// GET /api/cycles/:id/blueprints - Paginated blueprints
router.get("/:id/blueprints", requireCycleRead, asyncHandler(async (req: any, res) => {
  const id = validateIdParam(req.params.id);
  const { offset, limit } = paginationService.validate(req.query);

  const [blueprints, [{ count }]] = await Promise.all([
    db.select()
      .from(cycleBlueprints)
      .where(eq(cycleBlueprints.cycleId, id))
      .orderBy(cycleBlueprints.id)
      .offset(offset)
      .limit(limit),
    db.select({ count: sql<number>`COUNT(*)::int` })
      .from(cycleBlueprints)
      .where(eq(cycleBlueprints.cycleId, id))
  ]);

  res.json(paginationService.buildResponse(blueprints, offset, limit, count));
}));

// GET /api/approvals - Paginated approvals
router.get("/", requireAuth, asyncHandler(async (req: any, res: Response) => {
  const { offset, limit } = paginationService.validate(req.query);
  
  const [approvals, [{ count }]] = await Promise.all([
    approvalService.listPending(
      req.user.id,
      req.user.email,
      req.user.adminRole,
      offset,
      limit
    ),
    approvalService.countPending(req.user.id, req.user.email, req.user.adminRole)
  ]);

  res.json(paginationService.buildResponse(approvals, offset, limit, count.total));
}));
```

### Day 3-4: Server-Sent Events (SSE) Streaming

**Tasks:**
1. Create streaming export endpoints

**File:** `server/routes/operational-cycles.ts`

```typescript
// GET /api/cycles/:id/export/csv - Stream cycle data as CSV
router.get("/:id/export/csv", requireCycleRead, asyncHandler(async (req: any, res) => {
  const id = validateIdParam(req.params.id);
  const batchSize = 100;

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Content-Disposition', `attachment; filename="cycle-${id}-export.csv"`);

  // Helper to send event
  const sendEvent = (type: string, data: any) => {
    res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // Get cycle info
    const [cycle] = await db.select()
      .from(operationalCycles)
      .where(eq(operationalCycles.id, id));

    if (!cycle) {
      sendEvent('error', { message: 'Cycle not found' });
      res.end();
      return;
    }

    sendEvent('start', {
      cycleId: id,
      cycleName: cycle.name,
      timestamp: new Date().toISOString()
    });

    // Stream mission runs
    let offset = 0;
    let totalProcessed = 0;

    while (true) {
      const runs = await db.select()
        .from(missionRuns)
        .where(and(
          eq(missionRuns.cycleId, id),
          isNull(missionRuns.deletedAt)
        ))
        .orderBy(desc(missionRuns.createdAt))
        .offset(offset)
        .limit(batchSize);

      if (runs.length === 0) break;

      // Convert to CSV format
      const csv = runs.map(r =>
        `${r.id},${r.missionId},"${r.status}",${r.createdAt}`
      ).join('\n');

      sendEvent('data', {
        batchNumber: Math.floor(offset / batchSize) + 1,
        rowCount: runs.length,
        csv: csv
      });

      totalProcessed += runs.length;
      offset += batchSize;

      // Yield to event loop
      await new Promise(resolve => setImmediate(resolve));
    }

    sendEvent('complete', {
      totalRows: totalProcessed,
      completedAt: new Date().toISOString()
    });

    res.end();
  } catch (err: any) {
    sendEvent('error', { message: err.message });
    res.end();
  }
}));

// GET /api/cycles/:id/export/json - Stream cycle data as JSONL
router.get("/:id/export/jsonl", requireCycleRead, asyncHandler(async (req: any, res) => {
  const id = validateIdParam(req.params.id);
  const batchSize = 100;

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Transfer-Encoding', 'chunked');

  try {
    let offset = 0;

    while (true) {
      const runs = await db.select()
        .from(missionRuns)
        .where(and(
          eq(missionRuns.cycleId, id),
          isNull(missionRuns.deletedAt)
        ))
        .offset(offset)
        .limit(batchSize);

      if (runs.length === 0) break;

      // Write one JSON object per line
      for (const run of runs) {
        res.write(JSON.stringify(run) + '\n');
      }

      offset += batchSize;
      await new Promise(resolve => setImmediate(resolve));
    }

    res.end();
  } catch (err: any) {
    res.write(`{"error": "${err.message}"}\n`);
    res.end();
  }
}));
```

2. Create client-side streaming handler

**File:** `client/src/hooks/useStreamingExport.ts`
```typescript
export function useStreamingExport() {
  const downloadStream = async (url: string, filename: string) => {
    const eventSource = new EventSource(url);
    const chunks: string[] = [];

    return new Promise<void>((resolve, reject) => {
      eventSource.addEventListener('data', (event) => {
        const data = JSON.parse(event.data);
        if (data.csv) chunks.push(data.csv);
        if (data.jsonl) chunks.push(data.jsonl);
      });

      eventSource.addEventListener('complete', () => {
        const blob = new Blob([chunks.join('\n')], { type: 'text/plain' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        eventSource.close();
        resolve();
      });

      eventSource.addEventListener('error', () => {
        eventSource.close();
        reject(new Error('Export failed'));
      });
    });
  };

  return { downloadStream };
}
```

### Day 5: Performance & UX Testing

**Expected Results:**
- Initial page load: 2-3s → 500ms (4-6x improvement)
- Memory per page: 100MB → 5MB (20x reduction for large cycles)
- Network payload: 100MB → 1MB (100x reduction)
- Streaming export: User gets data incrementally instead of waiting

**Deliverables:**
- `pagination.service.ts` - Pagination layer
- Updated routes with pagination
- SSE streaming endpoints
- `useStreamingExport.ts` - Client hook
- `streaming_guide.md` - How to use pagination and streaming

---

## Week 4: Async Processing & Workers (Phase 4D)

### Goals
- Set up background job queue (Bull/Redis)
- Offload heavy operations to workers
- Enable 10x better throughput

### Day 1: Worker Infrastructure Setup

**Tasks:**
1. Install and configure Bull

```bash
npm install bull @types/bull
```

2. Create job queue service

**File:** `server/domain/core/job-queue.service.ts`
```typescript
import Queue from 'bull';

export type JobType =
  | 'cycle_synthesis'
  | 'cycle_postmortem'
  | 'approval_notification'
  | 'analytics_aggregation'
  | 'data_cleanup';

export const jobQueue = new Queue<any>('oddjob-jobs', {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    db: 1 // Separate from cache
  },
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000
    },
    removeOnComplete: true,
    removeOnFail: false
  }
});

export const enqueueJob = async <T extends JobType>(
  jobType: T,
  data: any,
  options?: any
) => {
  const job = await jobQueue.add(jobType, data, {
    jobId: `${jobType}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    ...options
  });
  return job.id;
};

// Monitor queue health
jobQueue.on('completed', (job) => {
  logger.info(`[Queue] Job completed: ${job.type} (${job.id})`);
});

jobQueue.on('failed', (job, err) => {
  logger.error(`[Queue] Job failed: ${job.type} (${job.id}) - ${err.message}`);
});

setInterval(async () => {
  const counts = await jobQueue.getJobCounts();
  logger.info(`[Queue] Stats: ${counts.waiting} waiting, ${counts.active} active, ${counts.failed} failed`);
}, 60000);
```

3. Create worker pool service

**File:** `server/domain/core/worker-pool.service.ts`
```typescript
import { jobQueue, type JobType } from './job-queue.service';

const workers: Map<JobType, Function> = new Map();

export const registerWorker = <T extends JobType>(jobType: T, handler: Function) => {
  workers.set(jobType, handler);
  jobQueue.process(jobType, 5, async (job) => {
    logger.info(`[Worker] Processing: ${job.type} (${job.id})`);
    return await handler(job.data);
  });
};

export const startWorkers = async () => {
  logger.info('[Workers] Starting job processors');
  // Workers start automatically on registration
};

export const stopWorkers = async () => {
  await jobQueue.close();
  logger.info('[Workers] Stopped');
};
```

### Day 2-3: Implement Async Operations

**Task 1: Cycle Synthesis (AI Planning)**

**File:** `server/domain/mission/core/cycle-synthesis.worker.ts`
```typescript
import { registerWorker, enqueueJob } from '@domain/core/job-queue.service';

registerWorker('cycle_synthesis', async (data) => {
  const { cycleId, prompt } = data;

  logger.info(`[Synthesis Worker] Starting cycle ${cycleId}`);

  try {
    // Run AI synthesis (10-30 second operation)
    const response = await systemAiService.generateText(prompt, {
      serviceKey: 'architect',
      timeout: 60000
    });

    // Update cycle with plan
    await db.update(operationalCycles)
      .set({
        executionPlan: JSON.parse(response),
        metadata: sql`jsonb_set(metadata, '{synthesis_status}', '"complete"')`
      })
      .where(eq(operationalCycles.id, cycleId));

    logger.info(`[Synthesis Worker] Completed cycle ${cycleId}`);
    return { success: true, cycleId };
  } catch (err: any) {
    logger.error(`[Synthesis Worker] Failed cycle ${cycleId}: ${err.message}`);
    throw err;
  }
});

// In cycle-manager.service.ts, replace synchronous synthesis with async
export async function synthesizeCyclePlanAsync(
  cycleId: number,
  template: any
): Promise<string> {
  const prompt = buildSynthesisPrompt(template);

  // Enqueue job instead of waiting
  const jobId = await enqueueJob('cycle_synthesis', {
    cycleId,
    prompt
  });

  // Return job ID immediately (don't wait)
  return jobId;
}
```

**Task 2: Approval Notifications**

**File:** `server/domain/governor/core/approval-notification.worker.ts`
```typescript
registerWorker('approval_notification', async (data) => {
  const { approvalId, channels = ['slack', 'email', 'sms'] } = data;

  logger.info(`[Notification Worker] Sending for approval ${approvalId}`);

  try {
    const [approval] = await db.select()
      .from(approvalRequests)
      .where(eq(approvalRequests.id, approvalId));

    if (!approval) throw new Error(`Approval ${approvalId} not found`);

    // Send to all channels in parallel
    const results = await Promise.allSettled([
      ...(channels.includes('slack') ? [slackService.sendApprovalRequest(approval)] : []),
      ...(channels.includes('email') ? [emailService.sendApprovalRequest(approval)] : []),
      ...(channels.includes('sms') ? [smsService.sendApprovalRequest(approval)] : [])
    ]);

    const failed = results.filter(r => r.status === 'rejected');
    if (failed.length > 0) {
      logger.warn(`[Notification Worker] ${failed.length}/${results.length} channels failed`);
    }

    return { success: failed.length === 0, channelResults: results };
  } catch (err: any) {
    logger.error(`[Notification Worker] Failed: ${err.message}`);
    throw err;
  }
});

// In decision-router.ts, enqueue instead of sending synchronously
export async function notifyApprovalAsync(approvalId: number): Promise<void> {
  await enqueueJob('approval_notification', {
    approvalId,
    channels: ['slack', 'email']
  });
}
```

**Task 3: Cycle Post-Mortem**

**File:** `server/domain/mission/core/cycle-postmortem.worker.ts`
```typescript
registerWorker('cycle_postmortem', async (data) => {
  const { cycleId } = data;

  logger.info(`[PostMortem Worker] Analyzing cycle ${cycleId}`);

  try {
    const [cycle] = await db.select()
      .from(operationalCycles)
      .where(eq(operationalCycles.id, cycleId));

    const runs = await db.select()
      .from(missionRuns)
      .where(eq(missionRuns.cycleId, cycleId));

    // Build analysis prompt (heavy computation)
    const prompt = buildPostMortemPrompt(cycle, runs);

    // Generate post-mortem (AI call)
    const postMortem = await systemAiService.generateText(prompt, {
      serviceKey: 'business_analyst',
      timeout: 60000
    });

    // Store results
    await db.update(operationalCycles)
      .set({
        outcomeMetrics: sql`jsonb_set(
          outcome_metrics,
          '{postMortem}',
          to_jsonb(${postMortem}::text)
        )`
      })
      .where(eq(operationalCycles.id, cycleId));

    logger.info(`[PostMortem Worker] Completed cycle ${cycleId}`);
    return { success: true, cycleId };
  } catch (err: any) {
    logger.error(`[PostMortem Worker] Failed: ${err.message}`);
    throw err;
  }
});

// Enqueue on cycle completion
export async function queueCyclePostMortem(cycleId: number): Promise<void> {
  await enqueueJob('cycle_postmortem', { cycleId });
}
```

**Task 4: Analytics Aggregation**

**File:** `server/domain/mission/core/analytics-aggregation.worker.ts`
```typescript
registerWorker('analytics_aggregation', async (data) => {
  const { cycleId } = data;

  logger.info(`[Analytics Worker] Aggregating cycle ${cycleId}`);

  try {
    const runs = await db.select()
      .from(missionRuns)
      .where(eq(missionRuns.cycleId, cycleId));

    // Heavy computation: ROI, burn rate, efficiency metrics
    const metrics = {
      totalDuration: computeTotalDuration(runs),
      successRate: computeSuccessRate(runs),
      costPerSuccess: computeCostPerSuccess(runs),
      efficencyScore: computeEfficiencyScore(runs),
      recommendations: generateOptimizations(runs)
    };

    await db.update(operationalCycles)
      .set({ analyticsData: metrics })
      .where(eq(operationalCycles.id, cycleId));

    logger.info(`[Analytics Worker] Completed cycle ${cycleId}`);
    return { success: true, metrics };
  } catch (err: any) {
    logger.error(`[Analytics Worker] Failed: ${err.message}`);
    throw err;
  }
});
```

### Day 4-5: Integration & Deployment

**Tasks:**
1. Update API responses to return job IDs

```typescript
// Instead of:
const response = await synthesizeCyclePlan(...);
res.json({ status: 'complete', plan: response });

// Now:
const jobId = await synthesizeCyclePlanAsync(...);
res.json({ status: 'processing', jobId });
```

2. Create job status endpoint

```typescript
router.get("/jobs/:jobId/status", asyncHandler(async (req, res) => {
  const jobId = req.params.jobId;
  const job = await jobQueue.getJob(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  const state = await job.getState();
  const progress = job.progress();
  const data = job.data;
  const result = job.returnvalue;

  res.json({
    jobId,
    type: job.name,
    state,
    progress,
    createdAt: new Date(job.timestamp),
    attempts: job.attemptsMade,
    result: state === 'completed' ? result : undefined
  });
}));
```

3. Create WebSocket listener for job completion

```typescript
export function subscribeToJobCompletion(jobId: string, callback: Function) {
  jobQueue.on('completed', (job) => {
    if (job.id === jobId) {
      callback(job.returnvalue);
    }
  });
}
```

**Expected Results:**
- Request latency: 10-30s (synthesis) → 100-200ms (immediate)
- Throughput: 10 concurrent cycles → 100+ concurrent cycles
- CPU: More evenly distributed across worker processes
- User experience: Instant feedback + background processing

**Deliverables:**
- `job-queue.service.ts` - Queue infrastructure
- `worker-pool.service.ts` - Worker management
- 4 worker implementations (synthesis, notifications, postmortem, analytics)
- Updated API routes with async patterns
- Job status endpoint
- WebSocket subscription system
- `async_guide.md` - How to use async jobs

---

## Implementation Checklist

### Week 1: Indexing
- [ ] Day 1-2: Analyze & plan
- [ ] Day 3-4: Create & deploy indexes
- [ ] Day 5: Performance testing
- [ ] Deliverable: 8 indexes, performance metrics

### Week 2: Caching
- [ ] Day 1-2: Cache architecture
- [ ] Day 3-4: Implement caching in endpoints
- [ ] Day 5: Invalidation & monitoring
- [ ] Deliverable: Cache service, 3+ cached endpoints, metrics

### Week 3: Streaming
- [ ] Day 1-2: Pagination layer
- [ ] Day 3-4: SSE streaming
- [ ] Day 5: Performance testing
- [ ] Deliverable: Pagination, 2 streaming endpoints, client hook

### Week 4: Async Workers
- [ ] Day 1: Queue infrastructure
- [ ] Day 2-3: Implement 4 workers
- [ ] Day 4-5: Integration & testing
- [ ] Deliverable: Job queue, 4 workers, job status endpoint

---

## Testing Strategy

### Unit Tests
```bash
npm test -- --testPathPattern="cache|queue|pagination"
```

### Integration Tests
```bash
npm test -- --testPathPattern="integration" --testNamePattern="Phase 4"
```

### Performance Benchmarks
```bash
npm run perf:benchmark -- --phases 1,2,3,4a,4b,4c,4d
```

### Load Testing (Week 4)
```bash
npm run load-test -- --duration 60s --concurrency 100
```

### Monitoring
```typescript
// Dashboard metrics
- Request latency (p50, p95, p99)
- Database query time
- Cache hit rate
- Queue depth
- Worker utilization
- Memory usage
```

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Cache invalidation bugs | Start with short TTLs, test invalidation paths thoroughly |
| Queue bottleneck | Monitor queue depth, scale workers if needed |
| Worker crashes | 3 retries with exponential backoff, dead-letter queue |
| Database lock contention | Use non-blocking index creation (CONCURRENTLY) |
| Client timeout waiting for job | Implement long-polling or WebSocket for job updates |

---

## Success Criteria

### Phase 4A: Indexing
- [ ] All 8 indexes created successfully
- [ ] Approval queries: 5-10x faster
- [ ] No query plan changes
- [ ] Index disk space < 100MB

### Phase 4B: Caching
- [ ] Cache hit rate > 80%
- [ ] Approval listing: 10-20x faster
- [ ] Cache invalidation: <100ms max
- [ ] Memory usage reasonable (<100MB)

### Phase 4C: Streaming
- [ ] Initial page load: 4-6x faster
- [ ] Memory per page: 20x reduction
- [ ] Network: 100x payload reduction
- [ ] UX: Instant feedback

### Phase 4D: Async
- [ ] Request latency: 50-100x improvement
- [ ] Throughput: 10x improvement
- [ ] Worker reliability: 99%+ success rate
- [ ] Job status tracking: Real-time updates

---

## Timeline & Effort Summary

| Phase | Week | Days | Effort | Impact |
|-------|------|------|--------|--------|
| 4A | 1 | 5 | 5h | 2-10x |
| 4B | 2 | 5 | 7.5h | 3-5x |
| 4C | 3 | 5 | 7.5h | 2-3x UX |
| 4D | 4 | 5 | 10.5h | 5-20x |
| **Total** | **4 weeks** | **20** | **30.5h** | **6-50,000x** |

---

## Questions for Planning

1. **Timeline preference:** Sequential (one week at a time) or parallel weeks?
2. **Resource allocation:** Full-time or part-time work?
3. **Risk tolerance:** More testing (slower) or faster deployment?
4. **Monitoring:** What APM/dashboard solution should we use?
5. **Deployment strategy:** Rolling deployment or big-bang?

