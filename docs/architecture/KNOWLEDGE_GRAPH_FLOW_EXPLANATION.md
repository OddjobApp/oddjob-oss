# Knowledge Graph: Data Flow and Analysis

## Overview
This document explains how data flows from Pipeline executions into the Knowledge Graph, how it becomes available for analysis, and how the system identifies data mutations and relationships.

---

## Part 1: Data Entry from Pipelines

### 1.1 Pipeline Execution Flow

When a pipeline executes, each step produces output data. The Knowledge Graph integration happens **after each successful step execution**:

```
Pipeline Execution
  └─> Step 1 Executes → Output: JSON Data
      └─> Knowledge Graph Processing (if enabled)
  └─> Step 2 Executes → Output: JSON Data
      └─> Knowledge Graph Processing (if enabled)
  └─> ...
```

**Location**: `server/pipeline-executor.ts` (lines 503-551)

### 1.2 Three Extraction Mechanisms

The system uses **three complementary methods** to extract entities and relationships:

#### **Method 1: Explicit Knowledge Graph Rules** (Primary)
- **When**: Step has `knowledgeGraphConfig` configured
- **How**: JSONPath-based extraction rules defined per step
- **Location**: `server/knowledge-graph-integration.ts` → `processExplicitKnowledgeGraphRules()`

**Example Configuration**:
```json
{
  "rules": [
    {
      "ruleId": "rule-1",
      "name": "Extract JIRA Tickets",
      "entityType": "Ticket",
      "sourceRootPath": "$.issues[*]",
      "externalIdPath": "$.key",
      "entityNamePath": "$.fields.summary",
      "includeFullSourceData": true
    }
  ],
  "internalEdges": [
    {
      "sourceRuleId": "rule-1",
      "targetRuleId": "rule-2",
      "relationType": "relates_to",
      "sourcePath": "$.project.key",
      "targetPath": "$.key"
    }
  ]
}
```

**Process**:
1. Parse step output as JSON
2. For each rule:
   - Use JSONPath to extract source objects (e.g., `$.issues[*]`)
   - Extract `externalId`, `name`, and optional data fields
   - **Idempotent Upsert**: Check if node exists by `(organizationId, label, externalId)`
   - If exists: **Update** node data (merge with existing)
   - If new: **Create** node and trigger embedding
3. Create edges between nodes from different rules based on join conditions

**Key Feature**: **Idempotent Updates**
- Same entity (same `externalId`) across multiple runs → **Updates** existing node
- This enables **mutation tracking** by comparing node data over time

---

#### **Method 2: Semantic Enrichment** (Automatic)
- **When**: Always runs if Knowledge Graph is enabled for the organization
- **How**: Uses global Schema Profiles (Regex/AI) to extract entities from unstructured text
- **Location**: `server/knowledge-graph-integration.ts` → `processSemanticEnrichment()`

**Process**:
1. **Identify Anchors**: Extract "main" entities from job output (e.g., Tickets, Issues)
2. **Extract Text**: Collect text from anchor entities (description, summary, body fields)
3. **Run Schema Profiles**: For each active schema:
   - **Regex Extraction**: Pattern matching (e.g., `VIN-\d+`, `[A-Z]{3}-\d{4}`)
   - **AI Extraction**: LLM-based extraction using prompts
4. **Create Relationships**: Anchor → Extracted Entity (with confidence scores)

**Example**:
- Anchor: JIRA Ticket "PROJ-11425" with description "Fix VIN-12345 issue"
- Schema Profile: Extract VINs using regex `VIN-\d+`
- Result: Creates edge `Ticket:PROJ-11425 --[mentions]--> VIN:VIN-12345`

**Location**: `server/services/knowledge-extractor.ts`

---

#### **Method 3: Human-in-the-Loop (HIL) Forms**
- **When**: Human approval forms are submitted/rated
- **How**: Creates nodes from form responses
- **Location**: `server/knowledge-graph-integration.ts` → `createKnowledgeGraphFromApproval()`

