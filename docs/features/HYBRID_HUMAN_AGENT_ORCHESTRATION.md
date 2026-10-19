# Hybrid Human/Agent Team Collaboration & Orchestration

## 1. Executive Summary & Vision

Oddjob is engineered as the premier orchestration platform for **hybrid human-agent teams**. Unlike generic agent task frameworks that operate in isolation, or traditional HRIS tools that only track humans, Oddjob treats humans and autonomous agents as first-class, polymorphic actors participating in unified operational cycles, shared decision matrices, dynamic skill promotion, and in-room tool syntheses.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       ODDJOB HYBRID CONTROL PLANE                           │
├──────────────────────────────┬──────────────────────────────┬───────────────┤
│    ProjectPlanningPod        │      DecisionMatrixPod       │ Intent Router │
│  (CPM Waves & Hybrid Squads) │  (Weighted Consensus Matrix) │  (MoE + ToM)  │
├──────────────────────────────┴──────────────────────────────┴───────────────┤
│    AgentUpskillingPod        │       ToolScaffoldPod        │ Dynamic Tool  │
│ (3-Tier Remediation & Bench) │ (REST/OpenAPI live synthesis)│  Mount & Auth │
├─────────────────────────────────────────────────────────────┴───────────────┤
│                  Polymorphic Actor & Competency Schema                      │
│                (`competencies`, `actor_competencies`, etc.)                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Core Architecture & Components

### 2.1 Polymorphic Actor & Competency Layer
Defined in [`shared/schema/competencies.ts`](../../shared/schema/competencies.ts):
* **`competencies`**: Canonical registry of skills (e.g., `code_refactoring`, `api_synthesis`, `financial_modeling`, `incident_triage`) categorized by domain, certified levels (`TRAINEE`, `PRACTITIONER`, `EXPERT`, `MASTER`), and evaluation rubrics.
* **`actor_competencies`**: Relates any actor (`actor_type: 'human' | 'agent' | 'hybrid'`) to competencies with verifiable proof artifacts (`evaluation_run_id`, `verified_by_actor_id`, `expires_at`, `revocation_reason`).

### 2.2 Specialized Builder Pods
Each builder pod adheres to the **Packaged Registry Invariant** and lives under `server/domain/core/ui/components/packaged/`. They mount seamlessly into CREW rooms and can be invoked either by human users or agents via the `mount_builder_pod` capability.

#### 1. Project Planning Pod (`ProjectPlanningPod.tsx`)
* **Path**: [`server/domain/core/ui/components/packaged/ProjectPlanningPod.tsx`](../../server/domain/core/ui/components/packaged/ProjectPlanningPod.tsx)
* **Function**: Organizes complex work into Critical Path Method (CPM) waves.
* **Capabilities**:
  * Visual timeline of scheduling waves with status badges (`PLANNED`, `IN_PROGRESS`, `BLOCKED`).
  * Hybrid squad member allocation cards displaying human engineers, agents, and verified competency indicators.
  * Direct execution cycle dispatch via `commit_project_plan_to_cycle` tool and `onCommitPlan` lifecycle hook.

#### 2. Decision Matrix Pod (`DecisionMatrixPod.tsx`)
* **Path**: [`server/domain/core/ui/components/packaged/DecisionMatrixPod.tsx`](../../server/domain/core/ui/components/packaged/DecisionMatrixPod.tsx)
* **Function**: Multi-criteria weighted trade-off deliberation cockpit designed to eliminate human-agent alignment drift.
* **Capabilities**:
  * Multi-dimensional criteria weighting (e.g., Latency, Operational Cost, Architectural Resilience).
  * Real-time automated composite score evaluation highlighting optimal candidates.
  * Human-in-the-loop ratification with mandatory justification logging.

#### 3. Agent Upskilling Pod (`AgentUpskillingPod.tsx`)
* **Path**: [`server/domain/core/ui/components/packaged/AgentUpskillingPod.tsx`](../../server/domain/core/ui/components/packaged/AgentUpskillingPod.tsx)
* **Function**: Closed-loop skill diagnosis, curriculum repair, and competency elevation.
* **Capabilities**:
  * **Execution Trajectory Diagnostic**: Visual breakdown of recent runtime anomalies, parameter schema mismatches, and execution error rates.
  * **3-Tier Remediation Strategy**:
    * **Tier 1 (Prompt Patch)**: Fast, zero-cost directive guardrails.
    * **Tier 2 (Few-Shot Vectors)**: Dynamic injection of curated golden exemplars into RAG context.
    * **Tier 3 (LoRA Fine-Tuning)**: Parameter-efficient adapter training triggered for deep capability upgrades.
  * **Canary Sandbox Benchmark**: Live test runner validating synthetic pass rates (5/5 tests, 98% accuracy score).
  * **Competency Promotion**: Grants verified level elevation in `actor_competencies`.

#### 4. Tool Scaffold Pod (`ToolScaffoldPod.tsx`)
* **Path**: [`server/domain/core/ui/components/packaged/ToolScaffoldPod.tsx`](../../server/domain/core/ui/components/packaged/ToolScaffoldPod.tsx)
* **Function**: Live synthesis and testing of REST/OpenAPI connectors directly in chat or CREW rooms.
* **Capabilities**:
  * Dynamic endpoint configuration (`GET`, `POST`, `PUT`, `DELETE`, `PATCH`) with Credential Vault reference token authentication.
  * Interactive parameter schema builder (`string`, `number`, `boolean`, `object`, `array`).
  * In-pod sandbox test runner executing test requests with formatted response headers and JSON body inspection.
  * Real-time tool publishing into active room inventories without server restarts.

