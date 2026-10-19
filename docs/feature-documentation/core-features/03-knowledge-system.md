# Knowledge System Documentation

> **Spec References:** oddjob_feature_reference (screens, routes).

## **Feature Overview**

### **Purpose & Business Value**
The Knowledge System is Oddjob's intelligent information management platform, combining document storage, semantic search, knowledge graph visualization, and RAG (Retrieval-Augmented Generation) capabilities. It enables organizations to build searchable knowledge bases, extract insights from unstructured data, and enhance AI-powered workflows with contextual information.

### **User Personas & Use Cases**
- **Knowledge Managers**: Curate and organize document collections
- **Data Scientists**: Build and explore knowledge graphs
- **AI Engineers**: Enhance AI workflows with RAG capabilities
- **Compliance Officers**: Manage document lifecycle and access control
- **Business Analysts**: Search and analyze organizational knowledge
- **Support Teams**: Access knowledge for issue resolution

### **Key Requirements & Constraints**
- **Document Management**: Support for multiple file formats (PDF, Word, text, JSON)
- **Semantic Search**: Vector-based similarity search using Qdrant
- **Knowledge Graph**: Visualize entity relationships and connections
- **Topic Organization**: Hierarchical topic-based document organization
- **RAG Integration**: Enhance AI jobs with knowledge context
- **Multi-tenant Isolation**: Separate knowledge by organization
- **Access Control**: Role-based document and topic access
- **Version Control**: Track document changes and history

### **Success Metrics**
- Search accuracy > 95%
- Document ingestion rate > 1000 documents/hour
- Knowledge graph query response < 2 seconds
- RAG context relevance > 90%

---

## **User Interface Documentation**

### **Screens & Navigation**

#### **Knowledge Store (`/knowledge-store`)**
- **Purpose**: Main document management interface
- **Key Features**:
  - Topic hierarchy navigation
  - Document upload and management
  - Bulk import/export operations
  - Document preview and editing
  - Metadata management
  - Access control configuration

#### **Knowledge Graph (`/knowledge/graph`)**
- **Purpose**: Visual knowledge graph exploration
- **Key Features**:
  - Interactive node-edge visualization
  - Graph filtering and search
  - Relationship strength visualization
  - Path finding and shortest routes
  - Node detail inspection
  - Graph layout algorithms
  - Export graph data

#### **Knowledge Search (`/knowledge/search`)**
- **Purpose**: Semantic and keyword search interface
- **Key Features**:
  - Natural language search queries
  - Advanced filtering (date, type, topic)
  - Search result relevance scoring
  - Document snippet preview
  - Search history and saved searches
  - Export search results

#### **Knowledge Garden (`/knowledge/garden`)**
- **Purpose**: Human-in-the-loop review of AI-extracted knowledge graph nodes. Pipeline and auto-linking steps create new graph nodes with `verificationStatus: "staging"` (see the existing `KnowledgeDocument.verificationStatus` schema below); the Garden is the operator console for promoting them to `"verified"` or rejecting them, and for viewing the source context that produced them.
- **Key Features**:
  - **Staging list with confidence-coded cards.** Each entity card has a left-edge gradient whose color reflects the model's confidence score (`getConfidenceColor`, `KnowledgeGarden.tsx`: `>= 0.9` indigo, `>= 0.7` emerald, `>= 0.4` amber, otherwise rose), giving a quick visual read on which items need attention.
  - **Header counters.** Three live counts in the page header — Pending (yellow), Verified (green), Rejected (red) — pulled from `/api/knowledge-graph/staging/stats`.
  - **Per-card actions:** **Promote** (approve), **Edit** (opens the correction dialog with prefilled `label`/`name`), **Drop** (reject), and **Context** (opens the `SourceDocumentPanel` side-by-side at `w-1/2`).
  - **Bulk actions.** Select-all checkbox + per-card checkbox; "Approve Selected" and "Reject Selected" appear once any card is selected. When a label filter is active, an "Approve All {label}" button appears as a fast-path.
  - **Filters.** Entity type (label) and knowledge topic, both surfaced as dropdown menus with live counts. The active filter set is also reflected in the URL (`?label=...&topicId=...`) so the view is shareable / reload-safe.
  - **Enrichment chips on each card.** When present in the node's `data`, the card surfaces `auto_summary` (italic summary block), `topics[]` (uppercase tag pills), `sentiment` (positive/negative score), `urgency > 0.5` (a pulsing "Critical Priority" badge), and a glowing "AI Verified" badge when `confidenceScore > 0.9`.
  - **Source-document side panel.** Clicking **Context** opens `SourceDocumentPanel`, which renders each entry from `node.extractionSources[]` as a card. Plain-text `sourceText` is shown with the entity name highlighted (`HighlightedText`); JSON-parseable `sourceText` is rendered as a structured `JsonTableView`. The panel also surfaces `pipelineExecutionId` (linked to `/pipeline-executions/:id`), `stepOrder`, and a timestamp.
  - **CSV export.** The header's `ExportButton` exports the currently visible staging list (id, label, name, externalId, status, confidence, topic, data, run id, createdAt) using the shared `formatDateForExport` / `formatJSONForExport` helpers.
  - **Pagination.** 50 items per page, server-enforced max of 100; client `Previous` / `Next` controls render only when the result set exceeds one page.

