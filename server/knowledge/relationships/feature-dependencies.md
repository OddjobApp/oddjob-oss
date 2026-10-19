# Feature Relationships & Interdependencies

This document maps how Oddjob features connect and depend on each other.

## Dependency Graph

```
                    ┌─────────────┐
                    │ Credentials │
                    └──────┬──────┘
                           │ uses
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
   ┌────────┐         ┌────────┐         ┌────────┐
   │  Jobs  │         │Datasets│         │   KG   │
   └───┬────┘         └───┬────┘         └───┬────┘
       │                  │                  │
       │ contains         │ stores          │ references
       ▼                  ▼                  ▼
   ┌────────────┐    ┌────────────┐    ┌────────────┐
   │ Pipelines  │───▶│ Job Output │    │  Entities  │
   └─────┬──────┘    └────────────┘    └────────────┘
         │
         │ triggers
         ▼
   ┌────────────┐
   │ Schedules  │
   └─────┬──────┘
         │
         │ creates
         ▼
   ┌────────────┐
   │   Alerts   │
   └────────────┘
```

## Core Relationships

### Jobs → Pipelines
- Jobs are building blocks for pipelines
- A job can be used in multiple pipelines
- **Before deleting a job**: Check which pipelines use it

### Jobs → Credentials
- Jobs that access external APIs need credentials
- `credentialId` references a stored credential
- **Before deleting a credential**: Check which jobs use it

### Jobs → Datasets
- Jobs can output to datasets (`outputDatasetId`)
- Datasets store structured job results
- **Relationship**: One job → One output dataset

### Pipelines → Schedules
- Scheduled jobs link pipelines to timing patterns
- Multiple scheduled jobs can use the same schedule
- **Dependencies**: Pipeline → Scheduled Job → Schedule

### Workgroups → Missions
- Workgroups are persistent teams with an Objective.
- Missions are *active* executions of that objective.
- **Relationship**: One Workgroup → Many Missions (over time).

### Workgroups → Members (Jobs/Pipelines)
- Members are the "workers" that execute tasks.
- Supervisor Agents orchestrate member actions.
- **Dependency**: Deleting a Job removes it from the Workgroup member list.

### Knowledge Graph → All Features
- Entities can represent jobs, pipelines, users, systems
- Relationships map dependencies between components
- **Use for**: Impact analysis before changes

## Feature Matrix

| Feature | Depends On | Used By |
|---------|------------|---------|
| **Jobs** | Credentials | Pipelines, Scheduled Jobs |
| **Pipelines** | Jobs | Scheduled Jobs, Alerts |
| **Schedules** | - | Scheduled Jobs |
| **Scheduled Jobs** | Jobs/Pipelines, Schedules | Alerts |
| **Credentials** | - | Jobs |
| **Datasets** | - | Jobs (output) |
| **Knowledge Graph** | - | All (for context) |
| **Alerts** | Jobs, Pipelines, Schedules | Notifications |

## Common Patterns

### Creating an Integration
```
1. Create Credential (API auth)
2. Create Job (uses credential)
3. Create Pipeline (contains job)
4. Create Schedule (timing pattern)
5. Create Scheduled Job (links pipeline to schedule)
```

### Impact Analysis Before Deletion
```
Deleting a Job:
1. Check: list_pipelines → find pipelines using this job
2. Check: scheduled_jobs → find scheduled runs
3. Check: knowledge_graph → find entity references

Deleting a Credential:
1. Check: list_jobs → find jobs using credentialId
2. Check: scheduled_jobs → find webhook credentials
```

### Data Flow
```
External API → CURL Job → Transformer Job → Dataset
                  │
                  └→ Knowledge Graph (entities)
                  │
                  └→ Slack Notification
```

## Cross-Feature Queries

### "What uses this credential?"
```sql
SELECT * FROM jobs WHERE config->>'credentialId' = '5';
SELECT * FROM scheduled_jobs WHERE trigger_credential_id = 5;
```

### "What pipelines run this job?"
```sql
SELECT p.* FROM pipelines p
JOIN pipeline_steps ps ON ps.pipeline_id = p.id
WHERE ps.job_id = 10;
```

### "What depends on this entity?"
```
get_entity_impact("Payment Service", direction: "inbound")
```
