# Phase 4B: Caching Layer Strategy

**Week:** Jun 24-28, 2026  
**Duration:** 7.5 hours  
**Purpose:** Reduce database load and API calls via intelligent caching  
**Target Impact:** 3-5x improvement on high-traffic endpoints

---

## 🎯 Strategy Overview

**Three-tier caching approach:**

1. **Request-level** — Cache within a single HTTP request (in-memory)
2. **Session-level** — Cache for logged-in user (Redis, 5-15 min TTL)
3. **Global-level** — Cache shared across all users (Redis, 1-24 hour TTL)

**Invalidation strategy:**
- Time-based expiration (TTL)
- Event-based invalidation (on write operations)
- Tag-based grouping (invalidate related caches together)

---

## 📊 High-Traffic Endpoints to Cache

### 1. **Approval Listing** ⭐⭐⭐ CRITICAL

**Endpoint:** `GET /api/approvals?organizationId=X&status=Y&limit=50`

**Why cache:**
- Frequently accessed (every approval page load)
- Relatively static (updated by approval mutations)
- High cardinality but predictable patterns

**Cache key pattern:**
```
approval:org:{orgId}:status:{status}:page:{page}
```

**TTL:**
- 5 minutes (approval lists change frequently)

**Invalidation triggers:**
- When approval created: invalidate `approval:org:{orgId}:*`
- When approval status changes: invalidate `approval:org:{orgId}:status:{status}:*`

**Expected improvement:**
- 60-100ms → 5-10ms (10-20x faster)
- Hit rate: 85-90% (most users view same lists)

**Data size:**
- ~50 items × 2KB per item = 100KB per page
- ~1000 active users × 2-3 cached pages = 200-300MB total

---

### 2. **Cycle Metadata** ⭐⭐⭐ CRITICAL

**Endpoint:** `GET /api/cycles/{cycleId}/metadata`

**Why cache:**
- Loaded on every cycle detail view
- Changes infrequently (only on cycle mutations)
- Small payload (~5KB per cycle)

**Cache key pattern:**
```
cycle:metadata:{cycleId}
```

**TTL:**
- 1 hour (cycle metadata stable once created)

**Invalidation triggers:**
- When cycle created: set cache
- When cycle updated: invalidate `cycle:metadata:{cycleId}`
- When status changes: invalidate + update

**Expected improvement:**
- 80-150ms → 2-5ms (20-50x faster)
- Hit rate: 90%+ (same cycle viewed multiple times)

**Data size:**
- ~5KB per cycle
- ~10,000 active cycles × 5KB = 50MB

---

### 3. **Blueprint Templates** ⭐⭐ HIGH PRIORITY

**Endpoint:** `GET /api/blueprints?organizationId=X&type=Y`

**Why cache:**
- Loaded during cycle creation (frequent)
- Blueprint definitions are stable
- Used by all users in org

**Cache key pattern:**
```
blueprints:org:{orgId}:type:{type}
```

**TTL:**
- 24 hours (blueprints rarely change)

**Invalidation triggers:**
- When blueprint created/updated: invalidate `blueprints:org:{orgId}:*`
- Clear on org plan change

**Expected improvement:**
- 100-200ms → 5-15ms (10-20x faster)
- Hit rate: 95%+ (all users share blueprint list)

**Data size:**
- ~20 templates × 5KB = 100KB per org
- ~100 orgs × 100KB = 10MB total

---

### Additional Endpoints to Cache (Bonus)

#### 4. **Mission Run History**
```
GET /api/missions?cycleId=X&limit=50
mission:cycle:{cycleId}:page:{page}
TTL: 15 minutes
```

#### 5. **Approval Request Count**
```
GET /api/approvals/count?organizationId=X
approval:count:org:{orgId}
TTL: 5 minutes
```

#### 6. **Cycle Status Summary**
```
GET /api/cycles/stats?organizationId=X
cycle:stats:org:{orgId}
TTL: 10 minutes
```

---

## 🔑 Cache Key Naming Convention

**Format:** `{resource}:{context}:{identifier}:{filter}:{page}`

**Examples:**
- `approval:org:123:status:pending:page:1`
- `cycle:metadata:456`
- `blueprints:org:123:type:mission`
- `mission:cycle:456:page:1`
- `approval:count:org:123`
- `cycle:stats:org:123`

**Benefits:**
- Self-documenting
- Easy to invalidate by pattern
- Minimal key collisions

---

## 🔄 Invalidation Strategy

### Event-Based Invalidation

When these events occur, invalidate related caches:

| Event | Keys to Invalidate |
|-------|-------------------|
| Approval created | `approval:org:{orgId}:*` |
| Approval status changed | `approval:org:{orgId}:status:{oldStatus}:*`, `approval:org:{orgId}:status:{newStatus}:*`, `approval:count:org:{orgId}` |
| Cycle created | `cycle:stats:org:{orgId}` |
| Cycle status changed | `cycle:metadata:{cycleId}`, `cycle:stats:org:{orgId}` |
| Blueprint updated | `blueprints:org:{orgId}:*` |
| Mission completed | `mission:cycle:{cycleId}:*` |