#### **Knowledge Dashboard (`/knowledge/dashboard`)**
- **Purpose**: Knowledge system overview and analytics
- **Key Features**:
  - Document statistics and trends
  - Search analytics and patterns
  - Knowledge graph metrics
  - User activity monitoring
  - Storage usage tracking
  - Quality indicators

### **Component Hierarchy**

```
KnowledgeSystem/
├── KnowledgeStore/
│   ├── index.tsx - Main document management
│   ├── TopicTree.tsx - Hierarchical topic navigation
│   ├── DocumentList.tsx - Document listing and filtering
│   ├── DocumentPreview.tsx - Document preview panel
│   ├── DocumentUpload.tsx - File upload interface
│   ├── MetadataEditor.tsx - Document metadata editing
│   └── AccessControl.tsx - Permission management
├── KnowledgeGraph/
│   ├── index.tsx - Main graph interface (1027 lines)
│   ├── visualization/
│   │   ├── GraphCanvas.tsx - Main visualization
│   │   ├── NodeRenderer.tsx - Node visualization
│   │   ├── EdgeRenderer.tsx - Edge visualization
│   │   └── Controls.tsx - Zoom, pan, filter controls
│   ├── panels/
│   │   ├── NodeDetail.tsx - Node information panel
│   │   ├── SearchPanel.tsx - Graph search interface
│   │   ├── FilterPanel.tsx - Filtering options
│   │   └── StatisticsPanel.tsx - Graph statistics
│   ├── layouts/
│   │   ├── ForceDirected.tsx - Force layout algorithm
│   │   ├── Hierarchical.tsx - Tree layout
│   │   └── Circular.tsx - Circular layout
│   └── utils/
│       ├── GraphUtils.tsx - Graph manipulation utilities
│       ├── LayoutUtils.tsx - Layout calculation helpers
│       └── ExportUtils.tsx - Graph export functions
├── KnowledgeSearch/
│   ├── index.tsx - Main search interface
│   ├── SearchBar.tsx - Search input and suggestions
│   ├── ResultsList.tsx - Search results display
│   ├── ResultPreview.tsx - Document preview
│   ├── FilterPanel.tsx - Advanced search filters
│   └── SearchHistory.tsx - Search history management
├── RagAssetManager/
│   ├── index.tsx - RAG asset configuration (771 lines)
│   ├── AssetSelector.tsx - Asset selection interface
│   ├── PreviewPanel.tsx - Asset content preview
│   └── ConfigurationPanel.tsx - RAG settings
├── KnowledgeGarden/
│   ├── KnowledgeGarden.tsx - Staging review console (~795 lines)
│   ├── garden/
│   │   ├── SourceDocumentPanel.tsx - Split-screen source context with HighlightedText + JsonTableView
│   │   └── SourceDocumentPanel.module.css - Co-located panel styles
│   ├── HeaderStats.tsx - Pending / Verified / Rejected counters
│   ├── FilterDropdowns.tsx - Label and topic filter menus
│   ├── EntityCard.tsx - Single staging-node card with actions + enrichment chips
│   ├── CorrectionDialog.tsx - Edit-and-approve dialog (label/name/data)
│   ├── EmptyState.tsx - "All Caught Up!" zero-state
│   └── Pagination.tsx - Previous/Next page controls
└── Shared/
    ├── DocumentViewer.tsx - Universal document viewer
    ├── MetadataDisplay.tsx - Metadata presentation
    ├── PermissionBadge.tsx - Access level indicators
    └── StatusBadge.tsx - Document status indicators
```