---

## 3. Cognitive Intent Routing & Theory of Mind (ToM)

In [`server/domain/intent-router/core/intent-router.service.ts`](../../server/domain/intent-router/core/intent-router.service.ts), the Mixture-of-Experts (MoE) Intent Router integrates **Cognitive Theory of Mind (ToM) Modulation**:

1. **`classifyWithCognitiveState`**: Enriches classification queries with human cognitive load signals (`high_cognitive_load`, `fatigued`, `frustrated`, `rushed`).
2. **`routeWithCognitiveModulation`**:
   * When cognitive overload or fatigue is detected, the router automatically re-routes complex tasks away from the overburdened human to autonomous agent specialists or introduces structured decision gates.
   * Modulates agent verbosity and interaction friction based on human emotional and cognitive context.

---

## 4. Packaging & Capability Assembly

The platform maintains the **Packaged Registry Invariant**: Every pod advertised in `mount_builder_pod` must resolve in the packaged component registry:
* **Tool Capability**: [`server/domain/tools/v1/capabilities/assembly-tools.ts`](../../server/domain/tools/v1/capabilities/assembly-tools.ts)
* **Registry**: [`server/domain/core/ui/components/packaged/registry.ts`](../../server/domain/core/ui/components/packaged/registry.ts)

Supported builder pods:
* `FormBuilderPod`
* `KnowledgeIngestionPod`
* `WorkflowDesignerPod`
* `AgentForgePod`
* `HILConfigurationPod`
* `ConnectorPod`
* `EvaluationBenchPod`
* `SpatialQueryPod`
* `ApiScaffoldPod`
* `ProjectPlanningPod` *(Sprint 1)*
* `DecisionMatrixPod` *(Sprint 2)*
* `AgentUpskillingPod` *(Sprint 3)*
* `ToolScaffoldPod` *(Sprint 3)*

---

## 5. End-to-End Competency Lifecycle Loop (Sprint 4)

1. **Runtime Competency Promotion**:
   * [`upskilling-orchestrator.service.ts`](../../server/domain/agents/core/upskilling-orchestrator.service.ts): On canary benchmark pass, automatically upserts and promotes agent certified competencies into `actor_competencies`.
   * Maps prompt optimization to Level 2 (`Prompt Directives & Schema Adherence`), golden samples to Level 3 (`Few-Shot Contextual Reasoning`), and fine-tuning to Level 4 (`Fine-Tuned Domain Mastery`).
   * Emits `agent.competency_promoted` on `eventStream`.

2. **Governor HR API Endpoints**:
   * [`governor.ts`](../../server/routes/governor.ts):
     * `GET /api/governor/hr/agents`: Dynamically enriched with each agent's active certified competencies and star proficiency ratings.
     * `GET /api/governor/hr/competencies`: Returns the organization-wide competency catalog and actor assignments.
     * `POST /api/governor/hr/competencies/assign`: Endpoint for human supervisor endorsements or manual overrides.

3. **Agentic HR UI Integration**:
   * [`AgenticHR.tsx`](../../client/src/modules/agents/components/AgenticHR.tsx):
     * **Polymorphic Competency Matrix**: Tab rendering cards for each agent with star proficiency ratings (★) and verification provenance.
     * **Verified Competencies**: Displayed inside the agent details dialog.
     * **Mount Upskilling Pod**: Direct action button to launch the `AgentUpskillingPod` for any agent.

---

## 6. Verification & Testing

### 6.1 Playwright Browser End-to-End Automation
Automated browser tests are executed using Chromium via Playwright:
* Test runner script: `scripts/run-playwright-verification.ts`
* Showcase route: `/external/builder-pods` via [`client/src/pages/dev/BuilderPodsShowcasePage.tsx`](../../client/src/pages/dev/BuilderPodsShowcasePage.tsx)
* Test coverage verified:
  1. Full page rendering of all 4 interactive pods.
  2. CPM Wave selection and "Commit & Launch Cycle" event dispatch.
  3. Weighted matrix candidate scoring and decision ratification.
  4. Upskilling strategy switching (Tier 1 -> Tier 2) and competency promotion ratification.
  5. Tool scaffold sandbox request execution (`HTTP 200 OK`) and live room publishing.

### 6.2 Unit Test Suites
* **Competency Lifecycle Suite**: [`tests/unit/upskilling-competency-lifecycle.test.ts`](../../tests/unit/upskilling-competency-lifecycle.test.ts) (3/3 tests passing).
* **Builder Pods Suite**: [`server/domain/core/ui/components/packaged/BuilderPods.test.tsx`](../../server/domain/core/ui/components/packaged/BuilderPods.test.tsx) (22/22 tests passing).
* **Intent Router Suite**: [`server/domain/intent-router/core/intent-router.service.test.ts`](../../server/domain/intent-router/core/intent-router.service.test.ts) (37/37 tests passing).
