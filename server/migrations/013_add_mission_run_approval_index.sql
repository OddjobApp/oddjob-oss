-- Migration 013: Add GIN index on mission_runs resume_condition for approvalRequestIds
-- Purpose: Accelerates resumeIfWaitingOnApproval queries looking up waiting mission runs by approval requestId

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mission_runs_resume_approval_ids
    ON mission_runs USING gin ((resume_condition->'approvalRequestIds'))
    WHERE status = 'waiting_on_human';

ANALYZE mission_runs;
