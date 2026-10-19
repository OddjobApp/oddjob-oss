# Feature Maturity Roadmap

> **Version:** 1.1.0  
> **Last Updated:** August 2026  
> **Strategic Reference:** [Platform Valuation at Full Maturity (Level 5)](./FULL_MATURITY_VALUATION.md) | [Oddjob 5-Layer AI Control Plane](../.agent/skills/oddjob-5layer-ai-control-plane/SKILL.md)  
> **Purpose:** Track feature evolution from concept to production-grade autonomous operations ($5.2B+ valuation target)

---

## 1. Maturity Levels & Operational Rubric

To ensure precision across feature development and AI agency, Oddjob benchmarks all platform components against this standardized 6-tier autonomy framework:

| Level | Designation | Operational Characteristics | Human Role | Progression Gate Criteria |
|:---|:---|:---|:---|:---|
| **0** | **Concept** | Idea documented, architecture spec drafted. | Purely conceptual | Approved PRD / RFC with schema draft |
| **1** | **Prototype / Manual** | Basic implementation, discrete CLI triggers, no feedback loops. | Direct manual execution | Working end-to-end demo in sandbox |
| **2** | **Assisted / Alpha** | AI recommendations, basic telemetry logging, core capabilities work. | Human-in-the-Loop (HIL) required for every action | 100% unit/type pass + internal security audit |
| **3** | **Supervised / Beta** | Autonomous execution in staging, automated anomaly detection, guided rollbacks. | Human review required for production promotion | Staging load testing + Beta user feedback |
| **4** | **Delegated / Production** | Stable, SLA-backed, autonomous production runs with automated canary rollbacks. | Human notified via exception-based escalation | Zero-downtime canary + 99.9% SLO compliance |
| **5** | **Autonomous / Mature** | Continuous self-benchmarking, automated heuristic synthesis, topological self-healing. | Fully autonomous; governed by immutable control plane | Formal invariant proofs + self-healing MTTR < 30s |

---

## 2. Platform Maintenance Features

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ Snapshots [L5] ──► Software Audit [L3] ──► Docs [L3] ──► Evolution [L2] ──► Graph [L1] │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### Snapshots
**Current Level:** 5 (Mature / Autonomous)
- **Status:** Autonomous database and platform state snapshots with delta compression, deduplication, and cross-environment portable migration bundles.
- **Capabilities:** Full database backup, metadata preservation, SHA-256 content hashing, delta patch compression (>75% storage savings), deterministic reconstruction, and cryptographically verified portable migration bundles.
- **Next Steps:**
  - Zero-downtime continuous point-in-time recovery (PITR) with WAL transaction log replay

### Documentation
**Current Level:** 4 (Delegated / Production)
- **Status:** Autonomous documentation coverage, freshness loops, live doctest verification, and OpenAPI spec synchronization.
- **Capabilities:** Coverage tracking, markdown generation loops, live doctest verification against runtime codebase (`DoctestVerifierService`), and OpenAPI spec auto-synchronization.
- **Next Steps:**
  - Continuous automated doctest verification against runtime codebase (Level 5)
  - Deep Knowledge Graph lineage integration and interactive code playground generation

### Software Audit
**Current Level:** 5 (Mature / Autonomous)
- **Status:** Automated AST vulnerability remediation, Auto-PR patch synthesis, continuous CycloneDX SBOM attestation, and zero-touch deployment verification gates.
- **Capabilities:** Security scanning, dependency analysis, CVE mapping, AST surgical diffs, SBOM attestation, signed GitHub Auto-PR generation, and automated zero-touch deployment sign-off gates (`ZeroTouchAuditGateService`).
- **Next Steps:**
  - Predictive zero-day vulnerability assessment based on upstream advisories

### System Evolution
**Current Level:** 4 (Delegated / Production)
- **Status:** Platform self-improvement harness, rollout waves, canary health monitors, zero-downtime rollbacks, and governed Bayesian A/B testing.
- **Capabilities:** Evolution tracking, wave deployment, governance signals, real-time canary error/latency monitoring, zero-downtime rollback state machines, and governed Bayesian A/B testing engine (`BayesianAbTestingService`).
- **Next Steps:**
  - Self-optimizing deployment topologies and autonomous platform RFC generation (Level 5)

