# Knowledge Graph & RAG Vector Hygiene Guide

This guide defines the engineering practices for maintaining data hygiene, embedding vector integrity, and multi-tenant isolation across Oddjob's **Knowledge Graph Engine** and **Qdrant Vector Database**.

---

## 1. Dual-Store Architecture: Relational Graph + Semantic Vector

Oddjob pairs a structured entity-relationship graph (stored in PostgreSQL via `entities` and `entity_relations`) with a dense semantic vector space (stored in Qdrant collections).

```
[Ingested Source] (PDF, Slack, Markdown, SOW, API Specs)
        │
        ├──► [Entity Extraction] ──► PostgreSQL Graph (Nodes & Edges)
        │
        └──► [Semantic Chunking] ──► Qdrant Vector Points (Dense Embeddings)
```

---

## 2. Ingestion & Chunking Standards

1. **Chunk Size & Overlap**:
   - Primary text chunks: **500–800 tokens** with **100-token sliding window overlap**.
   - Code & Schema snippets: Preserved intact without mid-function slicing.
2. **Metadata Enrichment**:
   - Every chunk embedded into Qdrant must contain payload metadata:
     - `organizationId`: Mandatory for multi-tenant isolation.
     - `documentId`: Relational link to the source knowledge document.
     - `sourceType`: (`slack`, `jira`, `spec`, `handbook`, `code`).
     - `securityClassification`: (`public`, `internal`, `confidential`, `restricted`).
3. **Deterministic ID Hashing**: Generate vector point IDs using UUID v5 derived from the document ID and chunk offset to make re-indexing operations idempotent.

---

## 3. Defense Against Vector Poisoning

Vector search can be vulnerable to adversarial data injection ("poisoning"), where malicious or hallucinated documents skew LLM generation.

### Built-in Defenses:
1. **Source Reputation Scoring**: Chunks carry a trust coefficient ($[0.0, 1.0]$) derived from the verified identity of the publisher.
2. **Temporal Decay Weighting**: Older operational documents decay in relevance relative to recently verified system configurations.
3. **Purge Protocols**: If poisoned documents are discovered, execute the scoped purge scripts (`scripts/purge-db-poison.ts` and `scripts/broad-poison-purge.ts`) to synchronously evict corrupted vectors from both Qdrant and the relational graph.

---

## 4. Maintenance Scripts

```bash
# Clear knowledge graph documents (dev/test only)
npm run knowledge:clear

# Backfill vector embeddings for unindexed documents
npm run knowledge:backfill-index

# Reindex long-term episodic memory
npm run memory:backfill-index

# Run end-to-end knowledge graph integration verification
npm run test:kg-e2e
```
