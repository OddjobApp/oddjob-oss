# 🔗 Traverse an Ontology Relationship

> **Capability ID:** `ontology_traverse_link`
> **Capability Version:** `1.0.0`
> **Manifest Schema Version:** `1`
> **Category:** `Ontology`
> **Owner:** `platform`
> **Risk Profile:** `Low`
> **Execution Environment:** `Host`

---

## Description

Follow a declared relationship from one object to the objects on its other end — 'which App does this deployment deploy?', or from the far end, 'which deployments deploy this App?'. Use the name from ontology_list_link_types: either the forward name or its inverse, whichever direction you are reading. If the result says complete=false, more matches may exist beyond those returned — do not report it as the full set.

---

## Inputs

| Name       | Type   |
|------------|--------|
| objectType | string |
| id         | any    |
| link       | string |
| limit      | number |

---

## Outputs

| Name   | Type   |
|--------|--------|
| result | string |

---

## Guardrails

> [!NOTE] No explicit guardrails declared.

---

## Business Use Cases

*   None declared.
