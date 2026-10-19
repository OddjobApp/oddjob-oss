-- Phase 1a: State Consistency Checker Schema Migration
-- Created: 2026-06-26
-- Purpose: Add tables and indexes for State Consistency Logging and Auto-Remediation Config
-- Status: READY FOR DEPLOYMENT

-- ============================================================================
-- 1. CREATE TABLES
-- ============================================================================

-- Configuration for auto-remediation behavior and alerting thresholds per organization
CREATE TABLE IF NOT EXISTS public.consistency_remediation_config (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES public.orgs(org_id) ON DELETE CASCADE,

  -- Enable/disable auto-remediation
  auto_remediate_enabled BOOLEAN NOT NULL DEFAULT TRUE,

  -- Divergence types to remediate automatically
  remediate_missing_container BOOLEAN NOT NULL DEFAULT TRUE,
  remediate_state_mismatch BOOLEAN NOT NULL DEFAULT TRUE,
  remediate_port_conflict BOOLEAN NOT NULL DEFAULT FALSE,

  -- Remediation strategies
  restart_strategy VARCHAR(20) NOT NULL DEFAULT 'graceful',  -- 'graceful'|'force'|'recreate'
  restart_timeout_seconds INTEGER NOT NULL DEFAULT 30,
  max_restart_attempts INTEGER NOT NULL DEFAULT 3,

  -- Alert configuration
  alert_on_divergence BOOLEAN NOT NULL DEFAULT TRUE,
  alert_channels TEXT NOT NULL DEFAULT 'slack',
  alert_severity VARCHAR(20) NOT NULL DEFAULT 'warning',      -- 'info'|'warning'|'critical'

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT consistency_remediation_config_org_unq UNIQUE (org_id)
);

-- Audit log for state consistency checks and auto-remediation actions
CREATE TABLE IF NOT EXISTS public.state_consistency_log (
  id BIGSERIAL PRIMARY KEY,
  instance_id INTEGER NOT NULL REFERENCES public.app_instances(id) ON DELETE CASCADE,
  check_timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  -- Database state
  db_status VARCHAR(20),                  -- 'running'|'stopped'|'pending'
  db_container_id VARCHAR(256),
  db_port INTEGER,

  -- Docker state
  docker_exists BOOLEAN,
  docker_running BOOLEAN,
  docker_container_id VARCHAR(256),
  docker_exit_code INTEGER,
  docker_last_error TEXT,

  -- Divergence detection
  divergence_type VARCHAR(50),            -- 'none'|'container_missing'|'state_mismatch'|'port_conflict'|'id_mismatch'|'zombie_process'
  divergence_details JSONB,

  -- Auto-remediation attempt
  remediation_attempted BOOLEAN NOT NULL DEFAULT FALSE,
  remediation_action VARCHAR(100),        -- 'restart'|'recreate'|'force_stop'|'cleanup'
  remediation_success BOOLEAN,
  remediation_error TEXT,

  -- Outcome
  outcome VARCHAR(50) NOT NULL,            -- 'healthy'|'divergent'|'unrecoverable'
  alert_sent BOOLEAN NOT NULL DEFAULT FALSE,

  -- Metadata
  org_id INTEGER NOT NULL REFERENCES public.orgs(org_id) ON DELETE CASCADE,
  app_id INTEGER NOT NULL REFERENCES public.apps(id) ON DELETE CASCADE,

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 2. CREATE INDEXES (CONCURRENTLY)
-- ============================================================================

CREATE INDEX idx_consistency_remediation_config_org_id 
  ON public.consistency_remediation_config(org_id);

CREATE INDEX idx_state_consistency_instance_id 
  ON public.state_consistency_log(instance_id);

CREATE INDEX idx_state_consistency_check_timestamp 
  ON public.state_consistency_log(check_timestamp);

CREATE INDEX idx_state_consistency_org_id 
  ON public.state_consistency_log(org_id);

CREATE INDEX idx_state_consistency_divergence_type 
  ON public.state_consistency_log(divergence_type);

-- ============================================================================
-- 3. ANALYZE TABLES
-- ============================================================================
ANALYZE public.consistency_remediation_config;
ANALYZE public.state_consistency_log;
