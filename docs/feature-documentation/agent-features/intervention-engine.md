# Intervention Engine

## Feature Overview

### Purpose & Business Value

The Intervention Engine is a self-improving assistant that watches user behaviour in real time and proactively surfaces contextual help. When a user struggles (repeated errors, long pauses, abandoned forms), the system fires a coaching card in the bottom-right corner of the UI — pre-populated with a tailored message and a one-click path to ask the Oddjob Copilot for help.

Unlike static tooltips or onboarding wizards, the engine **learns**. An LLM-powered agent evaluates each potential intervention before it fires, deciding whether to show it, rewrite its message, or suppress it based on accumulated outcomes and distilled policies. Over time the agent becomes calibrated to the specific platform, user patterns, and org context.

### User Personas & Use Cases

| Persona | Use case |
|---|---|
| End user | Sees a contextual suggestion card when stuck; clicks "Get help" to open the Copilot with a pre-filled prompt |
| Admin / operator | Reviews the agent's learned policies and pending threshold change suggestions in Scoring Studio → Agent Brain |
| Developer | Triggers test interventions from the admin panel to preview how the card looks without waiting for real events |

### Key Requirements & Constraints

- **Non-blocking**: The agent evaluation path is fully async and has a try/catch fallback — if the LLM call fails, the intervention fires with the raw threshold message. The scoring pipeline never breaks.
- **Cooldown enforced**: A Redis TTL key prevents the same threshold from firing twice within `cooldownMs`. The agent adds a second same-vector recency gate (default 5 min).
- **Privacy**: Intervention memory stores session-scoped identifiers (`sess-xxx`), not PII. User ID stored as `u:userId` only when the event provides it.
- **Human in the loop**: Policy suggestions from distillation are `pending` by default. An admin must explicitly approve them in Scoring Studio before they influence the agent.

### Success Metrics

- **Accept rate** (accepted / fired) tracked in `intervention_memory` and shown in Agent Brain stats bar
- **Suppression rate** — what % of candidates does the agent suppress vs. fire
- **Distillation cadence** — new policies created every 50 resolved outcomes

---

## User Interface Documentation

### Screens & Navigation

| Screen | Path | Description |
|---|---|---|
| Intervention toast | Global (bottom-right) | The `CopilotIntervention` component mounts at app root via `CoreRouting.tsx`, always visible when authenticated |
| Agent Brain | Admin → Scoring Studio → Agent Brain tab | Memory, Policies, Suggestions, Test Fire |

### Component Hierarchy

```
CoreRouting.tsx
  └─ <Suspense>
       └─ CopilotIntervention          ← mounts at root, always present
            └─ useInterventionEngine   ← SSE queue manager hook

Admin
  └─ ScoringStudio
       └─ AgentBrainPanel (lazy)
            ├─ StatsBar
            ├─ MemoryPanel
            ├─ PoliciesPanel
            ├─ SuggestionsPanel
            │    └─ SuggestionCard
            └─ TestFirePanel
```

### CopilotIntervention — states

| State | Description |
|---|---|
| Hidden | No active intervention in queue |
| Card | Full intervention card visible with progress bar |
| Minimised | Floating orb with queue badge — click to restore |

### InterventionCard anatomy

```
┌──────────────────────────────────────────────────────────────┐
│ [progress bar — auto-dismiss timer]                          │
├──────────────────────────────────────────────────────────────┤
│ [Vector badge]  [URGENT?]  [+N]        [▼ minimize] [✕]     │
│ Oddjob · Scored                                              │
│                                                              │
│ **Title** (agent-written, max 8 words)                       │
│ Description sentence or two.                                 │
│                                                              │
│ ▶ Why am I seeing this?  (collapsible rationale)             │
│                                                              │
│ ░░░░░░░░░░░░░░░░░░░░░░░  87% confidence                      │
│                                                              │
│  [  Dismiss  ]  [  Get help  →  ]                            │
└──────────────────────────────────────────────────────────────┘
```

### SCORE vector colours

| Vector | Meaning | Colour |
|---|---|---|
| S | Struggle | Red |
| C | Clarity gap | Amber |
| O | Outcome opportunity | Blue |
| R | Readiness signal | Purple |
| E | Engagement peak | Emerald |

### Priority rings

| Priority | Visual treatment |
|---|---|
| critical | `ring-2 ring-red-500` + red glow shadow |
| high | `ring-2 ring-amber-500` + amber shadow |
| medium | `ring-1 ring-border` |
| low | No ring |

### User Interactions

| Action | Result |
|---|---|
| Click "Get help" (accept) | Dispatches `agent-assist-request` custom DOM event → `Layout.tsx` opens `AgentChatSheet` with `initialPrompt` and `initialContext` pre-filled |
| Click "Dismiss" | Marks suggestion id in `sessionStorage` so it doesn't reappear; reports `dismissed` outcome to `/api/scoring/interventions/outcome` |
| Click minimise (▼) | Component collapses to floating orb; queue count badge shown |
| Click orb | Restores full card |
| Auto-expire (12 s) | Progress bar hits zero; reports `expired` outcome |
| Click "Why am I seeing this?" | Expands collapsible rationale section |

