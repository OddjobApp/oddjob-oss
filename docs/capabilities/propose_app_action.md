# 🧩 Propose App Action

> **Capability ID:** `propose_app_action`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** App Forge  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Propose creating, updating, or deleting a record in an installed app's collection (e.g. logging a ticket, adding an expense item, creating a dispatch incident). Renders a structured approval card in the room so a human can review the proposed fields before any changes are written. Specify `app` (slug or name), `action` ('create_record', 'update_record', or 'delete_record'), `collection`, optional `recordId`, `data` (fields to set), and `reason`.

---

## Inputs

| Name | Type |
| --- | --- |
| `app` | `string` |
| `action` | `enum` |
| `collection` | `string` |
| `recordId` | `string` |
| `data` | `object` |
| `reason` | `string` |

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
