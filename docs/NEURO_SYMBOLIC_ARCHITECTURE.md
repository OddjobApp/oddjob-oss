# Neuro-Symbolic Architecture

## Core idea

Oddjob couples a **neural substrate** (LLMs for language understanding,
entity/relation extraction, embedding-based similarity, and answer generation)
with a **symbolic substrate** (typed property graphs in Postgres, a Datalog
reasoning engine, domain rulesets, do-calculus, and deterministic graph
algorithms). The two halves meet at the knowledge graph: neural processes
*write and ground* symbolic structure, and symbolic processes *verify,
traverse, and explain* what the neural side produces. Every symbolic artifact
carries confidence, provenance, and verification state so neural output is
never silently trusted.

There are in fact **two graph universes**: the knowledge graph
(`knowledge_nodes`/`knowledge_edges`) and the prediction-intelligence graph
(`graph_nodes`/`graph_edges`), bridged by event streams rather than a shared
schema. Both are described below.

## Layer 0 — Property graph substrate (knowledge)

The base store is a labeled property graph in Postgres, defined in
`shared/schema/knowledge/graph.ts`:

- **`knowledge_nodes`** — `label` + `name` + schemaless `data` JSONB payload.
  Nodes carry trust metadata (`verificationStatus`: staging/verified/rejected,
  `confidenceScore`, `verifiedBy`, `lastReaffirmedAt`), utility metadata
  (`usageCount`, `utilityScore`), provenance (`sourceType`,
  `extractionSources`, `pipelineExecutionId`, `missionId`,
  `knowledgeDocumentId`), federation scope (`private`/`dept`/`org`), a
  `fidelityClass` (`operational`/`informational`/`relational`), and embedding
  contract columns (provider/model/dimensions/version). Deduplication is
  enforced by partial unique indexes on `(org, externalId)` and
  `(org, fingerprint)`.
- **`knowledge_edges`** — `(sourceId, targetId, relation, weight 1–10, data
  JSONB)` with a unique `(source, target, relation)` constraint and no
  self-loops.
- **Typed relation taxonomy** — ~25 canonical relations grouped by semantics,
  with `normalizeRelation()` mapping ad-hoc strings into the taxonomy:
  - *Hierarchical*: `PART_OF`, `MEMBER_OF`, `CONTAINED_IN`
  - *Functional*: `RELIES_ON`, `PROVIDED_BY`, `TRIGGERS`
  - *Causal*: `CAUSES`, `ENABLES`, `PRECEDED_BY`
  - *Behavioral coverage* (code/docs/test reconciliation): `INTRODUCED`,
    `IMPLEMENTS`, `SUPPORTS`, `DOCUMENTS`, `VERIFIES`
  - *Associative*: `ABOUT`, `OWNED_BY`, `ASSIGNED_TO`, `MENTIONS`,
    `MENTIONS_ISSUE`
  - *Semantic resolution*: `SAME_AS`, `IS_A`, `REPORTS_TO`
  - *Computational*: `COMPUTES`, `AGGREGATES`, `TRANSFORMS`, `WEIGHTS_BY`,
    `INPUT_TO`
- **`graphSchemaDefs`** — per-org custom schema definitions layered over the
  base model.
- **Concept/policy overlay** — `concept-service.ts` wires
  `knowledgeTopics → knowledgeConcepts → knowledgePolicyConstraints → SMEs`:
  policy constraints bound to concepts act as a governance layer over the
  graph (`getPolicyRuleIdsForTopics` resolves the rules that apply to a set
  of topics).

Everything is org-scoped through `getOrgConditions` — this is a security
boundary, not a filter convenience.

## Layer 0b — Prediction-intelligence graph (world model)

A second, independent graph store lives in `shared/schema/prediction/graph.ts`
(`graph_nodes` / `graph_edges` / `graph_snapshots` / `graph_diffs`), serving
the `prediction-intelligence` domain:

