# 🛠️ Compile & Export Manuscript

> **Capability ID:** `scribe_export_manuscript`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Compiles all stations in the active Scribe Studio document into formatted Markdown, PDF, or Word DOCX.

---

## Inputs

| Name | Type |
| --- | --- |
| `documentId` | `number` |
| `format` | `enum` |
| `branchId` | `number` |

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
