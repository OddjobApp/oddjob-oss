# Phase 4A: Database Analysis Report

**Generated:** 2026-06-14T15:45:27.225Z
**Environment:** 127.0.0.1:5433/oddjob (development)

## Summary

- **Total Tables:** 28
- **Total Indexes:** 862
- **Total Data Size:** 46810.88 MB
- **Total Index Size:** 835.05 MB

## Top 10 Largest Tables

| Table | Rows | Dead Rows | Size (GB) | Last Vacuum |
|-------|------|-----------|-----------|-------------|
| public.forensic_event_log | 26642 | 10 | 0.01 | N/A |
| public.worker_heartbeats | 5789 | 1154 | 0.00 | N/A |
| public.gateway_request_logs | 3391 | 0 | 26.42 | N/A |
| public.mission_blackboard_history | 3077 | 0 | 0.01 | N/A |
| public.agent_tool_usage | 2843 | 437 | 0.00 | N/A |
| public.knowledge_edges | 2335 | 1 | 0.01 | N/A |
| public.agent_run_steps | 1768 | 30 | 0.00 | N/A |
| public.document_templates | 951 | 118 | 0.00 | N/A |
| public.pipelines | 825 | 93 | 0.00 | N/A |
| public.pipeline_steps | 757 | 185 | 0.00 | N/A |

## Unused Indexes (Candidates for Removal)

✅ All indexes are in use!

## Most Used Indexes

| Index | Table | Scans | Size (GB) |
|-------|-------|-------|----------|
| node_org_fingerprint_unique | public.knowledge_nodes | 338906 | 0.0004 |
| app_deployment_org_app_unq | public.app_deployments | 254778 | 0.0000 |
| worker_heartbeats_worker_id_unique | public.worker_heartbeats | 251459 | 0.0003 |
| pipeline_executions_pkey | public.pipeline_executions | 153506 | 0.0000 |
| session_pkey | public.session | 93967 | 0.0000 |
| step_executions_execution_id_idx | public.pipeline_step_executions | 76962 | 0.0000 |
| jobs_pkey | public.jobs | 65512 | 0.0000 |
| mission_runs_mission_id_idx | public.mission_runs | 54263 | 0.0000 |
| IDX_session_expire | public.session | 47794 | 0.0000 |
| mission_runs_pipeline_execution_idx | public.mission_runs | 41837 | 0.0000 |

## Query Plan Analysis

### Approval Requests - Organization + Status
```
Status: ✅ OK

```

### Mission Runs - Cycle + Status
```
Status: ✅ OK

```

### Cycle Blueprints - Cycle ID
```
Status: ✅ OK

```

### Jobs - Organization + Type
```
Status: ✅ OK

```

## Recommendations

### Immediate Actions
- ✅ Remove or analyze unused indexes (see indexes.unused)
- ✅ Create indexes for high-traffic queries (see below)
- ✅ Run VACUUM on tables with high dead row counts

### Indexes to Create (Phase 4A Priority)
- idx_approval_requests_org_status (approval_requests.organization_id, approval_requests.status)
- idx_mission_runs_cycle_status (mission_runs.cycle_id, mission_runs.status)
- idx_cycle_blueprints_cycle_id (cycle_blueprints.cycle_id)
- idx_jobs_org_type (jobs.organization_id, jobs.type)
- idx_operational_cycles_org_status (operational_cycles.organization_id, operational_cycles.status)
- idx_approval_requests_org_created (approval_requests.organization_id, approval_requests.created_at DESC)
- idx_pipeline_executions_org_status (pipeline_executions.organization_id, pipeline_executions.status)
- idx_forms_org_status (forms.organization_id, forms.status)

---

**Next Step:** Create migration file `server/migrations/004_add_performance_indexes.sql` with the indexes listed above.
