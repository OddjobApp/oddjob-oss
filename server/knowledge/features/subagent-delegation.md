# Feature Specification: Sub-Agent Delegation (Deadlock & Cycle Guard)

## Overview
**Sub-Agent Delegation** is elevated to **Level 5 (Mature / Autonomous)**. It provides autonomous hierarchical task delegation, topological dependency graph tracking, circular deadlock detection ($O(V+E)$), recursive loop interception, and automated fallback specialist routing.

```
                 ┌───────────────────────────────────────┐
                 │     Task Delegation Request (A ──► B) │
                 └──────────────────┬────────────────────┘
                                    │
                                    ▼
                 ┌───────────────────────────────────────┐
                 │   Delegation Graph Cycle Detector     │
                 │   • DFS Traversal (O(V+E))            │
                 │   • Max Depth Guard (D ≤ 5)           │
                 └──────────────────┬────────────────────┘
                                    │
                         ┌──────────┴──────────┐
                         │ Cycle / Depth OK?   │
                         └──────────┬──────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼ NO                            ▼ YES
     ┌───────────────────────────────┐  ┌───────────────────────────────┐
     │   Deadlock Interception       │  │   Normal Delegation Dispatch  │
     │   • Emit 'delegation:deadlock'│  │   • Register graph edge       │
     │   • Break circular loop       │  │   • Increment task depth      │
     │   • Reroute to fallback       │  │   • Dispatch to Agent B       │
     │     specialist / team lead    │  │                               │
     └───────────────────────────────┘  └───────────────────────────────┘
```

---

## Core Capabilities

### 1. Topological Graph & Cycle Detection
- **DFS Cycle Detection**: `detectDelegationCycle(fromAgentId, toAgentId)` evaluates the directed delegation graph to detect self-delegation, direct 2-hop cycles ($A \rightarrow B \rightarrow A$), and multi-hop circular loops ($A \rightarrow B \rightarrow C \rightarrow A$).
- **Max Delegation Depth Guardrail**: Restricts task delegation depth to $D \le 5$ (`MAX_DELEGATION_DEPTH`) to prevent token-burn cascades.

### 2. Autonomous Loop Breaking & Fallback Reroute
- On deadlock detection, automatically terminates the circular branch, emits a `delegation:deadlock` telemetry event, and reroutes the task to a healthy specialist agent not in the cycle path (`findFallbackSpecialist`).

### 3. Automated Verification
- Verified via [subagent-deadlock-guard.test.ts](../../domain/agents/core/multi-agent/tests/subagent-deadlock-guard.test.ts).
