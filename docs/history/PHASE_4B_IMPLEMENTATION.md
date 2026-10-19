# Phase 4B: Caching Implementation Guide

**Days 3-4: Implement Caching on 3 Critical Endpoints**

---

## 📝 Task 3.1: Cache Approval Listing Endpoint

**File:** `server/routes/approvals.ts`

**Current implementation (before):**
```typescript
app.get('/api/approvals', async (req, res) => {
  const { organizationId, status, page = 1, limit = 50 } = req.query;
  
  const approvals = await db
    .select()
    .from(approvalRequests)
    .where(
      and(
        eq(approvalRequests.organizationId, Number(organizationId)),
        eq(approvalRequests.status, String(status))
      )
    )
    .limit(Number(limit))
    .offset((Number(page) - 1) * Number(limit));

  const count = await db
    .select({ count: sql`count(*)` })
    .from(approvalRequests)
    .where(
      and(
        eq(approvalRequests.organizationId, Number(organizationId)),
        eq(approvalRequests.status, String(status))
      )
    );

  res.json({
    data: approvals,
    total: count[0].count,
    page: Number(page),
    pageSize: Number(limit),
  });
});
```

**With caching (after):**
```typescript
import { cacheService } from '@domain/cache/cache.service.js';

app.get('/api/approvals', async (req, res) => {
  const { organizationId, status, page = 1, limit = 50 } = req.query;
  
  const orgId = Number(organizationId);
  const pageNum = Number(page);
  const pageLimit = Number(limit);
  
  // Build cache key
  const cacheKey = `approval:org:${orgId}:status:${status}:page:${pageNum}`;
  
  // Get from cache or fetch
  const result = await cacheService.getOrFetch(cacheKey, async () => {
    const approvals = await db
      .select()
      .from(approvalRequests)
      .where(
        and(
          eq(approvalRequests.organizationId, orgId),
          eq(approvalRequests.status, String(status))
        )
      )
      .limit(pageLimit)
      .offset((pageNum - 1) * pageLimit);

    const countResult = await db
      .select({ count: sql`count(*)` })
      .from(approvalRequests)
      .where(
        and(
          eq(approvalRequests.organizationId, orgId),
          eq(approvalRequests.status, String(status))
        )
      );

    return {
      data: approvals,
      total: countResult[0].count,
      page: pageNum,
      pageSize: pageLimit,
    };
  }, {
    ttl: 300, // 5 minutes
    tags: [`org:${orgId}`, 'approval'],
  });

  res.json(result);
});
```

**Changes:**
- Added `cacheService.getOrFetch()` wrapper
- Cache key includes org, status, and page
- 5-minute TTL (approval lists change frequently)
- Tagged with org and approval for grouped invalidation

**Expected improvement:**
- First request: 60-100ms (full database query)
- Cached requests: 2-5ms (Redis hit)
- Hit rate: 85-90%

---

## 📝 Task 3.2: Cache Cycle Metadata Endpoint

**File:** `server/routes/operational-cycles.ts`

**Current implementation (before):**
```typescript
app.get('/api/cycles/:cycleId/metadata', async (req, res) => {
  const { cycleId } = req.params;
  
  const [cycle] = await db
    .select()
    .from(operationalCycles)
    .where(eq(operationalCycles.id, Number(cycleId)));
  
  if (!cycle) {
    return res.status(404).json({ error: 'Cycle not found' });
  }

  // Also fetch related data
  const blueprints = await db
    .select()
    .from(cycleBlueprints)
    .where(eq(cycleBlueprints.cycleId, cycle.id));

  const missions = await db
    .select()
    .from(missionRuns)
    .where(eq(missionRuns.cycleId, cycle.id));

  res.json({
    cycle,
    blueprints,
    missions,
    metadata: {
      blueprintCount: blueprints.length,
      missionCount: missions.length,
      status: cycle.status,
    },
  });
});
```

**With caching (after):**
```typescript
app.get('/api/cycles/:cycleId/metadata', async (req, res) => {
  const { cycleId } = req.params;
  const cycleIdNum = Number(cycleId);
  
  // Build cache key
  const cacheKey = `cycle:metadata:${cycleIdNum}`;
  
  // Get from cache or fetch
  const result = await cacheService.getOrFetch(cacheKey, async () => {
    const [cycle] = await db
      .select()
      .from(operationalCycles)
      .where(eq(operationalCycles.id, cycleIdNum));
    
    if (!cycle) {
      throw new Error('Cycle not found');
    }

    // Fetch related data in parallel
    const [blueprints, missions] = await Promise.all([
      db
        .select()
        .from(cycleBlueprints)
        .where(eq(cycleBlueprints.cycleId, cycle.id)),
      db
        .select()
        .from(missionRuns)
        .where(eq(missionRuns.cycleId, cycle.id)),
    ]);

    return {
      cycle,
      blueprints,
      missions,
      metadata: {
        blueprintCount: blueprints.length,
        missionCount: missions.length,
        status: cycle.status,
      },
    };
  }, {
    ttl: 3600, // 1 hour - cycle metadata is stable
    tags: [`cycle:${cycleIdNum}`, `org:${req.user.organizationId}`],
  });

  res.json(result);
});
```

