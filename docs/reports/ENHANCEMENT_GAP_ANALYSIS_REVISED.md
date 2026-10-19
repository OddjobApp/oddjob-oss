# Oddjob Enhancement Gap Analysis (Revised)

**Date:** February 2026  
**Purpose:** Deep analysis of existing Oddjob functionality vs. Kore.ai competitive capabilities, incorporating memory documents, tests, and backend services previously overlooked.

---

## Key Corrections from Initial Analysis

The initial analysis understated several implemented features. This revision incorporates:

- **Memory documents** in `server/knowledge/` (35+ markdown files) and Python `memory_documentation`
- **Test coverage** from `spec-coverage.test.ts`, `memory-documentation.test.ts`, `mission-wake-up.test.ts`, and integration tests
- **Backend Python services** (memory API, documentation API, memory_store, memory_retrieval)
- **Agent chat persistence** via `agentChatMessages` and `saveMessage()`
- **Mission service** (replaced workgroup-service): `getSharedMemories`, `addSharedMemory`
- **Sidecar sync** to Python memory backend

---

## 1. Conversational Interface and Intent Layer

### Existing Functionality (Revised)

| Component | Location | Capability |
|-----------|----------|------------|
| **Agent Chat** | [server/routes/agent-chat.ts](server/routes/agent-chat.ts), [server/services/agent-service.ts](server/services/agent-service.ts) | POST `/api/agent/chat`; context-aware; Governor/Molt; **Fast Path** for "how many jobs" / "job count" (direct SQL, no LLM) |
| **Chat Persistence** | agent-service.ts `saveMessage()` | **Persists to `agentChatMessages`** (jobId, userId, sessionId, role, content, missionId); deduplication (30s window) |
| **RAG Examples** | [server/services/ai/prompt-service.ts](server/services/ai/prompt-service.ts) (lines 717-751) | **Positive examples**: `agentChatMessages` with rating=1, effectivenessScore; **Negative examples**: rating=-1; both injected into system prompt |
| **Critic Feedback Injection** | agent-service.ts (lines 354-362) | `criticService.getRelevantCritiques(message)` injects past critiques into context |
| **Mission Blackboard Context** | agent-service.ts (lines 368-377) | Mission blackboard injected when missionId present |
| **Sidecar Memory Sync** | [server/services/sidecar-sync-service.ts](server/services/sidecar-sync-service.ts) | After each agent response: `syncMemory()` to Python `/memory/memories`; `fetchConsolidatedContext()` for long-term context |
| **Natural Language Query** | graph-service.ts, knowledge-graph routes | `parseNaturalLanguageQuery()` for knowledge graph; POST `/search/natural` |
| **System Knowledge** | [server/knowledge/](server/knowledge/) | 35+ markdown files: features (jobs, pipelines, templates, workgroups), screens, mcp-tools, cognitive-states; loaded by prompt-service for RAG |

### Gaps (Corrected)

| Gap | Severity | Notes |
|-----|----------|-------|
| Intent-to-pipeline mapping | High | Chat does not map "Run JIRA analysis" to pipeline trigger; tools exist (`trigger_pipeline`) but no NL intent layer |
| Chat-based mission control via Slack/Teams | Medium | Messaging is push + Molt; no inbound chat commands to start/pause missions |
| Spec-coverage test stale | Low | Test imports `workgroup-service` (deleted); should use `mission-service` |

---

## 2. Template Marketplace and Accelerators

### Existing Functionality (Unchanged)

Pipeline templates, Template Gallery, Template Wizard, Mission TemplateGalleryDialog. See initial analysis.

### Gaps (Unchanged)

Vertical accelerators, marketplace ratings, credential bundling.

---

## 3. Evaluation and Prompt Studio

### Existing Functionality (Revised)