---

## API Documentation

### Endpoint Specifications

All endpoints require authentication (`requireAuth`). Mutation endpoints require a valid `x-csrf-token` header.

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/scoring/interventions/outcome` | Record user outcome for an intervention |
| `GET` | `/api/scoring/agent/memory` | Last 50 intervention memory rows (with threshold names) |
| `GET` | `/api/scoring/agent/policies` | All intervention policies |
| `PATCH` | `/api/scoring/agent/policies/:id/toggle` | Enable / disable a policy |
| `GET` | `/api/scoring/agent/suggestions` | All policy suggestions |
| `PATCH` | `/api/scoring/agent/suggestions/:id` | Approve or reject a suggestion |
| `POST` | `/api/scoring/agent/distill` | Manually trigger policy distillation |
| `POST` | `/api/scoring/agent/test-fire` | Fire a synthetic intervention for UI preview |

### Request/Response Schemas

#### `POST /api/scoring/interventions/outcome`

```json
// Request
{
  "interventionId": "1-1713000000000",
  "outcome":        "accepted",            // accepted | dismissed | expired | ignored
  "timestamp":      1713000000000          // receivedAt timestamp (ms since epoch)
}

// Response 200
{ "success": true }
```

#### `POST /api/scoring/agent/test-fire`

```json
// Request
{
  "vector":      "S",        // S | C | O | R | E  (default: C)
  "priority":    "high",     // critical | high | medium | low  (default: medium)
  "title":       "...",      // optional override
  "description": "..."       // optional override
}

// Response 200
{ "success": true }
```

#### `PATCH /api/scoring/agent/suggestions/:id`

```json
// Request
{ "status": "approved" }   // approved | rejected

// Response 200 — updated suggestion row
```

### Error Handling

| Status | Cause |
|---|---|
| 400 | Missing required field (`interventionId`, `outcome`, `status`) |
| 400 | Invalid `status` value (not `approved`/`rejected`) |
| 401 | Not authenticated |

---

## Component Architecture

### `useInterventionEngine` hook

**Location:** `server/domain/core/ui/hooks/use-intervention-engine.ts`

```typescript
const {
    active,         // ActiveIntervention | null — currently displayed
    queueLength,    // number — pending items
    dismiss,        // () => void
    accept,         // () => void — fires agent-assist-request + records outcome
    clearQueue,     // () => void
    autoDismissMs,  // 12000 — exposed for ProgressBar
} = useInterventionEngine();
```

**Behaviour:**
- Opens a single `EventSource` to `/api/events/stream`
- Handles both `INTENT_STABILIZED` (legacy psychologist) and `intervention.triggered` (scoring runner)
- Deduplicates via `sessionStorage` dismissed-id list
- Queue sorted by priority (`critical → low`) when multiple items are waiting
- Reports outcome to backend on every action (accept / dismiss / expire)

### `ActiveIntervention` interface

```typescript
interface ActiveIntervention {
    id:           string;
    memoryId?:    number;         // foreign key into intervention_memory
    thresholdId?: number;
    vector:       string;         // S | C | O | R | E
    title:        string;
    description:  string;
    aiPrompt?:    string;         // pre-filled prompt for AgentChatSheet
    actionLabel?: string;
    rationale?:   string;         // shown in "Why am I seeing this?"
    priority:     'critical' | 'high' | 'medium' | 'low';
    source:       'INTENT_STABILIZED' | 'intervention.triggered';
    receivedAt:   number;         // ms timestamp — used for time-to-action
    confidence?:  number;         // 0-1
    context?:     Record<string, any>;
}
```

---

## Integration Points

### Event Stream (SSE)

The component subscribes to two event types:

| Event type | Source | When fired |
|---|---|---|
| `INTENT_STABILIZED` | `psychologist` (ephemeral engine) | User intent stabilises on a page |
| `intervention.triggered` | `scoring-runner` | SCORE threshold crossed + agent approves |

`intervention.triggered` payload:

```json
{
  "interventionId": "99-1713000000000",
  "memoryId":       42,
  "thresholdId":    99,
  "vector":         "S",
  "score":          5.0,
  "title":          "You seem stuck",
  "description":    "I noticed repeated errors in the pipeline editor.",
  "aiPrompt":       "The user is editing a pipeline and keeps hitting validation errors...",
  "rationale":      "S-score crossed threshold 5 on /pipelines/42",
  "priority":       "high",
  "confidence":     0.87,
  "sessionId":      "sess-abc",
  "action":         { "type": "toast", "config": {} }
}
```

### AgentChatSheet handoff

When the user clicks "Get help", `useInterventionEngine.accept()` dispatches:

```typescript
window.dispatchEvent(new CustomEvent('agent-assist-request', {
    detail: {
        prompt:      intervention.aiPrompt,
        context:     intervention.context,
        userSummary: intervention.description,
    }
}));
```

`Layout.tsx` listens for this event and opens `AgentChatSheet` with the prompt auto-sent.

### Database Tables

| Table | Purpose |
|---|---|
| `intervention_memory` | One row per intervention evaluated (decision + outcome). Used as few-shot examples. |
| `intervention_policies` | Plain-English rules distilled by the agent every 50 outcomes. Applied as prompt prefix. |
| `intervention_policy_suggestions` | Agent suggestions for threshold/rule changes awaiting admin approval. |

### Redis Keys

| Key pattern | TTL | Purpose |
|---|---|---|
| `iv:recent:{sessionId}:{vector}` | 5 min | Same-vector recency gate |
| `scoring:cooldown:{thresholdId}:{subjectId}` | `cooldownMs` | Threshold cooldown (existing) |
| `scoring:scores:{subjectId}` | — | SCORE vector hash (existing) |

---

## Error Handling & Edge Cases

### Fallback chain

```
scoreThreshold breached
  → interventionAgentService.evaluate()
      ├─ LLM available → agent decides fire/suppress/rewrite
      └─ LLM unavailable / throws
           → builtinDecision()
                ├─ Same-vector recency key set? → suppress
                └─ No? → fire with raw threshold message
