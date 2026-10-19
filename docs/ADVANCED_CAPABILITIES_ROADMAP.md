# Oddjob Advanced Capabilities Roadmap

**Date**: 2026-04-24  
**Scope**: 12 near-complete features requiring wiring, UI, and test coverage to reach production readiness  
**Framework**: Vitest + Supertest (node environment) for backend; React Testing Library for frontend  
**DB**: PostgreSQL via Drizzle ORM at `127.0.0.1:5433/oddjob` (test)  
**Test pattern**: `/** @vitest-environment node */` with `beforeAll(async () => { await serverReady; })`

---

## Execution Order

Features are ordered by **impact × effort ratio** — each unlocks or accelerates features that follow it.

| # | Feature | Why First |
|---|---------|-----------|
| 1 | Real-Time SSE to UI | Enables live feedback for every other feature |
| 2 | Dead Letter Queue + Circuit Breaker Admin UI | Operational safety net for all background work |
| 3 | App Forge Progress Visibility | Closes the most visible user-facing gap |
| 4 | Agent Feedback Loop | Low-lift completion of partially-running system |
| 5 | Supervisor Engine + AI Judge retry loop | Makes missions self-healing |
| 6 | Knowledge Graph Visualization | Unlocks semantic search UI |
| 7 | Rolling Wave Mission Orchestration | Crew recruitment + live progress |
| 8 | Selenium Browser Autopilot | Route wiring + recording UI |
| 9 | Fine-Tuning Pipeline | OpenAI/Anthropic submission + training status |
| 10 | Autonomous Lifecycle Manager | Manifest verification + Molt integration |
| 11 | Macro-Economic Control Plane | Token salary budgets + Board Approval Gates |
| 12 | Agentic HR & Performance Pipelining | Automated upskilling + de-provisioning loop |


---

## Feature 1 — Real-Time SSE to UI

### Current State
`server/domain/core/infrastructure/event-stream.service.ts` publishes to Redis pub/sub channels (`oddjob:events`, `intent_events`) and buffers up to 100 recent events. The server has no HTTP endpoint to expose this stream to clients. No frontend SSE consumers exist.

### Implementation Steps

**Step 1 — Server: SSE endpoint**  
File: `server/domain/core/core.route.ts` (or create `server/domain/core/events.route.ts`)  
- Add `GET /api/events/stream` protected route
- Use `res.setHeader('Content-Type', 'text/event-stream')` + `res.flushHeaders()`
- Subscribe to `eventStreamService.onEvent(handler)` — send `data: ${JSON.stringify(event)}\n\n`
- On client disconnect (`req.on('close')`), unsubscribe
- Send recent event buffer on connect so client catches up
- Add `GET /api/events/recent?limit=50` for initial page load hydration

**Step 2 — Event stream service: expose subscription API**  
File: `server/domain/core/infrastructure/event-stream.service.ts`  
- Add `onEvent(handler: (event) => void): () => void` method returning unsubscribe fn
- Add `getRecent(limit: number)` accessor for the buffer
- Replace `console.log` debug calls in qdrant-publisher with `logger`

**Step 3 — Frontend: SSE hook**  
File: `server/domain/core/ui/hooks/useEventStream.ts` (new)
```typescript
// useEventStream(filter?: (e: OddjobEvent) => boolean)
// Returns: { events, isConnected }
// Internally: new EventSource('/api/events/stream'), reconnects on error with backoff
```

**Step 4 — Frontend: Live indicators**  
- `ForgeProgressToast` — toast that opens when forge starts, streams progress steps
- `MissionStatusPulse` — pulsing dot in mission list rows tied to live status events
- Add event-stream connection indicator to existing Layout/nav

### Files to Create/Modify
| File | Action |
|------|--------|
| `server/domain/core/infrastructure/event-stream.service.ts` | Add `onEvent`, `getRecent` |
| `server/domain/core/events.route.ts` | Create — SSE + recent endpoints |
| `server/domain/core/ui/hooks/useEventStream.ts` | Create — React hook |
| `server/domain/core/ui/components/shared/LiveEventFeed.tsx` | Create — debug/admin panel |

