# Oddjob Copilot Improvement Plan

This plan turns Copilot into the operational front door for Oddjob's governed agentic operations engine.

## Shipped Contract

- `shared/product/oddjob-capability-manifest.ts` now includes `copilotNextActions` for every capability.
- `ODDJOB_COPILOT_GUIDE` defines guided flows, safe command intents, trust questions, default ontology object types, risk levels, and suggested tool names.
- `GET /api/system/copilot-guide` exposes a lightweight UI/API contract for Copilot surfaces.
- `GET /api/system/copilot-guide/export` exports the current Copilot safety/command contract as JSON.
- `get_oddjob_copilot_guide` exposes the same guidance as an agent tool.
- Mission creation renders the guide and can seed a guided prompt.
- Mission chat renders safe command/trust-question prompts and injects the guide into server-side Mission Control replies.
- `GET /api/mission-runs/:id/audit-bundle` exports a redacted-by-default mission-run audit bundle with evidence timeline, approval/action summary, replayability markers, and trust-review questions.
- Mission detail exposes an Audit Bundle action when a mission run exists.
- `npm run smoke:capabilities` validates Copilot guide IDs, guided-flow references, command risk consistency, and trust-question requirements.

## Product Priorities

1. **Ontology-aware Copilot**
   - Use `ontology_list_object_types` before answering operational state questions.
   - Prefer `Mission`, `Job`, `Pipeline`, and `Dataset` objects for real state inspection.
   - Route writes through `ontology_execute_action` so approval and audit behavior stay consistent.

2. **Guided first mission**
   - Start with one canonical guided flow: `governed-support-triage`.
   - Let Copilot check setup, attach knowledge, propose the mission, and identify the first approval checkpoint.
   - Keep prediction intelligence out of the first-run path until trust is established.

3. **Unified explainability**
   - Every Copilot recommendation should be able to answer:
     - Why this action?
     - What changes if approved?
     - What sources were used?
     - Can this be replayed or audited?

4. **Safe command palette**
   - Render `copilotGuide.commands` as UI actions.
   - Show risk level, approval requirement, affected pillar, and suggested tools before execution.
   - Treat high-risk commands as review-first, never fire-and-forget.

5. **Recurring work to Forge**
   - Detect repeated mission patterns and suggest `forge-recurring-work`.
   - Use `forge_trigger`, `forge_validate_workspace`, and `diagnose_forge_job` as the operational path.
   - Require explicit approval before publish or external deployment.

6. **Knowledge confidence**
   - Show source names, recency, confidence, contradictions, and gaps before acting on retrieved knowledge.
   - Use `search_knowledge_base`, `search_documents`, and ontology context together.

## Next Implementation Slices

1. Add a Copilot analytics dashboard using the command analytics endpoint.
2. Surface knowledge-source review controls beside retrieved citations in every Copilot experience.
3. Alert administrators when source calibration error or high-risk command usage crosses an agreed threshold.

## Contract Verification

- Canonical guided prompts live with their demos in `shared/product/oddjob-capability-manifest.ts`; mission creation does not maintain a separate prompt map.
- Mission Control replies are scheduled only for `active`, `paused`, `waiting_on_file`, and `waiting_on_human` runs. Messages for missions without a live run are still saved to the blackboard but do not claim an AI reply was scheduled.
- Mission chat validates non-empty messages and caps input at 10,000 characters.
- Focused contract tests verify guided-flow prompt coverage, guide injection, trust questions, and eligible run states.
- Mission-run audit bundles use schema v2 and include ontology actions linked by `missionRunId`, with action name, effect, risk, approval, actor, status, and redacted-by-default parameters/results.
- Copilot command selections are persisted with command, surface, risk, approval requirement, mission, and run context; `/api/system/copilot-guide/commands/analytics` aggregates usage by command and surface.
- Knowledge-source review outcomes (`relevant`, `partially_relevant`, or `irrelevant`) are persisted and exposed through source-review and calibrated-confidence endpoints. Calibration is evidence-weighted and reports sample size and mean absolute error.
