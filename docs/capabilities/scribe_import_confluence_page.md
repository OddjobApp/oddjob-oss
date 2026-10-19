# 🛠️ Import a Confluence Page into Scribe

> **Capability ID:** `scribe_import_confluence_page`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Import a Confluence page into the active Scribe document, splitting it into stations at its heading level. Replaces the current outline, so read scribe_get_document first if the manuscript already has work in it.

Import a Confluence page into the active Scribe document, splitting it into stations at its heading level. Replaces the current outline, so read scribe_get_document first if the manuscript already has work in it.

---

## Inputs

| Name | Type |
| --- | --- |
| `credentialId` | `number` |
| `pageId` | `string` |
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