### Tests Required
**File**: `server/domain/core/tests/integration/event-stream.test.ts`
```typescript
/** @vitest-environment node */
// describe('Event Stream')
// - it('delivers events to SSE subscriber via HTTP')
// - it('replays recent buffer on new connection')
// - it('unsubscribes cleanly on client disconnect')
// - it('GET /api/events/recent returns last N events')
```

### Documentation
File: `docs/feature-documentation/real-time-events.md`  
Cover: channel names, event shape `{ type, payload, orgId, timestamp }`, reconnection behavior, backpressure limits.

---

## Feature 2 — Dead Letter Queue + Circuit Breaker Admin UI

### Current State
`server/domain/admin/core/circuit-breaker.service.ts` — full CLOSED/HALF_OPEN/OPEN state machine.  
`server/domain/admin/core/dead-letter-queue.service.ts` — BullMQ DLQ with retry and exponential backoff.  
No admin routes expose these. No UI exists.

### Implementation Steps

**Step 1 — Admin routes**  
File: `server/domain/admin/admin.route.ts` — append:
```
GET  /api/admin/dlq                    — list DLQ jobs (paginated)
POST /api/admin/dlq/:jobId/retry       — requeue single job
DELETE /api/admin/dlq/:jobId           — purge job
POST /api/admin/dlq/retry-all          — bulk requeue
GET  /api/admin/circuit-breakers       — all breaker states
POST /api/admin/circuit-breakers/:key/reset  — force CLOSED
```

**Step 2 — Admin UI page**  
File: `server/domain/admin/ui/modules/admin/pages/InfraHealth.tsx` (new)  
- Two-panel layout: DLQ table + Circuit Breaker table
- DLQ table columns: Job ID, Queue, Failure Reason, Failed At, Retry Count, actions (Retry / Purge)
- Circuit Breaker table: Key, State (badge: green/amber/red), Failure Count, Last Failure, Reset button
- Auto-refreshes every 30s; manual refresh button
- Bulk retry with confirmation dialog

**Step 3 — Wire circuit breaker to job/pipeline executors**  
Files: `server/domain/jobs/job-executor.service.ts`, `server/domain/pipeline/pipeline-executor.service.ts`  
- Wrap execution in `circuitBreakerService.execute(key, fn)` where `key = pipeline:${id}` or `job:${type}`
- On `CircuitOpenError`, move job to DLQ and create alert

### Files to Create/Modify
| File | Action |
|------|--------|
| `server/domain/admin/admin.route.ts` | Add 6 DLQ + circuit breaker endpoints |
| `server/domain/admin/ui/modules/admin/pages/InfraHealth.tsx` | Create page |
| `server/domain/jobs/job-executor.service.ts` | Wrap in circuit breaker |
| `server/domain/pipeline/pipeline-executor.service.ts` | Wrap in circuit breaker |

### Tests Required
**File**: `server/domain/admin/tests/integration/infra-health.test.ts`
```typescript
/** @vitest-environment node */
// describe('DLQ Admin API')
// - it('GET /api/admin/dlq returns paginated failed jobs')
// - it('POST /api/admin/dlq/:id/retry requeues the job')
// - it('DELETE /api/admin/dlq/:id purges the job')
// describe('Circuit Breaker Admin API')
// - it('GET /api/admin/circuit-breakers lists all breaker states')
// - it('POST /api/admin/circuit-breakers/:key/reset forces CLOSED')
// describe('Circuit Breaker Unit')
// - it('transitions CLOSED → OPEN after threshold failures')
// - it('transitions HALF_OPEN → CLOSED on success')
```

### Documentation
File: `docs/feature-documentation/infra-health.md`  
Cover: DLQ flow diagram, circuit breaker state transitions, retry backoff formula, alert thresholds.

---

## Feature 3 — App Forge Progress Visibility

### Current State
`server/domain/apps/app-forge.service.ts` — complete forge pipeline with Redis job state. Progress percentage jumps 0→100. No step-level granularity. No workspace cleanup on failure. Frontend has no progress polling.

### Implementation Steps

