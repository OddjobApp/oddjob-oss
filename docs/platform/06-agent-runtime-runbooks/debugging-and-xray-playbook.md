---
id: debugging-and-xray-playbook
title: Armory X-Ray Composition Explorer & Autonomous Incident Triage Playbook
audience: [HUMAN_PRIMARY, AGENT_PRIMARY, HYBRID]
badge: HYBRID
category: 06-agent-runtime-runbooks
autonomy_level: L1-L4
version: 2.0.0
tags: [xray, debugging, triage, telemetry, incident-response, armory, root-cause, traceparent]
summary: Dual-audience playbook for using Armory X-Ray composition explorer, querying execution traces programmatically, calculating root-cause confidence heuristics, and executing automated rollbacks.
verification_status: verified
applies_when:
  - Investigating failed agent missions, broken DAG pipelines, or degraded node clusters
  - Querying system topology specifications and node dependencies programmatically
  - Isolating performance bottlenecks or anomalous trace spans across distributed worker nodes
do_not_use_when:
  - Routine healthy system execution without alerts or failure signatures
required_tools:
  - get_xray_spec
  - list_xray_specs
  - list_failed_jobs
  - query_code_graph
  - monitoring_get_incidents
  - apply_recovery_decision
preconditions:
  - X-Ray index service is active and synchronized with latest entity graph
  - OpenTelemetry trace spans available for the target execution window
approval_requirements:
  - Applying automated state rollback or killing active worker pods requires Governor consensus
success_checks:
  - Root cause isolated to a specific failing node or span with confidence $\ge 0.85$
  - Automated remediation or HIL escalation ticket generated with complete reproduction trace
stop_conditions:
  - Failure trace involves external vendor complete outage (requires status page escalation)
escalation:
  - Generate urgent HIL Incident Brief when cascade affects critical production nodes
implementation_evidence:
  - server/domain/xray/
  - server/domain/diagnostics/
---

# Armory X-Ray & Autonomous Incident Triage Playbook `[🤝 HYBRID]`

> **Audience:** `🤝 Hybrid: Systems Engineers + Autonomous Diagnostics Agents` &nbsp;|&nbsp; **Classification:** Incident Triage & Forensic Runbook

---

## 1. X-Ray Architecture & Canvas Topology `[🧑 Human]`

The **Armory X-Ray Explorer** (`/armory/x-ray`) provides real-time visualization of Oddjob's live dependency graph across all system layers:

```mermaid
graph TD
    subgraph UI_Explorer["Armory X-Ray Composition Explorer"]
        FilterSidebar["1. Scope & Filter Sidebar (Nodes, Pipelines, Datasets)"]
        GraphCanvas["2. Interactive ReactFlow Canvas (Health, Spans, Edges)"]
        DetailDrawer["3. Diagnostic Drawer (Specs, Logs, Trace Tree, Recovery)"]
    end

    subgraph DiagnosticsEngine["Autonomous Diagnostic Engine"]
        SpecQuery["get_xray_spec / list_xray_specs"]
        JobTracker["list_failed_jobs & Telemetry Tracer"]
        HeuristicScorer["Root-Cause Heuristic Engine (Bayesian Score)"]
    end

    FilterSidebar --> GraphCanvas --> DetailDrawer
    DiagnosticsEngine -.->|Syncs Real-Time State| GraphCanvas
```

---

## 2. Autonomous Agent Incident Triage Loop `[🤖 Agent Reference]`

When an alert triggers or a mission fails, agents must execute the standard **4-Step Forensic Diagnostic Loop**:

```mermaid
sequenceDiagram
    autonumber
    participant Agent as Autonomous Triage Agent
    participant XRay as X-Ray Spec Service
    participant Jobs as Job Failure Tracker
    participant Graph as Code & Knowledge Graph
    participant Remediation as Recovery Engine

    Agent->>Jobs: 1. list_failed_jobs({ limit: 10, timeWindow: "15m" })
    Jobs-->>Agent: Return Failed Execution ID & Error Traceparent
    Agent->>XRay: 2. get_xray_spec({ nodeId: "pipeline_sync_orders_v2" })
    XRay-->>Agent: Return Inbound/Outbound Dependency Specs & Schema
    Agent->>Graph: 3. query_code_graph({ targetFile: spec.sourcePath })
    Graph-->>Agent: Return Recent AST Code Diff / Schema Mutations
    Agent->>Agent: 4. Compute Root Cause Probability Score P(RootCause)
    alt Confidence >= 0.85
        Agent->>Remediation: apply_recovery_decision({ action: "COMPENSATE_ROLLBACK" })
    else Ambiguous Cause (< 0.85)
        Agent->>Agent: Generate HIL Forensic Triage Brief with Diagnostic Card
    end
```

---

## 3. Root-Cause Heuristic Scoring Formula `[🤖 Agent Reference]`

The autonomous diagnostics engine evaluates candidate root causes $C_i$ using weighted Bayesian evidence:

$$P(C_i \mid E) = \frac{P(E \mid C_i) \cdot P(C_i)}{\sum_j P(E \mid C_j) \cdot P(C_j)}$$

### Primary Evidence Weights:
1. **Recent Schema Mutation ($w = 0.40$):** Did upstream table or tool schema change in last 60 minutes?
2. **Upstream Error Spans ($w = 0.35$):** Did parent dependency node emit HTTP 5xx or timeout?
3. **Environment Resource Anomaly ($w = 0.25$):** Did worker host experience memory/CPU saturation?

---

## 4. Remediation & Recovery Tool Signatures `[🤖 Agent Reference]`

### A. Querying Node X-Ray Specification
```typescript
// Querying node spec to inspect topological relationships
const spec = await get_xray_spec({
  nodeId: "calc_net_revenue_v1",
  includeUpstream: true,
  includeDownstream: true
});
```

### B. Applying Automated Recovery Decision
```typescript
// Triggering safe non-destructive recovery
await apply_recovery_decision({
  incidentId: "inc_940182",
  nodeId: "pipeline_sync_orders_v2",
  action: "RESTART_WORKER_WITH_EXPANDED_MEMORY",
  parameters: {
    memoryLimitMb: 2048
  }
});
```
