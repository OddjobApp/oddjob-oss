# Oddjob Mission Execution Specification

**Version:** 1.0.0  
**Status:** Draft  
**Last updated:** 2026-05-20

---

## 1. Introduction

This document and its sub-specifications define the normative contracts for Oddjob's mission execution system. They describe the interfaces, state machines, and protocols that any conformant implementation MUST honour, independent of language or runtime.

These specs serve three purposes:

1. **Onboarding** — a single authoritative reference for engineers and AI agents working on the platform
2. **Portability** — a basis for generating conformant implementations in alternative runtimes
3. **Conformance testing** — each normative assertion maps to a test assertion in `tests/spec-conformance/`

---

## 2. Normative Language

The key words **MUST**, **MUST NOT**, **SHALL**, **SHALL NOT**, **SHOULD**, **SHOULD NOT**, **MAY** are used as defined in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

Normative sections are marked with **[NORMATIVE]**. Informative sections are marked with **[INFORMATIVE]**.

---

## 3. Glossary

| Term | Definition |
|---|---|
| **Mission** | A durable, goal-directed unit of work with a named objective, budget, and execution strategy. Persisted in `missions` table. |
| **Mission Run** | A single execution attempt of a Mission. Carries its own status, blackboard, dynamic trace, and missionContext. Persisted in `missionRuns` table. |
| **Blackboard** | The shared, append-only state store for a Mission (on `missions.blackboard`). Written by action handlers; read by the orchestration thinking layer. |
| **MissionContext** | Run-scoped orchestration state on `missionRuns.missionContext`. Holds `cycleCount`, `maxCycles`, `allowedTools`, `rulesOfEngagement`, and temporary orchestration data. |
| **Dynamic Trace** | An append-only event log on `missionRuns.dynamicTrace`. Every orchestration event is appended here. |
| **Execution Strategy** | The named orchestration model for a Mission: `pre_planned`, `dynamic_autonomous`, or `rolling_wave`. |
| **Cycle** | One iteration of the `dynamic_autonomous` OODA loop. |
| **Wave** | One iteration of the `rolling_wave` phase sequence. |
| **Action Handler** | A named, typed handler that executes an AI-decided action (e.g., `CALL_TOOL`, `CONCLUDE`). |
| **HIL** | Human-in-the-Loop. Any point where the orchestrator suspends to await human input or approval. |
| **Resume Condition** | A typed predicate on `missionRuns.resumeCondition` that, when satisfied, re-activates a `waiting_on_human` or `waiting_on_file` run. |
| **Loopbane Protocol** | One of three safety mechanisms (A: cycle count, B: stagnation, C: TTL) that abort pipeline execution on detected loops. |
| **Governance Tier** | A named approval-strictness profile (`strict`, `standard`, `relaxed`) applied to tool calls. |
| **SAFE_TOOLS** | A fixed set of tool names that bypass sentinel audit: `think_step`, `google_search`, `browse_web`. |
| **Sentinel Audit** | A policy check performed by `MissionGovernanceService.sentinelAudit` before any non-safe tool action. |

---

## 4. Sub-Specifications

| Document | Scope |
|---|---|
| [mission-execution.md](./mission-execution.md) | Mission run lifecycle, state machine, blackboard contract, HIL, resume conditions |
| [orchestration-strategies.md](./orchestration-strategies.md) | `pre_planned`, `dynamic_autonomous`, `rolling_wave` execution contracts |
| [action-protocol.md](./action-protocol.md) | All 10 named action handlers — input schema, blackboard writes, trace emissions, HIL gates |
| [agent-governance.md](./agent-governance.md) | Budget hierarchy, governance tiers, tool approval protocol, credential scoping |
| [pipeline-execution.md](./pipeline-execution.md) | Deterministic step runner, variable resolution, Loopbane Protocols A/B/C |

---

## 5. Conformance

See [conformance/CONFORMANCE.md](./conformance/CONFORMANCE.md) for numbered assertions and test harness requirements.

A conformant implementation MUST pass all `MUST`-level assertions at the applicable conformance level.

---

## 6. Implementation Notes

Where this specification describes a clean model that differs from the current TypeScript implementation, the difference is flagged with an **Implementation Note** callout in the relevant sub-document.

These notes document known drift that SHOULD be resolved to achieve full conformance. They are not blockers for conformance testing at Level 1 or Level 2.
