# Feature Specification: Semantic Retrospective RAG (Dual-Vector Steering)

## Overview
**Semantic Retrospective RAG** implements **Level 4 (Delegated / Production)** prompt-space behavioral steering. It provides contrastive dual-vector prior injection to OODA thinking agents by pairing **Golden Path SOPs** (positive priors) with **Failed Trace Anti-Patterns** (negative constraints).

```
                 ┌───────────────────────────────────────┐
                 │        OODA Orchestration Context     │
                 └──────────────────┬────────────────────┘
                                    │
                  ┌─────────────────┴─────────────────┐
                  ▼                                   ▼
      ┌───────────────────────┐           ┌───────────────────────┐
      │   Golden Path RAG     │           │   Anti-Pattern RAG    │
      │  (Positive Strategy)  │           │ (Negative Failure Trap│
      └───────────┬───────────┘           └───────────┬───────────┘
                  │                                   │
                  └─────────────────┬─────────────────┘
                                    ▼
                 ┌───────────────────────────────────────┐
                 │     Steering Vector Injection (α)     │
                 │   • ## PROVEN STRATEGY                │
                 │   • ## PROVEN ANTI-PATTERNS (DO NOT)  │
                 │   • Behavioral Directives (OCEAN)     │
                 └───────────────────────────────────────┘
```

---

## Core Capabilities

### 1. Dual-Vector Semantic Retrieval
- **Golden Path SOPs (`sourceType = 'golden_path'`)**: Retrieved via fast keyword and semantic scoring over indexed post-run distillation summaries.
- **Failed Trace Anti-Patterns (`sourceType = 'failed_trace'`)**: Retrieved from failed mission post-mortems to surface explicit traps, invalid assumptions, and broken tool calls.

### 2. Prompt-Space Contrastive Modulation
- Injects structured positive and negative blocks into the system prompt:
  ```markdown
  ## PROVEN STRATEGY (follow this approach)
  <Golden Path SOP steps>

  ## PROVEN ANTI-PATTERNS (DO NOT ATTEMPT — known failure modes)
  <Failed trace root causes and warnings>
  ```
- Injection token budget scales proportionally with steering intensity $\alpha \in [0, 1]$.

### 3. Verification & Observability
- All steering decisions are logged in dynamic execution traces with `goldenPathId`, `antiPatternId`, `alpha`, and `entropyAtResolution`.
- Verified in [dual-vector-rag.test.ts](../../domain/ai/core/tests/dual-vector-rag.test.ts).
