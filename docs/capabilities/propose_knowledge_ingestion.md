# 📚 Propose Scoped Data Ingestion & Entity Enrichment

> **Capability ID:** `propose_knowledge_ingestion`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** Knowledge  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Proposes running a targeted 1-time external ingestion job (e.g. Jira, Zendesk, PDF, or Datasets) to extract entity triples and enrich the room's Knowledge Graph.

---

## Inputs

| Name | Type |
| --- | --- |
| `sourceName` | `string` |
| `timeframeOrFilter` | `string` |
| `reason` | `string` |

## Outputs

| Name | Type |
| --- | --- |
| `result` | `string` |

---

## Business Use Cases

_No business use cases documented._

---

## Security Guardrails

> [!NOTE]
> No explicit guardrails declared.
