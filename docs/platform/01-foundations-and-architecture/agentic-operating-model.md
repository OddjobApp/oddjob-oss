---
id: agentic-operating-model
title: The Oddjob Agentic Operating Model & Autonomy Tiers (L0-L4)
audience: [HUMAN_PRIMARY, HYBRID]
badge: HYBRID
category: 01-foundations-and-architecture
autonomy_level: L0-L4
version: 1.0.0
tags: [operating-model, autonomy-tiers, delegation, governance, co-pilot, human-in-the-loop]
summary: The 5-tier autonomy framework (L0 Manual through L4 Full Swarm Autonomy), delegation handoff protocols, and hybrid human-agent collaboration contracts.
---

# The Agentic Operating Model & Autonomy Tiers `[🤝 HYBRID]`

> **Audience:** `🤝 Hybrid: Builder + Agent` &nbsp;|&nbsp; **Classification:** Platform Architecture

---

## 1. The 5 Autonomy Levels (L0 to L4) `[🧑 Human]`

Oddjob enforces clear operational boundaries based on task risk and model certainty:

```mermaid
graph LR
    L0["L0: Manual Execution<br/>(Deterministic Code / Human CLI)"]
    L1["L1: Agent Assisted<br/>(Read-only suggestions, Search, Summaries)"]
    L2["L2: Supervised Co-Pilot<br/>(Agent proposes action -> Human explicitly signs off)"]
    L3["L3: Conditional Autonomy<br/>(Agent executes autonomously -> Escalates on low confidence)"]
    L4["L4: Full Autonomous Swarm<br/>(Self-healing loops, Swarm consensus, Post-facto audit)"]

    L0 --> L1 --> L2 --> L3 --> L4
```

| Autonomy Tier | Description | Execution Permission | HIL Review Requirement |
| :--- | :--- | :--- | :--- |
| **L0 (Manual)** | Deterministic SQL/Code | Direct user trigger | None (Human directly operates) |
| **L1 (Assisted)** | Read-only analysis & search | Read tools only | No mutations permitted |
| **L2 (Supervised)** | Guided mutation proposals | Prepared mutation draft | **100% Pre-Execution Signoff Required** |
| **L3 (Conditional)** | Autonomous with risk guardrails | Direct bounded mutation | **Escalates when confidence < 0.85 or spend limit reached** |
| **L4 (Full Swarm)** | Multi-agent autonomous loops | Full bounded toolset | **Post-execution audit log & anomaly alerting** |

---

## 2. Delegation & Subagent Handoff Protocol `[🤖 Agent]`

When a primary Mission agent delegates a sub-task to a specialized worker subagent:
1. **Pass Traceparent:** Forward the current W3C `traceparent` so child spans nest under the root mission.
2. **Quota Bounding:** Specify a strict maximum step count (default: 10 steps) and token allocation (default: 50,000 tokens).
3. **Deterministic Output Requirement:** The subagent must return a validated JSON object conforming to the parent's requested schema.
