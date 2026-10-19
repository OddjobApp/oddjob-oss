# Oddjob Platform X-Ray Specifications & Visual Blueprint Contracts

This document provides the authoritative **X-Ray Specifications** for all visual blueprint execution stages, Mermaid DAG representations, state transitions, and component topology contracts in the Oddjob Platform.

---

## 1. Universal Blueprint Stage Topology & Readiness States

Every Assembly Blueprint and Operational Cycle consists of a Directed Acyclic Graph (DAG) of execution stages. Each stage is assigned a visual readiness state:

| State Class | Badge Color | Description | Visual Contract |
| :--- | :--- | :--- | :--- |
| `ready` | Green (`#10b981`) | Stage prerequisites fulfilled; ready for immediate execution. | `safeId["Stage Name (READY)"]:::ready` |
| `active` | Amber (`#f59e0b`) | Stage currently executing in worker container or agent turn. | `safeId["Stage Name (ACTIVE)"]:::active` |
| `blocked` | Dashed (`#1e293b`) | Prerequisite stages pending or awaiting Human-in-the-Loop approval. | `safeId["Stage Name (BLOCKED)"]:::blocked` |

---

## 2. Standard Operational Cycle X-Ray Blueprint

```mermaid
graph TD
    classDef ready fill:#10b981,stroke:#059669,stroke-width:2px,color:#fff;
    classDef active fill:#f59e0b,stroke:#d97706,stroke-width:3px,color:#fff;
    classDef blocked fill:#1e293b,stroke:#475569,stroke-dasharray: 5 5,color:#94a3b8;

    stage_ingest["1. Alert Ingestion & Signal Intake (READY)"]:::ready
    stage_ast["2. AST Rule Engine & Pack Assembly (ACTIVE)"]:::active
    stage_hil["3. SOC2 HIL Governance Gate (BLOCKED)"]:::blocked
    stage_deploy["4. Container Reconciliation & Staging (BLOCKED)"]:::blocked

    stage_ingest --> stage_ast
    stage_ast --> stage_hil
    stage_hil --> stage_deploy
```

---

## 3. Chaos Engineering & Auto-Recovery X-Ray Blueprint

```mermaid
graph TD
    classDef ready fill:#10b981,stroke:#059669,stroke-width:2px,color:#fff;
    classDef active fill:#f59e0b,stroke:#d97706,stroke-width:3px,color:#fff;
    classDef blocked fill:#1e293b,stroke:#475569,stroke-dasharray: 5 5,color:#94a3b8;

    chaos_inject["1. Fault Injection Probe (READY)"]:::ready
    anomaly_detect["2. Prometheus Anomaly Detection (READY)"]:::ready
    auto_remedy["3. Automated Remediation Dispatch (ACTIVE)"]:::active
    post_mortem["4. SOC2 Attested Post-Mortem (BLOCKED)"]:::blocked

    chaos_inject --> anomaly_detect
    anomaly_detect --> auto_remedy
    auto_remedy --> post_mortem
```

---

## 4. Product Launch Cycle X-Ray Blueprint

```mermaid
graph TD
    classDef ready fill:#10b981,stroke:#059669,stroke-width:2px,color:#fff;
    classDef active fill:#f59e0b,stroke:#d97706,stroke-width:3px,color:#fff;
    classDef blocked fill:#1e293b,stroke:#475569,stroke-dasharray: 5 5,color:#94a3b8;

    req_intake["1. Feature Brief & PRD Intake (READY)"]:::ready
    scaffold_gen["2. Full-Stack Scaffold Assembly (READY)"]:::ready
    otel_probe["3. OpenTelemetry Health Probe (ACTIVE)"]:::active
    live_launch["4. Production Deployment Gate (BLOCKED)"]:::blocked

    req_intake --> scaffold_gen
    scaffold_gen --> otel_probe
    otel_probe --> live_launch
```

---

## 5. Tool Integration & Rendering Contracts

- **Tool Definition**: `render_workflow_diagram(stages: Array<{ id, name, status, dependsOn }>)`
- **Output Envelope**:
  ```json
  {
    "type": "workflow_diagram",
    "title": "Blueprint Workflow & Execution Diagram",
    "chart": "graph TD\n...",
    "markdownBlock": "```mermaid\ngraph TD\n...```"
  }
  ```
- **UI Render Component**: Mounted via `<MermaidRenderer chart={chart} />` inside [`AgentChatPanel.tsx`](../client/src/components/agent-chat/AgentChatPanel.tsx).
