# Agentic Maturity: Delegation, Memory, and JIT Discovery

This document details the advanced autonomous capabilities of the Oddjob agent system. These features enable agents to solve complex problems, learn from past successes, and dynamically acquire new tools.

## 1. Sub-Agent Delegation

The `delegate_task` tool allows a primary agent to spawn specialized sub-agents. This hierarchical approach is essential for large missions where a single context window is insufficient.

### How it Works
1. **Recursive Orchestration**: When `delegate_task` is called, the `ToolExecutor` initializes a new `AgentOrchestrator` instance.
2. **Context Sharing**: The sub-agent inherits the `parentId`, `organizationId`, and `missionId`.
3. **Guardrails**:
   - **Budget**: The parent can specify a `maxBudgetUsd` for the sub-agent.
   - **Tool Scoping**: The parent can limit the tools available to the sub-agent via `allowedToolNames`.
   - **Supervision**: Sub-agent actions are governed by the parent's `supervisionLevel`.

## 2. Semantic Retrospective RAG (Golden Plans)

Agents can now leverage "Episodic Memory" by retrieving successful strategy traces from previous similar missions.

### The Lifecycle
1. **Distillation**: After a mission succeeds, the `persistence.ts` service uses a "Janitor" LLM to distill the raw history into a reusable "Macro Skill" template.
2. **Vectorization**: This template, along with the original mission goal, is vectorized and stored in the `mission_retrospectives` table.
3. **Retrieval**: At the start of a new mission, the `RagService` performs a semantic search for relevant retrospectives. 
4. **Injection**: These "Golden Plans" are injected into the agent's system prompt as `SIMULATED EXPERIENCE`, providing a proven baseline strategy.

## 3. Automated Tool Discovery (JIT MCP)

Agents no longer need to be pre-configured with every possible tool. They can now acquire capabilities "Just-In-Time".

### Discovery & Enrollment Flow
1. **Discovery**: If an agent identifies a gap in its capabilities, it calls `list_available_mcp_capabilities` to search for matching inactive MCP servers.
2. **Request**: The agent calls `request_mcp_tool` with a justification.
3. **Strategic Triage**: This creates a **Rescue Session** (service type: `tool_discovery`) which is routed to the **Decision Inbox**.
4. **Dynamic Enrollment**: Once an admin approves the request via the Triage interface, the server is activated and the `AgentOrchestrator` automatically includes the new tools in its next loop.

## 4. Transference Engine (LLM Call Replacement)

The Transference Engine (TE-101) complements Evolution by optimizing **inference cost and latency** rather than skill source code. It observes cloud LLM calls, mines high-frequency low-entropy prompt templates, and promotes local Python handlers from shadow validation to live interception.

### How it works

1. **Telemetry**: `CachedAIClient` logs every successful cloud LLM call to `ai_execution_logs` keyed by an MD5 prompt hash.
2. **Mining**: The `transference` worker (queue `oddjob-transference`, daily 3 AM cron) registers shadow rules for templates with ≥ 100 calls and Shannon entropy below 1.8.
3. **Shadow validation**: Subsequent cloud calls still run normally; the handler output is compared to the LLM response asynchronously.
4. **Promotion**: Rules reaching ≥ 500 comparisons at ≥ 98% accuracy flip to **active** mode automatically.
5. **Interception**: Active rules with handler confidence ≥ 0.90 return local predictions before the cloud call (metadata provider: `transference-engine`).

Local inference paths (`ollama`, `local_openai`, localhost) bypass transference entirely. Handler errors and low confidence fail open to the cloud LLM.

**Full reference:** [Transference Engine](../features/TRANSFERENCE_ENGINE.md)

## UI Components

### Mission Tracker (Recursive View)
- Top-level mission runs now display a progress bar representing the completion percentage of all child sub-agents.
- Users can dive into sub-agent traces directly from the primary tracker.

### Retrospective Intelligence Section
- Located in the Mission Run Detail page.
- Features glowing golden borders and bronze accents to highlight high-value historical insights.

### Decision Inbox (Tool Enrollment)
- Specialized triage cards allow one-click approval or rejection of new tool requests.
- A "Capability Requests" counter in the sidebar tracks pending tool enrollment sessions.

## Safety and Governance

All advanced features are governed by the **Oddjob Governor**:
- **Privacy**: PII is redacted from delegation payloads and memory traces.
- **Circuit Breakers**: Parallel tool execution is protected by per-tool circuit breakers.
- **Human-in-the-Loop**: High-risk actions identified in a pre-planned strategy (Staged Orchestration) require explicit approval before execution.

## Related

- [Copilot Cycle Operations](./copilot-cycle-operations.md) — approving cycles from the copilot, major-step announcements, and per-turn tool subsetting.

For broader R&D directions that align with missions, tracing, evolution, RAG, and forge (not a product roadmap), see [Research themes](../research-themes.md).
