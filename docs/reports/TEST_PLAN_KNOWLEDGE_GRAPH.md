# Knowledge Graph End-to-End Test Plan

## Test Objectives
Verify that the complete knowledge graph flow works as expected:
1. Data enters from pipeline execution
2. Extraction mechanisms work (explicit rules, semantic enrichment)
3. Nodes and edges are created correctly
4. Data is immediately available via APIs
5. Mutation tracking works
6. Relationship discovery works

---

## Test Environment Setup

### Prerequisites
- Database is running and accessible
- Qdrant is running (for semantic search)
- Server is running
- Test user/organization exists

### Test Data
- Sample pipeline with knowledge graph configuration
- Sample job outputs (JSON format)
- Test organization ID

---

## Test Cases

### TC1: Explicit Rules Extraction
**Objective**: Verify explicit knowledge graph rules extract entities correctly

**Steps**:
1. Create a pipeline step with explicit knowledge graph rules
2. Execute pipeline with sample JSON output
3. Verify nodes are created in database
4. Verify edges are created between nodes
5. Verify idempotent updates (re-run creates updates, not duplicates)

**Expected Results**:
- Nodes created with correct label, name, externalId
- Node data contains full source data
- Edges created with correct relations
- Re-execution updates existing nodes (same externalId)

**Validation Points**:
- Database query: `SELECT * FROM knowledge_nodes WHERE pipeline_execution_id = ?`
- Database query: `SELECT * FROM knowledge_edges WHERE ...`
- API call: `GET /api/knowledge-graph/nodes`

---

### TC2: Semantic Enrichment
**Objective**: Verify semantic enrichment extracts entities from text

**Steps**:
1. Create schema profile with regex/AI extraction rules
2. Execute pipeline with text-containing output
3. Verify anchor nodes are created
4. Verify extracted entities are created
5. Verify edges connect anchors to extracted entities

**Expected Results**:
- Anchor nodes created (main entities)
- Extracted entities created (from text)
- Edges created with confidence scores
- Schema profile rules applied correctly

**Validation Points**:
- Database query: Check nodes with `created_by = 'system_enrichment'`
- Database query: Check edges with confidence weights
- API call: `GET /api/knowledge-graph/nodes?label=...`

---

### TC3: Data Availability
**Objective**: Verify data is immediately available after creation

**Steps**:
1. Execute pipeline with knowledge graph enabled
2. Immediately query API endpoints
3. Verify pagination works
4. Verify filtering works

**Expected Results**:
- Nodes available via `GET /api/knowledge-graph/nodes`
- Edges available via `GET /api/knowledge-graph/edges`
- Pagination returns correct structure: `{ nodes: [], total: N, page: 1, limit: 50 }`
- Filtering by label/data works

**Validation Points**:
- API response structure matches expected format
- Total count is correct
- Nodes/edges match database records

---

### TC4: Run Context
**Objective**: Verify run context shows correct graph for a pipeline execution

**Steps**:
1. Execute pipeline (Run 1)
2. Execute pipeline again (Run 2) with related data
3. Query run context for Run 2
4. Verify it shows Run 2 entities + historical connections

**Expected Results**:
- Run context returns nodes from the run
- Run context returns edges created/updated by the run
- Historical edges are included (star topology)
- Orphan nodes (no edges) are included

**Validation Points**:
- API call: `GET /api/knowledge-graph/run-context/:runId`
- Response contains `{ nodes: [], edges: [] }`
- All nodes have `pipeline_execution_id = runId` OR are connected via edges

---

### TC5: Mutation Tracking
**Objective**: Verify mutation detection works across time windows

**Steps**:
1. Execute pipeline in baseline window (creates nodes with status="Open")
2. Execute pipeline in comparison window (updates nodes with status="Closed")
3. Run forensic analysis
4. Compare node data between windows

**Expected Results**:
- Baseline window returns correct node count
- Comparison window returns correct node count
- Node data shows mutations (status changed)
- Execution counts are accurate

**Validation Points**:
- API call: `POST /api/knowledge-graph/forensics/aggregate-diff`
- Response contains baseline and comparison results
- Node data comparison shows mutations

---

### TC6: Relationship Discovery
**Objective**: Verify relationships are discovered correctly

**Steps**:
1. Create nodes with explicit relationships (via rules)
2. Create nodes with semantic relationships (via enrichment)
3. Query relationships via search
4. Verify relationship traversal works

**Expected Results**:
- Explicit relationships created correctly
- Semantic relationships created correctly
- Search finds related nodes
- Edge weights reflect confidence/strength

**Validation Points**:
- Database query: Check edges table
- API call: `GET /api/knowledge-graph/search`
- Graph traversal returns connected nodes

---

### TC7: Idempotent Updates
**Objective**: Verify same entity updates, doesn't duplicate

**Steps**:
1. Execute pipeline creating node with externalId="TEST-123"
2. Execute pipeline again with same externalId but different data
3. Verify only one node exists
4. Verify node data is updated (merged)

**Expected Results**:
- Only one node with externalId="TEST-123"
- Node data contains merged information
- `updatedAt` timestamp is updated
- `pipelineExecutionId` may reference latest run

**Validation Points**:
- Database query: `SELECT COUNT(*) FROM knowledge_nodes WHERE external_id = 'TEST-123'` → Should be 1
- Node data contains both old and new fields

---

### TC8: Qdrant Integration
**Objective**: Verify vector embeddings are created and searchable

**Steps**:
1. Create knowledge graph node
2. Wait for embedding generation
3. Perform semantic search
4. Verify results are relevant

**Expected Results**:
- Embedding created in Qdrant
- Semantic search returns relevant nodes
- Search results ordered by similarity

**Validation Points**:
- Qdrant collection contains point for node
- API call: Semantic search endpoint
- Results are semantically relevant

---

## Test Execution Strategy

### Phase 1: Unit Tests
- Test individual functions (extraction, node creation, edge creation)
- Mock dependencies (database, Qdrant)

### Phase 2: Integration Tests
- Test pipeline execution → knowledge graph creation
- Test API endpoints with real database

### Phase 3: End-to-End Tests
- Full pipeline execution
- Verify complete flow
- Validate all components work together

---

## Validation Chain

Each test will follow this validation chain:

1. **Input Validation**: Verify test data is correct
2. **Execution**: Run the test operation
3. **Database Validation**: Query database to verify state
4. **API Validation**: Query APIs to verify data availability
5. **Data Integrity**: Verify data consistency across systems
6. **Output Validation**: Verify results match expectations

---

## Success Criteria

All tests must pass:
- ✅ Nodes created correctly
- ✅ Edges created correctly
- ✅ Data available via APIs
- ✅ Mutations tracked correctly
- ✅ Relationships discovered correctly
- ✅ Idempotent updates work
- ✅ Qdrant integration works

---

## Test Scripts

See `test-knowledge-graph-e2e.ts` for automated test execution.

