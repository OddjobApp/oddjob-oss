# 📊 Get Dataset Records

> **ID**: `get_dataset_items`
> **Version**: `1.0.0`
> **Schema**: `1`
> **Category**: `Datasets & External`
> **Owner**: `platform`
> **Risk Profile**: `Low`
> **Execution Environment**: `Host`

Retrieve rows from a dataset, optionally filtered on one field. Use to inspect actual records before computing anything over them.

---

## Inputs

| Name | Type |
| :---------- | :----- |
| `datasetId` | `number` |
| `limit` | `number` |
| `offset` | `number` |
| `filterField` | `string` |
| `filterValue` | `string` |

---

## Outputs

| Name | Type |
| :------- | :----- |
| `result` | `string` |

---

## Guardrails

> [!NOTE] No explicit guardrails declared.

---

## Business Use Cases

> [!NOTE] No explicit business use cases declared.
