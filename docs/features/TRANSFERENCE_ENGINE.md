# Transference Engine (TE-101)

**Queue:** `oddjob-transference` · **Worker:** `transference` · **Migration:** `013_add_transference_tables.sql`

The Transference Engine learns which cloud LLM prompt templates produce predictable outputs, then replaces those calls with local Python handlers when accuracy is proven. It reduces cost and latency for repetitive, low-entropy workloads without changing upstream callers.

## The loop

1. **Log.** Every successful cloud LLM call through `CachedAIClient` writes a row to `ai_execution_logs` with prompt hash, combined prompt text, input variables, raw output, latency, and token count.
2. **Mine.** The `transference` worker runs daily at 3 AM (`transference-mine-daily`). `TransferenceRouter.mineTransferenceCandidates()` finds prompt templates with ≥ 100 logged calls and Shannon entropy below 1.8, then registers new `transference_rules` rows in **shadow** mode (tier 2).
3. **Shadow.** On subsequent cloud LLM calls, shadow rules still fall through to the real model. After the call completes, `trackShadowAccuracyForHash` runs the local handler and compares its prediction to the LLM output.
4. **Promote.** When a shadow rule reaches ≥ 500 comparisons at ≥ 98% accuracy, its mode is automatically set to **active**.
5. **Intercept.** Active rules are checked before the cloud call. If the handler returns confidence ≥ 0.90, the local prediction is returned immediately with provider metadata `transference-engine`.

```
Cloud LLM call
    │
    ├─ active rule + high confidence ──► local Python handler (skip cloud)
    │
    └─ otherwise ──► cloud LLM
            │
            └─ shadow rule? ──► compare handler vs LLM output, update accuracy
```

## Rule modes

| Mode | Behavior |
| --- | --- |
| `shadow` | Cloud LLM runs normally; handler output is compared asynchronously for accuracy tracking |
| `active` | Handler may intercept the call when confidence ≥ 0.90; low confidence falls back to cloud |
| `disabled` | Rule is ignored; call always goes to cloud |

## Handler contract

Handlers are Python scripts referenced by `transference_rules.handler_path`. The router invokes:

```bash
python "<handler_path>"
```

with JSON input on stdin containing at least `{ text, combinedPrompt }` (mirroring what `routeCall` passes).

Expected stdout (JSON):

```json
{
  "prediction": "the model output string",
  "confidence": 0.95
}
```

New candidates mined today receive a placeholder path:

`server/config/transference/handlers/<prompt_hash>_handler.py`

Those files must be implemented separately before shadow or active routing can succeed.

## Prompt identity

Rules are keyed by an MD5 hash of the combined system + user prompt:

```typescript
createHash("md5").update(systemPrompt + "\n" + userPrompt).digest("hex")
```

The same hash is used for logging, rule lookup, shadow tracking, and mining.

## Integration points

- **Pre-call routing:** `CachedAIClient.execute` in `server/domain/ai/core/ai-client.service.ts` calls `TransferenceRouter.routeCall` for non-local providers when a prompt hash is available.
- **Post-call shadow tracking:** After a successful cloud response, `trackShadowAccuracyForHash` runs fire-and-forget on the same hash.
- **Telemetry source:** `logTelemetry` inserts into `ai_execution_logs`, which feeds the miner.

Local providers (`ollama`, `local_openai`, `local`, or localhost base URLs) bypass transference routing entirely.

## Database schema

Defined in `shared/schema/ai/transference.ts`:

| Table | Purpose |
| --- | --- |
| `ai_execution_logs` | Raw LLM call telemetry for mining and analysis |
| `transference_rules` | Per-prompt-hash handler config, mode, tier, and shadow accuracy counters |

Key columns on `transference_rules`:

- `prompt_hash` — unique MD5 key
- `mode` — `shadow` \| `active` \| `disabled`
- `tier` — 1 (rules/regex), 2 (classic ML), 3 (SLM); mining currently registers tier 2
- `handler_path` — Python script path
- `accuracy_score`, `total_shadow_count`, `mismatch_count` — shadow promotion metrics

## Worker jobs

| Job type | Payload | Action |
| --- | --- | --- |
| `mine` | `{}` | Scan logs and register new shadow candidates |
| `retrainCheck` | `{ promptHash, llmOutput, inputVariables }` | Run shadow accuracy comparison for one call |

Daily mining is seeded in `server/worker-entrypoint.ts` when the `transference` worker starts:

```bash
WORKER_TYPE=transference node dist/worker-entrypoint.js
```

Or include it in a multi-worker deployment:

```bash
WORKER_TYPE=ai,transference node dist/worker-entrypoint.js
```

## Key files

| Concern | Location |
| --- | --- |
| Router + miner | `server/domain/agents/core/transference-router.ts` |
| Background worker | `server/workers/transference-worker.ts` |
| LLM interception | `server/domain/ai/core/ai-client.service.ts` |
| Queue registration | `server/domain/core/infrastructure/queue/queue-service.ts` |
| Schema | `shared/schema/ai/transference.ts` |
| Migration | `server/migrations/013_add_transference_tables.sql` |
| Worker bootstrap + cron | `server/worker-entrypoint.ts` |

## Safety properties

- **Shadow-first promotion.** New rules never intercept live traffic until 500 shadow comparisons at 98%+ accuracy.
- **Confidence gate.** Active rules with confidence below 0.90 fall back to the cloud LLM.
- **Fail open.** Handler errors, missing rules, and disabled modes all defer to standard LLM execution.
- **Local bypass.** Transference does not wrap already-local inference paths.

## Limitations

- No admin UI or REST API for managing rules; rows are written by the miner and updated by shadow tracking.
- Mined candidates reference handler paths that are not auto-generated — operators must supply working Python handlers.
- Shadow comparison uses exact string match (case-insensitive, trimmed); semantic equivalence is not evaluated.
- Mining threshold (≥ 100 calls, entropy < 1.8) and promotion threshold (500 runs, 98% accuracy) are hard-coded.
- Handler execution requires `python` on the worker PATH; there is no containerized or sandboxed runner yet.

## Related documentation

- [Worker Architecture](../feature-documentation/core-features/06-worker-architecture.md) — queue and worker deployment
- [Evolution Engine](./EVOLUTION_ENGINE.md) — complementary self-improvement loop for skill code
