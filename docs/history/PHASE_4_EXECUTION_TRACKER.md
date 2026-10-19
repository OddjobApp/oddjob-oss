# Phase 4 Execution Tracker

**Status:** Week 1 - Starting  
**Duration:** 4 weeks + 3 extensions (35-38 hours total)  
**Target Completion:** 2026-07-12 (core), 2026-07-19 (with extensions)  
**Expected Impact:** 6-50,000x cumulative improvement

---

## Timeline Overview

```
Week 1 (Jun 17-21):  Database Indexing       [████░░░░░░] 5/30.5 hours (17%)
Week 2 (Jun 24-28):  Caching Layer           [░░░░░░░░░░] 0/30.5 hours
Week 3 (Jul 01-05):  Query Streaming         [░░░░░░░░░░] 0/30.5 hours
Week 4 (Jul 08-12):  Async Processing        [░░░░░░░░░░] 0/30.5 hours
```

---

## 📋 Week 1: Database Indexing (Phase 4A)

**Duration:** 5 hours  
**Expected Impact:** 2-10x improvement  
**Status:** IN PROGRESS ⏳

### Day 1-2: Index Strategy & Planning (2 hours)

**Tasks:**

- [ ] **Task 1.1:** Analyze current table statistics
  ```bash
  # Run in PostgreSQL to see table sizes and stats
  SELECT schemaname, tablename, n_live_tup, n_dead_tup, 
         last_vacuum, last_autovacuum
  FROM pg_stat_user_tables
  WHERE n_live_tup > 1000
  ORDER BY n_live_tup DESC;
  ```
  - [ ] Save results to `database_analysis.md`

- [ ] **Task 1.2:** Review current index usage
  ```bash
  # Check which indexes are actually being used
  SELECT schemaname, tablename, indexname, idx_scan, idx_tup_read
  FROM pg_stat_user_indexes
  ORDER BY idx_scan DESC;
  ```
  - [ ] Document findings in `index_strategy.md`

- [ ] **Task 1.3:** Document baseline metrics
  - [ ] Query time (p50, p95, p99)
  - [ ] Database CPU usage
  - [ ] I/O operations
  - [ ] Save to `baseline_metrics.txt`

**Deliverables:** `database_analysis.md`, `index_strategy.md`

---

### Day 3-4: Create & Deploy Indexes (2 hours)

**Tasks:**

- [ ] **Task 2.1:** Create migration file
  - [ ] Create: `server/migrations/004_add_performance_indexes.sql`
  - [ ] Add 8 indexes (see below)

- [ ] **Task 2.2:** Deploy to staging database
  ```bash
  npm run db:migrate -- --target 004
  ```

- [ ] **Task 2.3:** Verify indexes created
  ```bash
  npm run db:verify-indexes
  ```

**Index Specifications:**

```sql
-- CRITICAL: Approval workflow (high-traffic)
CREATE INDEX CONCURRENTLY idx_approval_requests_org_status 
  ON approval_requests(organization_id, status) 
  INCLUDE (created_at, modified_output);

-- CRITICAL: Cycle completion detection
CREATE INDEX CONCURRENTLY idx_mission_runs_cycle_status 
  ON mission_runs(cycle_id, status) 
  INCLUDE (created_at, mission_id);

-- CRITICAL: Blueprint enumeration
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

-- Analyze tables
ANALYZE approval_requests;
ANALYZE mission_runs;
ANALYZE cycle_blueprints;
ANALYZE jobs;
ANALYZE operational_cycles;
ANALYZE pipeline_executions;
ANALYZE forms;
```

---

### Day 5: Performance Testing & Validation (1 hour)

**Tasks:**

- [ ] **Task 3.1:** Run performance benchmarks
  ```bash
  npm run perf:test -- --baseline=phase3 --compare=phase4a
  ```

- [ ] **Task 3.2:** Compare metrics before/after
  - [ ] Approval listing query time
  - [ ] Cycle detail loading time
  - [ ] Job filtering performance
  - [ ] Database CPU usage

- [ ] **Task 3.3:** Document results
  - [ ] Create: `phase_4a_results.md`
  - [ ] Include metric comparisons
  - [ ] Sign off on success criteria

**Success Criteria:**
- [ ] All 8 indexes created successfully
- [ ] Approval queries: 5-10x faster ✅
- [ ] Database CPU: 20-30% reduction ✅
- [ ] No query plan regressions ✅
- [ ] Disk space used < 100MB ✅

---

## 📋 Week 2: Caching Layer (Phase 4B)

