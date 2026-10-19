# Mach 4: Platform-Wired Block Proposal

**Date:** April 27, 2026  
**Status:** Proposed  
**Prerequisite:** `FORGE_SPEED_PROPOSAL.md` (scaffold cache + slot-fill — already implemented)

---

## The Problem in One Sentence

Every packaged block today is a **display-layer component** that accepts props and renders fake data. The AI that calls forge still has to write all the platform wiring code — defeating the entire purpose of pre-assembled blocks.

### Evidence

```tsx
// Current AIAgentChat.tsx — line 20
onSendMessage?: (content: string) => void;  // ← caller writes the fetch()

// Current MissionControlTable.tsx — line 37
const defaultMissions = [
  { id: 'm-1', name: 'Neural Link Stabilizer', ... }, // ← hardcoded fake data
];
```

The forged app AI still has to write `fetch('/api/oddjob/missions')`, handle polling, handle errors, and wire it to the component. We saved zero generation tokens on the hardest part.

---

## The Model: Self-Wiring Platform Blocks

Each block must be **fully self-contained** — it knows how to talk to the Oddjob platform proxy and only needs a small configuration prop (an ID, a collection name, a slug) to function. The AI's only job is to pass the right config.

```
❌ Current:  AI writes fetch() + state + polling + error handling + component
✅ Target:   AI writes <MissionsBlock pipelineId={42} />  ← that's it
```

This is exactly what Lovable does. Their blocks are fully self-wiring. The AI passes configuration, not wiring code.

---

## Proposed Block Set (12 Blocks)

Grouped by Oddjob capability domain. Each is a new file in `server/domain/core/ui/components/packaged/`.

---

### Group 1: Missions

#### `PlatformMissionsBlock.tsx`
**Replaces:** Current `MissionControlTable` (fake data)  
**Platform calls:**
- `GET /api/oddjob/missions` — list runs with status
- `POST /api/oddjob/missions` — launch new run
- `DELETE /api/oddjob/missions/{id}` — abort run  

**Props:**
```ts
interface PlatformMissionsBlockProps {
  title?: string;
  allowLaunch?: boolean;
  allowAbort?: boolean;
  pollingIntervalMs?: number; // default 5000
}
```
**Self-wires:** polling, status badge coloring, launch/abort actions, empty state, loading skeleton.

---

#### `PlatformMissionLogBlock.tsx`
**Platform calls:**
- `GET /api/oddjob/missions/{missionId}/logs` — streamed log lines
- Polls every 2s while mission is active

**Props:**
```ts
interface PlatformMissionLogBlockProps {
  missionId: number;
  maxLines?: number; // default 200
  autoScroll?: boolean; // default true
}
```
**Self-wires:** ANSI color stripping, auto-scroll, live/stopped indicator, download button.

---

### Group 2: Pipelines

#### `PlatformPipelineTriggerBlock.tsx`
**Platform calls:**
- `GET /api/oddjob/pipelines` — list available pipelines
- `POST /api/oddjob/pipelines/{id}/execute` — trigger run
- `GET /api/oddjob/pipelines/executions/{execId}` — poll status

**Props:**
```ts
interface PlatformPipelineTriggerBlockProps {
  allowedPipelineIds?: number[]; // if empty, shows all
  showExecutionHistory?: boolean;
  onComplete?: (execId: number) => void;
}
```
**Self-wires:** pipeline picker dropdown, input param form (from pipeline schema), execution progress bar, step-by-step status, history table.

---

#### `PlatformPipelineStatusBlock.tsx`
**Platform calls:**
- `GET /api/oddjob/pipelines/executions/{execId}` — poll until terminal state

**Props:**
```ts
interface PlatformPipelineStatusBlockProps {
  executionId: number;
  showStepOutputs?: boolean;
}
```
**Self-wires:** step timeline, output expandable panels, duration counter, error surfacing.

---

### Group 3: Datasets

#### `PlatformDatasetTableBlock.tsx`
**Replaces:** What AI currently has to generate for every CRUD app  
**Platform calls:**
- `GET /api/oddjob/datasets?collection={name}` — list records
- `POST /api/oddjob/datasets?collection={name}` — create
- `PUT /api/oddjob/datasets/{id}?collection={name}` — update
- `DELETE /api/oddjob/datasets/{id}?collection={name}` — delete