### **User Interactions**

#### **Document Ingestion Flow**
1. Navigate to `/knowledge/store` → Select or create topic
2. Click "Upload Documents" → Choose files or drag-drop
3. Configure metadata (title, description, tags, permissions)
4. Process and analyze documents (automatic)
5. Review extraction results and corrections
6. Publish to knowledge base

#### **Knowledge Graph Exploration Flow**
1. Navigate to `/knowledge/graph` → View graph overview
2. Use search panel to find specific entities
3. Click nodes to view details and relationships
4. Apply filters to focus on specific areas
5. Use layout controls to adjust visualization
6. Export graph data or share insights

#### **RAG Integration Flow**
1. Configure AI job → Add RAG resources
2. Select knowledge topics or individual documents
3. Configure retrieval settings (k values, filters)
4. Test RAG context retrieval
5. Execute job with enhanced AI context
6. Review results and context relevance

---

## **API Documentation**

### **Knowledge Store Endpoints**

#### **GET /api/knowledge/topics**
- **Purpose**: List knowledge topics with document counts
- **Query Parameters**:
  - `parentId`: Filter by parent topic
  - `includeCounts`: Include document counts (default: true)
  - `search`: Search term for topic names
- **Response**: `{ topics: KnowledgeTopic[] }`

#### **POST /api/knowledge/topics**
- **Purpose**: Create new knowledge topic
- **Request Body**: `InsertKnowledgeTopic`
- **Response**: Created `KnowledgeTopic`
- **Validation**: Name uniqueness within parent, valid parent ID

#### **GET /api/knowledge/documents**
- **Purpose**: List documents with metadata
- **Query Parameters**:
  - `topicId`: Filter by topic
  - `search`: Search term for content/metadata
  - `type`: Filter by document type
  - `limit`: Pagination limit
  - `offset`: Pagination offset
- **Response**: `{ documents: KnowledgeDocument[], total: number }`

#### **POST /api/knowledge/documents**
- **Purpose**: Create new knowledge document
- **Request Body**: `InsertKnowledgeDocument` with content or file reference
- **Response**: Created `KnowledgeDocument`
- **Processing**: Triggers automatic content analysis and embedding

#### **GET /api/knowledge/documents/:id/content**
- **Purpose**: Get document content
- **Response**: Document content with proper MIME type
- **Authentication**: Required with document access permissions

### **Knowledge Graph Endpoints**

#### **GET /api/knowledge/graph/nodes**
- **Purpose**: Get knowledge graph nodes
- **Query Parameters**:
  - `search`: Filter by node name/label
  - `type`: Filter by node type
  - `limit`: Maximum nodes to return
  - `includeRelations`: Include connected edges
- **Response**: `{ nodes: KnowledgeNode[], edges?: KnowledgeEdge[] }`

#### **GET /api/knowledge/graph/edges**
- **Purpose**: Get knowledge graph edges (relationships)
- **Query Parameters**:
  - `sourceId`: Filter by source node
  - `targetId`: Filter by target node
  - `type`: Filter by relationship type
  - `strength`: Filter by minimum strength
- **Response**: `{ edges: KnowledgeEdge[] }`

#### **POST /api/knowledge/graph/nodes**
- **Purpose**: Create knowledge graph node
- **Request Body**: `CreateNodeInput`
- **Response**: Created `KnowledgeNode`
- **Side Effects**: Updates embeddings and graph indices

#### **POST /api/knowledge/graph/edges**
- **Purpose**: Create relationship between nodes
- **Request Body**: `CreateEdgeInput`
- **Response**: Created `KnowledgeEdge`
- **Validation**: Node existence, relationship validity

#### **POST /api/knowledge/graph/search**
- **Purpose**: Semantic search in knowledge graph
- **Request Body**: `{ query: string, limit?: number, filters?: GraphSearchFilters }`
- **Response**: `{ nodes: KnowledgeNode[], scores: number[], paths?: GraphPath[] }`

