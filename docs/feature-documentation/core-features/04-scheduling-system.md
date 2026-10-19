# Scheduling System Documentation

## Feature Overview

### Purpose & Business Value
The Scheduling System enables cron-based triggers for pipelines. Schedules run pipelines at defined times (e.g. daily at 9am). Scheduled Jobs track historical runs.

### Key Requirements
- Cron expressions with timezone support
- Enable/disable schedules
- Pipeline association per schedule
- Historical run tracking

---

## User Interface

### Screens & Routes

| Screen | Route | Function |
|--------|-------|----------|
| Schedules | `/schedules` | List schedules, create, enable/disable |
| Schedule Detail | `/schedules/:id` | Configure cron, timezone, pipeline |
| Scheduled Jobs | `/scheduled-jobs` | Historical runs, status, logs |

### Configuration Fields

| Field | Type | Description |
|-------|------|-------------|
| cronExpression | string | Cron expression (e.g. `0 9 * * *` for 9am daily) |
| timezone | string | Timezone (e.g. `America/New_York`) |
| pipelineId | number | Pipeline to run |
| isActive | boolean | Enable/disable |

---

## API Endpoints

### Schedules
- GET `/api/schedules` — List schedules
- GET `/api/schedules/:id` — Get schedule
- POST `/api/schedules` — Create schedule
- PUT `/api/schedules/:id` — Update schedule
- DELETE `/api/schedules/:id` — Delete schedule
- POST `/api/schedules/preview` — Preview next run times

### Scheduled Jobs
- GET `/api/scheduled-jobs` — List scheduled runs
- GET `/api/scheduled-jobs/:id` — Get run detail

---

## Execution Flow

1. Scheduler polls active schedules
2. Evaluates cron expression in schedule timezone
3. Triggers pipeline execution when due
4. Records run in scheduled_jobs

---

## Related

- **Spec:** [SCHEDULES_SPEC](../../specs/SCHEDULES_SPEC.md)
- **Guide:** [SCHEDULED_JOBS_DEBUGGING](../../guides/SCHEDULED_JOBS_DEBUGGING.md)