**Props:**
```ts
interface PlatformDatasetTableBlockProps {
  collection: string;           // e.g. "contacts"
  columns: ColumnDef[];         // [{ key, label, type: 'text'|'badge'|'currency'|'date' }]
  allowCreate?: boolean;
  allowEdit?: boolean;
  allowDelete?: boolean;
  searchableFields?: string[];
}
```
**Self-wires:** full CRUD, search, sort, pagination, create/edit modal (dynamic form from `columns`), delete confirmation dialog, optimistic updates, loading skeletons.

**Impact:** This single block replaces ~400 lines of generated code in every `crud-app` forge. The AI passes `collection` + `columns` — nothing else.

---

#### `PlatformDatasetChartBlock.tsx`
**Platform calls:**
- `GET /api/oddjob/datasets?collection={name}` — fetch records for charting

**Props:**
```ts
interface PlatformDatasetChartBlockProps {
  collection: string;
  xField: string;
  yField: string;
  chartType: 'line' | 'bar' | 'area' | 'pie';
  title?: string;
  color?: string;
  dateRangeFilter?: boolean;
}
```
**Self-wires:** data fetch, Recharts rendering, date range picker, empty state, loading skeleton, error state.

---

### Group 4: Form Engine

#### `PlatformFormBlock.tsx`
**Leverages:** `FormRenderer.tsx` (already exists in `/shared/`)  
**Platform calls:**
- `GET /api/oddjob/forms/{formId}` — load form schema
- `POST /api/oddjob/forms/{formId}/submit` — submit response
- `GET /api/oddjob/datasets?collection={collection}` — optionally pre-populate

**Props:**
```ts
interface PlatformFormBlockProps {
  formId: number;
  onSubmit?: (data: Record<string, any>) => void;
  prefillCollection?: string;  // dataset to pre-populate from
  successMessage?: string;
}
```
**Self-wires:** loads form schema from platform, renders all field types via `FormRenderer`, handles validation, submit, success/error states.

---

### Group 5: Agent Chat (Platform-Wired)

#### `PlatformAgentChatBlock.tsx`
**Replaces:** Current `AIAgentChat` (prop-based, no platform calls)  
**Platform calls:**
- `POST /api/oddjob/agents/{agentId}/chat` — send message + get streaming response
- `GET /api/oddjob/agents/{agentId}/history` — load conversation history

**Props:**
```ts
interface PlatformAgentChatBlockProps {
  agentId: number;
  personaName?: string;
  suggestedPrompts?: string[];
  persistHistory?: boolean;
  collectionName?: string; // dataset to persist messages
}
```
**Self-wires:** streaming SSE response parsing, message history persistence, typing indicator, suggested prompts, all error states. The current `AIAgentChat` stays as a pure display component for cases where the caller manages the stream externally.

---

### Group 6: Knowledge Graph

#### `PlatformKnowledgeSearchBlock.tsx`
**Platform calls:**
- `POST /api/oddjob/knowledge/search` — RAG search
- `GET /api/oddjob/knowledge/nodes/{id}` — fetch node detail

**Props:**
```ts
interface PlatformKnowledgeSearchBlockProps {
  placeholder?: string;
  maxResults?: number;
  onSelectNode?: (nodeId: string) => void;
  showGraph?: boolean; // render a mini graph of related nodes
}
```
**Self-wires:** debounced search, result cards with relevance score, node detail panel, related nodes.

---

### Group 7: Jobs & HIL

#### `PlatformJobRunnerBlock.tsx`
**Platform calls:**
- `POST /api/oddjob/jobs/{jobId}/execute` — trigger job execution
- `GET /api/oddjob/jobs/{jobId}/status` — poll for result

**Props:**
```ts
interface PlatformJobRunnerBlockProps {
  jobId: number;
  inputParams?: Record<string, any>;
  showOutput?: boolean;
  label?: string;
}
```
**Self-wires:** execute button, progress indicator, output display (JSON or text), error handling, re-run capability.

---

#### `PlatformHILApprovalBlock.tsx`
**Platform calls:**
- `GET /api/oddjob/approvals/pending` — list open approval requests
- `POST /api/oddjob/approvals/{id}/approve` — approve
- `POST /api/oddjob/approvals/{id}/reject` — reject

