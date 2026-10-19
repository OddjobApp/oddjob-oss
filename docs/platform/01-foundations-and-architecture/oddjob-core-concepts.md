---
id: oddjob-core-concepts
title: Oddjob 5-Layer AI Control Plane & Core Architecture
audience: [HUMAN_PRIMARY, HYBRID]
badge: HUMAN_PRIMARY
category: 01-foundations-and-architecture
autonomy_level: L0-L4
version: 1.0.0
tags: [architecture, control-plane, missions, cycles, pipelines, telemetry]
summary: Foundational overview of Oddjob's 5-Layer Governed AI Control Plane and execution abstractions.
---

# Oddjob 5-Layer AI Control Plane & Core Architecture `[🧑 HUMAN]`

> **Audience:** `🧑 Human / Builder` &nbsp;|&nbsp; **Autonomy Scope:** `L0 to L4` &nbsp;|&nbsp; **Classification:** Architectural Foundation

---

## 1. The 5-Layer AI Control Plane `[🧑 Human]`

Oddjob structures all autonomous and assisted operations across five deterministic control layers:

```mermaid
graph TD
    L1["Layer 1: Ingestion & Spatial Telemetry<br/>(Streams, H3 Hexagons, Webhooks, Documents)"] --> L2["Layer 2: Semantic Enrichment & Knowledge Graph<br/>(Knowledge Garden, Vector DB, Entity Resolution)"]
    L2 --> L3["Layer 3: Policy, Safety & Governance<br/>(HIL Gates, Token Spend Caps, Tool Whitelisting)"]
    L3 --> L4["Layer 4: Orchestration & Assembly<br/>(Missions, Operational Cycles, DAG Pipelines, Forged Apps)"]
    L4 --> L5["Layer 5: Autonomous Execution & Forensic Audit<br/>(Tool Invocation, W3C Trace Spans, Replay Traces)"]
```

1. **Layer 1 (Ingestion & Spatial Telemetry):** Ingests raw inputs from webhook event streams, tabular datasets, document dumps, and spatial coordinate feeds mapped to Uber H3 hexagonal indexes.
2. **Layer 2 (Semantic Enrichment):** Embeds, tags, and resolves entities into the persistent Knowledge Garden graph.
3. **Layer 3 (Policy & Governance):** Intercepts execution requests against confidence thresholds, spending ceilings, and permission gates.
4. **Layer 4 (Orchestration & Assembly):** Compiles high-level user objectives into executable DAGs, Missions, or interactive Forged Apps.
5. **Layer 5 (Execution & Forensics):** Executes tools idempotently with full W3C distributed tracing and replayable audit records.

---

## 2. Core Execution Abstractions `[🧑 Human]`

* **Mission:** A goal-oriented, multi-step autonomous campaign assigned to an agent or agent swarm with a defined objective and exit criteria.
* **Operational Cycle:** A recurring or event-triggered operational loop (e.g., hourly reconciliation, daily maintenance, continuous monitoring).
* **Pipeline (DAG):** A deterministic, dependency-ordered sequence of computational jobs, transformations, and tool executions.
* **Forged App:** A domain-specific, rapidly assembled user interface composed of reusable platform components and governed agent tools.

---

## 3. Telemetry & Distributed Tracing `[🤝 Hybrid]`

Every execution in Oddjob generates standard W3C `traceparent` headers, ensuring all tool calls, database mutations, and subagent delegations can be inspected via the **Armory X-Ray** explorer.