**Step 1 — Granular progress events**  
File: `server/domain/apps/app-forge.service.ts`  
- Define forge stages: `validating` (5%), `generating_files` (20%), `building_image` (60%), `starting_container` (80%), `verifying` (95%), `complete` (100%)
- After each stage, publish to `eventStreamService.publish({ type: 'forge.progress', payload: { appId, stage, pct, message } })`
- On failure, publish `forge.failed` with error detail and trigger workspace rollback

**Step 2 — Workspace cleanup**  
File: `server/domain/apps/app-forge.service.ts`  
- Add `cleanupWorkspace(slug: string)` private helper using `fs.rm(workspacePath, { recursive: true, force: true })`
- Call in catch block after failed Docker build
- Add `POST /api/apps/:appId/forge-cleanup` admin endpoint for manual cleanup

**Step 3 — Frontend progress UI**  
File: `server/domain/apps/ui/modules/apps/components/ForgeProgressModal.tsx` (new)  
- Opens automatically when forge job starts (listen on `useEventStream` for `forge.progress` with matching `appId`)
- Stepped progress bar: stage name + percentage
- Shows live log lines streamed from event payload
- On `forge.failed`: shows error with "View Logs" and "Retry" actions
- On `forge.complete`: auto-dismisses after 3s, invalidates app query

**Step 4 — Fix progress polling in AppInteractiveBuilderTab**  
File: `server/domain/apps/ui/modules/apps/components/tabs/AppInteractiveBuilderTab.tsx`  
- Replace polling interval with `useEventStream` subscription

### Files to Create/Modify
| File | Action |
|------|--------|
| `server/domain/apps/app-forge.service.ts` | Stage events + cleanup + rollback |
| `server/domain/apps/ui/modules/apps/components/ForgeProgressModal.tsx` | Create |
| `server/domain/apps/ui/modules/apps/components/tabs/AppInteractiveBuilderTab.tsx` | Replace polling |

### Tests Required
**File**: `server/domain/apps/tests/integration/forge-progress.test.ts`
```typescript
/** @vitest-environment node */
// describe('Forge Progress Events')
// - it('publishes forge.progress events at each stage')
// - it('publishes forge.failed on Docker build failure')
// - it('cleans up workspace on failure')
// - it('does not leave orphaned workspace after successful forge')
```

### Documentation
File: `docs/feature-documentation/app-forge.md`  
Cover: forge stage definitions, event payload shapes, workspace layout, rollback behavior, retry semantics.

---

## Feature 4 — Agent Feedback Loop

### Current State
`server/domain/governor/core/feedback-loop.service.ts` — triggers on session completion, 30% sampling, generates AI survey, routes to HIL. The survey delivery mechanism is incomplete. No feedback→optimization→retry loop.  
`server/domain/agents/agent-optimization.service.ts` — generates optimization suggestions but no persistence route.

### Implementation Steps

**Step 1 — Close survey delivery**  
File: `server/domain/governor/core/feedback-loop.service.ts`  
- After HIL routing, also persist survey to `agentChatMessages` table (type: `feedback_survey`) so it surfaces in the agent chat history
- Add configurable sampling rate (env `FEEDBACK_SAMPLE_RATE`, default 0.3)
- Expose `POST /api/agents/:agentId/feedback` to accept completed survey responses

**Step 2 — Persist optimization suggestions**  
File: `server/domain/agents/agent-optimization.service.ts`  
- After generating suggestions, `db.insert(optimizationSuggestions).values({ agentId, suggestions, sessionId })`
- Add `GET /api/agents/:agentId/optimization-suggestions` endpoint

**Step 3 — Suggestion review UI**  
File: `server/domain/agents/ui/modules/agents/components/tabs/AgentOptimizationTab.tsx` (new)  
- Lists pending suggestions with Accept / Dismiss actions
- Accepted suggestions auto-apply to agent config (update system prompt or tool list)
- Shows feedback survey completion rate

**Step 4 — Feedback → retry loop**  
File: `server/domain/governor/core/feedback-loop.service.ts`  
- On negative feedback (score < 3), create a job in the rolling-wave queue to re-run the failed session step with revised context

### Files to Create/Modify
| File | Action |
|------|--------|
| `server/domain/governor/core/feedback-loop.service.ts` | Close survey delivery, add retry trigger |
| `server/domain/agents/agent-optimization.service.ts` | Persist suggestions, expose route |
| `server/domain/agents/ui/.../AgentOptimizationTab.tsx` | Create review tab |