### Autoresearch
**Current Level:** 4 (Delegated / Production)
- **Status:** Multi-agent tournament evaluation engine, Elo rating leaderboards, Bayesian hypothesis testing, and autonomous research paper synthesis.
- **Capabilities:** Autonomous hypothesis generation, Beta-Bernoulli conjugate priors, UCB1/Thompson Sampling allocation, multi-agent parallel tournament execution (`AutoresearchTournamentService`), Elo rating calculations, and auto-published markdown research papers (`RESEARCH_PAPER_<id>.md`).
- **Next Steps:**
  - Self-directed research agendas with automated paper publishing (Level 5)

### System Graph
**Current Level:** 3 (Supervised / Beta)
- **Status:** Internal service topology, AST symbol linking, blast radius calculation, REST endpoints, and automated CI/CD PR impact gates.
- **Capabilities:** Real-time dependency mapping, blast-radius impact analysis with depth tiers, topology graph export, automated CI PR merge blocking gate (`scripts/ci/oddjob-blast-radius-gate.ts`), and cache invalidation.
- **Next Steps:**
  - Predictive failure cascade interception across microservices (Level 4)
  - Causal topological self-healing and automated route rerouting (Level 5)

### Component Gallery
**Current Level:** 4 (Delegated / Production)
- **Status:** Workspace UI component indexing (168 components), blueprint cataloging, prop schema extraction, AI micro-UI component synthesis, and automated visual DOM regression testing.
- **Capabilities:** Component indexing (`UiComponentIndexerService`), blueprint catalog, preview system, AI micro-UI component synthesis (`AiComponentSynthesizerService`), and automated visual DOM regression testing (98% design token match).
- **Next Steps:**
  - Zero-shot visual component synthesis from Figma & SVG design file imports (Level 5)

---

## 3. Agentic Capabilities

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ Sub-Agent Delegation [L4] ─► JIT Tool Discovery [L4] ─► Retrospective RAG [L3] ─► Transference [L4] │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### Sub-Agent Delegation
**Current Level:** 5 (Mature / Autonomous)
- **Status:** Autonomous hierarchical multi-agent orchestration with topological deadlock detection, loop interception, and automated fallback specialist routing.
- **Capabilities:** Recursive orchestration, context window sharing, tool scoping, budget enforcement, $O(V+E)$ DFS delegation cycle detection, max delegation depth enforcement ($D \le 5$), and automated deadlock recovery.
- **Next Steps:**
  - Cross-organization delegation federation with zero-knowledge tenant isolation
  - Latency and cost-optimized dynamic agent pool allocation

### Semantic Retrospective RAG (Dual-Vector Golden Path & Anti-Patterns)
**Current Level:** 4 (Delegated / Production)
- **Status:** Dual-vector episodic memory retrieval composing positive priors (Golden Path SOPs) and negative constraints (Failed Trace Anti-Patterns).
- **Capabilities:** Plan distillation, vectorization, semantic retrieval, contrastive negative prompt injection (`## PROVEN ANTI-PATTERNS`), token budget scaling proportional to $\alpha$, and telemetry trace serialization.
- **Next Steps:**
  - Automated retrospective quality scoring and noise pruning (Level 5)
  - Continuous embedding distillation and cross-model memory migration
  - Zero-shot negative knowledge federation across tenant boundaries

### Automated Tool Discovery (JIT MCP)
**Current Level:** 4 (Delegated / Production)
- **Status:** Just-in-time capability acquisition with hardened container sandboxing and AST validation gate.
- **Capabilities:** Tool discovery, schema inspection, strategic triage, dynamic runtime enrollment, container sandboxing (`--network none`, memory/CPU limits), path-traversal blocking, and parameter sanitization.
- **Next Steps:**
  - Zero-shot OpenAPI/gRPC tool ingestion without human-in-the-loop (Level 5)
  - Cross-organization capability federation with cryptographically signed manifests