- **Richer edge semantics** — graded causal edges (`causes`,
  `correlated_with`, `causally_suspected`, `causally_supported`,
  `counterfactually_supported`, `predictively_supports`), epistemic edges
  (`supports`, `opposes`, `contradicts`, `resonates_with`), lifecycle edges
  (`expanded_to`, `merged_into`, `pruned_by`, `collapsed_into`,
  `matched_outcome`), and a spatial vocabulary (`located_in`, `near`,
  `inside`, `adjacent_to`, `moving_toward`, `path_intersects`,
  `entered`/`left`/`crossed_boundary`).
- **Typed nodes** for the world model: `event`, `quant`, `episode`,
  `hidden_state`, `branch`, `prediction`, `outcome`, `attractor`, `pattern`,
  `memory`, `geofence`, `route`, `entity`, `spatial_relation`, etc.
- **Bitemporal edges** — `validFrom`/`validTo` on edges, plus per-edge
  `strength`, `confidence`, `weight`, `direction`, `evidenceIds`, and
  `provenance` JSONB.
- **`GraphPort` interface** (`prediction-intelligence/graph/graph-pod.service.ts`)
  exposes eight operations: `upsertNode`, `upsertEdge`, `getNeighbors`,
  `findPaths`, `extractFeatures`, `diff`, `project`, `snapshot`.
- **Depth limits by `PredictionMode`** — realtime (depth 1, 20 nodes),
  interactive (3/100), analysis (6/500), batch (10/2000).
- **Signal ingress** — `signal-intelligence/core/causal-graph.service.ts`
  maps external `EventPrimitives` to business assets by sector/jurisdiction
  and computes blast radius via BFS (depth ≤ 3, 5-second mapping timeout);
  unmatched events are parked and re-evaluated for 30 days.
  `world-model-bridge.service.ts` emits state-transition events to Redis
  Streams/Kafka to keep the world model updated and runs read-only
  counterfactual simulations.
- Surrounding pods: `prediction` (counterfactual shadow evaluator,
  event-gap anomaly, prediction market, HIL/forge/research predictors),
  `calibration`, `hidden-state`, `realm-mesh`, `quant`, `windowing`,
  `pruning`, `memory`, `explanation`, `governance`, and a plugin runtime.

## Layer 1 — Symbolic reasoning (Datalog engine)

`server/domain/agents/core/neuro-symbolic/datalog-engine.ts` implements a
Horn-clause logic engine:

- **EDB/IDB split** — extensional facts (`SymbolicFact` with predicate,
  arguments, source, confidence, expiry) vs. intensional rules (`LogicRule` as
  head/body atoms with priority, defeasibility, and explanation templates).
- **Semi-naïve bottom-up evaluation** — iterates to a least fixed point,
  processing only newly derived (delta) facts per iteration, bounded by
  `maxDepth` and `timeoutMs`.
- **Unification & bindings** — variables bind to constants; query evaluation
  returns derived facts plus variable bindings and an optional `ProofStep`
  trace (rule applied, resulting fact, substitution).
- **A text parser** for `predicate(arg).` facts and `head(X) :- body(X).`
  rules.

Domain rulesets ship under `neuro-symbolic/domains/`: **finance/AML**
(large-transaction, high-risk-country rules + predicate schema),
**healthcare/clinical** (drug interactions, contraindications), and **legal**
(GDPR required clauses, high-risk terms) — each bundles rules, a predicate
schema, and NL templates.

A separate rule-level checker, `rules/core/symbolic-rule-verifier.service.ts`,
verifies business-rule branches for satisfiability/contradiction (e.g.
`field > 10 AND field < 5`) and issues `VerificationCertificate`s — symbolic
validation outside the Datalog engine.

## Layer 2 — Neuro-symbolic bridge

`hybrid-reasoning.service.ts` is where the two halves fuse. The query
pipeline:

