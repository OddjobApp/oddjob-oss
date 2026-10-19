# 🛠️ Publish Scribe Manuscript to Confluence

> **Capability ID:** `scribe_publish_to_confluence`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Compile the active manuscript and publish it to a Confluence space. Pass pageId to update an existing page in place; omit it to create a new one.

Compile the active manuscript and publish it to a Confluence space. Pass pageId to update an existing page in place; omit it to create a new one.

---

## Inputs

| Name | Type |
| --- | --- |
| `credentialId` | `number` |
| `spaceKey` | `string` |
| `pageId` | `string` |
| `title` | `string` |
| `documentId` | `number` |

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
