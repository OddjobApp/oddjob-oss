# Blueprint app maturity

App Forge builds apps from the blueprints in `server/blueprints/apps/`. Each one in
the App Forge gallery carries a maturity label, so you know how far to rely on it.
The labels come from `BLUEPRINT_MATURITY` in
`server/domain/apps/core/forge-blueprint.service.ts`, and
`forge-blueprint-catalog.test.ts` checks that they still match the evidence.

| Label | Means |
|---|---|
| **Stable** | Used by a cycle, so the blueprint contract test (`blueprint-crew-contract.test.ts`) gates it, and covered by its own tests. |
| **Beta** | Used by a cycle and gated by the contract test, without dedicated tests yet. |
| **Experimental** | Not used by any cycle: a starter template, demo or early build. Expect gaps. |

## Current labels

| Blueprint | Maturity |
|---|---|
| rescue-dispatch | Stable |
| sdlc-workbench | Stable |
| wayfare | Stable |
| agent-training-workbench | Beta |
| ai-workforce-dashboard | Beta |
| budgetmaster-advisor | Beta |
| budgetmaster-workbench | Beta |
| codegen-pipeline-workbench | Beta |
| it-ticketing-portal | Beta |
| location-search | Beta |
| ops-workbench | Beta |
| pm-workbench | Beta |
| product-launch-workbench | Beta |
| qa-workbench | Beta |
| research-workbench | Beta |
| sales-opportunity-workbench | Beta |
| scrum-master-workbench | Beta |
| stakeholder-workbench | Beta |
| support-agent-dashboard | Beta |
| analytics-dashboard | Experimental |
| api | Experimental |
| chat-assistant | Experimental |
| chat-assistant-v2 | Experimental |
| compliance-sentinel | Experimental |
| crud-app | Experimental |
| devops-workbench | Experimental |
| go-backend | Experimental |
| industrial-dashboard | Experimental |
| java-backend | Experimental |
| mission-supervisor | Experimental |
| pwa | Experimental |
| python-backend | Experimental |
| react-native | Experimental |
| spa | Experimental |

`go-backend`, `java-backend`, `python-backend`, `spa`, `pwa`, `react-native`, `api`
and `crud-app` are starter templates: small by design, and experimental because no
cycle exercises them, not because they are unfinished.

## Promoting a blueprint

- **To beta:** use it in a cycle (`blueprint:` or an app `id` in
  `server/cycles/*.cycle.yaml`), so the contract test covers it, then add it to
  `BLUEPRINT_MATURITY`.
- **To stable:** add tests that exercise the app itself, beside it or under
  `tests/`, then change its label.