**Process**:
1. Form submission includes approval status, rating, comments
2. Creates/updates node with approval metadata
3. Links to related entities (tickets, features, etc.)

---

### 1.3 Node Creation and Embedding

**Node Storage**:
- Stored in PostgreSQL (`knowledge_nodes` table)
- Fields: `id`, `organizationId`, `label`, `name`, `externalId`, `data` (JSONB), `pipelineExecutionId`

**Vector Embedding** (Async):
- After node creation, triggers embedding generation
- Uses Qdrant vector database for semantic search
- Location: `server/knowledge-graph-service.ts` → `embedKnowledgeNode()`

**Edge Creation**:
- Stored in PostgreSQL (`knowledge_edges` table)
- Fields: `sourceId`, `targetId`, `relation`, `weight`, `lastUpdatedByRunId`
- **Duplicate Prevention**: Checks for existing edge before creation

---

## Part 2: Data Availability in Knowledge Graph

### 2.1 Immediate Availability

Once created, nodes and edges are **immediately available** via:

1. **List Endpoints**:
   - `GET /api/knowledge-graph/nodes` - Paginated list
   - `GET /api/knowledge-graph/edges` - Paginated list

2. **Search Endpoints**:
   - `GET /api/knowledge-graph/search` - Structural search (filter by label, data fields)
   - Semantic search via Qdrant (vector similarity)

3. **Run Context**:
   - `GET /api/knowledge-graph/run-context/:runId` - All nodes/edges from a specific pipeline run
   - Uses "star topology": Shows entities from run + historical connections

### 2.2 Graph Structure

**Nodes** represent entities:
- **Labels**: Entity types (e.g., `Ticket`, `Feature`, `User`, `VIN`)
- **Data**: Flexible JSONB storage (can store any properties)
- **External ID**: Unique identifier (e.g., JIRA ticket key, VIN number)

**Edges** represent relationships:
- **Relations**: Relationship types (e.g., `relates_to`, `mentions`, `approved_by`)
- **Weight**: Numeric strength (e.g., confidence score, rating)
- **Run Tracking**: `lastUpdatedByRunId` tracks which execution created/updated the edge

---

## Part 3: Analysis and Mutation Detection

### 3.1 Run Context Analysis

**Endpoint**: `GET /api/knowledge-graph/run-context/:runId`

**How it Works**:
1. Finds all edges created/updated by the run (`lastUpdatedByRunId = runId`)
2. Identifies "semantic targets" (entities extracted in this run)
3. **Finds historical connections**: Edges where targets were previously connected
4. Returns **star topology**: New entities + their historical relationships

**Use Case**: See how new data connects to existing knowledge

**Location**: `server/routes.ts` (lines 7992-8083)

---

### 3.2 Forensic Analysis (Aggregate Diff)

**Endpoint**: `POST /api/knowledge-graph/forensics/aggregate-diff`

**Purpose**: Compare knowledge graph state between two time windows to identify mutations

**How it Works**:
1. **Baseline Window**: Fetch all pipeline executions in time range A
2. **Comparison Window**: Fetch all pipeline executions in time range B
3. **Extract Nodes**: Get all knowledge nodes created by these executions
4. **Return Raw Data**: Frontend performs aggregation/diff

**Example Use Case**:
- Baseline: Last week's pipeline runs
- Comparison: This week's pipeline runs
- Analysis: Compare node counts, entity types, relationships

**Location**: `server/routes.ts` (lines 8277-8352)

**Data Structure**:
```json
{
  "baselineResults": {
    "executionCount": 50,
    "nodeCount": 200,
    "executions": [...],
    "nodes": [...]
  },
  "comparisonResults": {
    "executionCount": 60,
    "nodeCount": 250,
    "executions": [...],
    "nodes": [...]
  }
}
```