### **Verification & Staging Endpoints**

All four endpoints are mounted under `/api/knowledge-graph/*`, require authentication, and are org-scoped via `getUserOrgContext`. They back the Knowledge Garden screen and the knowledge-verification service. (Source: `server/domain/knowledge/routes/knowledge-graph.route.ts:667-735`.)

#### **GET /api/knowledge-graph/staging**
- **Purpose**: List AI-extracted nodes currently in `"staging"` verification status, for the Garden review queue.
- **Query Parameters**:
  - `page`: 1-indexed page number (default `1`)
  - `limit`: Page size, **capped server-side at 100** (default `50`)
  - `label`: Filter by node label (entity type)
  - `topicId`: Filter by knowledge topic
  - `pipelineExecutionId`: Filter by originating pipeline run
- **Response**: `{ nodes: KnowledgeNode[], total: number, page: number, limit: number }` (the page's local `KnowledgeNode` shape, which extends the documented `KnowledgeNode` interface with runtime fields `extractionSources[]`, `confidenceScore`, `topicName`, and `pipelineExecutionId`).

#### **GET /api/knowledge-graph/staging/stats**
- **Purpose**: Aggregate counts that drive the Garden header counters and the label/topic filter dropdowns.
- **Response**:
  ```typescript
  interface StagingStats {
    byStatus: { staging: number; verified: number; rejected: number };
    byLabel: Record<string, { staging: number; verified: number; rejected: number }>;
    byTopic: Record<string, TopicStat>; // keyed by topic id; TopicStat = { id, name, staging, verified, rejected }
    totalStaging: number;
  }
  ```

#### **POST /api/knowledge-graph/nodes/:id/verify**
- **Purpose**: Apply a single-node verification action (Promote / Drop / Edit-and-Approve).
- **Request Body** (validated by `verifyKnowledgeNodeSchema` in `shared/schema/knowledge/graph.ts:235-242`):
  ```typescript
  {
    action: "approve" | "reject" | "correct";
    corrections?: {
      label?: string;   // 1-100 chars
      name?: string;    // 1-500 chars
      data?: Record<string, any>;
    };
  }
  ```
- **Validation**: The service rejects the request if the node is not currently in `"staging"` status (`server/domain/knowledge/core/knowledge-verification.service.ts:76`).
- **Response**: Updated `KnowledgeNode`.

#### **POST /api/knowledge-graph/staging/bulk-verify**
- **Purpose**: Apply the same action to many nodes at once. **Bulk only supports `approve` and `reject`** — the `correct` action is intentionally single-node only and returns a `ValidationError` for any other value.
- **Request Body**:
  ```typescript
  {
    action: "approve" | "reject";
    nodeIds?: number[];            // explicit selection
    pipelineExecutionId?: number;  // OR target all staging nodes from a run
    label?: string;                // OR target all staging nodes of a label
  }
  ```
- **Response**: `{ action: "verified" | "rejected"; count: number }`.

### **RAG & Search Endpoints**

#### **POST /api/knowledge/search/semantic**
- **Purpose**: Semantic search across documents
- **Request Body**: `{ query: string, limit?: number, topicIds?: number[] }`
- **Response**: `{ documents: KnowledgeDocument[], scores: number[], snippets: string[] }`

#### **POST /api/knowledge/rag/context`
- **Purpose**: Retrieve RAG context for AI jobs
- **Request Body**: `{ query: string, contextConfig: RAGContextConfig }`
- **Response**: `{ context: string, sources: KnowledgeDocument[], relevanceScores: number[] }`

#### **POST /api/knowledge/embeddings/generate**
- **Purpose**: Generate embeddings for documents (internal)
- **Request Body**: `{ documentIds: number[] }`
- **Response**: Success message with processed count
- **Processing**: Asynchronous embedding generation

### **Request/Response Schemas**

#### **Knowledge Topic Schema**
```typescript
interface KnowledgeTopic {
  id: number;
  name: string;
  description?: string;
  parentId?: number; // For hierarchical topics
  organizationId: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  documentCount?: number; // Computed
  childTopics?: KnowledgeTopic[]; // Computed
}
```

#### **Knowledge Document Schema**
```typescript
interface KnowledgeDocument {
  id: number;
  title: string;
  description?: string;
  sourceType: 'text' | 'upload' | 'link';
  content?: string; // For text documents
  filePath?: string; // For uploaded files
  url?: string; // For linked documents
  mimeType: string;
  size?: number;
  topicIds: number[];
  metadata: Record<string, any>; // Custom metadata
  organizationId: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  extractedEntities?: Record<string, any>; // Auto-extracted
  embeddingId?: string; // Vector reference
  verificationStatus: 'staging' | 'verified' | 'rejected';
}
```

#### **Knowledge Graph Node Schema**
```typescript
interface KnowledgeNode {
  id: number;
  label: string; // Type classification
  name: string; // Human-readable name
  externalId?: string; // ID in source system
  data: Record<string, any>; // Flexible metadata
  knowledgeDocumentId?: number; // Source document reference
  knowledgeTopicId?: number; // Topic association
  organizationId: number;
  embedding?: number[]; // Vector embedding
  createdAt: Date;
  updatedAt: Date;
}
```

#### **Knowledge Graph Edge Schema**
```typescript
interface KnowledgeEdge {
  id: number;
  sourceId: number;
  targetId: number;
  relationshipType: string;
  strength?: number; // Relationship strength (0-1)
  bidirectional: boolean;
  metadata: Record<string, any>;
  organizationId: number;
  createdAt: Date;
}
```

### **Error Handling & Status Codes**

#### **Document Processing Errors**
- `UNSUPPORTED_FILE_TYPE`: File format not supported
- `FILE_TOO_LARGE`: Document exceeds size limit
- `EXTRACTION_FAILED`: Content extraction failed
- `EMBEDDING_FAILED`: Vector generation failed
- `STORAGE_QUOTA_EXCEEDED`: Organization storage limit exceeded

#### **Graph Operation Errors**
- `NODE_NOT_FOUND`: Referenced node doesn't exist
- `CIRCULAR_REFERENCE`: Creating circular relationship
- `RELATIONSHIP_TYPE_INVALID`: Invalid relationship type
- `GRAPH_TOO_LARGE`: Query would return too much data
- `EMBEDDING_DIMENSION_MISMATCH`: Vector dimension issues

---

## **Component Architecture**

### **Knowledge Graph State Management**
```typescript
const KnowledgeGraph = () => {
  // Graph data
  const [nodes, setNodes] = useState<KnowledgeNode[]>([]);
  const [edges, setEdges] = useState<KnowledgeEdge[]>([]);
  const [selectedNode, setSelectedNode] = useState<KnowledgeNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<KnowledgeEdge | null>(null);
  
  // Visualization state
  const [layout, setLayout] = useState<'force' | 'hierarchical' | 'circular'>('force');
  const [filters, setFilters] = useState<GraphFilters>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  // UI state
  const [showNodeDetails, setShowNodeDetails] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [graphStats, setGraphStats] = useState<GraphStats | null>(null);
};
```

### **React Query Integration**
```typescript
// Graph data fetching
const { data: graphData, isLoading, error } = useQuery({
  queryKey: ['/api/knowledge/graph/nodes', filters],
  queryFn: () => fetchGraphNodes(filters),
  select: (data) => ({
    nodes: data.nodes,
    edges: data.edges || []
  })
});

// Document search
const { data: searchResults, isFetching } = useQuery({
  queryKey: ['/api/knowledge/search/semantic', searchQuery],
  queryFn: () => semanticSearch(searchQuery),
  enabled: !!searchQuery.trim(),
  staleTime: 5 * 60 * 1000 // 5 minutes
});

// Mutations for graph updates
const createNodeMutation = useMutation({
  mutationFn: createKnowledgeNode,
  onSuccess: (newNode) => {
    queryClient.invalidateQueries(['/api/knowledge/graph/nodes']);
    setSelectedNode(newNode);
  }
});
```

### **Key Component Interfaces**

#### **GraphCanvas Component**
```typescript
interface GraphCanvasProps {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  selectedNodeId?: string;
  onNodeClick: (node: KnowledgeNode) => void;
  onEdgeClick: (edge: KnowledgeEdge) => void;
  onNodeDrag: (nodeId: string, position: Point) => void;
  layout: GraphLayout;
  filters: GraphFilters;
  onFiltersChange: (filters: GraphFilters) => void;
}
```

#### **RagAssetManager Component**
```typescript
interface RagAssetManagerProps {
  jobId?: number;
  pipelineId?: number;
  selectedAssets: RagAsset[];
  onAssetSelect: (assets: RagAsset[]) => void;
  maxAssets?: number;
  organizationId: number;
}
```

### **Custom Hooks**

#### **useKnowledgeGraph**
```typescript
const useKnowledgeGraph = (filters?: GraphFilters) => {
  const { data, isLoading, error } = useQuery({
    queryKey: ['/api/knowledge/graph', filters],
    queryFn: () => fetchGraphData(filters)
  });
  
  const createNode = useMutation({
    mutationFn: createKnowledgeNode,
    onSuccess: () => {
      queryClient.invalidateQueries(['/api/knowledge/graph']);
    }
  });
  
  return {
    nodes: data?.nodes || [],
    edges: data?.edges || [],
    isLoading,
    error,
    createNode: createNode.mutate,
    updateNode: (id, updates) => updateNodeMutation.mutate({ id, updates }),
    deleteNode: (id) => deleteNodeMutation.mutate(id)
  };
};
```

#### **useSemanticSearch**
```typescript
const useSemanticSearch = () => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  
  const search = useCallback(async (searchQuery: string, options?: SearchOptions) => {
    setIsSearching(true);
    try {
      const searchResults = await semanticSearch(searchQuery, options);
      setResults(searchResults);
    } finally {
      setIsSearching(false);
    }
  }, []);
  
  return { query, setQuery, results, isSearching, search };
};
```

#### **KnowledgeGarden**
```typescript
// URL-derived initial state (label, topicId) so the view is shareable
const searchString = useSearch();
const searchParams = new URLSearchParams(searchString);

// Local UI state
const [selectedNodes, setSelectedNodes] = useState<number[]>([]);
const [filterLabel, setFilterLabel] = useState<string>(searchParams.get("label") || "");
const [filterTopicId, setFilterTopicId] = useState<number | null>(
    searchParams.get("topicId") ? parseInt(searchParams.get("topicId")!, 10) : null
);
const [page, setPage] = useState(1);
const [selectedSourceNode, setSelectedSourceNode] = useState<KnowledgeNode | null>(null);
const [correctionNode, setCorrectionNode] = useState<KnowledgeNode | null>(null);
const [corrections, setCorrections] = useState<{ label?: string; name?: string }>({});

// Staging queue (paginated, filtered)
const { data: stagingData, isLoading, refetch } = useQuery({
  queryKey: ["/api/knowledge-graph/staging", page, filterLabel, filterTopicId, selectedOrgId],
  queryFn: () => fetch(`/api/knowledge-graph/staging?page=${page}&limit=50&label=${filterLabel}&topicId=${filterTopicId}`).then(r => r.json()),
});

// Header counters + filter dropdown counts
const { data: stats } = useQuery({
  queryKey: ["/api/knowledge-graph/staging/stats", selectedOrgId],
  queryFn: () => fetch(`/api/knowledge-graph/staging/stats?orgId=${selectedOrgId}`).then(r => r.json()),
});

// Single-node verify (approve / reject / correct)
const verifyMutation = useMutation({
  mutationFn: ({ nodeId, action, corrections }) =>
    fetch(`/api/knowledge-graph/nodes/${nodeId}/verify`, {
      method: "POST",
      body: JSON.stringify({ action, corrections }),
    }).then(r => r.json()),
  onSuccess: () => {
    // Invalidate BOTH the queue and the stats so header counters + filter dropdowns refresh
    queryClient.invalidateQueries({ queryKey: ["/api/knowledge-graph/staging"] });
    queryClient.invalidateQueries({ queryKey: ["/api/knowledge-graph/staging/stats"] });
    setCorrectionNode(null);
    setCorrections({});
  },
});

// Bulk verify (selection-driven, label-driven, or run-driven)
const bulkVerifyMutation = useMutation({
  mutationFn: ({ action, nodeIds, label }) =>
    fetch(`/api/knowledge-graph/staging/bulk-verify`, {
      method: "POST",
      body: JSON.stringify({ action, nodeIds, label }),
    }).then(r => r.json()),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["/api/knowledge-graph/staging"] });
    queryClient.invalidateQueries({ queryKey: ["/api/knowledge-graph/staging/stats"] });
    setSelectedNodes([]);
  },
});
```

---

## **Integration Points**

### **External Services**
- **Qdrant Vector Database**: Semantic search and similarity matching
- **AI Embedding Models**: OpenAI, Google for text embeddings
- **Document Processing Services**: PDF parsing, OCR, content extraction
- **Cloud Storage**: AWS S3, Google Cloud Storage for file storage
- **Webhook Services**: External knowledge source synchronization

### **Database Dependencies**
- **knowledge_topics table**: Topic hierarchy and metadata
- **knowledge_documents table**: Document storage and metadata
- **knowledge_nodes table**: Graph node storage
- **knowledge_edges table**: Relationship storage
- **embeddings table**: Vector embeddings reference
- **organizations table**: Multi-tenancy boundaries
- **users table**: Document access and permissions

### **Vector Database Integration**
- **Qdrant Collections**: Separate collections per organization
- **Embedding Storage**: 768-dimensional vectors for text
- **Similarity Search**: Cosine similarity for semantic search
- **Batch Operations**: Bulk embedding generation and indexing
- **Collection Management**: Automated cleanup and optimization

### **Internal Service Dependencies**
- **Jobs Service**: RAG integration for AI job enhancement
- **Pipeline Service**: Knowledge context in pipeline steps
- **Auth Service**: Document and topic access permissions
- **File Storage Service**: Document upload and retrieval
- **AI Service**: Embedding generation and text analysis
- **Notification Service**: Document processing status updates

---

## **Error Handling & Edge Cases**

### **Document Processing Validation**
- **File Type Support**: Only allowed formats (PDF, DOCX, TXT, JSON)
- **File Size Limits**: Maximum 100MB per document
- **Content Extraction**: Handle corrupted or password-protected files
- **Encoding Issues**: Support UTF-8 and common encoding formats
- **Duplicate Detection**: Identify and handle duplicate documents

### **Knowledge Graph Validation**
- **Node Uniqueness**: Prevent duplicate nodes with same external ID
- **Relationship Constraints**: Validate allowed relationship types
- **Circular References**: Detect and prevent circular relationships
- **Graph Consistency**: Maintain referential integrity
- **Embedding Dimensions**: Ensure consistent vector dimensions

### **Search and RAG Errors**
- **Query Validation**: Validate search query format and length
- **Embedding Failures**: Handle AI service unavailability
- **Search Timeouts**: Limit search execution time
- **Context Limiting**: Respect token limits for RAG context
- **Fallback Strategies**: Keyword search when semantic search fails

### **Performance Edge Cases**
- **Large Document Handling**: Stream processing for large files
- **Graph Visualization**: Handle graphs with 1000+ nodes
- **Search Scalability**: Maintain performance with large document sets
- **Memory Management**: Prevent memory leaks in long-running operations
- **Concurrent Processing**: Handle multiple simultaneous document uploads

---

## **Performance Considerations**

### **Critical Paths**
- **Document Upload**: Must process documents < 30 seconds average
- **Semantic Search**: Search response time < 2 seconds
- **Graph Visualization**: Render graphs with 500+ nodes < 3 seconds
- **RAG Context Generation**: Context assembly < 1 second
- **Topic Navigation**: Load topic hierarchy < 1 second

### **Bottlenecks & Optimizations**
- **Embedding Generation**: AI API rate limits cause delays
- **Large Graph Rendering**: Canvas performance with 1000+ nodes
- **Document Processing**: CPU-intensive text extraction
- **Vector Search**: Memory usage with large embedding sets
- **File Storage**: Network latency for document uploads

### **Memory & CPU Usage**
- **Document Processing**: Stream processing to avoid memory spikes
- **Graph Visualization**: Virtual rendering for large graphs
- **Search Indexing**: Efficient data structures for fast search
- **Embedding Caching**: Cache frequently accessed embeddings
- **Component Memoization**: Prevent unnecessary re-renders

### **Network Request Patterns**
- **Batch Document Processing**: Process multiple documents in batches
- **Lazy Loading**: Load graph data on demand
- **Search Debouncing**: Debounce search inputs to reduce API calls
- **Background Processing**: Async document analysis
- **Progressive Loading**: Load search results incrementally

---

## **Security & Permissions**

### **Access Control**
- **Document-level Permissions**: View, edit, delete permissions per document
- **Topic Hierarchies**: Inherit permissions from parent topics
- **Organization Isolation**: Strict separation between organizations
- **RAG Access Control**: Only accessible documents in RAG context
- **Search Restrictions**: Users can only search accessible documents

### **Data Protection**
- **Document Encryption**: Encrypt sensitive documents at rest
- **Secure File Storage**: Secure cloud storage with encryption
- **Embedding Privacy**: Isolate embedding vectors by organization
- **Audit Logging**: Track all document access and modifications
- **Data Retention**: Configurable retention policies

### **Content Security**
- **Malware Scanning**: Scan uploaded documents for threats
- **Content Validation**: Validate document content and metadata
- **Injection Prevention**: Sanitize document content and search queries
- **Access Logging**: Comprehensive access logging for compliance
- **Rate Limiting**: Prevent abuse of search and upload features

---

## **Testing Requirements**

### **Unit Tests**
- **Document Processing**: Test all supported file formats
- **Graph Algorithms**: Test layout and path-finding algorithms
- **Search Functionality**: Test semantic and keyword search
- **Permission Logic**: Test access control and permissions
- **Embedding Generation**: Test vector generation and storage

### **Integration Tests**
- **Qdrant Integration**: Test vector database operations
- **AI Service Integration**: Test embedding generation
- **File Storage Integration**: Test document upload/retrieval
- **RAG Pipeline**: Test end-to-end RAG context generation
- **Multi-tenancy**: Test organization isolation

### **E2E Tests**
- **Document Ingestion Flow**: Complete upload-to-search workflow
- **Knowledge Graph Exploration**: Graph navigation and interaction
- **Search Workflows**: Various search scenarios and filters
- **RAG Integration**: Knowledge enhancement in AI jobs
- **Permission Scenarios**: Different user roles and access levels

---

## **Current Issues & Technical Debt**

### **Known Bugs**
- **Graph Performance**: Visualization freezes with 500+ nodes
- **Search Relevance**: Inconsistent relevance scoring across document types
- **Embedding Sync**: Race conditions in embedding generation
- **File Upload**: Large file uploads sometimes fail silently
- **Memory Leaks**: Long-running knowledge graph sessions consume memory

### **Performance Issues**
- **Initial Load**: Knowledge graph takes 8+ seconds to load with 1000+ nodes
- **Search Performance**: Semantic search takes 5+ seconds with large document sets
- **Document Processing**: PDF extraction can take 2+ minutes for large files
- **Bundle Size**: Knowledge components add 4MB to bundle
- **API Response Times**: Graph API responses > 3 seconds under load

### **Code Quality Issues**
- **KnowledgeGraph.tsx**: 1027 lines, multiple responsibilities mixed
- **RagAssetManager.tsx**: 771 lines, complex state management
- **Duplicate Logic**: Similar patterns across search components
- **Inconsistent Error Handling**: Different approaches across components
- **Limited Test Coverage**: < 30% coverage for knowledge features

---

## **Documentation References**

### **Related Documents**
- [01-jobs-system.md](./01-jobs-system.md) - RAG integration with jobs
- [02-pipelines-system.md](./02-pipelines-system.md) - Knowledge in pipelines
- 05-auth-system.md - Permission system
- 13-api-architecture.md - Complete API documentation

### **External Documentation**
- [Qdrant Vector Database](https://qdrant.tech/) - Vector storage and search
- [OpenAI Embeddings](https://platform.openai.com/docs/guides/embeddings) - Text embeddings
- [React Flow](https://reactflow.dev/) - Graph visualization library
- [PDF.js](https://mozilla.github.io/pdf.js/) - PDF processing

### **Important Code Locations**
- Knowledge schemas in shared/schema/knowledge.ts
- Graph algorithms in server/services/knowledge-graph-service.ts
- Vector operations in server/knowledge/knowledge-graph-integration.ts
- Document processing in server/services/document-service.ts