1. **Neural → symbolic**: the LLM translates natural language into a Datalog
   program via structured generation (`logicForm`, extracted entities,
   relations, confidence, alternatives). Extracted entities/relations are
   asserted as facts tagged `source: 'extracted'` with per-fact confidence.
2. **Symbolic inference**: the translated program + relevant domain ruleset
   are loaded into the Datalog engine and evaluated.
3. **Verification**: an optional formal-verification hook
   (`smt`/`theorem_prover`/`model_checker`/`custom`). *Currently a stub that
   returns `verified: true`.*
4. **Symbolic → neural**: derived facts are rendered back into a
   natural-language answer, plus a structured `Explanation` — steps, key
   facts, rules applied, and a recursive `ProofTreeNode` for UI rendering.
5. **Confidence fusion**: `0.4 × translation confidence + 0.6 × inference
   confidence`; derived facts decay confidence by 5% per rule application.
6. **Compliance checking**: `checkCompliance()` asserts subject/context facts,
   queries `violation(X)`, and returns violations, a risk score, remediations,
   and the proof trace as an audit trail.

Metrics track hallucination rate (share of derived facts below 0.5
confidence), verification success, and cache hits.

## Layer 3 — Retrieval: GraphRAG (vector ⊗ graph)

Two implementations exist:

- **`knowledge/core/rag/graph-rag.service.ts`** — the production-wired hybrid
  retriever: vector similarity seeds → multi-hop traversal → results tagged
  `vector`/`graph`/`hybrid` with path explanations; records
  `Mission→Knowledge` `READS_FROM` edges for Xray indexing. Consumed by
  `agentic-rag.service`, `graph-rag-client`, `rag.route`, and
  `xray-indexing.service`.
- **`knowledge/core/graph-rag/`** — the fuller engine (`GraphRAGService` +
  `HybridSearchEngine` + `PathExplainerService`), exposed via
  `routes/research.ts`:
  - **Seeding**: Qdrant vector search over the `knowledge_nodes` collection
    (score threshold 0.7, org + entity-type filters).
  - **Traversal**: batched BFS from seeds with `minEdgeWeight` filtering,
    `0.8^hop` distance decay, early-stop threshold, cycle detection, and
    per-hop/total node caps. Traversal can be delegated to the **Python
    sidecar** (`POST /api/v1/graph/traverse`), falling back to in-process BFS.
  - **Score fusion**: `0.6·vector + 0.4·graph`, −10% per hop; nodes found by
    both channels get a bonus. When the result set is large, Python-side
    **PageRank** re-ranks with an 80/20 semantic/structural blend.
  - **Explainability**: every result carries `traversedPaths` with
    human-readable explanations ("A → RELIES_ON → B") and relevance
    qualifiers; `explainQuery()` reports seeds, paths, and depth.
  - **Modes**: `local` (entity-focused traversal) vs. `global`
    (community-summary answering).
  - **Caching**: LRU query cache + configurable subgraph cache, full metrics
    per query.

## Layer 4 — Hierarchy & communities ("local to global")

- **`HierarchicalRetrievalService`** implements the Microsoft GraphRAG
  pattern: connected-component community detection over the adjacency graph, a
  two-level hierarchy (community summaries → global summary), and retrieval
  that resolves communities first and falls back to the global summary.
  Enabled via `ENABLE_HIERARCHICAL_RETRIEVAL` inside
  `searchNodesSemantically`.
- **`CommunitySummarizerService`** — label-propagation community detection
  plus LLM-generated community summaries; powers `global` mode queries.
- **`CommunityMaintainerService`** — incremental community maintenance: edge
  add/remove without full rebuilds, lazy per-org in-memory adjacency (~50K
  edges), modularity monitoring that schedules full rebuilds, selective cache
  invalidation, and adaptive retrieval-depth expansion.

## Layer 5 — Temporal graph

