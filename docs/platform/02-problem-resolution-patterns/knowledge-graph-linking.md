---
id: knowledge-graph-linking
title: Semantic Entity Extraction, Knowledge Garden Linking & Ontological Grounding
audience: [AGENT_PRIMARY, HYBRID]
badge: AGENT_PRIMARY
category: 02-problem-resolution-patterns
autonomy_level: L2-L4
version: 2.0.0
tags: [knowledge-graph, knowledge-garden, entities, ontology, semantic-search, linking, embeddings, rrf]
summary: Definitive standard for resolving entities into the Knowledge Garden, linking strongly-typed ontology object types, and querying 2-hop graph neighborhoods with real MCP tools.
verification_status: verified
applies_when:
  - Extracting business entities (Customers, Incidents, Products, Code Nodes) from unstructured text
  - Linking new knowledge nodes to existing graph entities via strongly-typed edge predicates
  - Performing multi-hop subgraph context expansion for autonomous agent grounding
do_not_use_when:
  - Performing tabular numeric aggregation without entity relational context
required_tools:
  - create_entity
  - create_relationship
  - ontology_link_objects
  - ontology_traverse_link
  - search_knowledge_graph
  - query_knowledge_subgraph
preconditions:
  - Tenant Knowledge Graph database connected and vector index synchronized
  - Extracted entity contains valid canonical type and non-empty property bag
approval_requirements:
  - Merging or re-parenting core business entities with high connectivity ($> 50\text{ edges}$) requires HIL confirmation
success_checks:
  - Entity created or resolved with cosine vector similarity score $\ge 0.88$
  - Edge predicates adhere to valid Ontology Schema definitions (`RELATES_TO`, `ASSIGNED_TO`, `DERIVED_FROM`)
stop_conditions:
  - Cyclic relationship detected where edge creation introduces an invalid DAG violation
escalation:
  - Prompt user via HIL Entity Disambiguation card when multiple candidate matches score within 5% of each other
implementation_evidence:
  - server/domain/knowledge/core/ontology.service.ts
  - server/domain/ai/core/scoped-topic-indexer.ts
---

# Knowledge Garden Graph Linking & Ontology Mapping `[🤖 AGENT]`

> **Audience:** `🤖 Agent Executable & Knowledge Architect` &nbsp;|&nbsp; **Classification:** Semantic Enrichment & Knowledge Graph Pattern

---

## 1. 3-Tier Knowledge Garden Architecture `[🧑 Human]`

The **Knowledge Garden** organizes all unstructured and structured enterprise intelligence into three interlinked layers:

```mermaid
graph TD
    subgraph Tier1["1. Raw Ingestion Layer (Blob & Stream Storage)"]
        RawDocs["Unstructured Files (PDF, MD, API JSON, Slack Transcripts)"]
    end

    subgraph Tier2["2. Semantic Vector & Topic Subgraph"]
        Chunks["Token Chunks & HNSW Vector Embeddings"]
        Topics["Louvain/Leiden Topic Clusters (2-hop neighborhood)"]
    end

    subgraph Tier3["3. Typed Ontology Business Graph"]
        Entities["Ontology Entities (Customer, Incident, WorkItem, CalculationNode)"]
        Edges["Typed Predicate Edges (AFFECTS, BLOCKS, OWNS, DERIVES)"]
    end

    RawDocs --> Chunks --> Topics --> Entities
    Entities <-->|Dynamic Link Types| Edges
```

---

## 2. Multi-Hop Entity Resolution & Linking Algorithm `[🤖 Agent Reference]`

When new text or structured records arrive, execute the **Entity Resolution Pipeline**:

```mermaid
graph TD
    Input["Extracted Entity Candidate (Name, Type, Properties)"] --> VectorSearch["1. search_knowledge_graph with Cosine Similarity"]
    VectorSearch --> MatchCheck{"Best Match Similarity Score"}
    MatchCheck -- "Score >= 0.88" --> ExistingNode["2A. Resolve to Existing Entity ID"]
    MatchCheck -- "Score < 0.88" --> NewNode["2B. Call create_entity to instantiate Node"]
    ExistingNode --> LinkEdges["3. Call create_relationship / ontology_link_objects"]
    NewNode --> LinkEdges
    LinkEdges --> SubgraphCheck["4. Call query_knowledge_subgraph to verify 2-hop neighborhood"]
```

---

## 3. Real MCP Tool Invocation Standards `[🤖 Agent Reference]`

### A. Creating an Entity Node
```typescript
// Call create_entity to register a new strongly-typed node
await create_entity({
  type: "ENTITY:WORK_ITEM",
  name: "Fix Stripe Webhook Replay Vulnerability",
  properties: {
    key: "ODD-4102",
    priority: "HIGH",
    status: "IN_PROGRESS",
    sourceSystem: "JIRA"
  }
});
```

### B. Linking Entities via Typed Ontology Edges
```typescript
// Call create_relationship to link entities
await create_relationship({
  sourceEntityId: "ent_work_item_4102",
  targetEntityId: "ent_user_dev_881",
  relationshipType: "ASSIGNED_TO",
  properties: {
    assignedAt: new Date().toISOString(),
    confidence: 0.95
  }
});
```

### C. Traversing and Querying Subgraphs
```typescript
// Call query_knowledge_subgraph to extract grounded context for Copilot turn
const context = await query_knowledge_subgraph({
  rootEntityId: "ent_work_item_4102",
  maxHops: 2,
  relationshipTypes: ["ASSIGNED_TO", "BLOCKS", "AFFECTS"]
});
```

---

## 4. Disambiguation Invariant & Entity Deduplication `[🤖 Agent Reference]`

1. **Threshold Boundaries**:
   - $\text{Similarity} \ge 0.88$: Safe for automated merging.
   - $0.72 \le \text{Similarity} < 0.88$: Ambiguous match. Must trigger HIL Disambiguation card rather than creating duplicate entities.
   - $\text{Similarity} < 0.72$: Distinct entity. Safe to create new node.
2. **Context Compaction Limit**:
   - Extracted 2-hop neighborhood subgraph must be serialized to compact Markdown and remain bounded to **$\le 350\text{ tokens}$** per turn.
