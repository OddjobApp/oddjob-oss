---
id: multi-source-reconciliation
title: Multi-Source Entity Reconciliation, Deduplication & Conflict Resolution
audience: [AGENT_PRIMARY, HUMAN_PRIMARY, HYBRID]
badge: HYBRID
category: 02-problem-resolution-patterns
autonomy_level: L2-L3
version: 2.0.0
tags: [reconciliation, deduplication, entities, knowledge-garden, conflict-resolution, provenance, jaro-winkler]
summary: Algorithmic standard for multi-source entity deduplication, weighted similarity scoring, split-brain prevention, and provenance tracking across disparate SaaS systems.
verification_status: verified
applies_when:
  - Merging duplicate customer, incident, asset, or transaction records across multi-SaaS feeds
  - Resolving conflicting property values (e.g. diverging phone numbers or status timestamps)
  - Generating human-in-the-loop discrepancy resolution forms for ambiguous candidate pairs
do_not_use_when:
  - Appending append-only immutable telemetry streams (e.g. raw W3C trace logs)
required_tools:
  - get_entity_details
  - search_knowledge_graph
  - create_relationship
  - list_pending_interventions
preconditions:
  - Source records parsed with normalized field keys and ISO timestamps
  - Candidate entities indexed in Knowledge Graph with vector embeddings
approval_requirements:
  - Destructive record merges with divergent primary IDs require Data Steward HIL sign-off
success_checks:
  - Composite match score correctly classifies merge vs. split vs. review candidates
  - Master entity retains complete bidirectional lineage and provenance changelog
stop_conditions:
  - Circular parent-child merge cycle detected (e.g. Entity A $\rightarrow$ Entity B $\rightarrow$ Entity A)
escalation:
  - Generate HIL Entity Merge Conflict Form when composite score falls between 0.70 and 0.90
implementation_evidence:
  - server/domain/knowledge/core/ontology-adapters.ts
  - server/domain/knowledge/core/ontology.service.ts
---

# Multi-Source Entity Reconciliation & Conflict Resolution `[🤝 HYBRID]`

> **Audience:** `🤝 Hybrid: Data Stewards + Autonomous Deduplication Agents` &nbsp;|&nbsp; **Classification:** Data Quality & Problem Resolution Pattern

---

## 1. Multi-Source Ingestion & Merge Architecture `[🧑 Human]`

When records stream in from Salesforce, ServiceNow, Jira, and PostgreSQL, identical real-world entities often carry slight variations. Oddjob executes a deterministic reconciliation pipeline:

```mermaid
graph TD
    subgraph InboundRecords["Inbound Source Records"]
        SFDC["Salesforce Record (Acme Corp, $100k)"]
        Jira["Jira Issue (Acme Corporation, Critical)"]
        Postgres["Billing DB (Acme Inc, Paid)"]
    end

    subgraph ScoringEngine["Composite Match Scoring Engine"]
        ExactMatch["1. Deterministic Exact Match (Tax ID / Domain: w = 0.50)"]
        FuzzyMatch["2. Jaro-Winkler String Similarity (Name: w = 0.30)"]
        VectorMatch["3. Semantic Vector Similarity (Bio/Notes: w = 0.20)"]
    end

    subgraph DecisionMatrix["Decision Matrix"]
        AutoMerge["Score >= 0.90: Autonomous Golden Merge"]
        HILForm["0.70 <= Score < 0.90: Generate HIL Discrepancy Form"]
        Distinct["Score < 0.70: Mark as Distinct Entities"]
    end

    InboundRecords --> ScoringEngine
    ExactMatch & FuzzyMatch & VectorMatch --> DecisionMatrix
```

---

## 2. Composite Match Scoring Formula `[🤖 Agent Reference]`

The composite match score $S_{\text{match}}(A, B)$ between candidate entities $A$ and $B$ is computed as:

$$S_{\text{match}}(A, B) = w_{\text{exact}} S_{\text{exact}} + w_{\text{fuzzy}} S_{\text{JW}}(\text{name}_A, \text{name}_B) + w_{\text{vector}} S_{\text{cos}}(\mathbf{v}_A, \mathbf{v}_B)$$

Where:
- $w_{\text{exact}} = 0.50$: Exact identifier match (Tax ID, Verified Domain, Email domain). $S_{\text{exact}} \in \{0.0, 1.0\}$.
- $w_{\text{fuzzy}} = 0.30$: Jaro-Winkler string similarity across normalized entity legal titles.
- $w_{\text{vector}} = 0.20$: Cosine similarity between LLM summary embeddings.

---

## 3. Conflict Resolution Precedence Rules `[🤖 Agent Reference]`

When merging conflicting attribute values into the **Golden Master Entity**:

| Attribute Type | Winning Precedence Rule | Fallback Mechanism |
| :--- | :--- | :--- |
| **Financial / Balance ($)** | Authoritative Billing System (e.g. Stripe / SAP) wins. | Most recent verified timestamp. |
| **Contact Email / Address** | Most recently updated timestamp with verified bounce check. | Append secondary contact aliases. |
| **Lifecycle State (Status)** | Strict State Machine progression (Active $>$ Suspended $>$ Closed). | HIL Review required on regressive status. |
| **Incident Urgency** | Maximum severity rule ($\max(\text{P1}, \text{P2}) = \text{P1}$). | Never downgrade severity autonomously. |

---

## 4. Merge Provenance Schema & Tombstone Invariant `[🤖 Agent Reference]`

When merging duplicate entity `Entity_B` into golden master `Entity_A`:
1. **Preserve Tombstone**: `Entity_B` is marked `status: "MERGED_TOMBSTONE"`, with `mergedIntoId: "Entity_A"`.
2. **Re-route Edges**: All relational edges previously pointing to `Entity_B` are migrated to `Entity_A`.
3. **Record Provenance**:
```json
{
  "operation": "ENTITY_RECONCILIATION_MERGE",
  "masterEntityId": "ent_acme_master_01",
  "absorbedEntityId": "ent_acme_sfdc_99",
  "compositeMatchScore": 0.94,
  "reconciledFields": {
    "annualRevenue": { "source": "SALESFORCE", "value": 1500000 },
    "primaryDomain": { "source": "BILLING_DB", "value": "acme.com" }
  },
  "timestamp": "2026-08-27T15:53:00Z"
}
```
