# Sales Opportunity Workbench Functional Specification

> X-Ray scope: `sales-opportunity-workbench`  
> Evidence: `tests/e2e/sales-opportunity-workbench-functional.spec.ts`

## Purpose

The Sales Opportunity Workbench provides an advisory revenue cockpit for opportunity progression, forecasting, risk review, AI guidance, and deal coaching. Deal closure remains subject to a human gate.

## Functional requirements

| ID | Behavior ID | Requirement | Evidence |
| --- | --- | --- | --- |
| SLS-01 | `sales-opportunity-workbench.pipeline.navigate-revenue-surfaces` | The hub exposes pipeline, opportunity register, forecast, risk, advisor, and deal-coach surfaces and declares that deals never close automatically. | Verified |
| SLS-02 | `sales-opportunity-workbench.pipeline.inspect-and-forecast` | Users can navigate among the pipeline, opportunities, forecast, deal-risk, and advisor views. | Verified |
| SLS-03 | `sales-opportunity-workbench.coaching.open-deal-coach` | Autonomous deal coaching is available as a distinct workflow without replacing the human close gate. | Verified for availability |

## Governing rule

AI recommendations, probability decay, alerts, and coaching are advisory. A human decision gate owns deal closure.

## Gaps

The suite does not yet create or move an opportunity, verify forecast calculations, exercise decay/re-engagement rules, submit a HIL decision, or validate coaching output against source communications.
