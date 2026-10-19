# SDLC Pipeline Feature

## Overview
The SDLC Pipeline is Oddjob's autonomous code-generation engine: a contract-governed, phase-based pipeline that takes a natural-language objective and a target repository and produces a verified pull request. It runs as a cycle blueprint on top of the platform's pipeline orchestrator, so every phase is a first-class artifact producer whose output is schema-validated before the next phase is allowed to start. The design goal is trustworthy autonomy — code is written, verified, and self-healed by the pipeline, but each hand-off is gated by an explicit artifact contract and a final quality gate.

## Architecture

The module splits into two layers:

- **`core/`** — pipeline infrastructure that is not specific to codegen: the pipeline orchestrator, artifact registry, artifact contract validator, session lifecycle manager, cost roll-up aggregator, and pipeline-graph validator.
- **`autonomous/`** — the code-generation pipeline proper: six phase services, their JSON-Schema artifact contracts, and the phase handlers that glue the services to the orchestrator.

The orchestrator drives phases; each phase runs a **handler** (`autonomous/phase-handlers.ts`) that:
1. Reads upstream artifacts via `artifactRegistryService.buildPhaseContext()`,
2. Invokes the phase's service,
3. Persists the output artifact,
4. Returns success/failure and timing.

Artifacts are addressed as `"<phase>.<artifactName>"` (e.g. `context_load.repository_context`), which is how a downstream phase reads what an upstream phase produced.

## The Six Phases

Each phase emits exactly one artifact, validated against its contract (`autonomous/contracts.ts`) before advancement.

| # | Phase | Service | Output artifact | What it does |
|---|-------|---------|-----------------|--------------|
| 1 | `context_load` | Repository Context Loader | `repository_context` | Analyzes the target repo — project structure, dependency graph, detected conventions, language/framework metadata, and the ranked set of relevant files (with a token count against the budget). |
| 2 | `change_plan` | Change Planner | `edit_plan` | Turns the objective + repository context into an ordered set of file operations (`create`/`modify`/`delete`), each with a rationale, dependency order, and a `requiresHumanReview` flag. |
| 3 | `apply_edits` | Incremental Verifier | `verification_report` | Applies each operation and verifies it incrementally at the configured level, accumulating a timeline and a pass/fail summary (`all_passed` / `has_failures` / `in_progress`). |
| 4 | `test_loop` | Test Loop Controller | `test_loop_result` | Runs the self-healing test loop against affected test files: diagnose → fix → re-run, up to `maxFixAttempts`, watching for regressions. Status is `all_passed`, `partially_fixed`, `exhausted`, or `escalated`. |
| 5 | `quality_gate` | Quality Gate | `gate_result` | Evaluates all checks and produces a single `passed` boolean plus any `blockingFailures`. This is the go/no-go gate for shipping. |
| 6 | `pr_generation` | PR Generator | `pr_result` | Creates a branch, commits, and opens a PR — embedding test evidence (total/passing tests, fix attempts, verification timeline) in the description. |

### Phase data flow

```
[objective + repo]
      │
      ▼
context_load ──► repository_context
      │
      ▼
change_plan ───► edit_plan ──────────────────────────┐
      │                                               │
      ▼                                               │
apply_edits ───► verification_report ─────────────┐   │
      │                                           │   │
      ▼                                           │   │
test_loop ─────► test_loop_result                 │   │
      │                                           │   │
      ▼                                           │   │
quality_gate ──► gate_result  (go / no-go)        │   │
      │                                           │   │
      ▼                                           ▼   ▼
pr_generation ─► pr_result  (reads edit_plan + verification_report + conventions)
```

## Artifact Contracts

Contracts are JSON Schema 7 documents (schema version `2025-01-01`) declared in `autonomous/contracts.ts` and enforced by `artifactContractValidator`. The phase → contract map:

| Phase | Contract | Key required fields |
|-------|----------|---------------------|
| `context_load` | `repositoryContextContract` | `projectStructure`, `dependencyGraph`, `conventions`, `languageMetadata`, `relevantFiles`, `tokenCount` |
| `change_plan` | `editPlanContract` | `objective`, `operations`, `dependencyOrder`, `totalFileCount`, `requiresHumanReview` |
| `apply_edits` | `verificationReportContract` | `verificationLevel`, `timeline`, `summary`, `finalStatus` |
| `test_loop` | `testLoopResultContract` | `status`, `totalAttempts`, `fixAttempts`, `passingTests`, `failingTests`, `duration` |
| `quality_gate` | `gateResultContract` | `passed`, `evaluatedAt`, `checks`, `blockingFailures` |
| `pr_generation` | `prResultContract` | `branchName`, `commitSha`, `prUrl`, `prNumber`, `description`, `testEvidence` |

`registerAutonomousContracts()` returns these in the `{ output_contract }` shape a cycle blueprint expects, and `registerAutonomousPhaseHandlers()` returns the phase→handler map used when wiring the phases into the Cycle Manager.

## Configuration

A session is parameterized by `AutonomousCodegenConfig` (`core/types.ts`):

| Field | Default | Purpose |
|-------|---------|---------|
| `verificationLevel` | — | Depth of verification per step: `none`, `lint_only`, `type_check`, or `full_test`. |
| `maxFixAttempts` | `5` | Cap on self-healing fix iterations in the test loop. |
| `maxFileCount` | `50` | Upper bound on files the change plan may touch. |
| `contextTokenBudget` | `100_000` | Token budget for the loaded repository context. |
| `dependencyTraceDepth` | `3` | How deep to trace affected files when scoping verification. |
| `repository` | — | `{ url?, workspacePath?, branch?, credentials? }` — remote or local target, branch (default `main`), and a credential reference. |
| `prTemplate` | detected | PR body template (auto-detected from the repo if not set). |
| `branchNamingPattern` | — | e.g. `codegen/{session-id}/{objective-slug}`. |

The config is stored on the session under `SessionMetadataExtension.autonomous_config` (with `pipeline_mode: "code_generation"`), alongside running metrics such as `fixAttempts`.

## Verification Levels

The `verificationLevel` knob trades speed for confidence and is threaded through both `apply_edits` and the verification report:

| Level | Runs |
|-------|------|
| `none` | No verification (fastest; planning/dry-run use). |
| `lint_only` | Lint checks only. |
| `type_check` | Lint + type checking. |
| `full_test` | Lint + types + the affected test suite. |

## Self-Healing Test Loop

The `test_loop` phase is the pipeline's resilience mechanism. For each failing test it records a structured `fixAttempt`: a `diagnosis` (test file, error, root cause, affected file, suggested approach), the `appliedFix`, and an `outcome` (`resolved`, `failed`, `regression_detected`, or `reverted`), plus any `newFailuresIntroduced`. The loop stops when tests pass, when a fix budget (`maxFixAttempts`) is exhausted, or when it escalates. A `regression_detected`/`reverted` outcome is how the loop avoids trading one failure for another.

## Human Oversight

Autonomy is bounded, not unsupervised:
- The change plan carries an explicit `requiresHumanReview` flag.
- The `quality_gate` phase is a hard go/no-go — `pr_generation` only runs on a passing gate, and blocking failures are surfaced with reasons.
- The final PR is a review surface, not an auto-merge: `pr_result` opens a PR with embedded test evidence for a human to approve.

## User Help Scenarios

| Scenario | Response |
|----------|----------|
| A codegen session stalled | Identify the current phase and read its output artifact; a missing-upstream-artifact error means the previous phase didn't persist its output. |
| PR was never opened | Check `gate_result.passed` — `pr_generation` is skipped when the quality gate fails; inspect `blockingFailures`. |
| Tests keep failing | Review `test_loop_result.fixAttempts` for `exhausted`/`escalated` status or `regression_detected` outcomes; consider raising `maxFixAttempts` or the verification level. |
| Plan touches too many files | Lower `maxFileCount`, or tighten the objective so the Change Planner scopes fewer operations. |
| Context looks incomplete | Check `repository_context.tokenCount` against `contextTokenBudget` and the `relevantFiles` relevance scores. |
