# 🔍 Execute Visual Query (X-Ray)

> **ID:** `execute_visual_query`
> **Version:** `1.0.0`
> **Schema Version:** `1`
> **Category:** `System Utilities`
> **Owner:** `platform`
> **Risk Profile:** `Low`
> **Execution Environment:** `Host`

---

## Description

Queries the Oddjob System X-Ray graph to discover nodes (pipelines, agents, datasets, missions, apps, etc.) and their structural relationships (TRIGGERS, WRITES_TO, READS_FROM, BELONGS_TO). Essential for understanding cross-domain platform topology.

---

## Inputs

| Name       | Type   |
| :--------- | :----- |
| `scope`    | `string` |
| `filterType` | `string` |

---

## Outputs

| Name     | Type   |
| :------- | :----- |
| `result` | `string` |

---

## Guardrails

> [!NOTE] No explicit guardrails declared.

---

## Business Use Cases

> [!NOTE] No business use cases declared.
