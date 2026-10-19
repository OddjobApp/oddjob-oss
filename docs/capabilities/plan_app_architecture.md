# 🏗️ Plan Application Architecture
> **ID**: `plan_app_architecture`
> **Version**: `1.0.0`
> **Manifest Schema**: `1`
> **Category**: `System Utilities`
> **Owner**: `platform`
> **Risk Profile**: `Low`
> **Execution Environment**: `Host`

---

Classifies application requirements into a supported archetype and returns the layout, surfaces, capabilities, and best CREW/Forge construction path. Use before selecting a builder for a new app.

---

## Inputs

| Name                 | Type     |
| :------------------- | :------- |
| `appName`            | `string` |
| `requirements`       | `string` |
| `preferredArchetype` | `enum`   |
| `capabilities`       | `array`  |
| `integrations`       | `array`  |

---

## Outputs

| Name     | Type     |
| :------- | :------- |
| `result` | `string` |

---

## Business Use Cases

> [!NOTE]
> No explicit business use cases declared.

---

## Guardrails

> [!NOTE]
> No explicit guardrails declared.
