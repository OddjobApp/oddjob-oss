# Infra Health — DLQ & Circuit Breakers

## Overview

The Infra Health page (`/admin/infra-health`) gives super-admins visibility into two operational safety systems:

1. **Dead Letter Queue (DLQ)** — BullMQ jobs that exhausted all retry attempts and were moved to a holding queue for manual review
2. **Circuit Breakers** — In-memory state machines that prevent cascading failures by blocking requests to failing services

## Dead Letter Queue

### Flow

```
Job fails on queue X (attempts exhausted)
  └─ setupDLQHandler listener fires
       └─ moveToDeadLetterQueue(job, error, queueName)
            ├─ Adds entry to oddjob-dlq BullMQ queue
            └─ Creates alert in DB (severity: warning, category: job_failure)

Admin reviews DLQ via /admin/infra-health
  ├─ Retry → job re-added to original queue with 3 attempts + exponential backoff
  └─ Purge → job permanently removed
```

### DLQ Entry shape

```typescript
interface DLQEntry {
    originalQueue: string;   // queue the job came from
    originalJobId: string;
    jobName: string;
    data: any;               // original job payload
    failedAt: string;        // ISO timestamp
    error: string;           // last error message
    attemptsMade: number;
    stacktrace?: string[];
}
```

### Registering a queue for DLQ

```typescript
import { setupDLQHandler } from "@domain/admin/core/dead-letter-queue.service.js";
import { QueueEvents } from "bullmq";

const events = new QueueEvents("my-queue", { connection: redisOpts });
setupDLQHandler("my-queue", events);
```

## Circuit Breakers

### States

```
             ┌──────────────────────────────────────────┐
             │            failures >= threshold          │
   ┌──────────┴──────┐                      ┌────────────▼────────┐
   │   CLOSED        │                      │     OPEN            │
   │ (requests pass) │                      │ (requests blocked)  │
   └──────────┬──────┘                      └────────────┬────────┘
              │           resetTimeout elapsed            │
              │                                           │
   ┌──────────▼──────────────────────────────────────────▼────────┐
   │                     HALF_OPEN                                 │
   │   (limited probes — success → CLOSED, failure → OPEN)        │
   └───────────────────────────────────────────────────────────────┘
```

### Pre-initialized breakers

| Name | Failure threshold | Reset timeout |
|------|-------------------|---------------|
| `openai` | 5 | 60s |
| `gemini` | 5 | 60s |
| `qdrant` | 3 | 30s |
| `external_api` | 5 | 30s |

### Using a circuit breaker in code

```typescript
import { withCircuitBreaker, CircuitOpenError } from "@domain/admin/core/circuit-breaker.service.js";

// Basic usage — throws CircuitOpenError if open
const result = await withCircuitBreaker("openai", () => openai.chat.completions.create(...));

// With fallback — returns fallback value instead of throwing
const result = await withCircuitBreaker(
    "openai",
    () => openai.chat.completions.create(...),
    () => ({ content: "AI unavailable, please try again" })
);

// Custom failure predicate
const result = await withCircuitBreaker(
    "external_api",
    () => fetch(url).then(r => r.json()),
    undefined,
    (res) => res.status >= 500  // treat 5xx as failure even without exception
);
```

### Creating a custom circuit

```typescript
import { createCircuitBreaker } from "@domain/admin/core/circuit-breaker.service.js";

createCircuitBreaker({
    name: "my-service",
    failureThreshold: 3,
    resetTimeoutMs: 30000,
    halfOpenMaxAttempts: 2,
});
```

## API Reference

All endpoints require authentication + super admin role.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/dlq` | List DLQ jobs + stats |
| `POST` | `/api/admin/dlq/:jobId/retry` | Requeue a single job |
| `DELETE` | `/api/admin/dlq/:jobId` | Permanently purge a single job |
| `POST` | `/api/admin/dlq/retry-all` | Requeue all DLQ jobs |
| `DELETE` | `/api/admin/dlq` | Purge all DLQ jobs |
| `GET` | `/api/admin/circuit-breakers` | List all circuit breaker states |
| `POST` | `/api/admin/circuit-breakers/:name/reset` | Force a circuit to CLOSED |

## Error Handling

- **Redis unavailable**: DLQ queue operations will fail; `moveToDeadLetterQueue` logs the error but does not throw (prevents cascading from DLQ handler itself)
- **Circuit OPEN + no fallback**: throws `CircuitOpenError` — callers should catch and handle gracefully
- **Budget circuit breaker**: `checkCircuitBreaker(pipelineId)` always returns `allowed: true` on DB error rather than blocking execution
