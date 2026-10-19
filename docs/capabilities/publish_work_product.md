# 🧩 Publish Room Work Product

> **Capability ID:** `publish_work_product`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** Rich UI  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Create or revise a room work product: a brief, plan, specification, research report, or summary. Reuse the same documentKey for revisions of the same deliverable. Include the complete current Markdown content and a short change summary. Cite evidence in the content, distinguish proposals from executed results, and identify unmet success criteria. This returns a versioned room artifact; it does not publish externally or approve or execute anything.

---

## Inputs

| Name | Type |
| --- | --- |
| `documentKey` | `string` |
| `title` | `string` |
| `content` | `string` |
| `changeSummary` | `string` |
| `sourceTurnId` | `number` |

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
