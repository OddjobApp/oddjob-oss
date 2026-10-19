# 🔗 Link Ontology Objects

> **ID**: `ontology_link_objects`
> **Version**: `1.0.0`
> **Manifest Schema**: `1`
> **Category**: `Ontology`
> **Owner**: `platform`
> **Risk Profile**: `Low`
> **Execution Environment**: `Host`

---

Create a governed stored edge between two materialized Ontology Objects. Re-linking the same pair is idempotent.

---

## Inputs

| Name       | Type     |
| :--------- | :------- |
| `sourceType` | `string` |
| `linkName`   | `string` |
| `sourceId`   | `any`    |
| `targetId`   | `any`    |

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
