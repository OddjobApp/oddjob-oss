# 🧩 Propose Binding a SaaS Resource to This Project

> **Capability ID:** `propose_adapter_binding`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** Integrations  
> **Owner:** platform  
> **Risk Profile:** Medium  
> **Execution Environment:** Host

---

## Overview

Propose binding a Confluence space or Jira project to this project space. Call list_confluence_spaces or list_jira_projects first and propose only a key that exists — an invented key is rejected. Requires human approval before it takes effect.

---

## Inputs

| Name | Type |
| --- | --- |
| `resourceKind` | `enum` |
| `resourceKey` | `string` |
| `resourceName` | `string` |
| `resourceType` | `string` |
| `externalId` | `string` |
| `webUrl` | `string` |
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
