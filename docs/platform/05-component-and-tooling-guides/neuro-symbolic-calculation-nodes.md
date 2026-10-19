---
id: neuro-symbolic-calculation-nodes
title: Neuro-Symbolic Calculation Nodes, AST Formulas & Reactive Cascades
audience: [HUMAN_PRIMARY, AGENT_PRIMARY, HYBRID]
badge: HYBRID
category: 05-component-and-tooling-guides
autonomy_level: L1-L3
version: 1.0.0
tags: [calculations, neuro-symbolic, ast, formulas, graph-cascades, math, precision, reactive]
summary: Comprehensive guide for developing deterministic, neuro-symbolic calculation nodes in Oddjob, handling AST mathematical formulas, unit reconciliation, and reactive graph edge cascades.
verification_status: verified
applies_when:
  - Defining mathematical formulas, KPI metrics, dynamic pricing, or financial allocations in Knowledge Garden
  - Creating reactive DAG dependency chains where updating node X triggers recalculated values across downstream nodes
  - Enforcing exact mathematical precision and eliminating LLM arithmetic hallucination
do_not_use_when:
  - Performing qualitative language generation or conversational synthesis
required_tools:
  - create_calculation_node
  - execute_calculation_node
  - list_calculation_nodes
  - calculate_dataset_metric
preconditions:
  - Calculation formula expressed in valid mathematical AST or mathjs syntax
  - Input variables mapped to valid Knowledge Graph entity properties
approval_requirements:
  - Modifications to production financial calculation formulas require Finance Owner sign-off
success_checks:
  - Formula passes topological sort cycle detection with zero circular references
  - Output evaluates with verified decimal precision (e.g. standard IEEE 754 float / Decimal.js)
stop_conditions:
  - Circular reference detected in `INPUT_TO` dependency graph or divide-by-zero condition
escalation:
  - Fall back to last known valid cached metric value and flag error on calculation HUD
implementation_evidence:
  - server/domain/knowledge/core/calculations/calculation.service.ts
---

# Neuro-Symbolic Calculation Nodes & AST Cascades `[🤝 HYBRID]`

> **Audience:** `🤝 Hybrid (Analytics Engineers + Mathematical Agents)` &nbsp;|&nbsp; **Classification:** Component Architecture & Calculation Engine

---

## 1. Neuro-Symbolic Architecture Overview `[🧑 Human]`

LLMs frequently hallucinate arithmetic calculations. Oddjob uses **Neuro-Symbolic Calculation Nodes** to separate cognitive semantic reasoning from deterministic algebraic computation:

```mermaid
graph LR
    subgraph CognitiveLayer["1. Cognitive Layer (LLM)"]
        Semantic["LLM analyzes business intent<br/>and generates AST Formula"]
    end

    subgraph SymbolicEngine["2. Symbolic Calculation Engine"]
        AST["Formula AST Parser & Validator"]
        UnitCheck["Unit Dimension Checker (e.g. USD, hours, kg)"]
        PrecisionCalc["Decimal.js Exact Precision Evaluator"]
    end

    subgraph ReactiveGraph["3. Reactive Knowledge Graph"]
        ParentNode["Entity: Order (Price = $100, Tax = 8%)"]
        CalcNode["CalculationNode: TotalWithTax = Price * (1 + Tax)"]
        DownstreamNode["Entity: Invoice (Amount Due = $108.00)"]
    end

    Semantic --> AST --> UnitCheck --> PrecisionCalc
    ParentNode -->|INPUT_TO| CalcNode
    CalcNode -->|DERIVES| DownstreamNode
```

---

## 2. Calculation Node Schema Contract `[🤖 Agent Reference]`

Every calculation node registered in the Knowledge Garden must conform to the standard structure:

```typescript
export interface CalculationNodeDefinition {
  id: string;
  name: string;
  description: string;
  formula: string; // e.g. "basePrice * (1 + taxRate) - discount"
  ast?: Record<string, any>;
  inputs: Array<{
    variableName: string;
    sourceEntityId: string;
    sourceProperty: string;
    unit: string; // e.g. "USD", "ratio", "seconds"
    defaultValue?: number;
  }>;
  output: {
    unit: string;
    precision: number; // decimal places, e.g. 2
    roundingMode: "ROUND_HALF_UP" | "FLOOR" | "CEIL";
  };
  reactive: boolean; // Auto-trigger downstream on input mutation
}
```

---

## 3. Reactive Graph Cascades & Circular Dependency Prevention `[🧑 Human]`

When an upstream entity property changes, the calculation engine propagates updates topologically:

```mermaid
sequenceDiagram
    autonumber
    participant Entity as Knowledge Entity Property Update
    participant Engine as Calculation Service
    participant Topo as Topological Sorter
    participant Graph as Knowledge Graph

    Entity->>Engine: Property Mutated (e.g., raw_temperature_celsius = 25)
    Engine->>Topo: Build Subgraph DAG of downstream calculation nodes
    alt DAG is Acyclic
        Topo-->>Engine: Return Execution Order [Node_A, Node_B, Node_C]
        loop For each calculation node in order
            Engine->>Engine: Resolve Inputs -> Evaluate AST -> Compute Output
            Engine->>Graph: Persist Computed Value & Update LastEvaluatedAt
        end
    else Cycle Detected (e.g. Node A -> Node B -> Node A)
        Topo-->>Engine: Error: CIRCULAR_DEPENDENCY_DETECTED
        Engine->>Engine: Abort Cascade & Revert to Last Stable Value
        Engine->>Graph: Log Metric Integrity Warning
    end
```

---

## 4. Arithmetic Invariants & Precision Rules `[🤖 Agent Reference]`

1. **Exact Decimal Representation**:
   - Never use native floating-point math `0.1 + 0.2 === 0.30000000000000004` for currency or inventory. Always use `Decimal.js` or `BigNumber`.
2. **Strict Unit Reconciliation**:
   - Adding mismatched dimensions (e.g. `USD + EUR` without an exchange rate node, or `meters + seconds`) must throw a typed `DIMENSIONAL_ANALYSIS_ERROR`.
3. **Divide-by-Zero Handling**:
   - Formulas must define explicit null-handling or fallback values for zero divisors (e.g. `denominator === 0 ? null : numerator / denominator`).
