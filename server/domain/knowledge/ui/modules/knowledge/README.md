# 🧠 Knowledge Module (`client/src/modules/knowledge`)

The Knowledge Module is the cognitive interface of the Oddjob platform. It provides sophisticated tools for managing RAG (Retrieval-Augmented Generation) assets, visualizing complex information hierarchies via interactive graphs, and preparing datasets for model fine-tuning.

## Mach 3 UI Role: `knowledge`
In the Mach 3 distributed architecture, this module serves as the primary gateway to the **Knowledge Service**. It allows users to interact with the semantic memory and cross-domain relationships managed by the backend knowledge pod, providing transparency into how agents retrieve and synthesize information.

## Core Pages
- **[KnowledgeGraph](./pages/KnowledgeGraph.tsx)**: Interactive 2D/3D visualization of entities and their relationships across the system.
- **[KnowledgeGarden](./pages/KnowledgeGarden.tsx)**: Asset management view for documents, PDFs, and web scrapes.
- **[KnowledgeSearch](./pages/KnowledgeSearch.tsx)**: Semantic search interface for testing vector retrieval and RAG relevance.
- **[DatasetManager](./pages/DatasetManager.tsx)**: Tools for curating, labeling, and exporting datasets for LLM fine-tuning.
- **[AgencyMaturityDashboard](./pages/AgencyMaturityDashboard.tsx)**: High-level metrics on knowledge coverage, vectorization status, and graph density.

## Key Components
- **GraphCanvas**: D3 or Force-graph based visualization for the Knowledge Graph.
- **[RagAssetManager](../../components/knowledge/RagAssetManager.tsx)**: Unified interface for uploading and managing source documents.
- **[QueryBuilder](pages/QueryBuilder.tsx)**: Advanced interface for constructing semantic and metadata-filtered queries.
- **DatasetPreview**: Visualizes the structure and quality of generated training data.

## Hooks & State
- **`useKnowledgeGraph`**: Manages the local node/edge state and layout physics for the graph visualization.
- **`useRagAssets`**: Handles file uploads, ingestion status polling, and asset metadata updates.
- **`useKnowledgeSearch`**: Executes semantic queries and manages search result pagination/filtering.

## API Integration
- `GET /api/knowledge/graph`: Fetch graph topology (nodes and relationships).
- `POST /api/knowledge/ingest`: Trigger document processing and vectorization.
- `POST /api/knowledge/search`: Execute semantic and hybrid search queries.

## Testing Status
- [ ] Visualization: 🟡 Graph rendering and interaction verified in Chrome/Firefox
- [ ] Ingestion: 🟢 Large file uploads and status tracking validated
