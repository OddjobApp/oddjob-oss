# CREW Room — How an Agent Gets a Tool

> **Source of truth:** [`crew-tools.service.ts`](../../server/domain/crew/core/crew-tools.service.ts)
> **Related:** [`CREW_IN_ROOM_GOVERNED_TASKS.md`](./CREW_IN_ROOM_GOVERNED_TASKS.md) covers Tier 3.5 proposals in depth.

An agent in a CREW room may call a tool only if it appears in `resolveForCard`'s candidate set **and** survives `classifyReadOnly`. Both halves matter, and the second one fails quietly — see *Silent withholding* below.

## The candidate set

```
declared = cardTools ∪ UNIVERSAL_PRESENTATION_TOOLS ∪ RESEARCH_TOOLS ∪ PLATFORM_STATUS_TOOLS
```

`agent_cards.tools` is a **ceiling on domain reach** — which repo an agent may read, which tracker it may query. It is not a ceiling on how an agent hands something to a user, looks something up, or reads the platform's own state, which is why the three universal lists are additive. No synced agent card declares a render tool, because job configs list domain integrations rather than presentation affordances; without the universal grants, tiers 2 and 4 would never fire at all.

## The tiers

| Tier | Set | What it is | Admitted because |
| :--- | :-- | :--------- | :--------------- |
| 1 | *(heuristic)* | Reads on the agent's declared domain tools | Name has a read verb and no write verb, or `idempotency: "read-safe"` |
| 2 | `ARTIFACT_TOOLS` | Renders a surface for the user — forms, instant apps, charts, documents | Explicit allowlist; each checked to produce ephemeral UI with no external side effect |
| 3 | `COLLABORATION_TOOLS` | Shared working memory, asking a human | Explicit; a write no heuristic would admit |
| 3.5 | `PROPOSAL_TOOLS` | Non-destructive drafts behind a human approval gate | Explicit; proposes, does not execute |
| 4 | `RESEARCH_TOOLS` | Looking something up the room does not know | Explicit; `browse_web` and `propose_research_mission` cannot pass the name heuristic |
| **4b** | **`PLATFORM_STATUS_TOOLS`** | **What the platform knows about itself** | **Explicit; all reads, org-scoped by their own ToolContext** |

### Tier 4b — platform self-knowledge

```
list_missions            list_mission_runs
get_system_health        get_health_triage_brief
list_jobs                list_failed_jobs         list_recent_executions
list_alerts              list_pending_interventions
get_cost_analysis        get_graph_statistics
list_scheduled_jobs      get_upcoming_scheduled_runs
```

Asked for a status brief on the platform — active missions, job health, spend — the crew previously had `search_unified_knowledge` and nothing else. It searched the knowledge base for operational facts that do not live there, found nothing, and reported that the information did not exist. The data was always available; no agent could reach it, because these tools sit in the registry named by no agent card and by neither universal list.

Nothing here writes: no tool starts, retries, cancels or approves anything. Each is org-scoped by its own `ToolContext`, and each passes `classifyReadOnly` on its own name, so they are admitted as `read-verb` rather than smuggled past the classifier.

## Silent withholding

`classifyReadOnly` returns `null` for a tool that is `adminOnly`, `superAdminOnly`, `riskLevel: "high"`, declares a disqualifying side effect (`file-system`, `email`, `webhook`, `container`, `queue-message`), or declares `idempotency: "none"`. Rejections are recorded with `logger.debug` — **not** an error.

A tool can therefore be listed in a universal grant and still never reach a single agent, and from the room that is indistinguishable from the platform not having the capability at all. `get_upcoming_scheduled_runs` sits one stem away from the `run` write-verb blocklist and only passes because `tokenize` does not stem plurals.

**Adding a name to a universal list is a nomination, not a grant.** `crew-platform-status-tools.test.ts` asserts every nominated tool both exists in the real registry and survives the classifier, and it is the reason to trust the table above.

## Execution shape

A turn runs in **two bounded passes**, which is what allows gather-then-render:

1. **Pass 1** — the model may call any permitted tool, capped at `MAX_TOOL_CALLS_PER_TURN` (3).
2. Results are handed back and the model is called again, still with tools.
3. **Pass 2** — only calls in `ARTIFACT_TOOLS` are honoured; anything else is ignored.

So an agent gathers in pass 1 and renders the finding in pass 2, without an unbounded loop. Agent prompts must ask for that ordering explicitly: a prompt that says "call the render tool immediately" produces a confident, empty deliverable, because pass 1 runs before any data exists.

## Failure semantics

`crewToolsService.execute` marks a call failed only when the tool **throws**. A tool that catches its own error and returns a string is recorded `ok: true`, and the model reads the message as a result — which is how a crashed PDF renderer reached a user as a document that had supposedly been created. Tools must throw. Note that `tool-executor.service.ts` (the non-crew path) additionally sniffs outputs beginning with `error`; the crew executor does not, so do not rely on it.
