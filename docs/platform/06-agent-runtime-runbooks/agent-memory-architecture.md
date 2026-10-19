---
id: agent-memory-architecture
title: "Three-Tier Agent Memory: Working Context, Semantic Vectors & Episodic Journals"
audience: ["AGENT_PRIMARY", "HUMAN_PRIMARY", "GOVERNANCE"]
badge: "AGENT_PRIMARY"
category: "06-agent-runtime-runbooks"
autonomy_level: "L2-L5"
version: "1.0.0"
tags: ["memory-architecture", "context-budgeting", "vector-search", "episodic-journal", "qdrant", "redis"]
summary: "Architectural guidelines for managing the three distinct tiers of AI agent memory: volatile working scratchpad, persistent semantic vector index, and immutable episodic audit journals."
---

# Three-Tier Agent Memory Architecture

> **Audience:** 🤖 Agent / Autonomous | 🧑 Human / Builder | 🛡️ Safety & Governance  
> **Autonomy Level:** L2 to L5  
> **Telemetry Span:** `agent.memory.sync`

---

## 1. Memory Tier Overview

Autonomous agents operating over multi-day business processes cannot rely solely on the in-prompt LLM context window. Oddjob organizes memory across three specialized storage tiers:

```mermaid
graph TD
    subgraph Tier 1: Volatile Working Memory
        WM[In-Context Scratchpad<br/>• XML Blocks (<working_memory>)<br/>• Token Budget: 4,000 - 8,000 tokens<br/>• TTL: Single Turn / Mission Step]
    end

    subgraph Tier 2: Persistent Semantic Memory
        SM[Vector Store - Qdrant / PgVector<br/>• Embedded Schemas & Past Solutions<br/>• Top-K Cosine Retrieval<br/>• TTL: Indefinite / Organization Lifetime]
    end

    subgraph Tier 3: Immutable Episodic Journal
        EJ[Postgres Knowledge Documents & Audit Logs<br/>• W3C Traces, Tool Invocations & HIL Decisions<br/>• Queryable via SQL & GraphQL<br/>• TTL: Enterprise Retention SLA (7 Years)]
    end

    Task[Incoming Agent Step] --> Retrieve{Retrieve Context}
    Retrieve -->|Semantic Match| SM
    Retrieve -->|Recent Audit Trail| EJ
    
    SM --> Synthesize[Synthesize Context Injection]
    EJ --> Synthesize
    
    Synthesize --> WM
    WM --> LLM[Model Inference Core]
    LLM --> Writeback[Writeback Results & Decisions]
    
    Writeback -->|Update Embeddings| SM
    Writeback -->|Append Immutable Trace| EJ
```

---

## 2. Memory Tier Comparison Matrix

| Attribute | Tier 1: Working Memory | Tier 2: Semantic Memory | Tier 3: Episodic Journal |
| :--- | :--- | :--- | :--- |
| **Storage Engine** | LLM KV-Cache / RAM | Qdrant / Redis Vector | PostgreSQL `knowledge_documents` |
| **Access Latency** | $< 1\text{ms}$ (Instant) | $15\text{--}45\text{ms}$ | $5\text{--}20\text{ms}$ |
| **Query Mechanism** | Structural XML Tagging | Cosine Distance ($K=5$) | SQL / Relational Foreign Keys |
| **Scope** | Current Step Execution | Cross-Mission Knowledge | Organization Compliance Audit |
| **Eviction Policy** | Compacted on step exit | LRU / Score Degradation | Immutable Append-Only |

---

## 3. Dynamic Memory Eviction & Flush Protocol

When working context exceeds $75\%$ of the model's target budget:

```typescript
export async function flushWorkingMemoryToEpisodic(
  missionRunId: number,
  workingMemoryContent: string,
  summaryNotes: string
): Promise<void> {
  // 1. Persist compacted summary to immutable episodic store
  await db.insert(missionCheckpoints).values({
    missionRunId,
    checkpointType: "CONTEXT_COMPACTION_FLUSH",
    statePayload: {
      rawSummary: summaryNotes,
      tokenCountEstimate: Math.ceil(workingMemoryContent.length / 4),
    },
    createdAt: new Date(),
  });

  // 2. Vectorize salient knowledge into Semantic Tier if score > 0.80
  if (summaryNotes.includes("[KEY_LEARNING]")) {
    await vectorService.upsertKnowledgeVector({
      collection: "tenant_operational_learnings",
      payload: { text: summaryNotes, missionRunId },
    });
  }
}
```

---

## 4. Operational Invariants

1. **Never Store Secrets in Semantic Vectors:** PII and API keys must be scrubbed prior to embedding.
2. **Deterministic Recall Top-K:** Set semantic retrieval to $K \le 5$ with a minimum similarity threshold of $0.82$ to prevent hallucinated context distraction.
3. **Trace Reference Linking:** Every semantic memory node must retain a pointer (`sourceMissionRunId`) to its originating episodic journal entry.
