
# 🚀 Oddjob Business Operations Cycles

Operationalizing Autonomous Business Cycles transforms Oddjob from a mission-centric execution engine into a persistent **Autonomous Fleet Management Ecosystem**.

## 🏗️ Core Architecture

Business Cycles are high-level containers for **Mission Fleets**. They provide the strategic objective, temporal recurrence, and aggregate governance for one or more mission runs.

### 1. Resource Hardening (Governance)
- **Priority Tiers (1-10)**: Every cycle has a priority. Higher priority cycles (e.g., Incident Response) pre-empt lower priority ones in the execution queue.
- **Token Quotas**: Cycles track aggregate token consumption. If a fleet exceeds its `tokenLimit`, all missions are paused to prevent unexpected API costs.
- **Budget Guards**: Enforces hard USD limits across all missions in the fleet.

### 2. Strategic Intelligence
- **Conditional Termination**: Define "Success Criteria" (e.g., `stop_on: "finding_confirmed"`). The system autonomously monitors mission reflection phases and shuts down the fleet once the goal is achieved.
- **Autonomous Chaining**: Cycles can trigger follow-up cycles (e.g., "Discovery" -> "Remediation"). The follow-up cycle inherits the RAG memory context of its parent.

### 3. Human-Agent Synergy
- **HIL Approval Gates**: Sensitive cycles can be "Staged" in a `pending_approval` state, requiring manual sign-off before missions are spawned.
- **Deterministic Simulation & Contract Verification**: Validates DAG acyclicity, verifies port-to-port typed data contracts, probes participating studio resources (Workbench Apps, Form Agents, Data Pipelines, Prediction Targets), and calculates P50/P95 Monte Carlo cost and duration bounds with cryptographic proof certificates. See [SIMULATION_AND_VERIFICATION.md](./cycle-builder/SIMULATION_AND_VERIFICATION.md).
- **Studio Release Manifest**: On cycle creation or revision publishing, an immutable `studioManifest` snapshot is compiled into `metadata.studioManifest`.

## 🛠️ MCP Tools (Model Context Protocol)

You can manage cycles via any MCP-compatible agent:

| Tool | Purpose |
| :--- | :--- |
| `list_cycles` | View status, spend, and priority of all active fleets. |
| `launch_cycle` | Deploy a new rhythm from a strategic objective. |
| `approve_cycle` | Authorize a staged cycle from your IDE. |
| `pause_cycle` | Emergency halt of an entire autonomous fleet. |

## ⚙️ Background Infrastructure

- **Heartbeat Engine**: A BullMQ repeatable job (`cycle-operations`) runs every minute to evaluate scheduled recurrences.
- **Temporal Resolution**: Automatically calculates the next run date (Daily/Weekly/Monthly) upon iteration trigger.
- **RAG Integration**: Uses `MissionHistoryRAGService` to provide cross-mission context within a single cycle.

## 🛡️ Advanced Governance & Safety

### Strategic Drift Detection (The Sentinel)
The `CycleManagerService` includes an automated **Drift Monitor** that audits agent reasoning against the cycle's objective. 
- **Alignment Scoring**: Uses local SLMs to evaluate if the fleet is "On-Mission."
- **Automatic Pause**: If drift is detected (>40% misalignment), the cycle is automatically paused to prevent resource waste.
- **Forensic Attribution**: All costs are aggregated from the `ai_usage_logs`, ensuring that ROI reporting is based on verified audit trails.

## 🤝 CREW Deliberation Rooms & Live App Surfaces

Operational Cycles integrate with **CREW Rooms** for human-agent council deliberation and live workbench interaction:
- **Dual-Mode Rooms**: Support both persistent Standing Council Rooms and dedicated Stage Ceremony Rooms (e.g. Architecture RFC Review, QA Gate Sign-Off).
- **Embedded App Canvas**: Split-screen in-room micro-frontend iframe rendering live cycle workbenches alongside the chat transcript.
- **Stage Gate Consensus**: Automated gate evaluation against required decisions before advancing cycle stages.
- See full documentation in [CREW_CYCLE_AND_APP_SURFACE_INTEGRATION.md](./CREW_CYCLE_AND_APP_SURFACE_INTEGRATION.md).

---
*Oddjob: Move fast, stay governed.*
