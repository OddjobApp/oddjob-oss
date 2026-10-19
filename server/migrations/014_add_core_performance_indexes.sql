-- Migration 014: Add Core Performance Composite Indexes
-- Purpose: Adds composite covering indexes to high-traffic tables (approvals, mission_runs, jobs, blueprints)

-- 1. Approval Requests - Organization + Status filtering
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_approval_requests_org_status
  ON approval_requests(organization_id, status);

-- 2. Mission Runs - Cycle + Status filtering
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mission_runs_cycle_status
  ON mission_runs(cycle_id, status);

-- 3. Cycle Blueprints - Cycle ID lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cycle_blueprints_cycle_id
  ON cycle_blueprints(cycle_id);

-- 4. Jobs - Organization + Type filtering
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_org_type
  ON jobs(organization_id, type);

-- 5. Operational Cycles - Organization + Status filtering
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_operational_cycles_org_status
  ON operational_cycles(organization_id, status);

-- Update statistics for query planner
ANALYZE approval_requests;
ANALYZE mission_runs;
ANALYZE cycle_blueprints;
ANALYZE jobs;
ANALYZE operational_cycles;
