# Worker Architecture

## Overview

Oddjob uses a **multi-queue BullMQ worker architecture** for horizontal scaling. Each worker type handles a specific class of workload and can be scaled independently by setting the `WORKER_TYPE` environment variable.

All workers share a common `BaseWorker` base class and connect to Redis for queue coordination.

---

## Worker Types

| Worker | Queue Name | Key Work | Concurrency |
|---|---|---|---|
| **step** | `oddjob-steps` | Pipeline step execution (all job types) | 15 |
| **ai** | `oddjob-ai` | Raw LLM API calls with credential resolution | 20 (rate-limited 100/s) |
| **browser** | `oddjob-browser` | Selenium automation via `SeleniumRunner` | `BROWSER_CONCURRENCY` env (default 2) |
| **heavy** | `oddjob-heavy` | Long-running generation jobs (5 min lock) | 10 |
| **analytics** | `oddjob-analytics` | AI usage logging, cost tracking | 5 |
| **prospecting** | `oddjob-prospecting` | Prospecting event ingest + LLM scoring | 20 |
| **extraction** | `knowledge-extractions` | Knowledge graph extraction from documents/datasets | 5 (rate-limited 10/s) |
| **scheduler** | `oddjob-scheduler` | Polls for due cron triggers every 60 s | 1 |
| **forge** | `rolling-forge` | App rolling-wave pipeline generation | (internal) |
| **transference** | `oddjob-transference` | LLM call mining, shadow accuracy checks, transference rule promotion | 2 |

The `scheduler` worker also starts `ScheduledJobExecutor` and `initScheduler` as co-located helpers.

---

## Entrypoints

### `server/worker-entrypoint.ts`
Standalone entrypoint for running workers without the HTTP server. Used in containerised deployments.

```bash
# Run all workers
WORKER_TYPE=all node dist/worker-entrypoint.js

# Run specific workers (comma-separated)
WORKER_TYPE=step,ai,scheduler node dist/worker-entrypoint.js

# Dedicated browser worker pod
WORKER_TYPE=browser BROWSER_CONCURRENCY=4 node dist/worker-entrypoint.js
```

### `server/extraction-worker-only.ts`
Minimal entrypoint for the extraction worker only. Used in data-plane deployments.

---

## Deployment Patterns

### Single-node (development / small deployments)
The HTTP server starts all workers in-process via `registerIntegrationRoutes` or the app's main entrypoint.

### Horizontally scaled (production)
Run the HTTP server and workers as separate containers:
```
HTTP Pod:        WORKER_TYPE=none  (or omit worker-entrypoint)
Worker Pod(s):   WORKER_TYPE=all   (or per-type pods)
Browser Pod:     WORKER_TYPE=browser  BROWSER_CONCURRENCY=4
Extraction Pod:  WORKER_TYPE=extraction
```

---

## MCP Integration

The `get_system_health` MCP tool now returns **live queue depths** for all worker queues:

```json
{
  "status": "OPERATIONAL",
  "database": "Connected",
  "redis": "Connected",
  "totalActiveJobs": 3,
  "totalFailedJobs": 0,
  "queues": {
    "steps":       { "waiting": 2, "active": 1, "failed": 0 },
    "ai":          { "waiting": 0, "active": 2, "failed": 0 },
    "scheduler":   { "waiting": 0, "active": 0, "failed": 0 }
  }
}
```

Status is `DEGRADED` when `totalFailedJobs > 10`.

---

## Transference worker

The **transference** worker powers the [Transference Engine](../../features/TRANSFERENCE_ENGINE.md) (TE-101). It processes jobs on `oddjob-transference` with concurrency 2.

| Job type | Action |
| --- | --- |
| `mine` | Scan `ai_execution_logs` and register new shadow rule candidates |
| `retrainCheck` | Compare a local handler prediction against a completed LLM output |

On startup, `worker-entrypoint.ts` schedules a daily mining cron (`transference-mine-daily`, 3 AM). Include `transference` in `WORKER_TYPE` alongside `ai` when cloud LLM interception and shadow tracking should run in production.

---

## Files

| File | Role |
|---|---|
| `server/worker-entrypoint.ts` | Main multi-worker entrypoint (now fully wired) |
| `server/extraction-worker-only.ts` | Single-purpose extraction entrypoint (now fully wired) |
| `server/workers/base-worker.ts` | BullMQ `Worker` base class with logging + error handling |
| `server/workers/step-worker.ts` | Pipeline step executor |
| `server/workers/ai-worker.ts` | LLM call worker |
| `server/workers/browser-worker.ts` | Selenium runner worker |
| `server/workers/heavy-worker.ts` | Long-running job worker |
| `server/workers/analytics-worker.ts` | Usage analytics worker |
| `server/workers/prospecting-worker.ts` | Prospecting event worker |
| `server/domain/knowledge/knowledge-queue.ts` | Knowledge extraction worker + queue |
| `server/domain/pipeline/infrastructure/scheduler-worker.ts` | Cron scheduler + job executor worker |
| `server/domain/apps/infrastructure/forge-queue.ts` | App forge rolling-wave worker |
| `server/workers/transference-worker.ts` | Transference Engine mining and shadow accuracy worker |
| `server/domain/agents/core/transference-router.ts` | LLM interception, shadow tracking, candidate mining |
| `server/domain/tools/v1/capabilities/system.ts` | `get_system_health` MCP tool (live queue stats) |
| `server/workers/tests/worker-entrypoint.test.ts` | Unit tests |
