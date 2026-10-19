# 📚 Knowledge Grounding

> **Capability ID:** `knowledge_grounding`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** Knowledge  
> **Owner:** Knowledge Platform  
> **Risk Profile:** Medium  
> **Execution Environment:** Host

---

## Overview

Retrieve organization-scoped evidence and context that grounds agent, mission, and application decisions.

Combines stored documents, semantic retrieval, graph context, and mission memory into attributable evidence for execution.

---

## Inputs

| Name | Type |
| --- | --- |
| `query` | `string` |
| `scope` | `object` |
| `limit` | `integer` |
| `minimum_relevance` | `number \| null` |

## Outputs

| Name | Type |
| --- | --- |
| `evidence` | `object[]` |
| `citations` | `object[]` |
| `graph_context` | `object \| null` |
| `retrieval_metadata` | `object` |

---

## Business Use Cases

- Ground an agent response in approved organizational knowledge.
- Retrieve prior mission context and reusable execution evidence.
- Provide citations and provenance for decisions and generated outputs.

---

## Security Guardrails

> [!WARNING]
> Retrieval must enforce organization and resource-level access boundaries.

> [!WARNING]
> Evidence must retain source provenance and must not be represented as more authoritative than its source.

> [!WARNING]
> Sensitive content must follow applicable redaction, retention, and data-use policy.

---

## Dependencies

- `knowledge`
- `qdrant`
- `graph_rag`
- `auth`