### Implementation Points

**In approval.service.ts:**
```typescript
async updateApprovalStatus(id: number, status: string) {
  const approval = await updateInDb(id, status);
  
  // Invalidate caches
  await cacheService.invalidate(`approval:org:${approval.organizationId}:*`);
  
  return approval;
}
```

**In cycle-manager.service.ts:**
```typescript
async createCycle(data: any) {
  const cycle = await createInDb(data);
  
  // Cache metadata immediately
  await cacheService.set(
    `cycle:metadata:${cycle.id}`,
    cycle.metadata,
    { ttl: 3600, tags: [`org:${cycle.organizationId}`, 'cycle'] }
  );
  
  return cycle;
}
```

---

## 📈 Performance Projections

### Before Caching (Phase 4A only)

| Endpoint | Latency | QPS | CPU |
|----------|---------|-----|-----|
| Approval listing | 20ms | 100 | 30% |
| Cycle metadata | 80ms | 50 | 20% |
| Blueprint list | 80ms | 80 | 25% |
| **Total** | **30-80ms** | **230** | **75%** |

### After Caching (Phase 4B)

| Endpoint | Latency | QPS | CPU |
|----------|---------|-----|-----|
| Approval listing | 5-10ms | 500 | 15% |
| Cycle metadata | 2-5ms | 200 | 5% |
| Blueprint list | 5-15ms | 350 | 10% |
| **Total** | **3-10ms** | **1050** | **30%** |

**Improvement:**
- Latency: 30-80ms → 3-10ms **(5-25x faster)**
- Throughput: 230 → 1050 QPS **(4.5x capacity)**
- CPU: 75% → 30% **(55% savings)**

---

## 💾 Memory Footprint

**Total cache memory estimate:**

| Cache | Size | TTL | Est. Memory |
|-------|------|-----|-------------|
| Approval listings | 100KB × 1000 users | 5m | 100MB |
| Cycle metadata | 5KB × 10K cycles | 1h | 50MB |
| Blueprint templates | 100KB × 100 orgs | 24h | 10MB |
| Counts/stats | 1KB × 10K orgs | 5-10m | 10MB |
| **Total** | | | **170MB** |

**Budget:** <200MB (acceptable Redis footprint)

---

## ✅ Success Criteria

- [x] Cache service implemented (getOrFetch, invalidation, metrics)
- [ ] Approval listing endpoint cached
- [ ] Cycle metadata endpoint cached
- [ ] Blueprint template endpoint cached
- [ ] Cache invalidation working correctly
- [ ] Cache hit rate > 80% validated
- [ ] Memory usage < 200MB
- [ ] No stale data issues (invalidation working)
- [ ] Metrics dashboard shows cache performance

---

## 🚀 Implementation Plan

### Day 1-2: Design & Infrastructure (2 hours)

- [x] Create cache.service.ts with Redis integration
- [x] Define cache key patterns
- [x] Define invalidation triggers
- [ ] Setup Redis monitoring
- [ ] Configure Redis persistence

### Day 3-4: Implement Caching (4 hours)

- [ ] Cache approval listing endpoint
- [ ] Cache cycle metadata endpoint
- [ ] Cache blueprint templates endpoint
- [ ] Integrate invalidation hooks
- [ ] Add metrics tracking

### Day 5: Validation & Monitoring (1.5 hours)

- [ ] Test cache hit rates
- [ ] Validate performance improvements
- [ ] Monitor memory usage
- [ ] Document cache strategy
- [ ] Sign off on success criteria

---

## 🔧 Technical Decisions

### Why Redis?

- Already available in infrastructure
- Sub-millisecond latency
- Atomic operations (SET NX, EXPIRE)
- Pub/Sub for future cache invalidation broadcasts
- Built-in TTL and key expiration

### Why not database query caching?

- Drizzle ORM doesn't have built-in query caching
- Redis gives us finer control over invalidation
- Better for cross-tenant data (blueprint templates)

### Why TTL + event-based?

- **TTL alone:** Stale data possible, but safe
- **Event-based alone:** Complex logic, risk of memory leaks
- **Combined:** Best of both (safety + freshness)

---

## 📋 Next Steps

1. **Implement approval listing cache** (Day 3)
2. **Implement cycle metadata cache** (Day 3)
3. **Implement blueprint cache** (Day 4)
4. **Add invalidation hooks** (Day 4)
5. **Run performance benchmarks** (Day 5)
6. **Validate hit rates** (Day 5)

---

**Phase 4B is designed to achieve 3-5x improvement on top of Phase 4A's 2-10x gain.**

**Combined with Phase 4A:** 6-50x cumulative improvement ✅