| Component | Location | Capability |
|-----------|----------|-------------|
| **Evaluation Service** | [server/services/evaluation-service.ts](server/services/evaluation-service.ts) | `evaluateWithLLM()` (Yes/No criteria); `evaluateResponse()` for rule-based + LLM |
| **Critic Service** | [server/services/agent/critic-service.ts](server/services/agent/critic-service.ts) | `assessInteraction()` - scores 0-10, issues, correction; stores in DB; **injected into agent context** |
| **Fire-and-Forget Evaluation** | agent-service.ts (lines 590-596) | After saveMessage: `evaluationService.evaluateResponse(agentMsgId, response, ...)` |
| **Effectiveness Tracking** | agent-service.ts `submitFeedback()` | Boosts `effectivenessScore` on positive feedback; used for RAG example ranking |
| **Prompt Service** | [server/services/ai/prompt-service.ts](server/services/ai/prompt-service.ts) | Route-based knowledge loading (`ROUTE_TO_KNOWLEDGE`), tool hints, screen hints; **loads from server/knowledge/** |
| **Memory Documentation Test** | [tests/integration/memory-documentation.test.ts](tests/integration/memory-documentation.test.ts) | Tests **expected API contract** for: generate, get, list, update, delete, search, freshness, maintenance (mocked) |
| **Python Documentation API** | [backend/api/routes/documentation.py](backend/api/routes/documentation.py) | POST `/documentation/generate/{feature_id}`, maintenance tasks, search; uses `memory_documentation_service` |
| **Python Memory Documentation** | [backend/core/memory_documentation.py](backend/core/memory_documentation.py) | `MemoryDocumentationService` - templates, feature registry, generation; integrates with `VectorMemoryStore` |

### Gaps (Corrected)

| Gap | Severity | Notes |
|-----|----------|-------|
| Prompt versioning UI | High | Prompts in code; no version history or A/B in UI |
| Evaluation Studio UI | High | Evaluation runs; no UI for test sets or results |
| Memory documentation integration | Medium | Python backend has full API; Node agent uses different path (prompt-service loads markdown); integration unclear |
| Regression tracking | Medium | Eval scripts manual; no automated regression |

---

## 4. AI for Service (Customer-Facing)

### Existing Functionality (Unchanged)

Public Agent Deployment (`/a/:slug`), MessagingService, Messaging Webhooks. See initial analysis.

### Gaps (Unchanged)

Embeddable widget, agent assist, proactive outreach.

---

## 5. No-Code / Low-Code Flow Builder

### Existing Functionality (Unchanged)

Pipeline Visual Editor (React Flow), EnhancedPipelineCanvas, PipelineNodePalette, StepConfigurationSheet. See initial analysis.

### Gaps (Unchanged)

Form-only agent builder, guided wizards.

---

## 6. Connector Library Expansion

### Existing Functionality (Unchanged)

SaaS connectors (JIRA, Confluence, GitHub, Slack), ConnectorsDashboard, saas_registry. See initial analysis.

### Gaps (Unchanged)

Connector count (~5 vs 100+), catalog UI.

---

## 7. Multi-Channel Deployment

### Existing Functionality (Unchanged)

Slack, Teams, Email, Public Agent Page. See initial analysis.

### Gaps (Unchanged)

Embeddable widget, WhatsApp/SMS, voice.

---

## 8. Agent Memory and Personalization

### Existing Functionality (Revised)

| Component | Location | Capability |
|-----------|----------|------------|
| **agentChatMessages** | [shared/schema/agent/chat.ts](shared/schema/agent/chat.ts) | Persisted chat; jobId, sessionId, missionId, rating, effectivenessScore, embedding |
| **saveMessage** | agent-service.ts | Persists user + agent messages; deduplication |
| **Mission Blackboard** | mission-service.ts | Shared KV; `getSharedMemories()`, `addSharedMemory()`; **missionService** (not workgroupService) |
| **add_shared_memory tool** | [server/services/tools/missions.ts](server/services/tools/missions.ts) | `missionService.addSharedMemory()` - agents can log observations |
| **launch_mission tool** | missions.ts | Triggers mission execution |
| **Python Memory API** | [backend/api/routes/memory.py](backend/api/routes/memory.py) | POST `/memories`, `/memories/conversation`, `/memories/workflow`; GET `/memories/{id}`; POST `/memories/search`, `/memories/context`, `/memories/conversation-context`; consolidate, export |
| **Python Memory Service** | [backend/services/memory_service.py](backend/services/memory_service.py) | `store_conversation_memory`, `store_workflow_memory`, `search_memories`, `retrieve_context`, `get_conversation_context`, `consolidate_memories`, `export_memories` |
| **Python Memory Store** | [backend/core/memory_store.py](backend/core/memory_store.py) | `VectorMemoryStore`, `MemoryEntry` (embedding, importance, tags, session_id, workflow_id) |
| **Python Memory Retrieval** | [backend/core/memory_retrieval.py](backend/core/memory_retrieval.py) | `memory_chunker`, `contextual_retriever` |
| **Sidecar Sync** | sidecar-sync-service.ts | Syncs agent responses to Python memory; fetches consolidated context |
| **Agent Memory View** | [client/src/pages/agent/AgentMemoryView.tsx](client/src/pages/agent/AgentMemoryView.tsx) | UI for agent runs, steps, suggestions (execution traces) |
| **use-agent-memory** | [client/src/hooks/use-agent-memory.ts](client/src/hooks/use-agent-memory.ts) | Hook for runs, steps, suggestions |
| **In-Memory CHAT_HISTORY** | agent-service.ts | 1hr TTL; used for recent context; **DB is primary** for published agents and persistence |

### Gaps (Corrected)

| Gap | Severity | Notes |
|-----|----------|-------|
| Node-Python memory integration | Medium | Node saves to agentChatMessages + syncs to Python; Python has richer API; usage of Python context in Node agent loop unclear |
| User preferences | Medium | No stored preferences (language, verbosity) |
| Spec-coverage test | Low | References `workgroupService`; should use `missionService` |

---

## 9. Compliance and Audit

### Existing Functionality (Unchanged)

Audit logs, audit middleware, Audit Log UI, auditEvents, event_log. See initial analysis.

### Gaps (Unchanged)

Compliance exports, data retention policies.

---

## 10. Observability

### Existing Functionality (Unchanged)

Forensic event log, error diagnosis, ObservabilityDashboard, TraceWaterfall, AgentExecutionTrace. See initial analysis.

### Gaps (Unchanged)

Distributed tracing, agent trace aggregation.

---

## 11. Guided-to-Full Autonomy

### Existing Functionality (Revised)

| Component | Location | Capability |
|-----------|----------|------------|
| **Governor** | governor-resolver, molt-producer | Hierarchical resolution; OFF, ADVISORY, BLOCKING |
| **Decision Router** | decision-router.ts | riskLevel (low/medium/high); creates decision requests |
| **Molt Protocol** | messaging-webhooks | OBSERVATION, PROPOSAL, DECISION |
| **agentRunSteps.confidence** | shared/schema/agent/chat.ts | Column exists; populated in agent-service when saving steps |
| **Tool Analytics** | [server/services/tool-analytics.ts](server/services/tool-analytics.ts) | `inferTaskType()`, `getSuccessfulExamples()`, `getRecommendedTools()` - **implemented** (spec-coverage tests) |
| **Tool Recommendations** | AI_AGENT_ENHANCEMENTS_SPEC | Tool recommendations from past usage; toolAnalyticsService provides this |
| **Streaming Supervisor Plans** | supervisor-service.ts | `planStream` exists (spec-coverage); async generator |
| **Multi-Model Fallback** | ai-client.ts | `FallbackAIClient`; used when copilotWithFallback configured |
| **Agent Memory Sharing** | mission-service.ts | `getSharedMemories`, `addSharedMemory`; add_shared_memory tool |

### Gaps (Corrected)

| Gap | Severity | Notes |
|-----|----------|-------|
| Confidence-based HIL routing | Medium | Confidence stored; decision-router integration partial |
| Autonomy level config UI | Low | No explicit manual/assisted/supervised/full selector |
| Spec-coverage workgroupService | Low | Test imports deleted module; update to missionService |

---

## 12. Test and Spec Coverage Notes

### Spec-Coverage Test ([tests/integration/spec-coverage.test.ts](tests/integration/spec-coverage.test.ts))

- **Job Executors**: All JOB_TYPES_SPEC executors registered
- **HIL 2.0**: registerApprovalsRoutes, externalService.submitForm
- **Missions**: missionService methods (create, list, getById, checkpoint, pauseForFile, pauseForHumanApproval, resumeMission, resumeIfWaitingOnApproval, listWaitingOnFile)
- **AI Agent Enhancements**: toolAnalyticsService, **workgroupService** (getSharedMemories, addSharedMemory) - **STALE: workgroup-service deleted**
- **Streaming Plans**: supervisorService.planStream, plan-stream route
- **Multi-Model Fallback**: AIClientFactory
- **Confidence**: agentRunSteps.confidence column

**Action:** Update spec-coverage test to use `missionService` instead of `workgroupService`. **DONE** (Feb 2026).

### Mission Wake-Up Test ([tests/integration/mission-wake-up.test.ts](tests/integration/mission-wake-up.test.ts))

- Imports `workgroups`, `missions`, `workgroupBlackboardHistory` from `@shared/schema`; **workgroups/workgroupBlackboardHistory no longer exist** (refactored to missions)
- **Action:** Update test for missions schema: use `missions`, `missionRuns`, `missionBlackboardHistory`. **DONE** (Feb 2026) – test now uses missionRunService and missions schema.

### Memory Documentation Test ([tests/integration/memory-documentation.test.ts](tests/integration/memory-documentation.test.ts))

- Tests **mocked** API contract for Python documentation/memory features
- Covers: generate, get, list, update, delete, search, freshness report, maintenance (configure, status, history)
- **Note:** Backend has real implementation in documentation.py and memory.py

---

## Summary: Implemented vs. Gap (Revised)

| Area | Implemented (Previously Understated) | Remaining Gaps |
|------|-------------------------------------|----------------|
| **Conversational** | Chat persistence (agentChatMessages), Fast Path, RAG examples, critic injection, mission blackboard, sidecar sync, 35+ knowledge docs | Intent-to-pipeline, Slack/Teams chat commands |
| **Templates** | (unchanged) | Vertical accelerators, marketplace |
| **Evaluation** | Critic service, fire-and-forget eval, effectiveness tracking, Python documentation API | Prompt versioning UI, Eval Studio UI |
| **Agent Memory** | agentChatMessages, missionService getSharedMemories/addSharedMemory, Python memory API (store/search/context/consolidate/export), sidecar sync | Node-Python integration clarity, user preferences |
| **Guided Autonomy** | Tool analytics (inferTaskType, getRecommendedTools), planStream, FallbackAIClient, confidence column, add_shared_memory | Confidence-based HIL routing, autonomy level UI |
| **Tests** | Spec-coverage validates many features | workgroupService ref to missionService; mission-wake-up schema update |

---

## Recommended Next Steps

1. **Fix spec-coverage test**: Replace `workgroupService` with `missionService` for getSharedMemories/addSharedMemory.
2. **Fix mission-wake-up test**: Update for missions schema (remove workgroups dependency if tables changed).
3. **Document Node-Python memory flow**: Clarify when Python memory context is used vs. agentChatMessages. **DONE** – see [docs/memory/NODE_PYTHON_MEMORY_FLOW.md](../memory/NODE_PYTHON_MEMORY_FLOW.md).
4. **Intent-to-pipeline**: Add NL intent layer to map chat utterances to pipeline triggers (leverage existing trigger_pipeline tool).
5. **Embeddable widget**: Enable customer-facing deployment without full app.
