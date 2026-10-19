---
id: pipeline-and-mission-assembly
title: DAG Pipeline Assembly, Step Variable Interpolation & Mission Orchestration
audience: [HUMAN_PRIMARY, AGENT_PRIMARY, HYBRID]
badge: HYBRID
category: 05-component-and-tooling-guides
autonomy_level: L2-L4
version: 2.0.0
tags: [pipelines, missions, dag, variables, orchestration, dependencies, assembly, workflow]
summary: Definitive guide for assembling directed acyclic graph (DAG) pipelines, step variable syntax, conditional branching gates, and durable mission manifests in Oddjob.
verification_status: verified
applies_when:
  - Assembling complex multi-step pipelines or durable agent missions
  - Configuring step-to-step variable bindings using the `{{steps.step_id.output}}` syntax
  - Validating DAG topology for cycles, missing input bindings, and conditional branches
do_not_use_when:
  - Running single-step ad-hoc tool executions with no dependencies
required_tools:
  - create_pipeline
  - update_pipeline
  - resolve_assembly_dag
  - get_pipeline_variable_syntax
  - trigger_pipeline
preconditions:
  - Target step executors registered in Tool Armory or Worker Fleet
  - Pipeline definition conforms to topological DAG acyclic structure
approval_requirements:
  - Deploying production pipelines with automated financial or external webhook triggers requires Admin review
success_checks:
  - DAG passes topological sort with zero cycles and all variable dependencies resolved
  - Pipeline executes through all stages with state persisted at step boundaries
stop_conditions:
  - Cyclic dependency detected during DAG assembly or missing required upstream output variable
escalation:
  - Revert to last published valid pipeline version and alert pipeline owner
implementation_evidence:
  - server/domain/pipeline/
  - server/domain/mission/
---

# DAG Pipeline Assembly & Mission Orchestration `[🤝 HYBRID]`

> **Audience:** `🤝 Hybrid: Pipeline Architects + Autonomous Mission Orchestrators` &nbsp;|&nbsp; **Classification:** Component Architecture & Assembly Standard

---

## 1. Directed Acyclic Graph (DAG) Pipeline Model `[🧑 Human]`

Oddjob structures complex workflows as **Directed Acyclic Graphs (DAGs)** where each node represents an isolated executor step and edges represent data dependencies:

```mermaid
graph LR
    Step1["Step 1: Extract Ingest Data<br/>(tool: saas_fetch)"]
    Step2["Step 2: Transform & Normalize<br/>(tool: ast_normalize)"]
    Step3A["Step 3A: Compute KPIs<br/>(tool: calculation_node)"]
    Step3B["Step 3B: Vector Indexing<br/>(tool: vector_embed)"]
    Step4["Step 4: Publish Dashboard<br/>(tool: render_app_surface)"]

    Step1 --> Step2
    Step2 --> Step3A & Step3B
    Step3A & Step3B --> Step4
```

---

## 2. Step Variable Interpolation Syntax `[🤖 Agent Reference]`

Downstream steps dynamically reference outputs from preceding upstream steps using the double-brace mustache syntax:

### Standard Reference Patterns:
- `{{steps.<stepId>.output.<propertyName>}}`
- `{{env.<environmentVariableName>}}`
- `{{context.organizationId}}`
- `{{context.userId}}`

### Example Pipeline Manifest Payload:
```json
{
  "pipelineId": "pipe_customer_onboarding_v2",
  "name": "Automated Customer Onboarding Pipeline",
  "steps": [
    {
      "id": "fetch_customer",
      "executor": "salesforce_get_record",
      "inputs": {
        "recordId": "{{context.targetRecordId}}",
        "objectType": "Lead"
      }
    },
    {
      "id": "provision_account",
      "executor": "db_insert_record",
      "dependsOn": ["fetch_customer"],
      "inputs": {
        "tableName": "accounts",
        "companyName": "{{steps.fetch_customer.output.Company}}",
        "email": "{{steps.fetch_customer.output.Email}}"
      }
    },
    {
      "id": "send_welcome_email",
      "executor": "send_agentmail",
      "dependsOn": ["provision_account"],
      "inputs": {
        "recipientEmail": "{{steps.fetch_customer.output.Email}}",
        "accountId": "{{steps.provision_account.output.id}}",
        "templateId": "tmpl_welcome_v1"
      }
    }
  ]
}
```

---

## 3. Conditional Branching & Error Handling Policies `[🤖 Agent Reference]`

Each DAG step can declare conditional execution rules and fallback policies:

| Property | Values | Description |
| :--- | :--- | :--- |
| **`condition`** | `{{steps.check.output.isVip}} == true` | Evaluated prior to step execution. If false, step is skipped. |
| **`onFailure`** | `ABORT_PIPELINE` \| `CONTINUE` \| `RETRY_THEN_HALT` | Dictates pipeline behavior when step throws an error. |
| **`maxRetries`** | `0 - 3` | Number of automatic retries before triggering failure policy. |
| **`timeoutSeconds`** | `10 - 300` | Hard deadline for step completion before watchdog cancellation. |