**Duration:** 7.5 hours  
**Expected Impact:** 3-5x improvement  
**Status:** NOT STARTED

### Day 1-2: Cache Architecture Design (2 hours)
- [ ] Design cache layer service
- [ ] Define cache key patterns
- [ ] Plan cache invalidation strategy

### Day 3-4: Implement Caching (4 hours)
- [ ] Create `cache.service.ts`
- [ ] Implement approval listing cache
- [ ] Implement cycle metadata cache
- [ ] Implement blueprint templates cache

### Day 5: Cache Invalidation & Monitoring (1.5 hours)
- [ ] Add cache invalidation to write operations
- [ ] Add cache metrics monitoring
- [ ] Document cache strategy

**Success Criteria:**
- [ ] Cache hit rate > 80% ✅
- [ ] Approval listing: 10-20x faster ✅
- [ ] Cache invalidation: <100ms max ✅
- [ ] Memory usage reasonable (<100MB) ✅

---

## 📋 Week 3: Query Result Streaming (Phase 4C)

**Duration:** 7.5 hours  
**Expected Impact:** 2-3x improvement (UX/Memory)  
**Status:** NOT STARTED

### Day 1-2: Pagination Layer (2 hours)
- [ ] Create pagination service
- [ ] Add validation and constraints
- [ ] Implement pagination in high-traffic endpoints

### Day 3-4: Server-Sent Events (SSE) (4 hours)
- [ ] Create streaming export endpoints
- [ ] Implement CSV streaming
- [ ] Implement JSONL streaming
- [ ] Create client-side streaming handlers

### Day 5: Performance & UX Testing (1.5 hours)
- [ ] Test pagination performance
- [ ] Test streaming export
- [ ] Validate memory reduction

**Success Criteria:**
- [ ] Initial page load: 4-6x faster ✅
- [ ] Memory per page: 20x reduction ✅
- [ ] Network payload: 100x reduction ✅
- [ ] Streaming exports working ✅

---

## 📋 Week 4: Async Processing & Workers (Phase 4D)

**Duration:** 10.5 hours core + 5-8 hours extensions = ~15.5 hours total  
**Expected Impact:** 5-20x improvement (async) + cost/compliance wins (extensions)  
**Status:** NOT STARTED

### Day 1: Worker Infrastructure (2 hours)
- [ ] Install Bull and configure Redis
- [ ] Create job queue service
- [ ] Create worker pool service
- [ ] Prepare for extension work (taskComplexityScore schema)

### Day 2-3: Implement Async Workers + 3 Extensions (5 + 5-8 hours)

**Core Workers (5 hours):**
- [ ] Cycle synthesis worker
- [ ] Approval notifications worker
- [ ] Cycle post-mortem worker
- [ ] Analytics aggregation worker

**Extension 1: Model Arbitrage / Cost Routing (1.5 hours in Day 2-3):**
- [ ] Add taskComplexityScore heuristic to job schema
- [ ] Add model selection logic to ai-client.service.ts
  - score < 20 → Haiku, 20-60 → Sonnet, >60 → Opus
- [ ] Update each worker to calculate and pass complexity score
- [ ] Test cost reduction on routine tasks

**Extension 2: Per-Tool Audit Trail (1.5 hours in Day 2-3):**
- [ ] Add toolCallAudited() method to audit.service.ts
- [ ] Add audit hooks before/after each tool invocation in workers
- [ ] Implement sensitive field masking (passwords, tokens, PII)
- [ ] Create audit event schema for tool calls
- [ ] Test audit trail generation

**Extension 3: Mission State Persistence (1 hour in Day 2-3):**
- [ ] Add saveWorkerState() and loadWorkerState() to job-queue.service.ts
- [ ] Persist scratchpad to mission_runs.metadata after each tool call
- [ ] Add resume logic to check for partial execution
- [ ] Test server restart mid-execution (verify no duplicate work)

### Day 4-5: Integration & Deployment + Extension Testing (3.5 + 1.5 hours)

**Core Integration (3.5 hours):**
- [ ] Update API responses with job IDs
- [ ] Create job status endpoint
- [ ] Create WebSocket listener for job completion
- [ ] Integration testing

**Extension Integration (1.5 hours):**
- [ ] Add GET /missions/{id}/audit-trail endpoint
- [ ] Add audit panel to Mission Detail UI
- [ ] Add POST /cycles/{id}/resume endpoint for state recovery
- [ ] Add complexity score indicator to Job UI
- [ ] End-to-end testing: cost routing + audit trail + state persistence

