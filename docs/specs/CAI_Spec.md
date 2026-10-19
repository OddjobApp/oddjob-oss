# Constitutional AI and Mission Governance Spec

Status: partially implemented through mission governance, Sentinel audit, approval routing, and policy/governor services. A standalone Python critic and revise-loop planner are not implemented.

Last architecture check: June 30, 2026.

## Trust Boundary

This spec describes the current TypeScript Oddjob implementation. It does not claim a standalone Python critic, a standalone markdown constitution under a Python validation package, or a Python HTN critique-and-revise loop. Constitutional checks live in mission/governor TypeScript services and route risky actions to human approval when required.

## Implemented Components

- `server/domain/mission/utils/constitution.ts` defines the Oddjob constitution identifiers, principles, descriptions, severities, and audit result shape.
- `server/domain/mission/core/mission-governance.service.ts` enforces mission wave limits, mission budget limits, cycle budget limits, cycle token limits, and provides `sentinelAudit`.
- `server/domain/mission/core/orchestration/governance.service.ts` applies per-action governance during orchestration.
- `server/domain/governor/core/decision-router.ts` routes approval decisions to appropriate channels and persists decision state.
- `server/domain/integrations/core/approval.service.ts` creates approval requests used by governance and skill-regression workflows.
- `server/domain/governor/core/governance.service.ts` and `server/domain/governor/core/governance-policy.service.ts` provide broader policy/governance infrastructure.
- `server/domain/mission/core/strategic-sentinel.service.ts` monitors mission drift and can pause cycles when critical drift is detected.

## Current Governance Flow

1. Mission execution creates an orchestration thought with an action and params.
2. `orchestrationGovernanceService.checkRisk` allows known safe tools such as `think_step`, `google_search`, `browse_web`, `update_blackboard`, and `get_blackboard`.
3. If `missionContext.requireApprovalForAll` is set, most actions require approval.
4. For non-safe actions, `MissionGovernanceService.sentinelAudit` asks the configured `compliance_officer` AI model to evaluate the proposed tool call against an embedded system constitution.
5. If Sentinel rejects the action, orchestration requires human approval with the Sentinel rationale.
6. The tool registry is checked for explicit `approvalPolicy.requiresApproval` or `riskLevel === "high"`.
7. `orchestrationGovernanceService.requestApproval` calls `decisionRouter.requestDecision`, which records the decision request and routes it through configured channels.
8. Separately, `MissionGovernanceService.validate` enforces wave, budget, and token guards before continuing a mission run.

## Implementation Status

Implemented:

- Declarative constitution data in TypeScript.
- LLM-backed Sentinel audit for proposed tool calls.
- Human approval escalation for rejected or high-risk actions.
- Safe-tool bypass list for low-risk orchestration actions.
- Mission wave limits.
- Mission and cycle budget guards.
- Cycle token guard.
- Strategic drift monitoring and critical-drift pause behavior.
- Approval service integration for governance events.

Not implemented:

- A single canonical constitution file consumed by all governance paths. `sentinelAudit` currently embeds its own constitution text instead of importing `ODDJOB_CONSTITUTION`.
- Automatic critique-and-revise loop that regenerates a whole plan before execution.
- Formal proof or deterministic policy engine for every constitutional rule.
- Guaranteed fail-closed behavior when the compliance AI is unavailable; current `sentinelAudit` defaults to approval if no compliance officer config exists or if audit execution fails.
- Full alignment between `ODDJOB_CONSTITUTION` IDs and Sentinel audit prompt clauses.

## Drift Cues

Treat this spec as stale if any of these become true:

- `sentinelAudit` stops being called from `orchestrationGovernanceService.checkRisk`.
- The safe tool list changes materially.
- Compliance AI fallback changes from approve-on-unavailable to fail-closed.
- `MissionGovernanceService.validate` no longer owns wave/budget/token guards.
- The embedded Sentinel constitution is replaced by `ODDJOB_CONSTITUTION` or a database-backed policy.
- Decision routing no longer flows through `decisionRouter.requestDecision`.

## Required Improvements

- Use `ODDJOB_CONSTITUTION` as the source for the Sentinel prompt so IDs, severities, and descriptions stay synchronized.
- Return structured violation IDs from `sentinelAudit`, not only free-form rationale.
- Add a configurable fail-open/fail-closed policy per organization and risk tier.
- Persist Sentinel audit results into mission trace for reviewability.
- Add deterministic pre-checks for obviously destructive shell/database operations before invoking an LLM.

## Validation

Current coverage should verify:

- `orchestrationGovernanceService.checkRisk` invokes Sentinel for non-safe tools.
- Rejected Sentinel audits require approval.
- High-risk tool registry entries require approval.
- `MissionGovernanceService.validate` stops runs that exceed wave, budget, or token limits.
- `ODDJOB_CONSTITUTION` remains available and contains severity-bearing principles.
- Spec documentation references only real TypeScript files.
