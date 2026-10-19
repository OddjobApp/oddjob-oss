# Research Workbench Functional Specification

> X-Ray scope: `research-workbench`  
> Evidence: `tests/e2e/research-workbench-functional.spec.ts`

## Purpose

The Research Workbench supports a staged research-to-action workflow: ingest evidence, synthesize findings, govern decisions, draft artifacts, curate memory, explore the knowledge graph, and provision follow-up work.

## Functional requirements

| ID | Behavior ID | Requirement | Evidence |
| --- | --- | --- | --- |
| RSH-01 | `research-workbench.workflow.navigate-research-stages` | The hub exposes ingestion, decision, drafting, memory, knowledge-graph, and action-provisioning stages. | Verified |
| RSH-02 | `research-workbench.workflow.execute-review-and-curate` | Ingestion, decision control, draft review, shared memory, and knowledge-graph interfaces are independently routable. | Verified |
| RSH-03 | `research-workbench.workflow.provision-actions` | Research findings can progress to an action/backlog provisioning interface. | Verified |

## Primary flow

```text
Sources -> Ingestion & synthesis -> Decision control -> Draft & review
  -> Shared memory / knowledge graph -> Action & backlog provisioning
```

## Gaps

Navigation is verified. Source ingestion, execution progress, rerun behavior, strategy confirmation, decision submission, artifact persistence, and Jira/mission provisioning require data-backed assertions.