`temporal/temporal-version-store.service.ts` over `knowledge_node_versions` /
`knowledge_edge_versions`: version recording on every mutation,
point-in-time node/edge reconstruction (`getNodeAtTimestamp`,
`getEdgesAtTimestamp`), version ranges, edge diffs (`getEdgeDiff` with change
types), causal annotations on versions, and pruning. `searchNodes` also
supports temporal predicates (`before`/`after`/`between`/`atTime` on source
timestamps). The prediction graph adds its own bitemporal edges
(`validFrom`/`validTo`), `graph_snapshots`, and `graph_diffs`.

## Layer 6 — Causal reasoning (two engines)

- **Belief propagation over the knowledge graph** —
  `causal/belief-propagation-engine.service.ts`: `CAUSES` edges carry
  `CausalEdgeMetadata` (causalStrength 0–1, propagation direction, lag
  seconds). `propagate()` runs BFS confidence attenuation (confidence ×
  causalStrength per hop, min-confidence cutoff, ≤10 hops) with **cycle
  detection that reconstructs the cycle and breaks the weakest edge**.
  `counterfactual()` runs the same algorithm in-memory for what-if queries
  with zero writes.
- **Do-calculus engine (agent-side)** —
  `agents/core/causal/causal-reasoning.service.ts`: Judea Pearl's framework —
  `estimateATE`/`estimateATT`, `computeCounterfactual`, `analyzeRootCause`,
  `analyzeMediation`, backdoor-path identification with valid adjustment
  sets, frontdoor estimation, cycle checking over `CausalGraph`s of typed
  `CausalVariable`s. This is a rigorous statistical-causal layer, distinct
  from the heuristic propagation above; the two engines do not share a
  graph.
- **`server/domain/graph/core/causal-cascade-predictor.service.ts`**:
  failure-cascade prediction over a service/dependency graph —
  `risk(target) = P(failure source) × causalWeight`, producing impacted nodes,
  reroute recommendations, and a deploy-safety verdict.
- **`resource-impact-cascade.service.ts`**: 2-hop blast-radius traversal over
  a separate resource-catalog edge table before schema/prompt changes.

## Layer 7 — Link prediction

`prediction/link-predictor.service.ts` trains **TransE embeddings** (128-dim,
margin-based SGD, 50 epochs) over the graph, scores candidate edges, and
writes them to `knowledgePredictedLinks` above a confidence threshold.
Predictions go through human review — `approvePrediction` promotes a
prediction to a real `knowledge_edges` row; `rejectPrediction` discards it.
Embeddings can be regenerated per node.

## Layer 8 — The graph as a compute engine

`calculations/` turns the graph into a hybrid variable–operation model (using
the `COMPUTES`/`INPUT_TO`/`AGGREGATES`/etc. edge family and
`calculationDependencies` for ordering). `calculation.service.ts` dispatches
to eight evaluators:

| Evaluator | Functions |
|---|---|
| `basic` | FORMULA, ADD/SUBTRACT/MULTIPLY/DIVIDE, SUM, AVERAGE, COUNT, MIN, MAX |
| `temporal` | MOVING_AVERAGE, YEAR_OVER_YEAR, MONTH_OVER_MONTH, CAGR, EXPONENTIAL_SMOOTHING, ROLLING_SUM/AVERAGE |
| `probabilistic` | MONTE_CARLO_SIMULATION, BAYESIAN_INFERENCE, CONFIDENCE_INTERVAL, RISK_ASSESSMENT, SENSITIVITY_ANALYSIS (NORMAL/UNIFORM/TRIANGULAR distributions) |
| `constraint` | RULE_VALIDATION, CONDITIONAL_LOGIC, POLICY_ENFORCEMENT, CONSTRAINT_CHECK, GATE_CONDITION, COMPLIANCE_CHECK (RANGE/UNIQUE/SET_MEMBERSHIP) |
| `graph` | PAGERANK, BETWEENNESS_CENTRALITY, CLOSENESS_CENTRALITY |
| `ml` | REGRESSION_INFERENCE, ANOMALY_DETECTION (z-score), FEATURE_EXTRACTION (log/normalize/standardize), MODEL_ENSEMBLE (MAJORITY_VOTE/WEIGHTED_AVERAGE), CLUSTERING_INFERENCE, DIMENSIONALITY_REDUCTION |
| `security-score`, `layout-verification` | domain-specific scoring/verification |

