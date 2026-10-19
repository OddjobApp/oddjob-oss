-- Migration 007: Add data_classification to jobs for privacy-aware model routing
-- Purpose: Allows per-job designation of data sensitivity, which drives the
--          privacy-aware model router to enforce local-only inference for restricted data.
--
-- Values:
--   public     - no restrictions, any model can be used
--   internal   - prefer on-prem but cloud is acceptable
--   sensitive  - log a warning when routed to cloud models
--   restricted - MUST use a local/on-prem model (PII, PHI, financial, etc.)
--
-- Safe: adds a nullable column with a default; no table lock required.

ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS data_classification TEXT NOT NULL DEFAULT 'public'
        CHECK (data_classification IN ('public', 'internal', 'sensitive', 'restricted'));

-- Index for governance queries (e.g., "find all restricted jobs in org X")
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_data_classification
    ON jobs (organization_id, data_classification)
    WHERE data_classification != 'public';

-- Populate query-planner statistics
ANALYZE jobs;