**Success Criteria:**
- [ ] Request latency: 50-100x improvement ✅
- [ ] Throughput: 10x improvement ✅
- [ ] Worker reliability: 99%+ ✅
- [ ] Job status tracking: Real-time ✅
- [ ] **[Extension]** Cost reduction: 30-50% on routine tasks ✅
- [ ] **[Extension]** Audit trail: Complete per-tool action logging ✅
- [ ] **[Extension]** State persistence: Server restart survives mid-execution ✅

---

## 🎯 Cumulative Progress

### Phase 1-3 (Completed)
```
Map lookups:           5-20x ✅
Batch updates:         10-50x ✅
Pagination:            2-10x ✅
Loop optimization:     10-50x ✅
Parallel queries:      3-5x ✅
Regex simplification:  1.5-2x ✅
Event filtering:       1.1x ✅
JSON optimization:     1.1x ✅

SUBTOTAL:              30-100x ✅
```

### Phase 4A (Indexing) - In Progress
```
Database indexes:      2-10x ⏳
```

### Phase 4B (Caching) - To Do
```
Redis caching:         3-5x ⏳
```

### Phase 4C (Streaming) - To Do
```
Pagination/Streaming:  2-3x ⏳
```

### Phase 4D (Async) - To Do
```
Background workers:      5-20x ⏳
Model Arbitrage:         1.3-1.5x (cost multiplier) ⏳
Audit Trail:             Compliance (no perf impact) ⏳
State Persistence:       1.2x (resilience) ⏳
```

### TOTAL POTENTIAL: 6-50,000x 🚀

**Extensions add:**
- **Cost:** 30-50% reduction on frontier model spend
- **Compliance:** SOC 2 audit trail + mission state recovery
- **Resilience:** Survive server restarts without re-execution

---

## 📊 Metrics Tracking

### Approval Workflow Performance
| Milestone | Query Time | Status |
|-----------|-----------|--------|
| Phase 1-3 baseline | 60-100ms | ✅ |
| After Phase 4A (indexes) | 10-20ms | ⏳ |
| After Phase 4B (cache) | 5-10ms | ⏳ |
| After Phase 4C (streaming) | 1-2ms | ⏳ |
| After Phase 4D (async) | <1ms | ⏳ |

### Cycle Loading Performance
| Milestone | Load Time | Status |
|-----------|-----------|--------|
| Phase 1-3 baseline | 150ms | ✅ |
| After Phase 4A (indexes) | 50-75ms | ⏳ |
| After Phase 4B (cache) | 10-20ms | ⏳ |
| After Phase 4C (streaming) | 0.5-1s (initial) | ⏳ |

### Concurrent Cycles Supported
| Milestone | Capacity | Status |
|-----------|----------|--------|
| Phase 1-3 baseline | 100+ | ✅ |
| After Phase 4D (async) | 500+ | ⏳ |

---

## ✅ Sign-Off Checklist

### Before Starting Week 1
- [ ] Backup database (optional but recommended)
- [ ] Verify staging environment ready
- [ ] Review migration file created
- [ ] Confirm team aware of optimization work

### Before Starting Week 2
- [ ] Week 1 results documented ✅
- [ ] Performance improvements validated ✅
- [ ] No regressions detected ✅
- [ ] Code review completed ✅

### Before Starting Week 3
- [ ] Week 2 results documented
- [ ] Cache strategy approved
- [ ] Hit rates validated
- [ ] Code review completed

### Before Starting Week 4
- [ ] Week 3 results documented
- [ ] Streaming endpoints tested
- [ ] Memory reduction confirmed
- [ ] Code review completed

### Final Sign-Off
- [ ] All phases complete
- [ ] Combined 6-50,000x improvement validated
- [ ] Production deployment approved
- [ ] Post-deployment monitoring active

---

## 📝 Notes & Issues

Use this section to track blockers, decisions, or observations:

- (Week 1) Database type: PostgreSQL
- (Week 1) Use CONCURRENTLY flag for online index creation
- (Week 2) Redis already configured for caching
- (Week 3) Use pagination with defaults: offset=0, limit=50, max=500
- (Week 4) Bull queue runs on separate Redis DB (db=1)

---

## 🚀 Getting Started

**Right Now (Week 1, Day 1):**

1. Create the database analysis script
2. Run baseline metrics collection
3. Begin Task 1.1 and Task 1.2

**Expected Duration:** Start now, complete by Friday (2026-06-21)

---

**Phase 4 Execution Plan is LIVE. Good luck! 🎯**

