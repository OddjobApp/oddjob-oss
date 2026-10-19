# 🧠 Knowledge Pod (`server/domain/knowledge`)

The Knowledge Pod is the intelligence and memory layer of Oddjob. It handles document ingestion, semantic extraction, vector indexing (RAG), knowledge graph management, and the Knowledge Garden for staged knowledge verification. It provides agents with the context they need to execute missions accurately.

## Mach 3 Service Role: `worker` / `forge`
In the Mach 3 distributed architecture:
- **Worker Pod**: Handles resource-intensive extraction, OCR, and embedding generation tasks via the `knowledge-queue`.
- **Forge Pod**: Uses the Knowledge Graph and RAG context to synthesize new mission plans and job definitions.

## Key Services
- **[KnowledgeExtractionService](./core/extraction/knowledge-extraction.ts)**: Orchestrates the transformation of raw files into structured knowledge.
- **[SearchService](./core/search/search-service.ts)**: Provides hybrid search (semantic + keyword) across vector and relational stores.
- **[RagService](./core/rag/rag-workspace.service.ts)**: Manages retrieval-augmented generation context for LLM prompts.
- **[GraphService](./core/graph/graph-service.ts)**: Maintains the Knowledge Graph, mapping relationships between concepts, entities, and missions.
- **[QdrantPublisher](./core/indexing/qdrant-publisher.ts)**: Syncs structured data into the Qdrant vector database.
- **[TopicService](./core/topic-service.ts)**: Manages the taxonomy and grouping of knowledge assets.
- **[ConceptService](./core/concept-service.ts)**: Manages concept extraction and entity recognition.
- **[CollectionService](./core/collection.service.ts)**: Manages knowledge collections and grouping.
- **[DocumentService](./core/document-service.ts)**: Manages document ingestion and processing.
- **[EnrichmentService](./core/enrichment-service.ts)**: Enriches knowledge with additional metadata and context.
- **[AutoLinkingService](./core/auto-linking.service.ts)**: Automatically links related knowledge entities.
- **[ConfidenceDecayService](./core/confidence-decay.service.ts)**: Manages confidence score decay over time.

## Knowledge Garden vs Knowledge Graph

### Knowledge Garden (Staging)
The Knowledge Garden is a staging area for newly extracted knowledge that has not yet been verified. It serves as a review buffer where:
- **Nodes** are created with `verificationStatus: 'staging'`
- **Confidence scores** are assigned based on extraction quality
- **Human reviewers** can inspect, approve, or reject pending knowledge
- **Verification workflow** moves approved nodes to the Knowledge Graph

**Use Cases**:
- Review AI-extracted entities before adding to production graph
- Validate relationships between concepts
- Curate knowledge from external sources
- Batch verification workflows

**Access**: `/knowledge/garden` UI for reviewing staged nodes

### Knowledge Graph (Verified)
The Knowledge Graph contains verified, production-ready knowledge that agents can reliably use for:
- **Semantic search** and RAG queries
- **Entity resolution** and relationship traversal
- **Context injection** into agent prompts
- **Knowledge synthesis** for mission planning

**Characteristics**:
- Nodes have `verificationStatus: 'verified'`
- Includes `verifiedBy` and `verifiedAt` audit fields
- Indexed for high-performance retrieval
- Used by agents in production workflows

**Access**: `/knowledge/graph` UI for exploring verified knowledge

## Verification Workflow

1. **Extraction**: Knowledge is extracted from documents, APIs, or external sources
2. **Staging**: Extracted nodes are created in Knowledge Garden with `staging` status
3. **Review**: Human reviewers inspect staged nodes in the Knowledge Garden UI
4. **Approval**: Approved nodes are moved to `verified` status with audit metadata
5. **Promotion**: Verified nodes become part of the Knowledge Graph
6. **Usage**: Agents query the Knowledge Graph for context and relationships

## Routes
- `GET /api/search`: Perform a global semantic search.
- `POST /api/knowledge-extraction`: Upload and process a new document.
- `GET /api/knowledge-graph`: Retrieve graph visualization data.
- `GET /api/knowledge-garden`: Retrieve staged nodes for review.
- `POST /api/knowledge-garden/verify`: Approve or reject staged nodes.
- `GET /api/topics`: Manage knowledge categories.
- `GET /api/collections`: Manage knowledge collections.

## Dependencies
- **Qdrant**: Primary vector store for semantic retrieval.
- **PostgreSQL (pgvector)**: Relational and vector storage for metadata.
- **AI Service**: Used for embedding generation and entity extraction.
- **Shared Messaging**: Listens for "Mission Completed" events to trigger retrospective knowledge distillation.

## 🧪 Testing

The Knowledge pod uses a decentralized testing structure. Tests are colocated with the intelligence logic to ensure self-containment.

### Test Structure
- **[services/](./tests/services/)**: Focused tests for extraction, search, and graph services (e.g., `EntityExtractor`, `pgvector`).
- **[integration/](./tests/integration/)**: Strategic memory and documentation persistence tests.

### Running Tests
To run tests for this pod in isolation:
```bash
npx vitest server/domain/knowledge
```

### E2E Testing
A comprehensive E2E test for Knowledge Garden and Knowledge Graph is available:
```bash
npx tsx scripts/tests/e2e-knowledge-garden-test.ts
```

This test:
- Creates staging nodes (Knowledge Garden)
- Creates verified nodes (Knowledge Graph)
- Tests the verification workflow
- Validates API endpoints
- Retains data for manual inspection (use `--cleanup` to remove)

## Testing Status
- [x] Core Extraction: 🟢 Decentralized tests passing for entity extraction and RAG
- [x] Vector Search: 🟢 Integration tests passing for semantic retrieval and graph logic (pgvector)
- [x] Knowledge Garden: 🟢 E2E tests passing for staging and verification workflow