### Tests Required
**File**: `server/domain/governor/tests/feedback-loop.test.ts`
```typescript
// describe('Feedback Loop')
// - it('fires on session completion at configured sample rate')
// - it('persists survey to agentChatMessages')
// - it('persists optimization suggestions to DB')
// - it('triggers retry job on negative feedback score')
// - it('respects FEEDBACK_SAMPLE_RATE env override')
```

### Documentation
File: `docs/feature-documentation/feedback-loop.md`  
Cover: session eligibility criteria, sampling configuration, survey schema, optimization suggestion lifecycle.

---

## Feature 5 — Supervisor Engine + AI Judge Retry Loop

### Current State
`server/domain/mission/supervisor/supervisor-engine.ts` — task state sync and rejection handling. `JudgeService.evaluateTask` is called but the verdict is not used to trigger retries. The judge service file location is unclear (referenced as `./judge-service.js`).

### Implementation Steps

**Step 1 — Locate and complete judge service**  
Search for `judge-service` across codebase. If missing, create `server/domain/mission/supervisor/judge.service.ts`:
- `evaluateTask(task, output)` → calls LLM with acceptance criteria, returns `{ pass: boolean, score: number, critique: string }`
- Uses structured output / tool-call parsing for reliable bool extraction

**Step 2 — Wire verdict to retry**  
File: `server/domain/mission/supervisor/supervisor-engine.ts`  
- After `JudgeService.evaluateTask(task, output)`:
  - `pass === true` → mark task `completed`, emit `task.completed` event
  - `pass === false && retryCount < maxRetries` → increment retry, re-enqueue task with critique injected into context
  - `pass === false && retryCount >= maxRetries` → escalate to HIL via `decisionInboxService.create()`

**Step 3 — Retry context injection**  
- When re-enqueuing, prepend critique to the task's system message: `"Previous attempt failed: {critique}. Please address this specifically."`

**Step 4 — Supervisor status UI**  
File: `server/domain/mission/ui/.../components/SupervisorStatusPanel.tsx` (new)  
- Shows task list with judge scores, retry counts, and escalation badges
- Live updates via `useEventStream` filtering on `task.*` events

### Files to Create/Modify
| File | Action |
|------|--------|
| `server/domain/mission/supervisor/judge.service.ts` | Create (or complete) |
| `server/domain/mission/supervisor/supervisor-engine.ts` | Wire verdict → retry/escalate |
| `server/domain/mission/ui/.../SupervisorStatusPanel.tsx` | Create |

### Tests Required
**File**: `server/domain/mission/supervisor/tests/supervisor-engine.test.ts` (extend existing)
```typescript
// describe('Supervisor Judge Integration')
// - it('marks task completed when judge passes')
// - it('re-enqueues task with critique on judge failure within retry limit')
// - it('escalates to HIL when retry limit exceeded')
// - it('injects critique into retry context')
// describe('JudgeService')
// - it('returns pass:true for high-quality output')
// - it('returns pass:false with critique for poor output')
```

### Documentation
File: `docs/feature-documentation/supervisor-engine.md`  
Cover: task lifecycle diagram, judge scoring rubric, retry backoff, HIL escalation trigger, acceptance criteria schema.

---

## Feature 6 — Knowledge Graph Visualization

### Current State
`server/domain/knowledge/core/graph/graph-service.ts` — full CRUD, Qdrant semantic search, traversal. `SemanticGraph3D.tsx` is stubbed. Vector reindexing only triggers on creation (not updates).

### Implementation Steps

**Step 1 — Fix reindex on update**  
File: `server/domain/knowledge/core/graph/graph-service.ts`  
- In `updateNode(id, data)`, call `qdrantPublisher.publishGraphNode(updatedNode)` after DB update

**Step 2 — Complete SemanticGraph3D**  
File: `server/domain/knowledge/ui/.../SemanticGraph3D.tsx`  
- Use `react-force-graph` (2D mode) or `d3-force` for the visualization
- Fetch nodes/edges from `GET /api/knowledge/graph/nodes` and `GET /api/knowledge/graph/edges`
- Color nodes by label (taxonomy type)
- Click node → sidebar showing node detail + connected nodes
- Search bar triggers semantic search, highlights matching nodes
- "Add Node" button opens create dialog

