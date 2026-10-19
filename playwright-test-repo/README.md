# Oddjob UI Contract and Playwright Test Guide

This repository contains Oddjob's executable UI behavior contracts. Playwright tests are indexed into the suite-aware v2 manifest, linked to `UIBehavior` nodes in the system graph, shown in Platform Maintenance documentation, and executed by the change-validation pipeline.

This file is also a bounded work guide for an implementation agent. Complete one behavior at a time and do not broaden the requested change.

## Source of truth

- `tests/suites.json` registers every test suite and its owner, directory, routes, tier, tags, and schedule.
- `tests/**/*.spec.ts` contains active executable UI tests.
- `e2e-tests-index.json` is generated output. Never edit it manually.
- `page-objects/` contains reusable interactions for workflows shared by multiple tests.
- `utils/oddjob-reporter.ts` reports failures to the Oddjob incident pipeline.
- `tests/demos/` contains examples that are excluded from normal indexing and execution.

## Where new tests belong

Find the matching suite in `tests/suites.json`, then create the test beneath that suite's `path`.

Current suite categories include:

- `platform.smoke`: critical availability and primary navigation.
- `health.e2e-testing`: `/health` and `/health/e2e-tests` behavior.
- `platform-maintenance.documentation`: documentation and change-register behavior.
- `sdlc.change-validation`: the change-to-contract-to-test workflow.
- `platform.accessibility`: accessibility checks for critical routes.
- `generated.ui-contracts`: review-gated tests generated from uncovered contracts.

Do not create an unregistered test directory. If no suite is appropriate, add a suite entry first with a stable dotted ID and a unique path.

## Atomic UI behavior contract

Each `test(...)` block must verify one externally observable behavior. Put the stable graph behavior marker and optional tags inside the test body:

```ts
import { test, expect } from "@playwright/test";

test("shows registered E2E suites", async ({ page }) => {
  // @behavior health.e2e-testing.suites-visible
  // @tag health e2e-testing critical

  await page.goto("/health/e2e-tests");
  await expect(
    page.getByRole("heading", { name: "Indexed test suites" }),
  ).toBeVisible();
  await expect(page.getByText("Platform Shell & Navigation")).toBeVisible();
});
```

Rules:

1. Use one observable behavior per test.
2. Use unique, descriptive test names within each file.
3. Prefer accessible roles, names, labels, and stable test IDs.
4. Do not select by CSS styling classes, DOM position, or generated IDs.
5. Assert the user-visible outcome, not internal implementation details.
6. Reuse authenticated state from `tests/auth.setup.ts`; do not embed credentials.
7. Never add intentional failures to an active `*.spec.ts` file.
8. Never use `test.only`, commit `test.skip`, or silently weaken an assertion.

The indexer derives the atomic test ID and source boundaries, assigns the test to its suite by path, and creates the `E2ETest -> VERIFIES -> UIBehavior` relationship from `@behavior`.

## Agent work loop

For each requested UI behavior:

1. Read the relevant implementation and existing tests before editing.
2. Find the owning suite in `tests/suites.json`.
3. Confirm the behavior is observable by a user.
4. Reuse an existing behavior ID from the system graph or documentation. If none exists, create a stable dotted ID describing the domain, feature, and outcome.
5. Add one atomic test under the registered suite path.
6. Run the new test in isolation.
7. Regenerate and validate the v2 manifest.
8. Run TypeScript and the relevant test suite.
9. Report exactly what changed, what passed, and any uncovered behavior. Do not claim success when a command fails.

## Commands

Run commands from the Oddjob repository root unless noted otherwise.

```powershell
# Regenerate the suite-aware v2 manifest
npm run e2e:index

# Validate TypeScript
npm run check -- --pretty false

# Run one Playwright file
Set-Location playwright-test-repo
npx playwright test tests/features/health/example.spec.ts

# Run one atomic test by title
npx playwright test tests/features/health/example.spec.ts --grep "shows registered E2E suites"
```

After indexing, verify that `e2e-tests-index.json` has `schemaVersion: 2`, that the test is assigned to the expected `suiteId`, and that the suite/test/behavior counts increased correctly.

## Definition of done

A test task is complete only when:

- The test is inside a registered suite path.
- It has one stable `@behavior` marker when it represents a graph contract.
- It makes at least one meaningful user-visible assertion.
- The test passes in isolation twice without source changes between runs.
- `npm run e2e:index` succeeds without orphan or duplicate errors.
- `npm run check -- --pretty false` succeeds.
- No credentials, focused tests, skipped tests, or intentional failures were added.
- The agent reports the suite ID, behavior ID, file, test command, and results.

## Automatic authoring gates

Set `E2E_AUTO_AUTHOR_ENABLED=true` on the worker to enable automatic drafting. Keep it `false` when generated changes must be proposed for review.

The repository includes one idempotent, review-gated seed that exercises the real author-and-validate service without enabling global autonomous authoring:

```powershell
npm run e2e:author:seed
```

It creates the low-risk runner-ready-state contract only when that behavior is uncovered, requires the service's two passing validation runs, re-indexes the manifest, and does nothing on later runs once coverage exists.

A generated draft is eligible only when:

1. The behavior confidence is at least `0.85`.
2. The behavior is low risk and requires no clarification.
3. The file stays under the registered `generated.ui-contracts` suite path.
4. It contains one parseable test, one behavior marker, and an observable assertion.
5. It uses no focused/skipped test or disallowed browser operation.
6. It passes two isolated Playwright validation runs.

Failed validation must restore the previous content or remove a newly created file. Medium-risk, high-risk, or ambiguous behaviors remain staging graph nodes for human review.

## Full platform loop

```text
version.commit
  -> compare previous and current UI snapshots
  -> reconcile new or changed UIBehavior contracts
  -> find missing @behavior coverage in the v2 manifest
  -> author or request an atomic Playwright test
  -> run the impacted suite
  -> self-heal test drift or triage a product defect
  -> regenerate Platform Maintenance documentation
  -> add change-register and Pulse lifecycle evidence
```

The documentation is downstream evidence, not the source of test truth. The graph identifies intended behavior, Playwright verifies it, the manifest organizes it, and documentation explains the verified result.

## Agent response template

```text
Suite: <suite id>
Behavior: <behavior id>
Test: <relative spec path> - <test title>
Manifest: regenerated, schema v2
Validation: <commands and pass/fail results>
Documentation impact: <module or UI Spec section to regenerate>
Remaining gap: <none or concise description>
```
