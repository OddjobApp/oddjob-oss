# Design: Honest AI provider labeling & degraded-mode visibility

**Status:** Draft · **Author:** (session) · **Theme:** Reliability / "kill silent failure"

## Problem

When a cloud AI call fails (quota 429, spend cap), `CachedAIClient.executeStream`
transparently fails over: **Qwen (DashScope) → Ollama → Mock**. The response still
streams, so the user gets *an* answer — but:

1. **Usage is mislabeled.** The streaming interface is `executeStream(...) →
   AsyncIterable<string>` — pure text, no metadata channel. The caller logs usage
   (`usage.service` → `ai_usage_logs`) using the **requested** provider/model
   (`config.provider`/`config.model`), not the one that actually served the tokens.
   Observed in prod-like data: copilot answers recorded as `google` /
   `gemini-2.5-flash` with `0` tokens when they were actually mock/failover output.
2. **Degradation is silent.** Nothing tells the user, the trace, or monitoring that
   the answer came from a local fallback (or a canned mock stub) instead of the
   requested cloud model. This is exactly how "copilot silently served mock answers
   under a Gemini 429" went unnoticed.
3. **Cost attribution is wrong.** Spend dashboards under-count the real provider and
   over-count the requested one.

Non-streaming already does the right thing — `MockAIClient`/`OllamaClient` stamp
`metadata: { provider, model }`, and the non-stream failover returns real metadata.
The gap is specifically the **streaming** path.

## Goals

- Usage logs & traces record the **actual** provider/model that produced the output.
- Degraded mode (any failover, especially mock) is an **explicit, visible signal** —
  never silent.
- **Incremental & non-breaking**: unconverted call sites keep working unchanged.

## Non-goals

- Rewriting the streaming contract for every consumer (rejected — see Option B).
- Changing failover *behavior* (order, triggers). This is about visibility only.

## Shared type

```ts
// server/domain/ai/core/ai-client.service.ts (exported)
export interface AIStreamOutcome {
  actualProvider?: string;   // provider that produced the output (e.g. "qwen", "ollama", "mock")
  actualModel?: string;      // model that produced it (e.g. "qwen-max", "llama3.2:latest")
  degraded?: boolean;        // true when a failover/fallback path served the response
  degradedReason?: string;   // human string, e.g. "gemini 429 → qwen", "→ ollama", "→ mock"
  failoverChain?: string[];  // audit trail, e.g. ["gemini","qwen"]
}
```

## Options considered

| Option | Idea | Verdict |
|---|---|---|
| **A. Mutable outcome param** | Add optional `outcome?: AIStreamOutcome` to `executeStream`; the client writes into it; callers read it after draining the stream. | **Chosen.** One optional param, fully backward-compatible, no change to the `AsyncIterable<string>` contract. |
| B. Structured chunk stream | Change return to `AsyncIterable<{text?; meta?}>`. | Rejected — breaking for every consumer; large blast radius. |
| C. Overload `traceContext` | Carry `actualProvider` on the already-threaded trace object. | Rejected — `TraceContext` is a typed trace primitive (traceId/spanId), several definitions exist; overloading is hacky. |
| D. Emit `ai.degraded` event | Publish an event at each failover branch. | **Chosen for Phase 1** — complements A; zero call-site changes; instant visibility. |

## Plan (phased)

### Phase 1 — Surface degradation (small, high-value, zero call-site churn)
In `CachedAIClient.executeStream` (and the non-stream failover), at **each** failover
branch (Qwen / Ollama / Mock) emit:

```ts
eventStream.publish("ai.degraded", {
  requestedProvider, requestedModel,
  actualProvider, actualModel,
  reason,            // "budget/quota 429"
  serviceKey,        // config.serviceKey if present
}, { organizationId, userId, source: "ai-failover" }, "ai-failover");
```

- Instantly makes "copilot on mock/ollama" visible in `event_log` + the SSE/monitoring
  stream. Optionally raise it as an Assistant Update when the fallback is **mock**
  (the worst case) so a human notices the outage.
- Verifiable exactly like the cycle-step announcement: force a failover, assert one
  `ai.degraded` row in `event_log`.
- **Blast radius: 1 file.**

### Phase 2 — Honest usage labeling (medium, incremental)
1. Add `outcome?: AIStreamOutcome` to the `AIClient.executeStream` signature and to
   `QwenOverrideClient` / `CachedAIClient` / provider clients.
2. Populate it: primary path sets `actualProvider/actualModel` from the served
   provider; each failover branch sets `degraded=true` + reason + appends to
   `failoverChain`.
3. Update the **high-value** usage-log sites to read the truth:
   `provider: outcome.actualProvider ?? config.provider` (same for model). Start with
   the copilot/agent streaming path (where the mislabel was observed), then pipeline
   streaming. Sites that don't pass `outcome` keep current behavior — **no regression**.

> Scope correction: only a handful of sites actually INSERT `ai_usage_logs` on the
> streaming path (central `usage.service`, the agent/copilot logger, pipeline
> streaming). The earlier "~36 files" was references, not rewrites.

### Phase 3 — User-facing + non-stream parity (optional)
- Add a `degraded`/`actualProvider` flag to `AIResponse.metadata` for the non-stream
  path (it already carries `provider`), so both paths are uniform.
- Show a subtle notice in the copilot response when degraded (e.g. "answered via local
  fallback — cloud model was unavailable").

## Rollout & verification

- **Phase 1:** unit-force each branch; assert `ai.degraded` in `event_log`. Ship alone.
- **Phase 2:** per-branch unit tests for `outcome` population; DB check that copilot
  calls under a forced 429 now log `actualProvider = qwen|ollama|mock` (not `google`).
- Backward-compat guard: usage sites fall back to `config.provider` when `outcome` is
  absent → converting sites one at a time is safe.

## Risks

- **Silent no-op if callers forget `outcome`.** Mitigation: Phase 1 (events) is
  independent and needs no caller changes, so visibility exists even before any usage
  site is converted.
- **Event volume.** `ai.degraded` only fires on failover (rare, by definition), so
  volume is self-limiting; if a storm occurs it's itself the signal.

## Estimated effort

- Phase 1: ~half a day (1 file + a test).
- Phase 2: ~1–2 days (interface + client population + 2–3 log sites + tests).
- Phase 3: optional, ~half a day.