**Step 3 — Knowledge graph API routes**  
File: `server/domain/knowledge/knowledge.route.ts` (add if missing):
```
GET /api/knowledge/graph/nodes?orgId=&limit=&search=
GET /api/knowledge/graph/edges?nodeId=
POST /api/knowledge/graph/nodes
PUT /api/knowledge/graph/nodes/:id
DELETE /api/knowledge/graph/nodes/:id
GET /api/knowledge/graph/search?q=  (semantic)
```

**Step 4 — Replace console.log in qdrant-publisher**  
File: `server/domain/knowledge/core/indexing/qdrant-publisher.ts`  
- Lines 21, 119: replace `console.log` with `logger.debug`
- Complete `publishDatasetItems()` batching (currently has TODO)

### Files to Create/Modify
| File | Action |
|------|--------|
| `server/domain/knowledge/core/graph/graph-service.ts` | Add reindex on update |
| `server/domain/knowledge/core/indexing/qdrant-publisher.ts` | Fix logging + batching |
| `server/domain/knowledge/knowledge.route.ts` | Add graph API endpoints |
| `server/domain/knowledge/ui/.../SemanticGraph3D.tsx` | Implement visualization |

### Tests Required
**File**: `server/domain/knowledge/tests/integration/knowledge-graph.test.ts`
```typescript
/** @vitest-environment node */
// describe('Knowledge Graph API')
// - it('GET /api/knowledge/graph/nodes returns paginated nodes')
// - it('POST creates node and triggers Qdrant indexing')
// - it('PUT update triggers reindex')
// - it('GET /api/knowledge/graph/search returns semantically similar nodes')
// - it('GET /api/knowledge/graph/edges returns edges for a node')
```

### Documentation
File: `docs/feature-documentation/knowledge-graph.md`  
Cover: node schema, edge types, taxonomy labels, Qdrant collection config, semantic search pipeline, visualization controls.

---

## Feature 7 — Rolling Wave Mission Orchestration

### Current State
`server/domain/mission/core/rolling-wave-orchestrator.service.ts` — full state machine and BullMQ queue. Crew recruitment is a stub comment at line 38: `// Recruitment logic would go here`.

### Implementation Steps

**Step 1 — Crew recruitment logic**  
File: `server/domain/mission/core/rolling-wave-orchestrator.service.ts`  
Replace stub with:
- Query available agents from DB filtered by `specialization` tags matching required roles
- Select best-fit agent per role using `agentOptimizationService.scoreAgentFit(agentId, role)`
- If no agent matches, fallback to a general-purpose agent
- Record crew assignment to mission run: `db.update(missionRuns).set({ crewAssignment: assignments })`

**Step 2 — Heartbeat optimization**  
File: `server/domain/mission/infrastructure/rolling-wave-queue.ts`  
- Add idle detection: if no tasks produced in last N cycles, increase poll interval from 5s to 30s
- Emit `mission.idle` event after 3 consecutive empty waves

**Step 3 — Mission wave progress UI**  
File: `server/domain/mission/ui/.../components/MissionWaveProgress.tsx` (new)  
- Shows current wave phase with animated step indicator
- Lists crew members assigned per role with agent avatar/name
- Live task feed from `useEventStream({ type: /^task\./ })`
- Wave history accordion (expandable past waves)

**Step 4 — Wave configuration in mission editor**  
File: `server/domain/mission/ui/.../pages/MissionEditor.tsx`  
- Add "Wave Configuration" section: max concurrent waves, crew size per role, quality threshold for judge

### Files to Create/Modify
| File | Action |
|------|--------|
| `server/domain/mission/core/rolling-wave-orchestrator.service.ts` | Crew recruitment |
| `server/domain/mission/infrastructure/rolling-wave-queue.ts` | Idle heartbeat optimization |
| `server/domain/mission/ui/.../MissionWaveProgress.tsx` | Create |
| `server/domain/mission/ui/.../pages/MissionEditor.tsx` | Add wave config section |