**Props:**
```ts
interface PlatformHILApprovalBlockProps {
  pollingIntervalMs?: number; // default 3000
  maxItems?: number;
  onDecision?: (id: number, decision: 'approved' | 'rejected') => void;
}
```
**Self-wires:** polls for pending requests, renders approval cards with context, approve/reject buttons, confirmation dialog, real-time badge count.

---

## Updated Block Registry

The `block-registry.json` grows from 6 → 18 entries (6 existing + 12 new), all categorised:

| Category | Blocks |
|---|---|
| **Missions** | `PlatformMissionsBlock`, `PlatformMissionLogBlock` |
| **Pipelines** | `PlatformPipelineTriggerBlock`, `PlatformPipelineStatusBlock` |
| **Datasets** | `PlatformDatasetTableBlock`, `PlatformDatasetChartBlock` |
| **Forms** | `PlatformFormBlock` |
| **Agents** | `PlatformAgentChatBlock` |
| **Knowledge** | `PlatformKnowledgeSearchBlock` |
| **Jobs & HIL** | `PlatformJobRunnerBlock`, `PlatformHILApprovalBlock` |
| **Display** (existing) | `IndustrialDashboardHero`, `MetricGrid`, `StatusTimeline`, `TacticalMapControl`, `AIAgentChat` (display), `MissionControlTable` (display) |

---

## How This Changes App Forge Generation

### Before (today)

For a `mission-supervisor` forge, the AI generates ~600 lines including:
- `fetch('/api/oddjob/missions')` boilerplate
- Polling `useEffect` with cleanup
- Status badge logic
- Log streaming with SSE parsing
- Error boundaries
- Loading skeletons

### After (with platform blocks)

The AI generates ~40 lines:
```tsx
import PlatformMissionsBlock    from "@domain-ui/packaged/PlatformMissionsBlock";
import PlatformMissionLogBlock  from "@domain-ui/packaged/PlatformMissionLogBlock";
import PlatformPipelineTriggerBlock from "@domain-ui/packaged/PlatformPipelineTriggerBlock";

export default function MissionSupervisorPage() {
  const [activeMissionId, setActiveMissionId] = useState<number | null>(null);
  return (
    <div className="grid grid-cols-2 gap-6 p-8">
      <PlatformMissionsBlock 
        allowLaunch 
        allowAbort 
        onSelect={setActiveMissionId} // ← only app-level wiring needed
      />
      {activeMissionId && <PlatformMissionLogBlock missionId={activeMissionId} />}
      <PlatformPipelineTriggerBlock allowedPipelineIds={[{{PIPELINE_IDS}}]} />
    </div>
  );
}
```

The slot `{{PIPELINE_IDS}}` is the only thing the AI fills from `platformContext`. Everything else is block behaviour.

---

## Forge Prompt Changes

`forge-prompts.ts` needs a new `PLATFORM_BLOCKS_DIRECTIVE` section injected into `FORGE_CODE_GEN_PROMPT`:

```
── PLATFORM BLOCKS (USE THESE FIRST) ─────────────────────────────
Before writing any fetch(), useEffect(), or data-fetching logic, check if a
Platform Block covers the requirement. Platform Blocks are fully self-wiring —
they handle all platform API calls internally.

AVAILABLE PLATFORM BLOCKS:
{blockRegistry}  ← injected from block-registry.json at prompt build time

RULE: If a Platform Block covers a requirement, USE IT. Do not reimplement
its behaviour. Only write wiring code for app-level interactions between blocks
(e.g. passing a selected missionId from one block to another).
```

---

## Implementation Plan

### Phase 1 — Highest Leverage (3–4 days)
These two blocks alone eliminate most of the generated code in `crud-app`, `analytics-dashboard`, and `mission-supervisor` — the 3 most-forged blueprint types.

- [ ] **`PlatformDatasetTableBlock`** — replaces CRUD generation entirely
- [ ] **`PlatformAgentChatBlock`** — replaces chat wiring generation
- [ ] Update `block-registry.json` with both
- [ ] Update `FORGE_CODE_GEN_PROMPT` with `PLATFORM_BLOCKS_DIRECTIVE`

