# 🔗 Bind Screen Input/Output
> **ID:** `bind_screen_io`
> **Version:** `1.0.0`
> **Schema Version:** `1`
> **Category:** System Utilities
> **Owner:** platform
> **Risk Profile:** Low
> **Execution Environment:** Host

Wires an output field submitted on an upstream screen into a prop/input required by a downstream screen or action.

---

## Inputs

| Name | Type |
|---|---|
| `targetStageId` | `string` |
| `targetPropKey` | `string` |
| `sourceStageId` | `string` |
| `sourceOutputKey` | `string` |
| `defaultValue` | `any` |
| `transform` | `string` |

---

## Outputs

| Name | Type |
|---|---|
| `result` | `string` |

---

## Guardrails
> [!NOTE] No explicit guardrails declared.

---

## Business Use Cases
> [!NOTE] No explicit business use cases declared.
