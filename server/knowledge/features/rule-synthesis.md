# Feature Specification: Rule Synthesis & Formal Proof Engine

## Overview
**Rule Synthesis Core** is elevated to **Level 3 (Supervised / Beta)**. It provides natural language business logic compilation into typed AST `RuleBranchSpec` representations with mathematical formal proof verification before runtime activation in the Decision Intelligence engine.

```
                 ┌───────────────────────────────────────┐
                 │    Natural Language Business Directive│
                 └──────────────────┬────────────────────┘
                                    │
                                    ▼
                 ┌───────────────────────────────────────┐
                 │       AST Rule Compiler Engine        │
                 │   • Crisp Predicates (Severity, etc.) │
                 │   • Numeric / Range Constraints       │
                 └──────────────────┬────────────────────┘
                                    │
                                    ▼
                 ┌───────────────────────────────────────┐
                 │       Formal Verification Engine      │
                 │   • Contradiction Detection           │
                 │   • Inverted Boundary Checks          │
                 │   • Unsatisfiable Conjunctions        │
                 └──────────────────┬────────────────────┘
                                    │
                         ┌──────────┴──────────┐
                         │ Proof Verified?     │
                         └──────────┬──────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼ NO                            ▼ YES
     ┌───────────────────────────────┐  ┌───────────────────────────────┐
     │   Reject with Proof Report    │  │   Issue Verification Cert     │
     │   • Return detailed conflict  │  │   • Enroll in Rule Suite      │
     │     reasons and diagnostics   │  │   • Activate in Runtime GRIE  │
     └───────────────────────────────┘  └───────────────────────────────┘
```

---

## Core Capabilities

### 1. Natural Language Rule Compilation
- Compiles natural language trigger sentences into typed `RuleBranchSpec` objects with `CrispCondition` predicates (`synthesizeRuleFromNaturalLanguage`).

### 2. Formal Verification & Contradiction Detection
- `verifyRuleFormalConsistency(branch)` performs:
  - **Equality Contradictions**: Detects conflicting equality conditions under `ALL` match strategy (e.g. `severity == Critical` and `severity == Low`).
  - **Unsatisfiable Numeric Ranges**: Detects impossible overlapping boundaries (e.g. `price > 100` and `price < 50`).
  - **Inverted Bounds**: Detects inverted `between` intervals (`[min, max]` where `min > max`).

### 3. Automated Verification
- Verified via [rule-synthesis.test.ts](../../domain/signal-intelligence/tests/integration/rule-synthesis.test.ts).
