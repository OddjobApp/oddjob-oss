# ⚙️ Get System Spec
> **ID**: `get_system_spec`
> **Version**: `1.0.0`
> **Schema Version**: `1`
> **Category**: `System Utilities`
> **Owner**: `platform`
> **Risk Profile**: `Low`
> **Execution Environment**: `Host`

Retrieve the full markdown of one system documentation spec. Provide EITHER featureId for a backend domain module, OR specType 'api' / 'ui' / 'capability'. Prefer specType 'capability' when asked what the platform can do, so you neither over-claim nor wrongly refuse.

---

## Inputs

| Name        | Type     |
| :---------- | :------- |
| `featureId` | `string` |
| `specType`  | `enum`   |

---

## Outputs

| Name     | Type     |
| :------- | :------- |
| `result` | `string` |

---

## Guardrails

> [!NOTE] No explicit guardrails declared.

---

## Business Use Cases
