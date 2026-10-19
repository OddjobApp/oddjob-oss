# Knowledge Graph Enrichment & LLM Store Building Proposal

## Executive Summary
This proposal outlines the implementation of **Automated Knowledge Graph Construction** for Oddjob. While the foundational database schemas (`knowledgeNodes`, `knowledgeEdges`, `graphSchemaDefs`) exist, the system currently lacks the active "intelligence" to populate these tables from documents. This proposal defines the "brain" that will ingest raw documents, extract semantic entities/relationships using LLMs, and enable structured querying.

## 1. Data Model Enhancements

### 1.1. Document Extraction Status
To track which documents have been processed into the graph, we need to add state tracking to `knowledgeDocuments` or a sidecar table.

**Proposed Change:** Add `extraction_status` and `extraction_error` to `knowledgeDocuments` (or `knowledge_document_extractions`).

```typescript
// Modification to knowledgeDocuments (or new table)
extractionStatus: text("extraction_status").default("pending"), // 'pending', 'processing', 'completed', 'failed'
lastExtractedAt: timestamp("last_extracted_at"),
extractionSchemaId: integer("extraction_schema_id").references(() => graphSchemaDefs.id),
```

### 1.2. Job Type Update
We will introduce a new Job Type specifically for extraction, allowing it to be scheduled or triggered via pipeline.

**Proposed Change:** Update `jobTypes` enum within `schema.ts`.
```typescript
export const jobTypes = [
  // ... existing
  "knowledge_extraction", // NEW
] as const;

export const knowledgeExtractionConfigSchema = z.object({
  sourceTopicId: z.number().int().optional(), // If set, process all docs in topic
  schemaId: z.number().int().required(),     // The target graph schema to map to
  mode: z.enum(["full_reindex", "incremental"]).default("incremental")
});
```

## 2. Middleware & Backend Services

### 2.1. Knowledge Extraction Service (`server/services/knowledge-extraction.ts`)
This is the core engine. It will perform the following steps:
1.  **Job Trigger**: Receives a `knowledge_extraction` job.
2.  **Fetch Context**: Loads the target `graphSchemaDefs` (the ontology) and the source `KnowledgeDocument`.
3.  **LLM Processing**:
    *   Constructs a prompt containing the text content of the document + a minimized version of the Graph Schema (JSON definition of Nodes/Edges).
    *   Instructs the LLM (Gemini Pro 1.5) to "Extract all entities and relationships that match this schema."
    *   Enforces JSON output.
4.  **Upsert Logic**:
    *   Iterates through returned Nodes. Uses `label` + `externalId` (or `name`) to perform idempotent upserts to `knowledgeNodes`.
    *   Iterates through returned Edges. Resolves Source/Target Node IDs and upserts to `knowledgeEdges`.
5.  **Status Update**: Marks document as `completed`.

### 2.2. Schema Suggestion Service
To lower the barrier to entry, we will implement an AI-assistant for schema creation.

*   **Function**: `suggestSchema(domainDescription: string) -> GraphSchemaDef`
*   **Prompt**: "Generate a Knowledge Graph Schema for {domainDescription}. Include Node Labels (e.g., 'Ticket', 'User') and Edge Relations (e.g., 'ASSIGNED_TO')."

## 3. API Endpoints

### 3.1. Extraction Operations
*   `POST /api/knowledge/extract/document/:id`: Manually trigger extraction for a single document.
*   `POST /api/knowledge/extract/topic/:id`: Trigger for a whole topic.

### 3.2. Schema Assistant
*   `POST /api/knowledge/schemas/suggest`: 
    *   **Input**: `{ description: "Supply Chain Management" }`
    *   **Output**: JSON Schema definition to pre-fill the UI.

### 3.3. Semantic Graph Search
*   `POST /api/knowledge/graph/query/semantic`:
    *   **Input**: `{ query: "Find all high priority incidents caused by database outages" }`
    *   **Logic**:
        1.  LLM converts Natural Language -> Structured Graph Query (JSON filter).
        2.  System executes query against `knowledgeNodes`/`knowledgeEdges`.
        3.  Returns subgraph.

## 4. UI/UX Presentation

### 4.1. "Graph Builder" (New Tab in Knowledge Section)
A split-screen interface:
*   **Left**: Document Viewer (PDF/Text context).
*   **Right**: Extracted Graph Overlay.
    *   Users can "Approve/Reject" extracted nodes before they are committed (optional "Human-in-the-loop" mode).

### 4.2. Schema Editor
A visual editor for `graphSchemaDefs`.
*   **Visual**: Draw circles (Nodes) and arrows (Edges) to define the allowed ontology.
*   **AI Button**: "Auto-generate for [ Domain ]" input box.

### 4.3. Universal Query Bar
Upgrade the main search bar to support "Graph Mode":
*   Toggle between "Vector Search" (Document retrieval) and "Graph Search" (Entity retrieval).
*   Graph Search results show a force-directed graph visualization of connections.

## 5. Implementation Roadmap
1.  **Phase 1 (Backend Core)**: Implement `KnowledgeExtractionService` and integration with Gemini JSON mode.
2.  **Phase 2 (Jobs)**: Wire up the `knowledge_extraction` job type.
3.  **Phase 3 (UI)**: Build the Schema Editor and basic Graph Visualization.
4.  **Phase 4 (Enrichment)**: Implement Semantic Search (Text -> Graph Query).