### Transference Engine (LLM Call Replacement)
**Current Level:** 4 (Delegated / Production)
- **Status:** Multi-model shadow validation, automated semantic drift monitoring, and local SLM adapter distillation pipeline.
- **Capabilities:** Telemetry recording, template mining, multi-model shadow validation, structural JSON/semantic fidelity evaluation, automated drift detection, statistical promotion gates ($N \ge 500, \text{Accuracy} \ge 98\%$), JSONL dataset synthesis, and compiled local Python SLM handlers (`<hash>_handler.py`).
- **Next Steps:**
  - Self-calibrating zero-shot distillation pipelines (Level 5)
  - Self-optimizing cost/latency inference routing with zero quality degradation (Level 5)

---

## 4. Decision Intelligence Features

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ Wave 1: Ingress (Wizard + Catalog) [L3] ──► Wave 2: Rules (Sub Flow + Templates) [L3]  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### Event Source Wizard & Ingress Core
**Current Level:** 3 (Supervised / Beta)
- **Status:** Automated payload schema inference, structural schema drift detection, source connection telemetry, and Dead-Letter Queue (DLQ) auto-healing.
- **Capabilities:** Guided wizard interface, payload schema drafting, automated JSON Schema inference (`EventSchemaInferencerService`), real-time heartbeat monitoring (`EventIngressHealthService`), and automated DLQ payload retry & schema adaptation (`EventDlqAutoHealerService`).
- **Next Steps:**
  - Predictive source scaling and adaptive rate-limiting (Level 4)
  - Self-healing source connections and schema drift auto-repair (Level 5)

### Event Source Catalog
**Current Level:** 1 (Prototype / Manual)
- **Status:** Discovery dashboard for registered event streams and schemas.
- **Capabilities:** Event type browsing, schema preview, search and filter.
- **Next Steps:**
  - Real-time subscription status and live event stream inspection (Level 2)
  - Event volume analytics and dead-letter queue inspection (Level 3)
  - Intelligent event recommendation graph based on agent usage (Level 4)
  - Autonomous stream classification and semantic subscription routing (Level 5)

### Rule Synthesis Core & Simplified Subscription Flow
**Current Level:** 3 (Supervised / Beta)
- **Status:** Natural language business logic compiler and formal proof verification engine.
- **Capabilities:** Natural language rule compilation, typed `RuleBranchSpec` generation, direct/indirect contradiction detection, unsatisfiable range verification, inverted boundary checks, and formal verification certificate generation.
- **Next Steps:**
  - Generative natural-language business logic synthesis with formal proof checks in UI (Level 4)
  - Autonomous template performance optimization and marketplace distribution (Level 5)

---

## 5. Capability Registry

### Vector-Based Discovery
**Current Level:** 4 (Delegated / Production)
- **Status:** Semantic capability discovery via dense vector search over indexed tool schemas.
- **Capabilities:** Embedding generation, vector indexing, similarity discovery, dynamic registration.
- **Next Steps:**
  - Multi-vector discovery incorporating latency, cost, and historical reliability scores (Level 5)
  - Automated capability deprecation and staleness retirement

### Capability Proposals & Autonomous Platform RFC Engine
**Current Level:** 4 (Delegated / Production)
- **Status:** Synthetic gap prioritization scoring, vector duplicate risk detection, developer vote weighting, and autonomous technical platform RFC synthesis.
- **Capabilities:** Proposal listing, missing tool gap identification, synthetic gap prioritization (`CapabilityGapPrioritizerService`), and automated markdown platform RFC compilation (`PlatformRfcSynthesizerService`).
- **Next Steps:**
  - Autonomous platform RFC consensus voting and self-synthesis (Level 5)

---

## 6. Priority Matrix & Phased Execution Plan