### Tests Required
**File**: `server/domain/mission/tests/integration/rolling-wave.test.ts`
```typescript
/** @vitest-environment node */
// describe('Rolling Wave Orchestrator')
// - it('recruits agents by specialization match')
// - it('falls back to general agent when no specialization match')
// - it('transitions through PLANNING → EXECUTING → CRITIQUING phases')
// - it('emits mission.idle after 3 empty waves')
// - it('records crew assignment to missionRuns')
```

### Documentation
File: `docs/feature-documentation/rolling-wave-missions.md`  
Cover: wave phases, crew recruitment algorithm, specialization tags, idle detection, configuration schema.

---

## Feature 8 — Selenium Browser Autopilot

### Current State
`server/domain/agents/core/selenium-agent.service.ts` — Playwright, stealth mode, RAG navigation memory, AI step generation. No dedicated API route. `SeleniumAutoPilot.tsx` component exists. No step recording/playback UI.

### Implementation Steps

**Step 1 — API routes**  
File: `server/domain/agents/agents.route.ts` — add:
```
POST /api/agents/selenium/start         — start autopilot session
GET  /api/agents/selenium/:sessionId/steps — list recorded steps
POST /api/agents/selenium/:sessionId/stop  — stop + persist recording
POST /api/agents/selenium/replay/:sessionId — replay a recording
```

**Step 2 — Session persistence**  
File: `server/domain/agents/core/selenium-agent.service.ts`  
- After each AI step, append to `agentRunSteps` table with `{ sessionId, stepIndex, action, selector, value, screenshot }`
- On session stop, calculate success metrics and persist to knowledge graph

**Step 3 — Wire memory to knowledge graph**  
- After session, call `graphService.createNode({ label: 'web_navigation', content: summary, metadata: { url, steps } })`
- Future sessions query graph for similar URL patterns via semantic search

**Step 4 — Recording/playback UI**  
File: `server/domain/agents/ui/.../SeleniumAutoPilot.tsx` (extend)  
- Live step feed during recording (via SSE)
- Step list with action, selector, screenshot thumbnail
- "Stop & Save" button + replay button for saved recordings
- Status badge: Idle / Recording / Replaying / Error

### Files to Create/Modify
| File | Action |
|------|--------|
| `server/domain/agents/agents.route.ts` | Add 4 selenium endpoints |
| `server/domain/agents/core/selenium-agent.service.ts` | Step persistence + graph memory |
| `server/domain/agents/ui/.../SeleniumAutoPilot.tsx` | Extend with recording UI |

### Tests Required
**File**: `server/domain/agents/tests/integration/selenium-autopilot.test.ts`
```typescript
/** @vitest-environment node */
// describe('Selenium Autopilot API')
// - it('POST /start creates a session and returns sessionId')
// - it('steps are persisted to agentRunSteps during session')
// - it('POST /stop saves session and returns step summary')
// - it('GET /steps returns ordered steps for a session')
// Note: actual browser tests skipped in CI (SKIP_BROWSER=true)
```

### Documentation
File: `docs/feature-documentation/selenium-autopilot.md`  
Cover: stealth mode config, RAG memory integration, step schema, CI skip flag, replay semantics.

---

## Feature 9 — Fine-Tuning Pipeline

### Current State
`server/domain/ai/core/fine-tuning.service.ts` — dataset CRUD, example curation, knowledge node side-effects. `importExamples()` is incomplete at line 148. No OpenAI/Anthropic submission. No training status tracking.

### Implementation Steps

**Step 1 — Complete importExamples**  
File: `server/domain/ai/core/fine-tuning.service.ts`  
- Implement batch insert of `{ prompt, completion }` pairs with deduplication check
- Validate each example against OpenAI message format before insert
- Return `{ inserted, skipped, errors }` summary

**Step 2 — OpenAI fine-tune submission**  
File: `server/domain/ai/core/fine-tuning.service.ts`  
- `submitTrainingJob(datasetId)`:
  1. Export dataset to JSONL (messages format)
  2. Upload to OpenAI Files API: `openai.files.create({ file, purpose: 'fine-tune' })`
  3. Create fine-tune job: `openai.fineTuning.jobs.create({ training_file, model })`
  4. Persist `{ externalJobId, provider: 'openai', status: 'running' }` to `fineTuningDatasets`

