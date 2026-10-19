---
id: distributed-fleet-and-worker-isolation
title: Distributed Fleet Orchestration, Worker Isolation & Crash Recovery Standards
audience: [HUMAN_PRIMARY, AGENT_PRIMARY, HYBRID]
badge: HYBRID
category: 01-foundations-and-architecture
autonomy_level: L2-L4
version: 1.0.0
tags: [distributed-fleet, workers, queues, bullmq, redis, isolation, failover, crash-recovery, heartbeat]
summary: Definitive architectural standard for Oddjob's distributed worker fleet, queue topologies, worker lifecycle heartbeats, memory containment, and state reconciliation under worker eviction.
verification_status: verified
applies_when:
  - Deploying background worker fleets or scaling execution nodes across environments
  - Configuring BullMQ/Redis job queues, worker concurrency caps, and memory limits
  - Implementing crash recovery, orphaned job cleanup, and heartbeat monitoring
do_not_use_when:
  - Running synchronous, lightweight in-memory utility functions that do not execute as background jobs
required_tools:
  - list_jobs
  - get_job_details
  - monitoring_query_metrics
preconditions:
  - Redis cluster or Valkey broker is healthy with sub-5ms ping latency
  - Worker node agent has valid tenant context and TLS certs provisioned
approval_requirements:
  - Fleet scaling adjustments exceeding 50 concurrent worker nodes require Organization Admin sign-off
success_checks:
  - Worker heartbeats registered within 5000ms intervals in the worker registry
  - Dead worker nodes trigger automatic job re-queueing without state corruption
stop_conditions:
  - Redis connection lost or queue broker memory saturation exceeds 90%
escalation:
  - Route fleet-wide worker degradation to #sre-alerts and trigger automatic rate throttling
implementation_evidence:
  - server/domain/jobs/
  - server/domain/queue/
---

# Distributed Fleet Orchestration & Worker Isolation Standards `[🤝 HYBRID]`

> **Audience:** `🤝 Hybrid (Platform Engineers + Autonomous Agents)` &nbsp;|&nbsp; **Classification:** Platform Architecture & Runtime Operational Standard

---

## 1. Architectural Topology `[🧑 Human]`

Oddjob distributes heavy workloads across a heterogeneous fleet of worker nodes. Jobs are dispatched through priority queues and isolated in hardened worker processes:

```mermaid
graph TD
    subgraph ControlPlane["Control Plane (API Server & Orchestrator)"]
        Orchestrator["Agent Orchestrator"]
        QueueManager["Queue Dispatch Service"]
        HeartbeatMonitor["Worker Heartbeat & Liveness Sentinel"]
    end

    subgraph QueueBroker["Redis / Valkey Cluster"]
        HighQ["High-Priority Queue (Interactive/HIL)"]
        StdQ["Standard Queue (Missions/Pipelines)"]
        BatchQ["Batch/Heavy Compute Queue (Vision/Scrape/ML)"]
        DLQ["Dead Letter Queue (DLQ)"]
    end

    subgraph WorkerFleet["Distributed Worker Fleet"]
        Worker1["Node A: General Worker (Sandbox V8)"]
        Worker2["Node B: Heavy Worker (Python/WASM Runtime)"]
        Worker3["Node C: Headless Browser Pod (Playwright/Chrome)"]
    end

    Orchestrator --> QueueManager
    QueueManager --> HighQ & StdQ & BatchQ
    HighQ --> Worker1
    StdQ --> Worker2
    BatchQ --> Worker3
    Worker1 & Worker2 & Worker3 -.->|Heartbeat / State Sync| HeartbeatMonitor
    Worker1 & Worker2 & Worker3 -.->|Max Retries Exceeded| DLQ
```

---

## 2. Worker Lifecycle & Heartbeat Contract `[🤖 Agent Reference]`

Every worker instance MUST strictly implement the 5-state lifecycle:

1. **`BOOTING`**: Worker initializes runtime dependencies (V8 isolates, Python environments, Playwright binaries) and verifies broker connectivity.
2. **`IDLE / READY`**: Worker registers with `fleet_worker_registry`, advertising capabilities, CPU/Memory capacity, and supported job types.
3. **`PROCESSING`**: Worker locks a job envelope with a distributed atomic lock (`SETNX` + 30s TTL). Emits heartbeat every **5,000ms**.
4. **`DRAINING`**: Upon SIGTERM/preemption signal, worker ceases claiming new jobs and allows existing jobs up to **30,000ms** to reach a safe checkpoint.
5. **`TERMINATED / DEAD`**: Worker unregisters. If heartbeat misses 3 consecutive cycles (15s), Sentinel marks node dead and reconciles orphaned jobs.

### Worker Heartbeat Payload Schema

```typescript
export interface WorkerHeartbeatPayload {
  workerId: string;
  hostName: string;
  tenantId: string;
  status: "IDLE" | "BUSY" | "DRAINING";
  activeJobId?: string;
  activeJobType?: string;
  concurrency: {
    current: number;
    max: number;
  };
  metrics: {
    memoryUsedMb: number;
    memoryLimitMb: number;
    cpuLoadPercent: number;
  };
  timestamp: string; // ISO-8601 UTC
}
```

---

## 3. Worker Crash Recovery & Orphaned Job Reconciliation `[🧑 Human]`

When a worker node experiences sudden hardware failure, OOM termination, or network partition:

```mermaid
sequenceDiagram
    autonumber
    participant Sentinel as Heartbeat Sentinel
    participant Registry as Worker Registry (Redis)
    participant Queue as Job Queue
    participant DB as Postgres Job Store
    participant Telemetry as OpenTelemetry / Audit Log

    Sentinel->>Registry: Check Worker Last Seen
    Note over Sentinel: Last Seen > 15,000ms (Threshold Exceeded)
    Sentinel->>Registry: Mark Worker as DEAD
    Sentinel->>DB: Query Active Jobs locked by WorkerId
    DB-->>Sentinel: Return Orphaned Job Record (attempt = N)
    alt Attempt < Max Retries (e.g. 3)
        Sentinel->>DB: Increment Retry Count & Set Status = QUEUED
        Sentinel->>Queue: Push Job back to High-Priority Queue head
        Sentinel->>Telemetry: Emit WorkerCrashReconciliationSpan
    else Max Retries Exceeded
        Sentinel->>DB: Set Status = FAILED (Error: WORKER_TERMINATED_UNEXPECTEDLY)
        Sentinel->>Queue: Push to Dead Letter Queue (DLQ)
        Sentinel->>Telemetry: Trigger Alert to Ops HUD
    end
```

---

## 4. Resource Containment & Isolation Invariants `[🤖 Agent Reference]`

1. **Process Hard Memory Caps**:
   - Standard workers: Max `1024 MB` RSS.
   - Browser/Puppeteer workers: Max `2048 MB` RSS per tab pool.
   - Python ML workers: Max `4096 MB` RSS.
   - If a job exceeds 90% of memory limit, the worker must initiate graceful context compaction or checkpointing rather than crashing.
2. **Job Isolation Boundaries**:
   - Each job execution occurs within an isolated worker child process or throwaway container.
   - Shared disk `/tmp/oddjob_sandbox/{jobId}` must be wiped immediately on job completion or failure.
3. **Idempotency Checkpoints**:
   - Long-running multi-step jobs must persist checkpoint tokens to the database at every step boundary. On failover, the replacement worker resumes from the last validated checkpoint.