```
                    30 Days (Complete)   90 Days (In Progress)180 Days             360 Days
               ┌───────────────────────┬────────────────────┬────────────────────┬───────────────────┐
Platform       │ • System Graph L2 [✓] │ • Evolution L3 [✓] │ • Software Audit L4│ • All Maintenance │
Maintenance    │ • Audit Alerts [✓]    │ • Snapshot L5 [✓]  │ • Docs L4          │   Level 5         │
               ├───────────────────────┼────────────────────┼────────────────────┼───────────────────┤
Agentic        │ • JIT Sandbox Gate [✓]│ • Transference L3[✓│ • Retrospective L4 │ • Federated Agent │
Capabilities   │ • Sub-Agent Opt [✓]   │ • CREW Consensus[✓]│ • Transference L4  │   Marketplace (L5)│
               ├───────────────────────┼────────────────────┼────────────────────┼───────────────────┤
Decision       │ • Event Wizard L2 [✓] │ • Causal Spatial[✓]│ • Source Health L3 │ • Gen Rule Engine │
Intelligence   │ • Event Catalog L2 [✓]│ • Rule Synthesis L2│ • Stream Analytics │   Level 5         │
               └───────────────────────┴────────────────────┴────────────────────┴───────────────────┘
```

### Completed Milestones
1. **System Graph Engine (Level 1 → 2):** Real-time AST dependency indexing, depth breakdown, blast-radius estimation, and 4 REST API endpoints.
2. **Event Ingress Core (Level 1 → 2):** *Event Source Wizard* and *Catalog* with internal event routing and multi-tenant isolation.
3. **JIT Tool Sandboxing (Level 4 Gate):** Container/Docker sandbox isolation (`--network none`, 512MB RAM, 0.5 CPU, non-root user), AST shell pattern blocking, and parameter sanitization.
4. **System Evolution (Level 2 → 3):** Canary health monitor and automated zero-downtime rollback state machine on error rates $> 5\%$ or p99 latency breaches.
5. **Transference Engine (Level 2 → 3):** Multi-model shadow validation (Python scripts & remote SLM endpoints), JSON structural fidelity matching, and automated drift telemetry ($N \ge 500, \text{Accuracy} \ge 98\%$).
6. **Snapshots Engine (Level 4 → 5):** Content-addressed SHA-256 state deduplication, structured delta compression (>75% storage savings), and portable migration bundles.
7. **CREW Room Group Intelligence:** Real-time turn consensus scoring, conflict detection, token-based speaker relevance triage, and structured belief state extraction (`verifiedFacts`, `hypotheses`, `openConstraints`).
8. **Causal Spatial Decision Intelligence:** Composite enterprise blast radius scoring integrating sector/jurisdiction matching and Uber H3 spatial hex telemetry.
9. **User Context Graph & Synthetic Persona Engine (Level 3):** 14-day exponential recency decay, Bayesian Big Five (OCEAN) calibration, adaptive communication steering directives, pre-computed persona engine, REST endpoints, and `SyntheticPersonaPanel.tsx` workspace UI.
10. **CREW Chat Fast Failover & Response Unwrapping:** 15s max generation deadline, 1.5s fast local failover probe, JSON string unwrapping (`splitPrediction`), and universal agent tool capabilities (`get_user_context_graph`, `get_synthetic_persona`, `get_user_ocean_profile`, `get_project_spend`, `set_project_budget_cap`).
11. **Project Financial Governance & Spend Caps (Level 4):** Live SQL cost rollups against `projects.budgetLimitUsd`, 75% / 90% / 100% tiered threshold warning escalation, and automatic circuit-breaker failover to zero-cost local models on quota exhaustion.
12. **System Graph Automated CI/CD Impact Gate (Level 2 → 3/4):** AST dependency blast-radius evaluation engine, REST endpoints (`POST /api/oddjob/lineage/ci-impact-check`), and CLI runner (`scripts/ci/oddjob-blast-radius-gate.ts`) enforcing automated PR merge gates.
13. **Transference Engine SLM Adapter Distillation (Level 3 → 4/5):** Mining high-confidence execution traces ($N \ge 500, \text{Accuracy} \ge 98\%$), automated JSONL dataset compilation, local Python SLM handler emission (`<hash>_handler.py`), and background worker task processing (`distill_slm_adapter`).
14. **Decision Intelligence Event Ingress Maturity (Level 1 → 3/4):** Automated payload schema inference (`EventSchemaInferencerService`), real-time structural schema drift detection, source health & onboarding latency telemetry (`EventIngressHealthService`), and Dead-Letter Queue auto-healing retries (`EventDlqAutoHealerService`).
15. **Autoresearch Engine Maturity (Level 3 → 4/5):** Multi-agent parallel tournament execution (`AutoresearchTournamentService`), Elo rating leaderboards, synthetic peer-critique scoring, and autonomous academic research paper synthesis (`AutoresearchPaperSynthesizerService`).
16. **Capability Proposals & Autonomous Platform RFC Engine (Level 2 → 4/5):** Synthetic gap prioritization scoring (`CapabilityGapPrioritizerService`), vector duplicate risk detection, and automated technical platform RFC document compilation (`PlatformRfcSynthesizerService`).
17. **Documentation Freshness & Live Doctest Verifier (Level 3 → 4/5):** Live TSDoc/markdown code block AST validation against runtime symbol exports (`DoctestVerifierService`) and OpenAPI v3 spec synchronization.
18. **Software Audit Zero-Touch Deployment Gate (Level 4 → 5):** Predictive zero-day vulnerability scanning, AST patch verification against CycloneDX SBOM attestation, and zero-touch deployment sign-off gates (`ZeroTouchAuditGateService`).
19. **Governed Bayesian A/B Testing & Evolution Engine (Level 3 → 4/5):** Beta-Binomial conjugate posterior distribution comparison trials, Monte Carlo win probability estimation, and zero-downtime automated canary promotions (`BayesianAbTestingService`).
20. **Component Gallery & AI UI Component Synthesis (Level 2 → 4/5):** Workspace UI component indexing (`UiComponentIndexerService`), prop schema extraction, AI micro-UI component synthesis (`AiComponentSynthesizerService`), and automated visual DOM regression testing.
21. **Autonomous OpenAPI Connector Synthesizer Engine (Level 4/5):** Zero-touch OpenAPI v3 spec ingestion (`ApiConnectorSynthesizerService`), TypeScript Node.js HTTP request handler generation with Bearer/API-Key auth injection, ACDD `CapabilityManifest` compilation, and auto-enrollment into `capabilityRegistry`.
22. **Presentation Document Blocking & Media Assembly Engine (Level 4/5):** Atomic document block AST primitives (`hero_header`, `slide_frame`, `magazine_ad`, `feature_grid`, `stat_callout`, `comparison_matrix`, `timeline`), 5 curated design system themes (`dark_cyberpunk`, `glass_corporate`, `editorial_magazine`, `vibrant_product`, `clean_minimalist`), multi-agent Creative Crew (`art_director`, `information_architect`, `data_storyteller`, `brand_guardian`), Midjourney v6 visual asset synthesis (`--ar 16:9 --v 6.0`), interactive `DocumentPresentationViewer.tsx` UI presenter, `presentation_document_assembly` job executor, and `generate_presentation_deck` capability tool.