**Mutation Detection**:
- Compare node counts → Growth/decline
- Compare node data fields → Value changes
- Compare edge counts → Relationship changes
- Group by entity type → Type-specific trends

---

### 3.3 Structural Search

**Endpoint**: `GET /api/knowledge-graph/search`

**Capabilities**:
- Filter by node label (entity type)
- Filter by data field values (JSONPath queries)
- Filter by relationships (traverse edges)
- Pagination support

**Example Queries**:
- Find all Tickets with `status = "Open"`
- Find all Features related to a specific User
- Find all nodes connected to a specific Ticket

**Location**: `server/storage.ts` → `searchKnowledgeGraph()`

---

### 3.4 Semantic Search

**How it Works**:
1. User provides query text
2. Query is embedded using same model as nodes
3. Qdrant performs vector similarity search
4. Returns most similar nodes

**Use Case**: Find entities by meaning, not exact match

**Location**: `server/knowledge-graph-service.ts` → `searchQdrant()`

---

### 3.5 Analytics (Sankey Diagrams)

**Endpoint**: `GET /api/knowledge-graph/analytics/sankey`

**Purpose**: Visualize data flow between entity types

**How it Works**:
1. Groups nodes by dimensions (e.g., User, Component, Infrastructure)
2. Traverses edges to find relationships
3. Aggregates flow volumes
4. Returns Sankey chart data

**Example**: Show how Tickets flow through Users → Components → Infrastructure

**Location**: `server/storage.ts` → `getSankeyChartData()`

---

## Part 4: Identifying Data Mutations and Relationships

### 4.1 Mutation Detection Strategies

#### **Strategy 1: Temporal Comparison**
- Compare node data between time windows
- Track `pipelineExecutionId` to know when nodes were created/updated
- Use `updatedAt` timestamp to detect changes

**Implementation**:
```typescript
// Get nodes from baseline period
const baselineNodes = await getKnowledgeNodesByExecutionIds(baselineExecutionIds);

// Get nodes from comparison period
const comparisonNodes = await getKnowledgeNodesByExecutionIds(comparisonExecutionIds);

// Compare by externalId
const mutations = findDataMutations(baselineNodes, comparisonNodes);
```

#### **Strategy 2: Node Update Tracking**
- Nodes are **updated** (not duplicated) when same `externalId` appears in new run
- Compare `data` field between versions
- Track which fields changed

**Example**:
- Run 1: Creates `Ticket:PROJ-11425` with `status: "Open"`
- Run 2: Updates `Ticket:PROJ-11425` with `status: "Closed"`
- Mutation detected: Status changed from "Open" to "Closed"

#### **Strategy 3: Edge Evolution**
- Track edge creation/deletion over time
- Compare edge counts between periods
- Identify new relationships or broken relationships

**Example**:
- Baseline: 100 edges between Tickets and Features
- Comparison: 120 edges between Tickets and Features
- Mutation: 20 new relationships created

---

### 4.2 Relationship Discovery

#### **Explicit Relationships**
- Created by explicit rules (join conditions)
- Example: Ticket → Project (via `project.key` match)

#### **Semantic Relationships**
- Created by semantic enrichment
- Example: Ticket → VIN (via text extraction from description)

#### **Historical Relationships**
- Discovered via run context analysis
- Example: New Ticket connects to existing Feature (via shared attributes)

#### **Relationship Patterns**
- **Direct**: A → B (one edge)
- **Transitive**: A → B → C (multi-hop)
- **Bidirectional**: A ↔ B (edges in both directions)
- **Weighted**: Edge strength indicates relationship importance

---

### 4.3 Practical Use Cases

#### **Use Case 1: Ticket Status Tracking**
1. Pipeline fetches JIRA tickets daily
2. Each run creates/updates Ticket nodes
3. Compare node data over time to detect status changes
4. Visualize status transitions in Sankey diagram

