# 🧠 Query Knowledge Graph Subgraph & Summarize

> **Capability ID:** `query_knowledge_subgraph`
> **Capability Version:** `1.0.0`
> **Manifest Schema Version:** `1`
> **Category:** Knowledge Management
> **Owner:** platform
> **Risk Profile:** Low
> **Execution Environment:** Host

---

## Description

Performs a multi-hop subgraph expansion and topological summarization around a named entity or concept in the Knowledge Graph. Returns direct entity properties, inbound/outbound dependencies, causal relationships, and a Mermaid topology diagram.

---

## Inputs

| Name | Type |
|---|---|
| `entityName` | `string` |
| `maxHops` | `number` |
| `limit` | `number` |
| `includeProperties` | `boolean` |

---

## Outputs

| Name | Type |
|---|---|
| `result` | `string` |

---

## Guardrails

> [!NOTE]
> No explicit guardrails declared.

---

## Business Use Cases

> [!NOTE]
> No explicit business use cases declared.
