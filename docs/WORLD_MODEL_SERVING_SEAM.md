# World Model Serving Seam — design

**Status:** design only. Nothing in this document is implemented.
**Date:** 2026-08-03

## Why this exists

A neural world model, an MCTS planner and an HTN loop already exist in `backend/`.
No TypeScript anywhere calls them. This describes what it would take to reach them,
and what has to be true before that is a good idea.

It is deliberately not a build plan for a model-serving platform. The decision this
document is meant to support is *whether* to run a Python service in production, and
what the smallest honest version of that looks like.

## What actually exists today (verified)

| Component | Location | State |
|---|---|---|
| GRU world model | `backend/memory/world_model.py:20` | Real. `nn.GRU`, `predict_next_state()` |
| MCTS | `backend/executors/htn/mcts.py:18` | Real, and already backed by the world model — `_simulate()` calls `predict_next_state()` |
| HTN loop | `backend/executors/htn/htn_loop.py:25` | Real. Builds the model, loads a checkpoint, hands it to MCTS |
| Training script | `scripts/train_world_model.py:32` | Trains on `(state, action, next_state)` JSONL |
| Training data writer | `backend/memory/knowledge_distiller.py:23` | Writes `world_model_data.jsonl` |
| FastAPI app | `backend/main.py:84` | Real app with routers; launched by `npm run backend` |
| **TypeScript → Python call** | — | **Does not exist** |

`server/domain/signal-intelligence/core/world-model-bridge.service.ts` is misleadingly
named: it formats state-transition events onto Redis Streams for the
prediction-intelligence domain. It has nothing to do with the Python model.

## What is genuinely missing

1. **Any call path from TypeScript.** This is the whole gap.
2. **A produced checkpoint.** `backend/memory/training_data/` does not exist, so
   `train_world_model.py` has never had input and `world_model.pth` has never been written.
3. **Train/validation split and versioning.** The trainer fits on everything and saves to
   a single bare filename.

### The defect to fix before anything else

`htn_loop.py:64-67` loads `world_model.pth` *if it exists* and otherwise proceeds with a
**randomly initialised network**, silently:

```python
model_path = 'world_model.pth'
if os.path.exists(model_path):
    world_model.load_state_dict(torch.load(model_path))
    world_model.eval()
# else: untrained weights, no warning, no flag
```

MCTS then runs rollouts against noise and returns a plan that looks exactly like a
planned one. The path is also relative to the process working directory. **Whatever
else happens, an untrained model must fail loudly rather than plan quietly.** This is
the same failure shape as the `accuracyImprovement: 0.05` literal that was just removed
from the strategy predictor: a confident-looking number with nothing behind it.

## The seam

One HTTP endpoint, one TypeScript client, a flag, and a fallback.

```
server/domain/mission/core/world-model-client.service.ts
        │  POST /internal/world-model/predict     (flag-gated, timeout, fallback)
        ▼
backend/api/routes/world_model.py                 (FastAPI, internal-only)
        ▼
backend/memory/world_model.py                     (checkpoint loaded once at startup)
```

### Contract

```ts
interface WorldModelPredictRequest {
  organizationId: number;        // scoping and attribution
  stateSequence: number[][];     // [T][STATE_VECTOR_SIZE]
  actionSequence: number[][];    // [T][ACTION_VECTOR_SIZE]
}

interface WorldModelPredictResponse {
  predictedState: number[];      // [STATE_VECTOR_SIZE]
  modelVersion: string;          // checkpoint identity, never "unknown"
  trained: boolean;              // false => caller MUST discard the prediction
  inferenceMs: number;
}
```

`trained: false` exists so the untrained case is a value the caller has to handle,
not a silence it can't detect.

### Non-negotiables

- **Feature flag, default off.** No traffic until deliberately switched on.
- **Fallback is the current behaviour.** Timeout, non-200, or `trained: false` falls
  back to today's retrieval/heuristic path. The model is an enhancement, never a
  dependency — the same rule the ToM tools follow.
- **Tight timeout** (~250ms). Planning must not block on a model that is thinking.
- **Internal network only.** No public route; no user-controlled tensors.
- **Org scoping.** Predictions attributed per tenant from day one. A shared model is
  defensible; shared *state* is not — the strategy predictor leaked exactly this way
  and it was invisible until someone read the query.

### Versioning

`strategy_model_versions` already provides the shape worth copying: per-org rows,
`featureWeights` blob, `validationAccuracy`, `isActive`. A world-model registry should
mirror it — checkpoint hash, training record count, held-out score, active flag — so a
model can be rolled back by flipping a row rather than redeploying.

## Sequencing

1. **Make the untrained case loud** (`htn_loop.py`). Small, self-contained, and it stops
   the current silent-noise behaviour whether or not the rest of this happens.
2. **Produce a checkpoint.** Create `training_data/`, run the distiller, run the trainer,
   add a validation split. Until a checkpoint exists with a known held-out score, there
   is nothing worth serving.
3. **Decide on the Python service.** This is the real question: a second runtime in
   production, deployed, monitored, versioned. Everything above is cheap; this is not.
4. **Then** the endpoint and the client, behind the flag.

Steps 1 and 2 are worth doing regardless. Steps 3 and 4 should not start until someone
owns the answer to "who operates this".

## Recommendation

Do 1 immediately — it is a correctness fix, not a feature.

Do 2 next, because it converts "we have a neural world model" from an architecture
claim into a measurable one. If the held-out score turns out to be poor, that is the
cheapest possible discovery and it makes step 3 moot.

Hold 3 and 4 until there is a concrete planning task where the heuristic path is
demonstrably losing. The MCTS/HTN machinery being unreachable is currently costing
nothing, because nothing has shown it would do better.
