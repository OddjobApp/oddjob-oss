# ➕ Create Entity
> **ID:** `create_entity`
> **Version:** `1.0.0`
> **Manifest Schema:** `1`
> **Category:** Knowledge Graph
> **Owner:** platform
> **Risk Profile:** Low
> **Execution Environment:** Host

Create a new entity in the knowledge graph. Requires admin permissions.

---

## Inputs

| Name       | Type   |
|------------|--------|
| name       | string |
| entityType | string |
| externalId | string |
| properties | object |

---

## Outputs

| Name   | Type   |
|--------|--------|
| result | string |

---

## Guardrails

> [!NOTE] No explicit guardrails declared.