**Step 3 — Training status polling**  
File: `server/domain/ai/core/fine-tuning.service.ts`  
- `pollTrainingStatus(datasetId)`:
  - Fetch job from OpenAI: `openai.fineTuning.jobs.retrieve(externalJobId)`
  - Update `fineTuningDatasets.status` + `fineTuningedModelId` on completion
  - Emit `finetuning.completed` event via eventStreamService

**Step 4 — Fine-tuning UI**  
File: `server/domain/ai/ui/.../FineTuningDashboard.tsx` (new)  
- Dataset list: name, example count, status badge, submit/view actions
- Dataset detail: example browser with approve/reject per example
- Training job status: progress bar, estimated completion, model ID on success
- Uses `useEventStream` for live status updates

### Files to Create/Modify
| File | Action |
|------|--------|
| `server/domain/ai/core/fine-tuning.service.ts` | Complete importExamples, add submit + poll |
| `server/domain/ai/ui/.../FineTuningDashboard.tsx` | Create |
| `server/domain/ai/ai.route.ts` | Add fine-tuning endpoints |

### Tests Required
**File**: `server/domain/ai/tests/integration/fine-tuning.test.ts`
```typescript
/** @vitest-environment node */
// describe('Fine-Tuning Service')
// - it('importExamples inserts valid examples and skips duplicates')
// - it('importExamples rejects malformed message format')
// - it('submitTrainingJob uploads JSONL and creates OpenAI job', { skip: !process.env.OPENAI_API_KEY })
// - it('pollTrainingStatus updates dataset status on completion')
// - it('emits finetuning.completed event when job finishes')
```

### Documentation
File: `docs/feature-documentation/fine-tuning.md`  
Cover: JSONL format spec, OpenAI API requirements, Anthropic future support stub, polling interval, model deployment after training.

---

## Feature 10 — Autonomous Lifecycle Manager

### Current State
`server/domain/ai/core/autonomous-lifecycle.service.ts` — three-stage lifecycle (plan/execute/verify), TaskManifest schema, MoltProducer integration, Sentinel health checks, AI-driven planning. Manifest verification step not fully implemented.

### Implementation Steps

**Step 1 — Complete manifest verification**  
File: `server/domain/ai/core/autonomous-lifecycle.service.ts`  
- `verifyManifest(manifest)`:
  - For each step, check `sentinelService.getToolHealth(step.toolId)` — reject manifest if any required tool is degraded
  - Check `riskLevel` — if `high`, require human approval before execution proceeds
  - Validate step dependencies form a DAG (no cycles)
  - Return `{ valid: boolean, warnings: string[], blockers: string[] }`

**Step 2 — Human approval gate for high-risk manifests**  
- On `riskLevel === 'high'`, call `decisionInboxService.create({ type: 'manifest_approval', manifest, requiredBy: estimatedStart })`
- Pause execution until inbox item is resolved (poll or event-driven)

**Step 3 — Molt step execution**  
File: `server/domain/ai/core/autonomous-lifecycle.service.ts`  
- Confirm `MoltProducer.produce(step)` signature and wire each manifest step through it
- On step failure, check `retryPolicy` from manifest and re-enqueue or escalate

**Step 4 — Manifest review UI**  
File: `server/domain/ai/ui/.../ManifestReviewPanel.tsx` (new)  
- Shows planned steps as a timeline with risk indicators
- Approve / Reject with optional comment
- Sentinel health status for each tool used in the manifest
- Live execution progress after approval

### Files to Create/Modify
| File | Action |
|------|--------|
| `server/domain/ai/core/autonomous-lifecycle.service.ts` | Complete verification + approval gate |
| `server/domain/ai/ui/.../ManifestReviewPanel.tsx` | Create |

### Tests Required
**File**: `server/domain/ai/tests/integration/autonomous-lifecycle.test.ts`
```typescript
/** @vitest-environment node */
// describe('Autonomous Lifecycle Manager')
// - it('rejects manifest with degraded required tool')
// - it('detects cyclic step dependency and returns blocker')
// - it('creates HIL approval request for high-risk manifest')
// - it('proceeds with execution after approval')
// - it('re-enqueues failed step per retry policy')
```