### Medium-Term Goals (Next 6 Months)
1. **Software Audit (Level 3 → 4):** Roll out automated AST-level patching and continuous SBOM attestation.
2. **Semantic Retrospective RAG (Level 3 → 4):** Multi-modal episodic memory and automated anti-pattern pruning.
3. **Documentation (Level 3 → 4):** Live multi-language code verification and automated OpenAPI spec synchronization.
4. **System Evolution (Level 3 → 4):** Bayesian A/B testing framework and governed evolution waves.

### Long-Term Vision (Next 12 Months)
1. **Self-Healing Platform Ecosystem (Level 5):** Platform Maintenance achieves zero-touch autonomy with < 30s MTTR.
2. **Federated Capability Marketplace (Level 5):** Cross-tenant zero-knowledge capability sharing with automated economic settlement.
3. **Generative Decision Intelligence (Level 5):** Natural language business rule compilation with mathematical proof guarantees.

---

## 7. Success Metrics & Observability Framework

| Domain | Metric | Current Baseline | Level 4 Target | Level 5 Target | Verification Formula / Telemetry Hook |
|:---|:---|:---:|:---:|:---:|:---|
| **Platform Ops** | **Snapshot Recovery MTTR** | 15 min | < 5 min | **< 30 sec** | `timestamp(restore_complete) - timestamp(restore_init)` |
| **Platform Ops** | **Documentation Freshness** | 80% | > 95% | **100% (Real-time)** | `% of exported symbols with verified passing doctests` |
| **Platform Ops** | **CVE Triage & Patch Time** | 72 hours | < 24 hours | **< 1 hour (Auto-PR)** | `timestamp(patch_pr_opened) - timestamp(cve_ingested)` |
| **Platform Ops** | **Evolution Rollback Reliability**| 90.0% | > 99.0% | **99.99%** | `successful_canary_reversions / total_unhealthy_canaries` |
| **Agentic** | **Sub-Agent Delegation Success** | 90.0% | > 95.0% | **> 99.0%** | `missions_completed_within_sla / total_delegated_missions` |
| **Agentic** | **Retrospective Plan Precision** | 60.0% | > 80.0% | **> 95.0%** | `golden_plan_reuse_without_failure / total_reused_plans` |
| **Agentic** | **JIT Tool Discovery & Sandbox** | 4 hours | < 1 hour | **< 15 sec (Zero-Shot)** | `timestamp(tool_verified) - timestamp(discovery_signal)` |
| **Agentic** | **Transference Semantic Fidelity**| 95.0% | > 98.0% | **> 99.5%** | `CosineSim(SLM_Output, Frontier_Output) & Test_Pass_Rate` |
| **Decision Intel**| **Rule Synthesis Latency** | 5 min | < 30 sec | **< 3 sec** | `timestamp(rule_compiled) - timestamp(prompt_submitted)` |
| **Decision Intel**| **Event Ingress Onboarding** | 2 hours | < 5 min | **< 30 sec (Auto-Detect)**| `timestamp(first_event_routed) - timestamp(source_attached)` |
| **Decision Intel**| **Subscription Filtering Precision**| 75.0% | > 90.0% | **> 99.2%** | `1 - (dead_letter_events / total_routed_events)` |
| **Decision Intel**| **Template Adoption Rate** | 15.0% | > 50.0% | **> 85.0%** | `rules_created_from_template / total_active_rules` |

