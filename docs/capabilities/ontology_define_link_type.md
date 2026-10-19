# 🔗 Declare an Ontology Relationship
> **Capability ID:** ontology_define_link_type
> **Capability Version:** 1.0.0
> **Manifest Schema Version:** 1
> **Category:** Ontology
> **Owner:** platform
> **Risk Profile:** Low
> **Execution Environment:** Host

---

## Description
Declare a governed relationship between two Object Types. Derived links follow an existing source property; materialized links store explicit edges between materialized Ontology Objects. Call the list tools first. The declaration requires human approval.

---

## Inputs
This capability does not require any inputs.

---

## Outputs
| Name | Type |
|---|---|
| result | string |

---

## Business Use Cases
No explicit business use cases declared.

---

## Guardrails
> [!NOTE]
> No explicit guardrails declared.

---

## Change History

<!-- ACDD:CHANGELOG -->

- **[Auto-Changelog 2026-08-15]** (source: code) — 10 field change(s):
  - removed `inputs.name`: `string` → `—`
  - removed `inputs.sourceType`: `string` → `—`
  - removed `inputs.targetType`: `string` → `—`
  - removed `inputs.cardinality`: `enum` → `—`
  - removed `inputs.description`: `string` → `—`
  - removed `inputs.inverseName`: `string` → `—`
  - removed `inputs.targetTypeMap`: `object` → `—`
  - removed `inputs.sourceProperty`: `string` → `—`
  - removed `inputs.targetProperty`: `string` → `—`
  - removed `inputs.targetTypeProperty`: `string` → `—`
