# 🚀 Start an App Forge build
> **ID:** `start_app_forge`
> **Version:** `1.0.0`
> **Schema Version:** `1`
> **Category:** App Forge
> **Owner:** platform
> **Risk Profile:** Low
> **Execution Environment:** Host

---

## Description
Begins a forge run for a new application and returns the studio attached to it. Provisions a container and runs the full generation pipeline, so it is dispatched only after the author confirms.

---

## Inputs
| Name | Type |
|---|---|
| name | string |
| description | string |
| blueprint | string |
| slug | string |
| projectId | number |

---

## Outputs
| Name | Type |
|---|---|
| result | string |

---

## Guardrails
> [!NOTE] No explicit guardrails declared.

---

## Business Use Cases
> [!NOTE] No explicit business use cases declared.
