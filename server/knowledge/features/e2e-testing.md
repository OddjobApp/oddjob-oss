# E2E Testing, Incident Reporting, & Self-Healing Feature

## Overview
Oddjob integrates automated Playwright End-to-End (E2E) testing with the platform's autonomous Bug Triage, change impact triggers, and self-healing verification loops. E2E tests run automatically upon application version commits, and any failures are reported as incidents, spawning autonomous triage cycles, real-time Copilot alerts, and optional self-healing code patch runs.

---

## Architecture Flow

```
                     [app-versioning.service.ts] (version.commit event)
                                   │
                                   ▼
                      [e2e-trigger-listener.service.ts]
                                   │ (Maps change & spawns runner)
                                   ▼
[Playwright Runner] ──► (Seeded Non-Superadmin state)
       │
       ▼
 [Test Fails] ──► [Oddjob Reporter] ──► (POST with ODDJOB_API_TOKEN)
       │                                         │
       ▼                                         ▼
[Test Loop Controller]                 [REST API /datasets]
 (Self-Healing Loop)                             │
       │                                         ▼
       ├─► [AiFailureDiagnoser]        [Dataset 71: Identified Bugs]
       │    (Gemini triage + spec                │
       │     atomic block lookup)                ▼
       │                               [Bug Triage YAML Cycle Launched]
       ├─► [AiFixGenerator]                      │
       │    (Surgical block repair)              ▼
       │                               [Copilot SSE Event Stream]
       ▼                                         │
[Indexer Assembly Engine]                        ▼
 (Saves updated block to disk)         [Copilot Toast Notifications]
```

---

## 1. Playwright Test Suite (`playwright-test-repo/`)
Automated E2E tests are housed in a decoupled repository directory to isolate dependencies and configuration.

- **`playwright.config.ts`**: Configures multi-browser runs and hooks the custom Oddjob reporter.
- **`utils/oddjob-reporter.ts`**: Intercepts Playwright test results. If a test fails, it makes a POST request to `/api/datasets/71/items` with the failure details.
- **`tests/auth.setup.ts`**: Handles authentication before testing by using a seeded, non-superadmin standard test user to verify user-facing permissions and security boundaries.

---

## 2. Autonomous Incident Pipeline (`item-service.ts`)
The item service interceptor handles incoming defect insertions into Dataset 71 ("Identified Bugs"):
1. Parses the test failure payload and extracts the bug summary and error logs.
2. Dynamically loads the `bug-triage.cycle.yaml` blueprint.
3. Invokes `CycleManagerService.launchCycle()` to spawn an active **Bug Triage & Classification** workflow in the system.
4. Publishes an `intervention.triggered` event to the Redis and SSE event streams.

---

## 3. E2E Change Registry & Impact Triggers (`e2e-trigger-listener.service.ts`)
The E2E trigger listener service hooks into the version commit flow:
- Subscribes to `version.commit` events published via the Redis Event Stream.
- Performs impact analysis to map changed file paths (e.g. `AppSidebar.tsx`) to E2E spec files.
- Asynchronously spawns the Playwright runner to execute affected tests in the background worker fleet.

---

## 4. Self-Healing E2E Test Loop (`test-loop-controller.service.ts`)
When E2E tests fail, the platform orchestrates a self-healing iteration:
- **`PlaywrightRunner`**: Executes atomic tests using Playwright's grep filters (`-g "test name"`).
- **`AiFailureDiagnoser`**: Contacts Gemini to analyze error logs, stack traces, and the failing code block to explain the root cause and identify the correct file to repair.
- **`AiFixGenerator`**: Requests targeted code corrections from Gemini for the specific failure.

---

## 5. Atomic Test Indexer & Assembly Engine (`e2e-test-indexer.service.ts`)
To prevent risky whole-file rewrites during self-healing:
- **Test Block Parser**: Parses spec files into atomic `test(...)` blocks mapped to unique ID slugs (e.g., `dashboard:should_load_the_dashboard_and_display_sidebar_links`).
- **Context Injection**: Feeds only the isolated failing test block into the AI failure diagnoser and fix generator prompt.
- **Surgical Assembly Engine**: Delegates patching to `assembleSpecContent`, which replaces only the targeted code block by ID before saving the spec file back to disk.

---

## Configuration & Environment Variables

| Variable | Location | Purpose |
|----------|----------|---------|
| `ODDJOB_API_TOKEN` | `.env` | Primary API token used by the reporter to authenticate POST calls. |
| `INTERNAL_API_SECRET` | `.env` | Local development fallback API token for the reporter. |
| `ODDJOB_URL` | `playwright-test-repo/.env` | Target instance host URL (e.g., `http://localhost:5000`). |
| `GIT_WORKSPACE_ROOT` | `.env` | Base path of the repository workspace used by command runners. |