### Documentation
File: `docs/feature-documentation/autonomous-lifecycle.md`  
Cover: manifest schema reference, risk level definitions, Molt integration contract, verification checklist, approval flow.

---

## Cross-Cutting Concerns (Apply to All Features)

### Test Patterns to Follow
- All backend integration tests: `/** @vitest-environment node */`, import `{ app, serverReady }` from `@server/index.js`
- All tests: `beforeAll(async () => { await serverReady; })` + seed data in `beforeAll`, cleanup in `afterAll`
- Auth: create test user + org, login via `/api/login`, extract `authCookie` + `csrfToken`
- Mocked external services (OpenAI, Docker, Qdrant): use `vi.mock` at top of file
- Frontend component tests: `@testing-library/react` + `vi.mock` for API calls

### Documentation Standard
Every feature doc in `docs/feature-documentation/` should include:
1. **Overview** — what the feature does and why it exists
2. **Architecture diagram** (ASCII or mermaid)
3. **API Reference** — all endpoints with request/response shapes
4. **Event Types** — any SSE events emitted (type, payload)
5. **Configuration** — env vars and their defaults
6. **Error Handling** — failure modes and recovery behavior

### Coverage Targets (from vitest.config.ts)
- Lines: 50% | Functions: 45% | Branches: 40%
- New feature code should target 70%+ given explicit test specs above

---

## Feature 11 — Macro-Economic Control Plane (The "Board Room")

### Current State
Oddjob tracks mission costs globally, but lacks the concept of "Agent Salaries" or "Departmental Budgets." High-risk manifests trigger generic HIL alerts rather than structured "Board Approval" flows.

### Implementation Steps

**Step 1 — Token Salary Schema**
File: `server/domain/governor/core/governance.service.ts` (new)
- Add `BudgetPolicy` schema: `{ orgId, department, monthlyLimit, alertThreshold }`
- Add `AgentSalary` schema: `{ agentId, sessionId, tokenAllowance, currentSpend }`
- Create `checkBudget(agentId, estimatedTokens)` helper

**Step 2 — Budget Enforcement in Lifecycle Manager**
File: `server/domain/ai/core/autonomous-lifecycle.service.ts`
- Before each step, call `governanceService.checkBudget(this.agentId, step.estimatedTokens)`
- If budget exceeded, transition step to `blocked_by_budget` and emit `SIG_BUDGET_EXCEEDED`

**Step 3 — Board Approval Gates**
File: `server/domain/governor/ui/BoardRoom.tsx` (new)
- High-risk or high-cost manifests are routed here
- Shows "Executive Summary" of the mission, projected ROI, and total token budget
- Human "Board Member" can approve, reject, or "Request Revision" (injecting critique back to Planner)

### Documentation
File: `docs/feature-documentation/macro-economic-governance.md`
Cover: Salary logic, department budgeting, Board Approval triggers, and ROI analytics.

---

## Feature 12 — Agentic HR & Performance Pipelining

### Current State
Sentinel tracks reliability, but these metrics are passive. There is no automated feedback loop to "fire" or "upskill" underperforming agents.

### Implementation Steps

**Step 1 — Performance Thresholds**
File: `server/domain/agents/core/performance-manager.service.ts` (new)
- Define "Probation" and "De-provisioning" thresholds (e.g., Reliability < 60% for 3 missions)
- Add `evaluateAgentPerformance(agentId)` job that runs daily

**Step 2 — Autonomous Upskilling Pipeline**
- If an agent is in "Probation," trigger a `Fine-Tuning Pipeline` job using its failed session logs as "negative examples"
- Generate "Golden Samples" for its specific failure modes using a higher-tier model (e.g., Gemini Ultra)

**Step 3 — Agentic HR Dashboard**
File: `server/domain/agents/ui/AgenticHR.tsx` (new)
- View "Employee Records" for each agent (total runs, reliability trend, cost-per-success)
- List agents currently in "Performance Improvement Plans" (PIP)
- Manual "Fire/Retrain" actions

### Documentation
File: `docs/feature-documentation/agentic-hr.md`
Cover: PIP logic, automated fine-tuning triggers, and de-provisioning safety protocols.