```

### Edge cases

| Scenario | Behaviour |
|---|---|
| LLM call fails | Fallback fires the raw action with `confidence: 0.5` |
| Same vector fired < 5 min ago | Agent suppresses regardless of LLM decision |
| `intervention_memory` table doesn't exist | `memoryId` not set; agent continues without persisting |
| SSE connection dropped | `useInterventionEngine` relies on `useEventStream`'s built-in exponential back-off reconnect |
| User dismisses and same intervention fires again | `sessionStorage` dismissed-id list blocks it from entering the queue |
| Queue fills > 5 items | New items are dropped; existing queue processed first |

---

## Performance Considerations

### Critical path latency

The agent evaluation adds latency to `triggerIntervention`. For typical Anthropic/OpenAI endpoints this is 500–2000 ms. This is acceptable since the intervention is non-blocking — the user never waits for it.

### Redis usage

- One `HGETALL` per threshold breach (to read full SCORE vector)
- One `GET` + one `SET` per evaluate call (recency gate)
- One `EXISTS` per threshold per event (cooldown check — existing)

### LLM costs

- Model: `concierge` service key (defaults to the org's configured model)
- Prompt length: ~300–500 tokens (policies + memory examples + candidate)
- Distillation (`distillPolicies`): 1 LLM call per 50 outcomes (~1000 tokens)

---

## Security & Permissions

All new endpoints require `requireAuth`. Mutation endpoints (`PATCH`, `POST`) require a valid CSRF token.

No endpoint exposes another user's intervention memory — rows are session-scoped and the admin endpoints (`/agent/*`) are admin-only in practice (behind the admin route guard in the router).

---

## Testing

### Unit tests

**`server/domain/knowledge/core/scoring/intervention-agent.test.ts`**

Covers:
- `evaluate()` — LLM approve / suppress / fallback / recency gate / memory persistence / policy loading / few-shot injection
- `recordOutcome()` — DB update, graceful error handling
- `distillPolicies()` — policy + suggestion insertion, skip when < 10 outcomes

**`server/domain/knowledge/core/scoring/scoring-runner.test.ts`**

Covers:
- `matches()` — all six hierarchy levels
- `meetsCondition()` — all operators
- `triggerIntervention()` — agent consulted, fire/suppress, fallback on error, cooldown skips publish
- `handleEvent()` — end-to-end from event to published intervention

### Integration tests

**`server/domain/knowledge/tests/integration/scoring-intervention.test.ts`**

Covers all 8 new API endpoints with real DB. Tests automatically skip if the `0032_intervention_agent` migration has not been applied.

---

## Migration

`migrations/0032_intervention_agent.sql` creates:

- `intervention_memory` — with FK to `score_thresholds` (nullable)
- `intervention_policies`
- `intervention_policy_suggestions`
- Indices on `session_id`, `vector`, `outcome`, `enabled`, `status`

Apply with:

```bash
npx drizzle-kit push
# or manually:
psql $DATABASE_URL -f migrations/0032_intervention_agent.sql
```

---

## Documentation References

- [Real-Time Event Stream](../real-time-events.md) — SSE infrastructure
- [Scoring Studio admin feature](../admin-features/09-admin-dashboard.md) — parent admin page
- `shared/schema/scoring.ts` — full schema including the three new tables
- `shared/schema/ephemeral.ts` — `contactIntentStates`, `engagementLogs` (legacy psychologist schema)