Results persist to typed tables (`monteCarloResults`,
`bayesianInferenceResults`, `graphAlgorithmResults`, `graphCentralityScores`,
`mlInferenceResults`, `calculationTimeSeries`) with execution logs.

## Layer 9 — Ontology (AIP-style object layer)

`ontology.service.ts` + `ontology/` provide a Foundry-flavored ontology on
top: object types with typed properties and title properties, link types with
cardinality and polymorphic targets (`ONTOLOGY_LINK_BACKINGS` for storage
strategies), objects, links, and **actions** — writes that go through an
approval-gated action log. Custom ontology stores and migrations live
alongside. All access is scoped by a resolved `OntologyCtx.organizationId`.

## Layer 10 — Planning & search (neural world model + symbolic search)

`agents/core/speculative/` implements speculative execution: an **MCTS
engine** (`mcts.engine.ts` — UCB1 selection, expansion, simulation,
backpropagation) driven by an **LLM state simulator**
(`llm-state-simulator.ts`) that predicts world state after each candidate
action. This is neuro-symbolic planning in the literal sense: a neural
transition model inside a symbolic search tree, producing `AlternativePlan`s
and tree statistics. Related machinery: `prm-tree-search.service.ts`
(process-reward-model tree search), `cot-self-consistency.service.ts`
(sampled reasoning paths with agreement voting), and `reflection/`
(post-hoc reasoning critique wired into the orchestrator).

## Layer 11 — Alternative neural substrates

- **`ebm/ebm-reasoner.service.ts`** — energy-based reasoning: treats
  inference as energy minimization for constraint satisfaction and optimal
  configuration search.
- **`liquid-nn/lnn-core.service.ts`** — MIT Liquid Neural Networks:
  continuous-time recurrent networks with ODE dynamics, sized for
  edge/real-time deployment.

## Layer 12 — Meta-cognition

`meta-cognitive/` monitors the reasoning process itself:
`cognitive-monitor.service.ts` tracks live cognitive metrics (latency, token
throughput, context utilization, error rate, repetition, coherence,
confidence) to detect confusion/fatigue/overload;
`meta-cognitive-planner.service.ts` selects among `reasoning-strategies.ts`
based on the observed state.

## Layer 13 — Multi-agent belief consensus

`beliefs/shared-belief-protocol.service.ts` lets agents assert beliefs about
shared nodes with evidence references and confidence; conflicting assertions
within a time window reconcile via weighted voting
(`ReconciliationResult` with per-agent voting details). This is the
consensus layer for federated knowledge writes.

## Layer 14 — The code graph (Xray)

`xray/core/code-graph.service.ts` runs a **parse → store pipeline**: AST
parsers (`parsers/`, `code-parser.service.ts`) extract code nodes/edges from
workspaces and blueprints, `code-label-mapper` assigns knowledge-graph
labels, and everything is stored through `graphService` — code lives in the
same `knowledge_nodes`/`knowledge_edges` tables. This is the write path for
the behavioral-coverage relation family (`IMPLEMENTS`, `VERIFIES`,
`DOCUMENTS`, `SUPPORTS`, `INTRODUCED`). `ci-impact-gate.service.ts` performs
graph-driven CI impact analysis; `global-xray.service.ts`,
`prefetch.service.ts`, and `scope-access.service.ts` handle federation and
tenant scoping.

## Layer 15 — Trust, governance & lifecycle

