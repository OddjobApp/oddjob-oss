# Skill Discovery and Evolution Spec

Status: partially implemented through trace-based skill synthesis, AI-generated evolution proposals, shadow-run promotion, and rollback. Automated clustering of successful trajectories into HTN methods is not implemented.

Last architecture check: June 30, 2026.

## Trust Boundary

This spec describes the TypeScript implementation that exists today. It does not claim a Python distillation pipeline, procedural-memory subsystem, DBSCAN clustering pipeline, or dynamic HTN method loader. Those ideas are historical proposal language and are not part of the current Oddjob codebase.

## Implemented Components

- `server/domain/mission/core/skill-synthesis.service.ts` creates a private JavaScript skill from a completed mission run's successful tool-call trace.
- `server/domain/mission/core/skill-generator.service.ts` generates an evolution proposal for an existing skill using failure logs and retrieved TrustGraph evidence.
- `server/domain/mission/core/skill-promotion.service.ts` promotes approved shadow-run improvements into the live `skills` row, snapshots version history, supports rollback, and watches for post-promotion regressions.
- `server/domain/mission/core/sentinel-service.ts` identifies poor-performing skills from forensic execution logs.
- `server/domain/mission/core/synthesis/knowledge-capturer.ts` records synthesis learnings into institutional memory.
- `server/domain/admin/ui/modules/admin/pages/SkillRegistry.tsx` provides the administrative UI surface for skill inventory and metadata.

## Current Data Flow

### Skill Synthesis From Mission Runs

1. `skillSynthesisService.synthesizeSkillFromMission` loads a `missionRuns` row.
2. It requires `run.status === "completed"` and at least one trace event with `tool_called` or `tool_executed`.
3. It truncates the trace to the latest 50 entries to control prompt size.
4. `systemAiService.generateJson` asks the configured architect model to produce a JavaScript skill with `name`, `description`, `language`, and `code`.
5. The service sanitizes the generated name, appends a UUID suffix, stores the skill as non-public, and records metadata including `synthesizedFromRunId`, trace length, and tools used.

### Skill Evolution From Failures

1. `SentinelService` can identify skill IDs with poor reliability from forensic execution logs.
2. `skillGeneratorService.generateProporsal` loads the current skill, retrieves optional graph context through `EvidenceStorageService`, and asks the configured AI provider for a JSON improvement proposal.
3. The proposal can include a strategy description, mission-context patch, recommended model, new version marker, and optional JavaScript code.
4. Shadow-run metadata carries proposed code or metadata patches.
5. `skillPromotionService.promoteToSkill` snapshots the pre-promotion skill, updates the live skill, and writes a post-promotion version-history row.
6. `skillPromotionService.checkForRegressions` compares skill reliability before and after promotion, rolls back when reliability drops past threshold, and creates a Decision Inbox approval request for review.

## Implementation Status

Implemented:

- AI-generated skill synthesis from successful mission traces.
- Private-by-default generated skills.
- AI-generated evolution proposals from failure logs and graph evidence.
- Durable skill version history before and after promotion.
- Rollback of promoted skills.
- Watchdog-style regression detection after promotions.
- Human review path through approval requests when regression rollback occurs.

Not implemented:

- Automated clustering of successful trajectories.
- Longest-common-subsequence abstraction over repeated traces.
- Automatic conversion of discovered patterns into HTN methods.
- Dynamic HTN planner loading from procedural memory.
- A persisted procedural-memory service separate from the `skills` table.
- Static sandbox validation that generated code is safe before insertion; current code relies on private visibility and downstream review/promotion.

## Drift Cues

Treat this spec as stale if any of these become true:

- `skillSynthesisService` no longer writes generated skills to `skills`.
- Generated skills become public by default.
- Promotion no longer writes `skillVersionHistory`.
- Regression checks no longer call `rollbackSkill` or create approval requests.
- Skill discovery gains a real clustering/mining implementation.
- Skill execution telemetry moves away from forensic logs used by `SentinelService`.

## Safety Requirements

- Generated skills must remain private until reviewed or explicitly promoted.
- Promotion must preserve a rollback point before writing live skill code.
- Evolution proposals must be stored as proposed changes before becoming live changes.
- Regression detection must use organization-scoped telemetry when available.
- Code-generation prompts must keep the required runtime contract explicit: the JavaScript skill writes its final output to global `result`.

## Validation

Current coverage should verify:

- `skillSynthesisService.synthesizeSkillFromMission` rejects non-completed runs and traces with no tool calls.
- Generated skills are inserted with `isPublic: false`.
- `skillPromotionService.promoteToSkill` creates pre- and post-promotion history rows.
- `skillPromotionService.rollbackSkill` restores prior code and metadata.
- Spec documentation references only real TypeScript files.