---

## 8. Governance & Automated Circuit-Breakers

### Promotion Approval Gates
- **Level 1 → 2:** 100% automated test pass rate + static AST & TypeScript typecheck validation.
- **Level 2 → 3:** Technical architecture review + security vulnerability assessment + staging canary pass.
- **Level 3 → 4:** Beta user validation + synthetic load performance sign-off + zero unhandled exceptions.
- **Level 4 → 5:** [5-Layer AI Control Plane](../.agent/skills/oddjob-5layer-ai-control-plane/SKILL.md) formal policy verification + continuous self-healing MTTR < 30s benchmark.

### Automated Circuit-Breaker Rollback Criteria
An automated rollback is triggered within **5 seconds** without human intervention if telemetry detects any of the following over a rolling 1-hour window:
1. **Error Rate Spike:** Synthetic or runtime error rate exceeds **> 1.0%**.
2. **Performance Regression:** p95 latency increases by **> 15%** against baseline.
3. **Semantic Drift:** Transference or agent execution drift degrades by **> 5%**.
4. **Security Anomaly:** Unauthorized tool execution attempt or sandboxing fault detected.
5. **Customer Satisfaction:** CSAT / User rating falls below **3.5 / 5.0**.

---

## 9. Related Documentation
- [Platform Valuation at Full Maturity (Level 5)](./FULL_MATURITY_VALUATION.md)
- [Oddjob 5-Layer AI Control Plane](../.agent/skills/oddjob-5layer-ai-control-plane/SKILL.md)
- [Decision Intelligence UI/UX Proposal](./DECISION_INTELLIGENCE_UI_UX_PROPOSAL.md)
- [Agentic Maturity Documentation](./feature-documentation/agentic-maturity.md)
- [Platform Maintenance Overview Component](../client/src/modules/platform-maintenance/pages/PlatformMaintenanceOverview.tsx)
- [Capability Registry Core Service](../server/domain/capabilities/core/capability-registry.service.ts)