### Phase 2 — Mission & Pipeline Coverage (2–3 days)
- [ ] **`PlatformMissionsBlock`** — upgrade from fake-data `MissionControlTable`
- [ ] **`PlatformMissionLogBlock`** — live log streaming
- [ ] **`PlatformPipelineTriggerBlock`** — pipeline trigger + status
- [ ] Update `mission-supervisor` blueprint to use these blocks

### Phase 3 — Full Coverage (3–4 days)
- [ ] **`PlatformDatasetChartBlock`**
- [ ] **`PlatformFormBlock`** (wraps existing `FormRenderer.tsx`)
- [ ] **`PlatformKnowledgeSearchBlock`**
- [ ] **`PlatformJobRunnerBlock`**
- [ ] **`PlatformHILApprovalBlock`**
- [ ] **`PlatformPipelineStatusBlock`**
- [ ] Update all remaining blueprints to reference platform blocks

### Phase 4 — Blueprint Upgrades (2 days)
- [ ] Rewrite `crud-app/pages/index.tsx` to use `PlatformDatasetTableBlock` with `{{COLLECTION_NAME}}` + `{{COLUMNS}}` slots
- [ ] Rewrite `analytics-dashboard/pages/index.tsx` to use `PlatformDatasetChartBlock` + `MetricGrid`
- [ ] Rewrite `chat-assistant/pages/index.tsx` to use `PlatformAgentChatBlock` with `{{AGENT_ID}}` slot
- [ ] Rewrite `mission-supervisor` to use `PlatformMissionsBlock` + `PlatformMissionLogBlock`

---

## Files to Create / Modify

| File | Action |
|---|---|
| `server/domain/core/ui/components/packaged/PlatformDatasetTableBlock.tsx` | **Create** |
| `server/domain/core/ui/components/packaged/PlatformAgentChatBlock.tsx` | **Create** |
| `server/domain/core/ui/components/packaged/PlatformMissionsBlock.tsx` | **Create** |
| `server/domain/core/ui/components/packaged/PlatformMissionLogBlock.tsx` | **Create** |
| `server/domain/core/ui/components/packaged/PlatformPipelineTriggerBlock.tsx` | **Create** |
| `server/domain/core/ui/components/packaged/PlatformPipelineStatusBlock.tsx` | **Create** |
| `server/domain/core/ui/components/packaged/PlatformDatasetChartBlock.tsx` | **Create** |
| `server/domain/core/ui/components/packaged/PlatformFormBlock.tsx` | **Create** |
| `server/domain/core/ui/components/packaged/PlatformKnowledgeSearchBlock.tsx` | **Create** |
| `server/domain/core/ui/components/packaged/PlatformJobRunnerBlock.tsx` | **Create** |
| `server/domain/core/ui/components/packaged/PlatformHILApprovalBlock.tsx` | **Create** |
| `server/domain/core/ui/components/packaged/index.ts` | **Modify** — export all new blocks |
| `server/domain/apps/core/block-registry.json` | **Modify** — add 12 new entries |
| `server/domain/apps/core/forge-prompts.ts` | **Modify** — add `PLATFORM_BLOCKS_DIRECTIVE` |
| `server/blueprints/apps/crud-app/pages/index.tsx` | **Modify** — use `PlatformDatasetTableBlock` |
| `server/blueprints/apps/analytics-dashboard/pages/index.tsx` | **Modify** — use `PlatformDatasetChartBlock` |
| `server/blueprints/apps/chat-assistant/pages/index.tsx` | **Modify** — use `PlatformAgentChatBlock` |
| `server/blueprints/apps/mission-supervisor/pages/index.tsx` | **Modify** — use platform mission blocks |

---

## Expected Outcome

| Metric | Today (Mach 4 launch) | After this proposal |
|---|---|---|
| AI output tokens for `crud-app` | ~600 lines | ~40 lines |
| AI output tokens for `chat-assistant` | ~400 lines | ~30 lines |
| AI output tokens for `mission-supervisor` | ~500 lines | ~50 lines |
| JSON parse failure rate | ~15% | ~2% (smaller output) |
| Oddjob capabilities surfaced in forged apps | ~10% | ~90% |
| Forged app quality floor | Variable | Consistent — blocks always work |
