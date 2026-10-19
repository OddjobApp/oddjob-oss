# 🔗 Unlink Ontology Objects
> **ID:** `ontology_unlink_objects`
> **Version:** `1.0.0`
> **Schema Version:** `1`
> **Category:** `Ontology`
> **Owner:** `platform`
> **Risk Profile:** `Low`
> **Execution Environment:** `Host`

---

## Description
Remove a governed stored edge between two materialized Ontology Objects. Removing a missing edge is idempotent.

---

## Inputs

| Name       | Type   |
| :--------- | :----- |
| `sourceType` | `string` |
| `linkName` | `string` |
| `sourceId` | `any`    |
| `targetId` | `any`    |

---

## Outputs

| Name   | Type   |
| :----- | :----- |
| `result` | `string` |

---

## Business Use Cases
* No explicit business use cases declared.

---

## Guardrails
> [!NOTE]
> No explicit guardrails declared.