#### **Use Case 2: Feature Dependency Analysis**
1. Pipeline extracts features from multiple sources
2. Semantic enrichment finds mentions of other features
3. Builds relationship graph
4. Identify feature dependencies and impact analysis

#### **Use Case 3: Anomaly Detection**
1. Baseline: Normal week's data patterns
2. Comparison: Current week's data
3. Detect anomalies:
   - Unusual spike in node creation
   - Missing expected relationships
   - Unexpected entity types

#### **Use Case 4: Data Quality Monitoring**
1. Track node creation rates by entity type
2. Monitor relationship completeness
3. Identify data gaps (missing expected connections)

---

## Part 5: Technical Architecture

### 5.1 Data Flow Diagram

```
Pipeline Execution
    │
    ├─> Step Output (JSON)
    │       │
    │       ├─> Explicit Rules → Extract Entities → Create/Update Nodes
    │       │                           │
    │       │                           └─> Create Edges (Internal)
    │       │
    │       ├─> Semantic Enrichment → Extract from Text → Create Nodes
    │       │                                   │
    │       │                                   └─> Create Edges (Anchor → Target)
    │       │
    │       └─> HIL Form → Approval Data → Create/Update Nodes
    │
    └─> Node Created
            │
            ├─> PostgreSQL (Structured Storage)
            │       ├─> knowledge_nodes
            │       └─> knowledge_edges
            │
            └─> Qdrant (Vector Storage)
                    └─> Embedding for Semantic Search
```

### 5.2 Key Components

1. **Pipeline Executor** (`server/pipeline-executor.ts`)
   - Orchestrates pipeline execution
   - Triggers knowledge graph processing after each step

2. **Knowledge Graph Integration** (`server/knowledge-graph-integration.ts`)
   - `processExplicitKnowledgeGraphRules()` - Rule-based extraction
   - `processSemanticEnrichment()` - Automatic extraction
   - `createKnowledgeGraphFromApproval()` - HIL integration

3. **Knowledge Extractor** (`server/services/knowledge-extractor.ts`)
   - Regex extraction
   - AI-based extraction

4. **Knowledge Graph Service** (`server/knowledge-graph-service.ts`)
   - Qdrant integration
   - Embedding generation
   - Semantic search

5. **Storage Layer** (`server/storage.ts`)
   - Database operations
   - Search queries
   - Forensic analysis helpers

6. **API Routes** (`server/routes.ts`)
   - REST endpoints
   - Run context
   - Forensic analysis
   - Analytics

---

## Part 6: Best Practices

### 6.1 Configuration

**Explicit Rules**:
- Use specific JSONPath expressions
- Define clear external IDs (unique identifiers)
- Include full source data for mutation tracking

**Semantic Enrichment**:
- Configure schema profiles per organization
- Use regex for high-confidence patterns
- Use AI for complex extraction (with validation)

### 6.2 Mutation Tracking

1. **Always use externalId**: Enables idempotent updates
2. **Store timestamps**: Track when nodes were created/updated
3. **Preserve history**: Don't overwrite data, merge intelligently
4. **Track execution IDs**: Link nodes to pipeline runs

### 6.3 Relationship Discovery

1. **Start with explicit rules**: Define known relationships
2. **Enable semantic enrichment**: Discover hidden relationships
3. **Review run contexts**: Understand how new data connects
4. **Use forensic analysis**: Compare periods to find patterns

---

## Summary

The Knowledge Graph system provides:

1. **Automatic Extraction**: Three methods (explicit rules, semantic enrichment, HIL)
2. **Idempotent Updates**: Same entities update, don't duplicate
3. **Immediate Availability**: Data accessible as soon as created
4. **Mutation Tracking**: Compare data across time windows
5. **Relationship Discovery**: Explicit and semantic relationships
6. **Analysis Tools**: Run context, forensic analysis, analytics

This enables comprehensive tracking of how data evolves over time and how entities relate to each other across pipeline executions.