- **Human-in-the-loop verification** ("Knowledge Garden"): extracted nodes
  land in `staging`; `verifyNode`/`bulkVerifyNodes` approve/reject/correct
  them. `kb-extensions/hil-pattern-detector.service.ts` detects patterns
  needing human review.
- **Confidence dynamics**: `confidence-decay.service`,
  `utilityScore`/`usageCount` reaffirmation on read, `memory-pruner`, and
  `knowledge-verification.service`.
- **Evolution**: `knowledge_evolution_events` (PRUNING/SYNTHESIS/
  INTEGRITY_CHECK), `memory-evolution.service`, `knowledge-synthesis.service`.
- **Forensics**: `getNodesByExecutionIds`, aggregate-diff / path /
  compare-runs / agent-session-trace routes — the graph doubles as an audit
  spine for pipeline runs.
- **Auto-linking, schema inference/comparison** (`auto-linking.service`,
  `schema-inference.service`, `schema-comparison.service`) keep the schema
  layer honest as data lands.
- **Auxiliary graphs**: `user-interest-graph.service` (half-life-decayed
  interest weights), the `Infrastructure`-labeled system graph surfaced in
  `SystemKnowledgeGraph.tsx`, and a `SemanticGraph3D` visualization.

## API surface

`knowledge-graph.route.ts` (~1,400 lines) exposes the knowledge-graph half:
node/edge CRUD and batch ops, staging & verification, `/expand/:id`
traversal, `/graph/semantic`, natural-language and unified search, a
**visual query builder** (execute/validate/templates — Cypher-flavored
`VisualQuery` with node patterns, relationship hops, filters, return
clauses), analytics (sankey/matrix), forensics, sessions, schema defs, and
OKF (Open Knowledge Format) document import/export.

Neuro-symbolic endpoints: `POST /api/research/neuro-symbolic/query` (loads
all three domain rulesets) and `POST /api/prediction/neuro-symbolic/query`.

## How the loop closes

```
Documents/events/code ──LLM extraction / Xray parse──▶ staging nodes/edges ──HIL verify──▶ trusted graph
                                          │                                              │
                                   embeddings → Qdrant                 Datalog rulesets, do-calculus,
                                          │                            belief propagation, rule verify
       NL query ──▶ vector seeds ──▶ graph traversal ──▶ hybrid ──▶ PageRank ──▶ LLM answer
                                                          score              + proof paths

Events ──▶ causal-graph mapping ──▶ prediction graph ──▶ world model ──▶ predictors / counterfactual sims
```

## Wiring status (verified)

- `HybridReasoningService` is wired: `routes/research.ts` (loads AML,
  clinical, and legal rulesets), `routes/prediction.ts`, `routes/agents.ts`.
- Both GraphRAG implementations are wired: `rag/graph-rag.service.ts` via
  agentic-rag / rag.route / xray-indexing; the `graph-rag/` engine via
  `routes/research.ts`.
- The integrations supervisor's "Orient" step calls
  `trustgraph/graph-rag.service.ts` — **a simulation stub** — in three
  places, so that portion of supervisor context is fabricated.

## Caveats

- `HybridReasoningService`'s formal verification is a stub returning
  `verified: true`.
- The Datalog engine is simplified: rule evaluation only consumes the
  **first** body atom, negated atoms are parsed but not enforced in
  evaluation, function terms are unsupported, and `loadProgram` clears all
  prior state per query.
- `integrations/trustgraph/graph-rag.service.ts` is explicitly a simulation
  stub.
- `hierarchicalRetrievalService` keyword-matches communities rather than
  using semantic similarity, and its "Leiden" is connected-components.
- **Two parallel graph stores** (`knowledge_nodes` vs prediction
  `graph_nodes`) with different schemas; `world-model-bridge` links them
  only via events.
- **Two causal systems that don't share a graph**: the do-calculus engine
  vs. CAUSES-edge belief propagation.
- **No GNN** — link prediction is TransE only; community detection is label
  propagation / connected components.
