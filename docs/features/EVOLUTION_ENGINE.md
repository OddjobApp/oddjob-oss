# Evolution Engine (System Evolution / Flight Deck)

**Route:** `/platform-maintenance/evolution` · **API:** `/api/evolution/*` · **UI:** `EvolutionFlightDeck.tsx`

The Evolution Engine turns observed reliability problems into **reviewable, reversible code improvements** for the skills that power the platform. It is a human-in-the-loop (HIL) loop — the system proposes, a human approves, and every change is snapshotted for rollback.

## The loop

1. **Detect.** `SentinelService.getEvolutionCandidatesForOrg(orgId, 75)` reads forensic telemetry and flags skills running below the **75% reliability** threshold. "Sync Neural Core" (`POST /api/evolution/trigger-sync`) runs this scan on demand.
2. **Generate.** For each candidate that resolves to a `skills` row with real `code`, the `codegen` model (`systemAiService.generateText`, Gemini-first) rewrites `skills.code` to improve reliability — input validation, null/undefined guards, error handling with retry/fallback, guaranteed outputs — while **preserving the exported signature and behavioral contract**. The result is recorded as a pending fix with a **real diff** (`oldContent` = current code).
3. **Review.** The Flight Deck lists pending fixes. **Inspect Diff** (`GET /api/evolution/diff/:id`) shows the before/after. Findings with no generated patch are badged **"Detection Only"** and cannot be approved (they need manual remediation).
4. **Approve.** `POST /api/evolution/approve/:id` promotes a skill-backed fix via `SkillPromotionService.applyDirectCodeChange`: it snapshots the current code to `skill_version_history`, updates the live `skills` row, then snapshots the new version. (File-backed fixes instead apply on an isolated `evolution/fix-*` git branch.)
5. **Guard.** `SkillPromotionService.checkForRegressions` compares pre/post-promotion reliability and **auto-rolls-back** (and raises a Decision Inbox approval) if a promoted skill regresses. Manual rollback is available via `rollbackSkill`.

## What it edits

Skill-backed evolutions modify the **`skills.code` database column**, not source files. Every change writes `skill_version_history` rows (`pre_promotion_snapshot` → `evolution_promotion`), so rollback always has a target.

## Safety properties

- **No blind application.** AI output is never auto-applied; a human inspects the diff and approves.
- **Rollback-safe.** Pre- and post-change snapshots; one-click rollback; regression watchdog auto-reverts drops ≥ 15 pts.
- **Deduplicated.** `SelfHealingHandler.proposeFix` skips a target that already has a pending proposal, so repeated scans don't stack identical cards.
- **No empty patches.** Detection-only findings (advisory) are refused by both the apply path and the UI, so a finding can never blank a target.
- **Scoped git.** File-backed applies stage only the patched file (never `git add .`) and return you to your original branch.

## Key files

| Concern | Location |
| --- | --- |
| UI | `server/domain/admin/ui/modules/admin/pages/EvolutionFlightDeck.tsx` |
| Routes | `server/domain/evolution/routes/evolution.route.ts` |
| Orchestration + code-gen | `server/domain/evolution/core/evolution.service.ts` |
| Pending fixes / file apply | `server/domain/evolution/infrastructure/self-healing.handler.ts` |
| Durable skill promotion + rollback | `server/domain/mission/core/skill-promotion.service.ts` |
| Candidate detection | `server/domain/mission/core/sentinel-service.ts` |

## Limitations

- Only candidates that map to a `skills` row with real code get an AI patch; others are advisory (detection-only).
- Code generation depends on a configured `codegen` model/API key; without one, findings fall back to advisory.

## Related documentation

- [Transference Engine](./TRANSFERENCE_ENGINE.md) — complementary loop that replaces predictable cloud LLM calls with local Python handlers after shadow validation
- [Worker Architecture](../feature-documentation/core-features/06-worker-architecture.md) — background worker deployment
