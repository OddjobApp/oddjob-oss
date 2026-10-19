# 🚀 Forge: Publish to Marketplace
> **Capability ID:** `forge_marketplace_publish`
> **Capability Version:** `1.0.0`
> **Manifest Schema Version:** `1`
> **Category:** App Forge
> **Owner:** platform
> **Risk Profile:** Low
> **Execution Environment:** Host

---

## Description
Finalizes a forged app and publishes it to the marketplace. This triggers the final deployment and sends a notification to the user with the live link.

---

## Inputs

| Name         | Type   |
| :----------- | :----- |
| `slug`       | string |
| `name`       | string |
| `description`| string |
| `missionRunId`| number |

---

## Outputs

| Name     | Type   |
| :------- | :----- |
| `result` | string |

---

## Guardrails

> [!NOTE] No explicit guardrails declared.

---

## Business Use Cases

No specific business use cases declared.
