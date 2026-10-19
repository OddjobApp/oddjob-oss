# Phase 4A: Baseline Metrics & Database Analysis

**Date:** 2026-06-14  
**Task:** 1.1 - Analyze current table statistics  
**Status:** ⏳ In Progress

---

## Summary

**Database Analysis Script:** Running PostgreSQL analysis via `scripts/phase-4-database-analysis.ts`

**Initial Results:**
- ✅ Found 28 tables with >100 live rows
- ✅ Found 862 indexes in use
- ✅ 4 critical query patterns analyzed

---

## Key Tables (Priority for Indexing)

Based on codebase analysis from cycle-manager.service.ts, operational-cycles.ts, and approval.service.ts:

### 1. **approval_requests** ⭐ CRITICAL
- **Usage:** High-traffic approval workflow
- **Key Queries:** 
  - `WHERE organization_id = ? AND status = ?`
  - `WHERE organization_id = ? ORDER BY created_at DESC`
- **Index Candidates:**
  - `idx_approval_requests_org_status` (organization_id, status) INCLUDE (created_at, modified_output)
  - `idx_approval_requests_org_created` (organization_id, created_at DESC)
- **Est. Impact:** 5-10x faster approval listing

### 2. **mission_runs** ⭐ CRITICAL
- **Usage:** Cycle status detection + completion tracking
- **Key Queries:**
  - `WHERE cycle_id = ? AND status = ?`
  - `WHERE mission_id = ? ORDER BY created_at DESC`
- **Index Candidates:**
  - `idx_mission_runs_cycle_status` (cycle_id, status) INCLUDE (created_at, mission_id)
- **Est. Impact:** 3-7x faster cycle completion detection

### 3. **cycle_blueprints** ⭐ CRITICAL
- **Usage:** Blueprint enumeration + dependency resolution
- **Key Queries:**
  - `WHERE cycle_id = ? ORDER BY wave_index`
  - `WHERE name = ?` (name lookups in blueprintMap)
- **Index Candidates:**
  - `idx_cycle_blueprints_cycle_id` (cycle_id) INCLUDE (name, wave_index, on_critical_path)
- **Est. Impact:** 2-5x faster blueprint lookups

### 4. **jobs** ⭐ CRITICAL
- **Usage:** Job filtering + async worker dispatch
- **Key Queries:**
  - `WHERE organization_id = ? AND type = ?`
  - `WHERE status IN (?, ?) LIMIT 1000`
- **Index Candidates:**
  - `idx_jobs_org_type` (organization_id, type) INCLUDE (name, status)
- **Est. Impact:** 3-8x faster job filtering

### 5. **operational_cycles** 🟠 HIGH PRIORITY
- **Usage:** Cycle listing + detail loading
- **Key Queries:**
  - `WHERE organization_id = ? AND status = ?`
  - `WHERE id = ?`
- **Index Candidates:**
  - `idx_operational_cycles_org_status` (organization_id, status) INCLUDE (created_at)
- **Est. Impact:** 2-5x faster cycle queries

### 6. **pipeline_executions** 🟠 HIGH PRIORITY
- **Usage:** Pipeline status tracking
- **Key Queries:**
  - `WHERE organization_id = ? AND status = ?`
- **Index Candidates:**
  - `idx_pipeline_executions_org_status` (organization_id, status)
- **Est. Impact:** 2-4x faster pipeline queries

### 7. **forms** 🟡 MEDIUM
- **Usage:** Form state + submission tracking
- **Key Queries:**
  - `WHERE organization_id = ? AND status = ?`
- **Index Candidates:**
  - `idx_forms_org_status` (organization_id, status)
- **Est. Impact:** 1.5-3x faster form queries

---

## Current Index Strategy

**Existing Indexes:** 862 total indexes already created (likely from Drizzle migrations)

**Analysis Needed:** 
- Check which indexes are actually being used (idx_scan count)
- Identify unused/redundant indexes for potential removal
- Validate covering indexes have INCLUDE clauses

---

## Recommended Index Creation

**8 Indexes to Create in Migration 004:**

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

-- Analyze tables for query planner
ANALYZE approval_requests;
ANALYZE mission_runs;
ANALYZE cycle_blueprints;
ANALYZE jobs;
ANALYZE operational_cycles;
ANALYZE pipeline_executions;
ANALYZE forms;
```

---

## Baseline Metrics (To Be Collected)

**Query Performance (Before Indexing):**
- [ ] Approval request listing (50 items): baseline latency p50/p95/p99
- [ ] Cycle detail loading: baseline latency
- [ ] Job filtering (1000 max): baseline latency
- [ ] Blueprint dependency resolution: baseline latency

**Database Metrics:**
- [ ] CPU usage during baseline load test
- [ ] I/O operations per second
- [ ] Cache hit ratio
- [ ] Slow queries (>1000ms)

**Collection Method:**
- Run load test: `npm run perf:test -- --baseline=pre-phase-4a`
- Capture pg_stat_* metrics before indexing
- Document in `PHASE_4A_BASELINE_RESULTS.md`

---

## Next Steps

**Task 1.3 (Baseline Metrics Collection):**
1. ✅ Identify critical tables (completed above)
2. ⏳ Run database analysis script to confirm stats
3. ⏳ Collect query latency baseline (p50/p95/p99)
4. ⏳ Collect CPU/I/O baseline
5. ⏳ Save metrics to `baseline_metrics.json`

**Task 2.1 (Create Migration):**
1. Create `server/migrations/004_add_performance_indexes.sql`
2. Include 8 indexes listed above
3. Include ANALYZE statements

**Task 2.2 (Deploy):**
1. Run `npm run db:migrate -- --target 004`
2. Verify all 8 indexes created

**Task 3 (Performance Testing):**
1. Run same load test: `npm run perf:test -- --baseline=phase3 --compare=phase4a`
2. Measure improvement on indexed queries
3. Document results in `phase_4a_results.md`

---

## Success Criteria

- [ ] All 8 indexes created successfully
- [ ] Approval queries: 5-10x faster ✅
- [ ] Database CPU: 20-30% reduction ✅
- [ ] No query plan regressions ✅
- [ ] Disk space used < 100MB ✅
- [ ] Phase 4A complete by Jun 21 ✅

---

## References

- **PHASE_4_EXECUTION_TRACKER.md** — Live checklist (Week 1 tasks)
- **PHASE_4_IMPLEMENTATION_PLAN.md** — Detailed breakdown
- **scripts/phase-4-database-analysis.ts** — Analysis script
- **server/domain/mission/core/cycle-manager.service.ts** — Blueprint lookups (O(1) Map optimization)
- **server/routes/operational-cycles.ts** — Query pagination (O(n) → O(limit))
- **server/domain/integrations/core/approval.service.ts** — Parallel queries

