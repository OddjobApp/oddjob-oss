# Advanced Data Relationships Review

Reviewed against the Oddjob codebase on 2026-07-17. The source analysis mixed real gaps with capabilities that already exist under different service names.

## Implemented in this change

### Governed Knowledge Operations

- Added the `knowledge_graph` virtual Ontology adapter.
- Added the default `Knowledge Entity` Object Type.
- Only verified, organization-scoped knowledge nodes are exposed through this adapter.
- The adapter exposes verification, confidence, source, mission, extraction provenance, and structured data fields.

### Tool-to-Action Mapping

- Ontology actions using `handlerKind=tool` are correlated with `agent_tool_usage` through their canonical `handlerRef`/tool name.
- `GET /api/ontology/actions/tool-mapping` reports invocation count, success rate, average latency, last use, risk, and approval requirements for each tool-backed action.
- Ontology action executions also retain mission-run linkage and appear in mission audit bundles.

### Mission-Driven Evaluation

- Evaluation test sets now support direct `missionId` linkage.
- Evaluation cases now retain `sourceMissionRunId` provenance.
- `POST /api/evaluation-studio/missions/:missionRunId/generate-test-case` creates an organization-scoped regression test set and case from a completed or failed mission run.
- Successful runs preserve objective and observed metrics; failed runs produce an explicit regression guard for the prior failure.

## Already implemented before this review

### Predictive Mission Orchestration

- `mission-event-bridge.ts` sends mission lifecycle events into Prediction Intelligence.
- The bridge invokes HIL prediction and can raise stricter human-intervention requirements.
- `prediction_outcomes` is indexed by mission run for outcome feedback and calibration.
- Mission context enrichment and predictive knowledge prefetching already exist.

### Unified Knowledge Memory

- `agent-memory-across-missions.service.ts` compacts mission learning into durable knowledge with mission-run provenance.
- It adjusts lesson relevance/confidence when information is reused or contradicted.
- `mission-knowledge-bridge.ts` captures mission learning as knowledge-graph nodes and enriches later mission context.

### Mission Blackboard and Knowledge Graph

- `mission-context-enrichment.service.ts` enriches mission blackboards from knowledge.
- `mission-knowledge-bridge.ts` captures mission outcomes and maintains mission provenance.
- Blackboard history and the mission evidence timeline already preserve causal state transitions for audit and downstream analysis.

### Adaptive Few-Shot Learning

- `tool-example-promoter.service.ts` promotes representative successful tool invocations into `agent_tool_examples` after a minimum evidence threshold.
- It rejects latency outliers, avoids duplicate high-quality examples, scores promoted examples, and is exposed through the learning API.

## Strategic capabilities completed

### Semantic Prediction Grounding

- Knowledge embeddings now retain provider, model, dimensions, and version metadata.
- The shared embedding contract rejects model, version, provider, or dimensionality mismatches instead of producing misleading similarity scores.
- `POST /api/prediction/semantic-grounding` embeds prediction context and returns only compatible, verified, organization-scoped knowledge evidence.
- The response reports how many legacy or incompatible vectors were skipped so re-embedding work remains observable.

### Real-Time Blackboard Knowledge Extraction

- The existing Redis-backed QMD worker performs extraction only after the blackboard write succeeds.
- Sensitive keys are recursively redacted before candidates are constructed.
- Deterministic fingerprints and the existing unique knowledge-node constraint make retries idempotent.
- Extracted facts retain mission, actor, reason, and stream provenance and enter the Knowledge Garden as `staging` with a confidence gate; they are never silently promoted to verified knowledge.
- Non-Redis development mode uses the same extractor asynchronously after its direct durable write.