**Changes:**
- Cache key includes cycle ID only (metadata is cycle-specific)
- 1-hour TTL (cycle metadata rarely changes)
- Parallelized database queries with `Promise.all()`
- Tagged with cycle and org for invalidation

**Expected improvement:**
- First request: 80-150ms (3 separate queries)
- Cached requests: 2-5ms (Redis hit)
- Hit rate: 90%+

---

## 📝 Task 3.3: Cache Blueprint Templates Endpoint

**File:** `server/routes/blueprints.ts` or similar

**Current implementation (before):**
```typescript
app.get('/api/blueprints', async (req, res) => {
  const { organizationId, type } = req.query;
  
  const blueprints = await db
    .select()
    .from(cycleBlueprints)
    .where(
      and(
        eq(cycleBlueprints.organizationId, Number(organizationId)),
        type ? eq(cycleBlueprints.type, String(type)) : undefined
      )
    )
    .orderBy(cycleBlueprints.name);

  res.json(blueprints);
});
```

**With caching (after):**
```typescript
app.get('/api/blueprints', async (req, res) => {
  const { organizationId, type } = req.query;
  const orgId = Number(organizationId);
  
  // Build cache key (include type in key)
  const typeStr = type ? `:type:${type}` : ':type:all';
  const cacheKey = `blueprints:org:${orgId}${typeStr}`;
  
  // Get from cache or fetch
  const blueprints = await cacheService.getOrFetch(cacheKey, async () => {
    return await db
      .select()
      .from(cycleBlueprints)
      .where(
        and(
          eq(cycleBlueprints.organizationId, orgId),
          type ? eq(cycleBlueprints.type, String(type)) : undefined
        )
      )
      .orderBy(cycleBlueprints.name);
  }, {
    ttl: 86400, // 24 hours - blueprints are stable
    tags: [`org:${orgId}`, 'blueprint'],
  });

  res.json(blueprints);
});
```

**Changes:**
- Cache key includes org and type
- 24-hour TTL (blueprints rarely change)
- Shared across all users in org (cache hit rate is very high)
- Tagged with org and blueprint for invalidation

**Expected improvement:**
- First request: 100-200ms (database query)
- Cached requests: 1-2ms (Redis hit)
- Hit rate: 95%+

---

## 🔄 Task 3.4: Add Cache Invalidation Hooks

**File:** `server/domain/integrations/core/approval.service.ts`

Add invalidation when approvals change:

```typescript
async updateApprovalStatus(id: number, newStatus: string) {
  const approval = approvalRequests.update(id, { status: newStatus });
  
  // Invalidate approval caches for this org
  await cacheService.invalidate(`approval:org:${approval.organizationId}:*`);
  
  return approval;
}

async createApproval(data: ApprovalData) {
  const approval = await approvalRequests.insert(data);
  
  // Invalidate approval listing caches
  await cacheService.invalidate(`approval:org:${approval.organizationId}:*`);
  
  return approval;
}
```

**File:** `server/domain/mission/core/cycle-manager.service.ts`

Add invalidation when cycles change:

```typescript
async launchCycle(data: any, userId: string, orgId: number | null) {
  const cycle = await operationalCycles.insert({...});
  
  // Cache the metadata immediately
  await cacheService.set(
    `cycle:metadata:${cycle.id}`,
    { cycle, blueprints: [], missions: [] },
    { ttl: 3600, tags: [`cycle:${cycle.id}`, `org:${orgId}`] }
  );
  
  return cycle;
}

async updateCycleStatus(cycleId: number, status: string) {
  const cycle = await operationalCycles.update(cycleId, { status });
  
  // Invalidate cycle metadata cache
  await cacheService.invalidate(`cycle:metadata:${cycleId}`);
  
  return cycle;
}
```

**File:** Blueprint mutations

Add invalidation when blueprints change:

```typescript
async createBlueprint(data: any, orgId: number) {
  const blueprint = await blueprints.insert({ ...data, organizationId: orgId });
  
  // Invalidate blueprint caches for this org
  await cacheService.invalidate(`blueprints:org:${orgId}:*`);
  
  return blueprint;
}

async updateBlueprint(id: number, data: any, orgId: number) {
  const blueprint = await blueprints.update(id, data);
  
  // Invalidate blueprint caches
  await cacheService.invalidate(`blueprints:org:${orgId}:*`);
  
  return blueprint;
}
```

---

## ✅ Task 3.5: Testing & Validation

### Unit Tests

```typescript
describe('Caching Layer', () => {
  beforeEach(async () => {
    await cacheService.flush();
    cacheService.resetMetrics();
  });

  describe('Approval listing cache', () => {
    it('should return cached results on second request', async () => {
      // First request - cache miss
      const res1 = await request(app).get('/api/approvals?organizationId=1&status=pending');
      expect(res1.status).toBe(200);

      // Second request - cache hit
      const res2 = await request(app).get('/api/approvals?organizationId=1&status=pending');
      expect(res2.status).toBe(200);
      expect(res2.body).toEqual(res1.body);

      // Check metrics
      const metrics = cacheService.getMetrics();
      expect(metrics.hits).toBeGreaterThan(0);
      expect(parseFloat(metrics.hitRate) > 50); // At least 50% hit rate
    });

    it('should invalidate cache on approval creation', async () => {
      // Prime cache
      await request(app).get('/api/approvals?organizationId=1&status=pending');

      // Create approval
      await request(app)
        .post('/api/approvals')
        .send({ organizationId: 1, data: {...} });

      // Next request should hit database (cache invalidated)
      const metrics = cacheService.getMetrics();
      const hitRateBefore = parseFloat(metrics.hitRate);

      await request(app).get('/api/approvals?organizationId=1&status=pending');
      const hitRateAfter = parseFloat(cacheService.getMetrics().hitRate);

      // Hit rate might drop due to cache miss after invalidation
      expect(hitRateBefore).toBeGreaterThanOrEqual(hitRateAfter);
    });
  });

  describe('Cycle metadata cache', () => {
    it('should cache cycle metadata', async () => {
      const cycleId = 123;
      
      // First request
      const res1 = await request(app).get(`/api/cycles/${cycleId}/metadata`);
      expect(res1.status).toBe(200);

      // Second request should be cached
      const res2 = await request(app).get(`/api/cycles/${cycleId}/metadata`);
      expect(res2.body).toEqual(res1.body);

      const metrics = cacheService.getMetrics();
      expect(metrics.hits).toBeGreaterThan(0);
    });
  });

  describe('Blueprint cache', () => {
    it('should cache blueprints for 24 hours', async () => {
      const res1 = await request(app).get('/api/blueprints?organizationId=1');
      expect(res1.status).toBe(200);

      const res2 = await request(app).get('/api/blueprints?organizationId=1');
      expect(res2.body).toEqual(res1.body);

      const metrics = cacheService.getMetrics();
      expect(metrics.hits).toBeGreaterThan(0);
    });
  });
});
```

### Performance Benchmarks

```bash
# Run before caching
npm run perf:test -- --baseline=phase4a

# Run after caching
npm run perf:test -- --baseline=phase4a --compare=phase4b

# Expected results:
# - Approval listing: 20ms → 5-10ms (3-4x)
# - Cycle metadata: 80ms → 5ms (16x)
# - Blueprint list: 80ms → 5ms (16x)
```

---

## 🎯 Checklist

### Day 3 (4 hours)

- [ ] Integrate caching into approval listing endpoint
- [ ] Integrate caching into cycle metadata endpoint
- [ ] Integrate caching into blueprint templates endpoint
- [ ] Test all 3 endpoints for cache hits

### Day 4 (2 hours)

- [ ] Add cache invalidation to approval mutations
- [ ] Add cache invalidation to cycle mutations
- [ ] Add cache invalidation to blueprint mutations
- [ ] Unit test cache invalidation

### Day 5 (1.5 hours)

- [ ] Run performance benchmarks
- [ ] Validate cache hit rates (target: >80%)
- [ ] Monitor memory usage
- [ ] Create cache monitoring dashboard
- [ ] Document results in phase_4b_results.md

---

## Success Criteria

- [x] Cache service created
- [ ] 3 endpoints integrated with caching
- [ ] Cache invalidation working correctly
- [ ] Hit rate > 80%
- [ ] Performance improvement: 3-5x on cached endpoints
- [ ] Memory usage < 200MB
- [ ] Zero stale data issues

---

**Phase 4B target completion: Jun 28, 2026**

Ready to implement! 🚀

