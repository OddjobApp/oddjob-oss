# Transference Engine (TE-101)

The Transference Engine learns which cloud LLM prompt templates produce predictable outputs, then replaces those calls with local Python handlers when accuracy is proven. It reduces cost and latency for repetitive, low-entropy workloads without changing upstream callers.

**Full reference:** [docs/features/TRANSFERENCE_ENGINE.md](../../../docs/features/TRANSFERENCE_ENGINE.md)

## When to mention it

- User asks about reducing LLM cost or latency for repetitive prompts
- User asks about shadow-mode ML replacement or local inference routing
- User is deploying workers and needs to know about `oddjob-transference`
- User asks how cloud LLM calls are logged, mined, or intercepted

## The loop

1. **Log** — Successful cloud LLM calls through `CachedAIClient` write rows to `ai_execution_logs` (prompt hash, prompts, output, latency, tokens).
2. **Mine** — The `transference` worker runs daily at 3 AM. Templates with ≥ 100 calls and Shannon entropy below 1.8 become new **shadow** rules in `transference_rules`.
3. **Shadow** — Cloud calls still run normally; after each call the target model (Python handler or remote SLM endpoint) is compared to the LLM output using multi-layer fidelity matching (exact match, structural JSON equivalence, semantic containment).
4. **Promote & Drift Monitor** — After ≥ 500 shadow comparisons at ≥ 98% accuracy, the rule mode becomes **active**. If accuracy falls below 90% in production, the rule is automatically demoted.
5. **Intercept** — Active rules with handler confidence ≥ 0.90 return local predictions before the cloud call (provider metadata: `transference-engine`).

## Rule modes

| Mode | Behavior |
| --- | --- |
| `shadow` | Cloud LLM runs; target model output evaluated asynchronously with drift telemetry |
| `active` | Target model intercepts when confidence ≥ 0.90; otherwise falls back to cloud |
| `disabled` | Rule ignored |

## Deployment

```bash
WORKER_TYPE=transference node dist/worker-entrypoint.js
# or combined:
WORKER_TYPE=ai,transference node dist/worker-entrypoint.js
```

Queue: `oddjob-transference` · Worker concurrency: 2

## Handler contract

Handlers can be local Python scripts at `transference_rules.handler_path` or remote HTTP/SLM endpoints (`http://...`). For local scripts, the router runs:

```bash
python "<handler_path>"
```

with JSON on stdin (`text`, `combinedPrompt`, etc.) and expects stdout JSON:

```json
{ "prediction": "...", "confidence": 0.95 }
```

Mined candidates get placeholder paths under `server/config/transference/handlers/<prompt_hash>_handler.py` — operators must implement these before shadow or active routing works. Remote SLM endpoints receive POST requests with JSON payload and return `{ "prediction": "...", "confidence": ... }`.

## Safety

- Shadow-first promotion (no live interception until proven across ≥ 500 runs)
- Multi-layer fidelity validation (exact match, JSON structural equivalence, semantic containment)
- Continuous drift monitoring and automatic demotion (< 90% accuracy)
- Confidence gate (below 0.90 → cloud fallback)
- Fail open on handler errors or missing rules
- Local providers (`ollama`, `local_openai`, localhost) bypass transference entirely

## Capabilities

- Multi-model target execution (Python scripts & remote SLM endpoints)
- Semantic fidelity evaluation engine (`evaluateFidelity`)
- Automated drift & statistical promotion telemetry (`computeDriftMetrics`)

## Limitations

- No admin UI or REST API for rule management
- Mining and promotion thresholds are hard-coded
- Requires `python` on the worker PATH

## Related

- **Evolution Engine** — Human-in-the-loop skill code improvement (complementary self-improvement loop)
- **Worker architecture** — [docs/feature-documentation/core-features/06-worker-architecture.md](../../../docs/feature-documentation/core-features/06-worker-architecture.md)

## Key files

| Concern | Location |
| --- | --- |
| Router + miner | `server/domain/agents/core/transference-router.ts` |
| Background worker | `server/workers/transference-worker.ts` |
| LLM interception | `server/domain/ai/core/ai-client.service.ts` |
| Schema | `shared/schema/ai/transference.ts` |
