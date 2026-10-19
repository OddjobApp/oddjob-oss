# 🛠️ Governed Approvals

> **Capability ID:** `governed_approvals`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** Governance Platform  
> **Risk Profile:** Medium  
> **Execution Environment:** Host

---

## Overview

Evaluate proposed autonomous actions against policy and route review-required actions to authorized human approvers.

Provides a consistent decision and human-review boundary for consequential agent and workflow actions.

---

## Inputs

| Name | Type |
| --- | --- |
| `action` | `object` |
| `actor` | `object` |
| `risk_context` | `object` |
| `policy_scope` | `string` |

## Outputs

| Name | Type |
| --- | --- |
| `decision` | `allow \| review \| deny` |
| `approval_request_id` | `integer \| null` |
| `reasons` | `string[]` |
| `audit_reference` | `string` |

---

## Business Use Cases

- Require approval before an agent sends an external message or changes a production system.
- Apply organization policy consistently across missions, agents, tools, and generated apps.
- Produce an auditable record of the evidence and authority behind a decision.

---

## Security Guardrails

> [!WARNING]
> Only authorized approvers may resolve an approval request.

> [!WARNING]
> Denied or expired approvals must not execute the underlying action.

> [!WARNING]
> Policy inputs, decisions, reasons, and resolution identity must be retained for audit.

---

## Dependencies

- `governor`
- `approval_requests`
- `audit`
- `auth`
