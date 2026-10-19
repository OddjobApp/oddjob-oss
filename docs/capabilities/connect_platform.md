# 🧩 Request a Platform Connection

> **Capability ID:** `connect_platform`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** Integrations  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Ask a person to connect an external platform — Gmail, Google Drive/Docs, Google Workspace, Microsoft 365, Jira — to this project space. Call it when a needed integration is missing (e.g. a Google Docs read reports no connection) rather than reporting the task impossible. Writes nothing: it returns a card a person clicks through. The connection is created scoped to the current project space, not the whole organization.

---

## Inputs

| Name | Type |
| --- | --- |
| `platform` | `enum` |
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
