# Agent Training Workbench Functional Specification

> X-Ray scope: `agent-training-workbench`  
> Evidence: `tests/e2e/agent-training-workbench-functional.spec.ts`

## Purpose

The Agent Training Workbench governs improvement of AI agents through corpus management, simulation, evaluation, failure analysis, human sign-off, and controlled promotion.

## Functional requirements

| ID | Behavior ID | Requirement | Evidence |
| --- | --- | --- | --- |
| TRN-01 | `agent-training-workbench.lifecycle.navigate-training-stages` | The hub exposes evaluation, failure analysis, sign-off, corpus, promotion, and simulation stages. | Verified |
| TRN-02 | `agent-training-workbench.lifecycle.evaluate-and-analyze` | Corpus, simulation, evaluation, and failure-analysis interfaces are routable as a coherent improvement loop. | Verified |
| TRN-03 | `agent-training-workbench.governance.sign-off-and-promote` | Training sign-off and promotion are explicit, separate governance surfaces. | Verified |

## Primary flow

```text
Corpus -> Simulation -> Evaluation -> Failure analysis
  -> Training sign-off -> Promotion gate -> Monitored rollout
```

## Gaps

The suite does not yet add corpus items, run a simulation/evaluation, classify a failure, submit sign-off, enforce promotion thresholds, or verify rollback and rollout-health behavior.
