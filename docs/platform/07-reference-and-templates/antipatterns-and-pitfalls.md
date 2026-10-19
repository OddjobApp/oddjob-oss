---
id: antipatterns-and-pitfalls
title: Agent Antipatterns, Common Pitfalls & Trajectory Failure Modes
audience: [HUMAN_PRIMARY, AGENT_PRIMARY, GOVERNANCE]
badge: HYBRID
category: 07-reference-and-templates
autonomy_level: L0-L4
version: 2.0.0
tags: [antipatterns, pitfalls, debugging, prompt-engineering, tool-hallucination, loop-prevention, safety]
summary: Curated catalog of high-risk agent failure modes, prompt leakage, tool hallucinations, unbounded loops, and naked database mutations with concrete remediation diffs.
verification_status: verified
applies_when:
  - Designing system prompts, tool interfaces, or multi-agent swarm handoffs
  - Debugging errant agent behavior, infinite loops, or hallucinations in production
  - Reviewing code and prompt PRs for safety and performance compliance
do_not_use_when:
  - None (Applicable across all agent development workflows)
required_tools:
  - discover_capabilities
  - run_dependency_audit
preconditions:
  - Understanding of Oddjob 5-Layer Governed Control Plane invariants
approval_requirements:
  - None
success_checks:
  - Agent trajectories avoid all 6 documented catastrophic failure modes
  - Code changes comply with standard safe remediation patterns
stop_conditions:
  - Antipattern detected in active production pipeline (triggers immediate code review gate)
escalation:
  - Halt agent execution when unbounded recursion or naked SQL deletion is detected
implementation_evidence:
  - server/domain/testing/
  - server/domain/governor/
---

# Agent Antipatterns & Failure Modes `[🤝 HYBRID]`

> **Audience:** `🤝 Hybrid: Agent Builders + Self-Reflecting Autonomous Agents` &nbsp;|&nbsp; **Classification:** Quality Assurance & Safety Reference

---

## 1. Top 6 Catastrophic Agent Antipatterns `[🧑 Human]`

```mermaid
graph TD
    subgraph Antipatterns["Catastrophic Agent Antipatterns"]
        A1["1. Tool Hallucination (Inventing APIs)"]
        A2["2. Unbounded Search Loops (Thrashing)"]
        A3["3. Naked Database Mutations (No rollback)"]
        A4["4. Prompt Memory Flooding (Full history dumping)"]
        A5["5. Lazy Socratic Questions ('What now?')"]
        A6["6. Unvalidated Subagent Delegation (No schema)"]
    end

    subgraph Defense["Oddjob Architectural Invariant"]
        D1["Tool Registry Strict Discovery"]
        D2["Param-Hash Loop Detection Sentinel"]
        D3["Drizzle Expand-and-Contract & Idempotency"]
        D4["PhaseCompiler 150t-350t Token Pruner"]
        D5["Good Question Engine (GQE) Cards"]
        D6["W3C Traceparent & Typed JSON Schema Output"]
    end

    A1 --> D1
    A2 --> D2
    A3 --> D3
    A4 --> D4
    A5 --> D5
    A6 --> D6
```

---

## 2. Antipattern Catalog & Concrete Remediation Diffs `[🤖 Agent Reference]`

### Antipattern 1: Tool Identifier Hallucination
- **Bad Practice:** Invoking invented tools like `update_user_db_directly()` or `link_knowledge_entity()`.
- **Good Practice:**
```typescript
// Always discover valid capabilities when uncertain of tool identifier
const tools = await discover_capabilities({ query: "entity relationship linking" });
// Result resolves to: "ontology_link_objects" or "create_relationship"
await ontology_link_objects({ ... });
```

---

### Antipattern 2: Naked Direct SQL Mutation without Idempotency Key
- **Bad Practice:** Running raw non-idempotent updates `UPDATE accounts SET balance = balance - 100 WHERE id = 5;`.
- **Good Practice:**
```typescript
// Wrap in explicit transaction with idempotencyKey and bounded parameterization
await execute_sql({
  query: "UPDATE accounts SET balance = balance - $1 WHERE id = $2 AND idempotency_key = $3 RETURNING *;",
  params: [100, 5, idempotencyKey]
});
```

---

### Antipattern 3: Prompt Memory Flooding (Context Bloat)
- **Bad Practice:** Passing 40 turns of raw conversation history and full JSON dumps to the prompt compiler.
- **Good Practice:** Use `PhaseCompiler` JIT compilation to prune history to the active 2-hop entity neighborhood (budgeted at **$150\text{t}–350\text{t}$** per turn).

---

### Antipattern 4: Lazy Open-Ended Questions
- **Bad Practice:** Asking the user *"I don't know what to do next, can you help me?"*.
- **Good Practice:** Use the **Good Question Engine (GQE)** to generate a structured 2–3 option decision card with clear pros/cons and a recommended default.
