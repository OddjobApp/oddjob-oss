# 🧩 Build an Assembly Draft From an Attached Process

> **Capability ID:** `synthesize_app_from_process`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** App Forge  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Turn an attached BPMN file, workflow diagram, flowchart, or process image into an assembly draft shown as a workflow diagram: inputs, pipeline steps in order, branch conditions and a dataset table. Call list_attachments first. This drafts only; deploying still requires propose_assembly_deployment.

Turn an attached BPMN file, workflow diagram, flowchart, or process image into an assembly draft shown as a workflow diagram: inputs, pipeline steps in order, branch conditions and a dataset table. Call list_attachments first. This drafts only; deploying still requires propose_assembly_deployment.

---

## Inputs

| Name | Type |
| --- | --- |
| `attachmentId` | `number` |

## Outputs

| Name | Type |
| --- | --- |
| `result` | `string` |

---

## Business Use Cases

_No business use cases documented._

---

## Security Guardrails

> [!NOTE]
> No explicit guardrails declared.

---

## Change History

<!-- ACDD:CHANGELOG -->

- **[Auto-Changelog 2026-09-12]** (source: code) — 2 field change(s):
  - modified `metadata.description`: `Turn an attached BPMN file, workflow diagram, flowchart, or process image into a full-stack assembly draft — UI inputs, pipeline steps in order, branch conditions and a dataset schema. Call list_attachments first. This drafts only; deploying still requires propose_assembly_deployment.` → `Turn an attached BPMN file, workflow diagram, flowchart, or process image into an assembly draft shown as a workflow diagram: inputs, pipeline steps in order, branch conditions and a dataset table. Call list_attachments first. This drafts only; deploying still requires propose_assembly_deployment.`
  - modified `documentation_meta.summary`: `Turn an attached BPMN file, workflow diagram, flowchart, or process image into a full-stack assembly draft — UI inputs, pipeline steps in order, branch conditions and a dataset schema. Call list_attachments first. This drafts only; deploying still requires propose_assembly_deployment.` → `Turn an attached BPMN file, workflow diagram, flowchart, or process image into an assembly draft shown as a workflow diagram: inputs, pipeline steps in order, branch conditions and a dataset table. Call list_attachments first. This drafts only; deploying still requires propose_assembly_deployment.`
