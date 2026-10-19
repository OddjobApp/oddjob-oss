# Intelligent Automation Phase 2: The Analytic Brain
**Proposal for Advanced Cognitive Features**

**Version:** 1.0 (Draft)
**Status:** Proposal
**Dependencies:** Master Intelligent Automation Spec (Stage 4 Completed)

---

## 1. Executive Summary

Phase 1 of Intelligent Automation (JIRA Solver, Knowledge Extraction) successfully established the "Nervous System" (Control Flow) and the "Memory Formation" (Graph Construction) of the platform.

**Phase 2 focuses on "Cognition"**: enabling the system to *understand*, *query*, and *refine* its own knowledge. We propose re-introducing the scope previously deferred: AI-assisted schema generation, natural language graph querying, and a human-in-the-loop "Gardening" interface for knowledge management.

These features transition Oddjob from a "Knowledge Recorder" to a "Knowledge Analyst."

---

## 2. Feature: AI Schema Architect
*Automated Ontology Design*

Currently, defining a Knowledge Graph Schema requires deep understanding of the domain and graph theory. This feature lowers the barrier by allowing users to describe their domain in English.

### 2.1. Functional Specification
*   **Input**: "Supply Chain Management for a Coffee Roaster."
*   **Process**:
    1.  AI analyzes the domain concepts.
    2.  Proposes Node Labels (e.g., `Supplier`, `BeanType`, `RoastBatch`, `Shipment`).
    3.  Proposes Edge Relations (e.g., `SUPPLIES`, `USED_IN`, `SHIPPED_TO`).
    4.  Proposes Properties for each (e.g., `roast_level` on `RoastBatch`).
*   **Output**: A fully formatted JSON Schema definition ready to be saved.

### 2.2. Technical Implementation
*   **Endpoint**: `POST /api/knowledge/schemas/suggest`
*   **Prompt Strategy**:
    ```text
    Role: Senior Data Architect.
    Task: Design a Knowledge Graph Ontology for the following domain: "{{userInput}}".
    Format: JSON.
    Structure:
    - nodes: [{ label, description, properties: [{name, type}] }]
    - edges: [{ relation, source_label, target_label }]
    Constraints: Use standard casing (UpperSnakeCase for relations, PascalCase for nodes). Keep schema simple (< 8 node types).
    ```
*   **UI Integration**: Add an "Auto-Generate" button in the Schema Editor modal.

---

## 3. Feature: Semantic Graph Query Engine
*Natural Language to Graph Logic*

Allows users to ask complex questions that require traversing relationships, rather than just matching keywords (Vector Search).

### 3.1. Functional Specification
*   **Type 1: Entity Retrieval**: "Show me all high-priority tickets related to the 'Auth Service'."
    *   *Logic*: Find Node(`Ticket`, status='High') -[RELATES_TO]-> Node(`System`, name='Auth Service').
*   **Type 2: Impact Analysis**: "What depends on the 'Login API'?"
    *   *Logic*: Find Node('Login API') <-[DEPENDS_ON*]- (Any Node).

### 3.2. Technical Implementation
*   **Architecture**:
    *   **Translator (LLM)**: Converts NL -> Structured Filtering Logic (Intermediate Representation or SQL).
    *   **Executor**: Runs the query against `knowledge_nodes` and `knowledge_edges`.
*   **Endpoint**: `POST /api/knowledge/graph/query`
    *   *Body*: `{ query: "..." }`
*   **Prompt Strategy**:
    *   Provide the LLM with the *active* Schema Definitions.
    *   Prompt: "Convert this question into a JSON graph query filter. Schema: [ ... ]. Question: '...'"


---

## 4. Feature: Enhanced RAG (Query Refinement)
*Metacognitive Retrieval*

Standard RAG fails when the user's query is vague or uses terminology that differs from the source documents. This feature introduces a "Thought Step" before retrieval.

### 4.1. Functional Specification
*   **Mechanism**: "Hypothetical Document Embeddings" (HyDE) or "Multi-Query Expansion".
*   **Workflow**:
    1.  User Query: "Why is the build failing?"
    2.  **Refiner (Hidden AI Step)**: "Active error logs, CI/CD pipeline timeouts, compilation errors in module X."
    3.  **Vector Search**: Searches for the *refined/expanded* terms.
    4.  **Result**: Retrieves documents that match the *intent*, not just the *keywords*.
*   **Configuration**: Toggle "Enable Query Expansion" in Job Settings.

### 4.2. Technical Implementation
*   **Design Decision**: Do NOT create a separate "Refiner" Job Type. This functionality must be implemented as a configuration option within the existing `ai_api_call` job (e.g., `enableQueryExpansion: boolean`) to keep pipeline graphs clean.
*   **Middleware**: New `RefineQuery` function in `rag-langchain.ts`.
*   **Integration**: Called automatically inside `buildHybridContextFromAssets` if enabled.

---

## 5. Feature: The "Knowledge Garden" (HIL Review)
*Curating the Graph*

Automated extraction is noisy. The "Knowledge Garden" is a staging area where extracted nodes/edges sit in a `pending` state until verified by a human. This ensures the "Live Graph" remains high-quality (Golden Data).

### 4.1. Functional Specification
*   **Staging Buffer**: Updates `KnowledgeExtractionService` to flag confidence. Low confidence extractions go to "Staging".
*   **Review Interface**:
    *   Split screen: Source Document (highlighted) vs. Extracted Entities.
    *   actions: "Approve", "Correct" (Edit properties), "Reject".
    *   **Bulk Actions**: "Approve all from this document."

### 4.2. Database Updates
*   **`knowledge_nodes` / `knowledge_edges`**:
    *   Add column: `verification_status` (`verified`, `staging`, `rejected`).
    *   Add column: `confidence_score` (Float).
*   **API**:
    *   `POST /api/knowledge/nodes/:id/verify`: Promotes node to `verified`.

---

## 6. Feature: Universal "Analyst" Search Bar
*Unified Discovery*

Merges the three search modalities (Keyword, Vector, Graph) into a single user experience.

### 6.1. Functional Specification
*   **UI Component**: A central command bar (Cmd+K style).
*   **Mode Detection** (AI Router):
    *   "Search for 'invoice'" -> **Keyword Search**.
    *   "How do I reset my password?" -> **Vector/RAG Search**.
    *   "Show connections between Team A and Project B" -> **Graph Search**.
*   **Visual Result**:
    *   Text results shown as lists.
    *   Graph results shown as a mini force-directed graph within the dropdown or results page.

---

## 7. Implementation Roadmap

### month 1: Intelligence
1.  Build **Schema Architect** (Low effort, high value).
2.  Implement **Semantic Graph Querying** (Backend only).
3.  Implement **Enhanced RAG (Query Expansion)**.

### Month 2: Governance
4.  Implement **Database Schema changes** for Staging/Verification.
5.  Build **"Knowledge Garden" UI**.

### Month 3: User Experience
6.  Build **Universal Search Bar**.
7.  Integrate Graph Visualizations into main search results.
