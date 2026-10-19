# Neuro-Symbolic Knowledge Graph Calculation System

## System Overview

The Calculation System provides a neuro-symbolic computation engine within the Oddjob Knowledge Graph platform. It combines structural knowledge graph nodes and edges with deterministic, probabilistic, machine learning, and temporal mathematical operations.

The system supports **7 core calculation categories** and over **35 distinct operations**:

1. **Basic Math & Aggregation**
   - Arithmetic formulas (`formula` with sandboxed variable replacement)
   - SUM, AVERAGE, MIN, MAX aggregations over input references or `INPUT_TO` edges
   - Conditional logic and statistical metrics

2. **Temporal Calculations**
   - Moving Average, Exponential Smoothing
   - Year-over-Year (YoY), Month-over-Month (MoM), CAGR (Compound Annual Growth Rate)
   - Rolling Sum & Rolling Average over historical time series data (`calculation_time_series` table)

3. **Probabilistic & Risk Analysis**
   - Monte Carlo Simulation (Normal, Uniform, Triangular, LogNormal distributions)
   - Bayesian Inference (Prior/Likelihood update)
   - Confidence Intervals & Risk Scoring
   - Sensitivity Analysis

4. **Constraint & Governance Validation**
   - Threshold Validation & Policy Enforcement
   - Gate Condition evaluation (`PASS` / `FAIL`)
   - Compliance Rule Checking

5. **Graph Algorithms**
   - PageRank, Betweenness Centrality, Closeness Centrality
   - Shortest Path (Dijkstra) & Minimum Spanning Tree
   - Community Detection (Louvain / Modular Clustering) & Influence Propagation

6. **ML Inference**
   - Model Prediction, Classification & Regression Inference
   - Anomaly Detection (Z-Score / Isolation Forest)
   - Model Ensembling & Dimensionality Reduction

7. **Advanced & Hybrid Operations**
   - Hybrid Edge-Based Calculations (`INPUT_TO` edges)
   - Reactive cascading updates triggered when input graph nodes change

---

## Interactive Visual Calculation Studio & Drag-and-Drop Canvas

The Calculation System is fully operationalized across frontend interfaces:

### 1. Dedicated Calculation Studio (`/knowledge/calculations`)
- **Page Component:** [`CalculationsPage.tsx`](../client/src/modules/knowledge/pages/CalculationsPage.tsx)
- **Calculation Inventory:** [`CalculationList.tsx`](../client/src/components/calculations/CalculationList.tsx) with search, category filtering, status badges, and 1-click execution.
- **Formula Builder:** [`CalculationBuilder.tsx`](../client/src/components/calculations/CalculationBuilder.tsx) supporting AST math expression generation, input node mapping, and parameter tuning.
- **Graph Topology Canvas:** Renders live calculations directly inside the Knowledge Network Visualizer.

### 2. Custom ReactFlow Calculation Node
- **Component:** [`CalculationGraphNode.tsx`](../client/src/components/calculations/CalculationGraphNode.tsx)
- Multi-port input dependency handles (`INPUT_TO`) and output target handles.
- Real-time cached output display, status indicators (`active`, `pending`, `error`), and on-node interactive execution trigger (`Play` button).

### 3. Interactive Drag-and-Drop Calculation Palette
- **Sidebar Component:** [`CalculationPalette.tsx`](../client/src/components/calculations/CalculationPalette.tsx)
- Categorized draggable cards (Arithmetic AST, Temporal YoY/CAGR, Monte Carlo/Bayes, Constraint Gates, Graph Centrality, ML Inferences).
- HTML5 Drag & Drop onto ReactFlow with automatic coordinate projection and backend persistence to `/api/calculations`.

### 4. Slide-Over Calculation Node Inspector
- **Component:** [`CalculationNodeInspector.tsx`](../client/src/components/calculations/CalculationNodeInspector.tsx)
- Slide-over drawer for configuring formulas, inspecting input dependencies, and executing instant evaluations.

---

## REST API Reference

### Calculation Management

- **`POST /api/calculations`**
  - Create a new calculation node.
  - Body:
    ```json
    {
      "name": "YoY Margin Growth",
      "operation": "YOY_GROWTH",
      "category": "temporal",
      "formula": "((current - previous) / previous) * 100",
      "inputReferences": [
        { "nodeId": 10, "variable": "current" },
        { "nodeId": 11, "variable": "previous" }
      ],
      "outputUnit": "%"
    }
    ```

- **`GET /api/calculations`**
  - List calculation nodes. Optional query filters: `status`, `operation`, `missionId`, `limit`, `offset`.

- **`GET /api/calculations/:id`**
  - Get a specific calculation node by ID.

- **`PUT /api/calculations/:id`**
  - Update a calculation node's formula, operation, or parameters.

- **`DELETE /api/calculations/:id`**
  - Remove a calculation node.

### Execution & History

- **`POST /api/calculations/:id/run`** & **`POST /api/calculations/:id/execute`**
  - Manually trigger execution of a calculation.
  - Returns calculated `result`, `executionTimeMs`, and `status`.

- **`GET /api/calculations/:id/history`**
  - Get historical execution logs (`executedAt`, `executionTimeMs`, `status`, `error`).

- **`GET /api/calculations/:id/result`**
  - Fetch the cached result and metadata without re-executing.

### Dependencies & Time Series

- **`GET /api/calculations/:id/dependencies`** & **`POST /api/calculations/:id/dependencies`**
- **`GET /api/calculations/:id/timeseries`** & **`POST /api/calculations/:id/timeseries`**

### Graph & ML Endpoints

- **`GET /api/graph/centrality`**: List node centrality scores across the knowledge graph.
- **`GET /api/graph/communities`**: List detected communities.
- **`GET /api/ml/models`** & **`POST /api/ml/models`**: Manage ML model versions and deployments.

---

## Reactive Updates Architecture

When any graph node value updates, `calculationService.triggerReactiveUpdates(nodeId, orgContext)` is called. It:
1. Queries `calculation_dependencies` for dependent calculation nodes.
2. Queries `INPUT_TO` knowledge edges for hybrid target calculation nodes.
3. Automatically re-executes dependent calculations in topological order and persists updated results.
