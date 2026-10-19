# Oddjob Domain & Sub-Domain Best Practices Taxonomy

This document is the **single source of truth for agents and contributors** to determine which architectural standards, runtime protocols, database tables, and best practices apply to each domain and sub-domain in the Oddjob platform.

---

## 🧭 How Agents Should Use This Taxonomy

Before writing or refactoring any code:
1. **Identify the Target Domain**: Locate your working directory in the **Domain Directory Index** below (e.g., `server/domain/spatial` or `client/src/modules/scribe`).
2. **Review Sub-Domains & Boundaries**: Verify the sub-domains owned by that domain. Do **not** leak responsibilities across domain boundaries.
3. **Enforce Mandatory Best Practices**: Open and read the linked developer guides and behavioral rules specified for that domain.
4. **Execute Verification Gates**: Run the specific verification commands listed for your domain before declaring a task complete.

---

## 🗺️ Domain Cluster Overview

```
                                    ┌────────────────────────────────────────────────────────┐
                                    │                ODDJOB PLATFORM DOMAINS                 │
                                    │                       (70 Domains)                     │
                                    └──────────────────────────┬─────────────────────────────┘
                                                               │
     ┌───────────────────┬───────────────────┬─────────────────┴───┬───────────────────┬───────────────────┐
     ▼                   ▼                   ▼                     ▼                   ▼                   ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐        ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  CLUSTER 1:  │  │  CLUSTER 2:  │  │  CLUSTER 3:  │        │  CLUSTER 4:  │  │  CLUSTER 5:  │  │  CLUSTER 6:  │
│ Control Plane│  │ Tactical &   │  │ Knowledge &  │        │ Intelligence │  │ Governance & │  │ UI Pods, App │
│ & Swarms     │  │ Spatial      │  │ Scribe       │        │ & Evolution  │  │ Compliance   │  │ Forge & UX   │
└──────────────┘  └──────────────┘  └──────────────┘        └──────────────┘  └──────────────┘  └──────────────┘
```

---

## 1. Cluster 1: Control Plane & Swarm Orchestration

Domains responsible for agent dispatch, autonomous swarms, multi-step job pipelines, and operational missions.

| Domain | Sub-Domains | Core Responsibilities | Key Database Tables | Bound Agent Capabilities | Mandatory Best Practices |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`agents`** | `core`, `handlers`, `governor`, `training-plans` | AgentRunner loop, prompt builder, persona lifecycle, dynamic tool pruning via `SkillManager`. | `agents`, `agent_deployments`, `agent_personas` | `list_available_mcp_capabilities`, `update_agent_persona` | [AGENT_AUTONOMY_AND_EVOLUTION.md](./AGENT_AUTONOMY_AND_EVOLUTION.md)<br>[DEEP_MODULE_ARCHITECTURE.md](./DEEP_MODULE_ARCHITECTURE.md) |
| **`crew`** | `blackboard`, `deliberation`, `coordination` | Crew Room multi-agent collaboration, shared blackboard, optimistic concurrency control. | `crew_sessions`, `crew_blackboards`, `blackboard_artifacts` | `get_blackboard`, `update_blackboard`, `post_crew_message` | [CREW_ROOM_BLACKBOARD_PROTOCOL.md](../platform/06-agent-runtime-runbooks/CREW_ROOM_BLACKBOARD_PROTOCOL.md) |
| **`swarm`** | `consensus`, `topology`, `p2p_messaging` | Decentralized swarm task distribution, peer-to-peer heartbeats, consensus voting. | `swarm_nodes`, `swarm_consensus_votes` | `broadcast_swarm_task`, `vote_consensus` | [CREW_ROOM_BLACKBOARD_PROTOCOL.md](../platform/06-agent-runtime-runbooks/CREW_ROOM_BLACKBOARD_PROTOCOL.md) |
| **`mission`** | `core`, `planner`, `roi`, `memory` | High-level operational missions, strategic manifests, goal decomposition, ROI tracking. | `missions`, `mission_objectives`, `mission_events` | `launch_mission`, `synthesize_mission_assets` | [AGENT_SURPRISE_REPLAN_PROTOCOL.md](../platform/06-agent-runtime-runbooks/AGENT_SURPRISE_REPLAN_PROTOCOL.md) |
| **`jobs`** | `runners`, `evaluators`, `schedulers` | Job execution engine (Selenium, Python, Node, AI evals), execution logs, retry queues. | `jobs`, `job_executions`, `job_schedules` | `trigger_job`, `get_job_status`, `abort_job` | [TOOL_AUTHORING_AND_IDEMPOTENCY.md](./TOOL_AUTHORING_AND_IDEMPOTENCY.md) |
| **`operations`** | `cycles`, `supervisors`, `telemetry` | Operational cycles (e.g. Cycle 312), operational health monitors, runtime supervisors. | `operational_cycles`, `cycle_checkpoints` | `start_operational_cycle`, `emit_cycle_signal` | [REALTIME_TELEMETRY_AND_STREAMS.md](./REALTIME_TELEMETRY_AND_STREAMS.md) |
| **`pipeline`** | `dag`, `step-executor`, `context` | Multi-step DAG workflow orchestration, parameter passing, conditional branching. | `pipelines`, `pipeline_executions`, `pipeline_steps` | `trigger_pipeline`, `pause_pipeline`, `resume_pipeline` | [DEEP_MODULE_ARCHITECTURE.md](./DEEP_MODULE_ARCHITECTURE.md) |
| **`intent-router`** | `classifier`, `embeddings`, `dispatch` | Natural language goal classification, routing user intents to tools, agents, or apps. | `intent_routes`, `intent_telemetry` | `classify_intent`, `route_intent` | [AGENT_AUTONOMY_AND_EVOLUTION.md](./AGENT_AUTONOMY_AND_EVOLUTION.md) |
| **`agent-cards`** | `card_specs`, `a2a_contracts` | A2A Agent Card specifications, capability disclosures, contract verification. | `agent_cards` | `get_agent_card` | [AGENT_AUTONOMY_AND_EVOLUTION.md](./AGENT_AUTONOMY_AND_EVOLUTION.md) |
| **`bots`** | `api`, `core`, `ui` | Natural-language bot intake, Agent Studio proposal review/apply, and CREW room provisioning for reviewed agents. | `agent_cards`, `crew_sessions`, `crew_members` | `propose_agent`, `mount_agent_studio` |
|| **`studio-marketplace`** | `core`, `api`, `ui` | CREW studio add-on marketplace; org-scoped entitlement for mounting gated studios in CREW rooms. | `organization_studio_entitlements` | `mount_media_studio`, `mount_prediction_studio`, `mount_computer_studio`, `mount_signal_studio` | [DEEP_MODULE_ARCHITECTURE.md](./DEEP_MODULE_ARCHITECTURE.md) | [AGENT_AUTONOMY_AND_EVOLUTION.md](./AGENT_AUTONOMY_AND_EVOLUTION.md)<br>[DEEP_MODULE_ARCHITECTURE.md](./DEEP_MODULE_ARCHITECTURE.md) |
| **`projects`** | `workspaces`, `namespaces` | Project spaces, multi-mission project workspaces, namespace isolation. | `project_spaces`, `project_members` | `create_project_space` | [DEEP_MODULE_ARCHITECTURE.md](./DEEP_MODULE_ARCHITECTURE.md) |

---

## 2. Cluster 2: Tactical Operations, Spatial Intelligence & Streams

Domains handling real-world or simulated spatial positioning, telemetry ingestion, incident dispatch, and streaming.

| Domain | Sub-Domains | Core Responsibilities | Key Database Tables | Bound Agent Capabilities | Mandatory Best Practices |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`spatial`** | `h3_hex_grid`, `geofencing`, `query` | Eulerian Hexagonal (Uber H3) spatial indexing, multi-resolution spatial binning, range queries. | `spatial_signals`, `geofences`, `spatial_indexes` | `spatial_query_hexagons`, `index_coordinate_h3` | [REALTIME_TELEMETRY_AND_STREAMS.md](./REALTIME_TELEMETRY_AND_STREAMS.md) |
| **`signal-intelligence`**| `ingestion`, `filtering`, `triage` | Real-time signal stream triage, anomaly detection, threshold monitoring. | `signal_streams`, `signal_alerts` | `ingest_signal_batch`, `evaluate_signal_rules` | [REALTIME_TELEMETRY_AND_STREAMS.md](./REALTIME_TELEMETRY_AND_STREAMS.md) |
| **`streaming`** | `sse`, `websockets`, `uee_encoder` | Universal Event Envelope (UEE) real-time event broadcasting, Redis SSE pub/sub fanout. | N/A (Redis Pub/Sub & Memory Ring Buffers) | `broadcast_uee_event`, `subscribe_stream` | [REALTIME_TELEMETRY_AND_STREAMS.md](./REALTIME_TELEMETRY_AND_STREAMS.md) |
| **`xray`** | `forensics`, `causal_tracer`, `spans` | End-to-end W3C distributed tracing, forensic event recording, execution graph inspection. | `xray_traces`, `forensic_events` | `query_xray_trace`, `inspect_forensic_timeline` | [TOOL_AUTHORING_AND_IDEMPOTENCY.md](./TOOL_AUTHORING_AND_IDEMPOTENCY.md) |
| **`rescue`** | `dispatch`, `field_units`, `tracking` | Emergency tactical dispatch, responder unit allocation, field mission updates. | `rescue_units`, `dispatch_tickets` | `dispatch_rescue_unit`, `update_unit_status` | [DEEP_MODULE_ARCHITECTURE.md](./DEEP_MODULE_ARCHITECTURE.md) |
| **`incident-response`**| `triage`, `escalation`, `postmortem` | Automated incident containment, alert escalation, root cause analysis (RCA). | `incidents`, `incident_timeline` | `declare_incident`, `resolve_incident` | [AGENT_SURPRISE_REPLAN_PROTOCOL.md](../platform/06-agent-runtime-runbooks/AGENT_SURPRISE_REPLAN_PROTOCOL.md) |
| **`chaos`** | `fault_injection`, `circuit_stress` | Resilience engineering, artificial latency injection, simulated service dropouts. | `chaos_experiments`, `chaos_results` | `inject_chaos_fault`, `stop_chaos_experiment` | [DEEP_MODULE_ARCHITECTURE.md](./DEEP_MODULE_ARCHITECTURE.md) |

---

## 3. Cluster 3: Knowledge, Documents & Creative Studio

Domains managing structured and unstructured corporate knowledge, relational entity graphs, and creative document/video synthesis.

| Domain | Sub-Domains | Core Responsibilities | Key Database Tables | Bound Agent Capabilities | Mandatory Best Practices |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`knowledge`** | `garden`, `vector_store`, `chunking` | Unified Knowledge Garden, Qdrant vector embedding, semantic search, hybrid retrieval. | `knowledge_documents`, `knowledge_chunks` | `search_unified_knowledge`, `get_document_content` | [KNOWLEDGE_GRAPH_AND_MEMORY_HYGIENE.md](./KNOWLEDGE_GRAPH_AND_MEMORY_HYGIENE.md) |
| **`graph`** | `ontology`, `entities`, `relationships` | Relational entity-relationship graph, Ontology Object Types, Link Types, Action Types. | `graph_entities`, `graph_relationships`, `ontology_objects` | `search_knowledge_graph`, `query_ontology` | [KNOWLEDGE_GRAPH_AND_MEMORY_HYGIENE.md](./KNOWLEDGE_GRAPH_AND_MEMORY_HYGIENE.md) |
| **`knowledge-packs`** | `pack_loader`, `domain_seeds` | Pre-packaged vertical knowledge packs (legal, medical, defense), tenant domain seeding. | `knowledge_packs`, `pack_installations` | `install_knowledge_pack`, `export_knowledge_pack` | [KNOWLEDGE_GRAPH_AND_MEMORY_HYGIENE.md](./KNOWLEDGE_GRAPH_AND_MEMORY_HYGIENE.md) |
| **`scribe`** | `studio`, `sow`, `scripts` | Scribe Studio, screenplay/document writing, Statement of Work (SOW) parsing & ratification. | `scribe_documents`, `scribe_scripts`, `sow_records` | `parse_sow_document`, `generate_script_scene` | [oddjob-film-production/SKILL.md](../../.agent/skills/oddjob-film-production/SKILL.md) |
| **`media`** | `video_gen`, `transcoding`, `gallery` | Multi-scene Seedance video orchestration, HIL dailies reviews, timeline video rendering. | `media_assets`, `video_render_jobs` | `generate_video_scene`, `render_media_timeline` | [oddjob-film-production/SKILL.md](../../.agent/skills/oddjob-film-production/SKILL.md) |
| **`media-studio`** | `api`, `core` | CREW productions, storyboards, keyframe and take generation, approvals, budgets, and scene assembly. | `media_productions`, `media_keyframes` | `mount_media_studio` | Preserve organization and room scoping; require generation approvals and enforce production budgets. |
| **`transference`** | `distillation`, `weights`, `concepts`| Cross-domain knowledge transfer, model concept distillation, transfer learning adapters. | `transference_sessions`, `concept_mappings`| `transfer_domain_concepts` | [AGENT_AUTONOMY_AND_EVOLUTION.md](./AGENT_AUTONOMY_AND_EVOLUTION.md) |
| **`asset-service`** | `storage`, `uploads`, `s3_proxy` | Static and dynamic file asset storage, CDN delivery, local & cloud asset proxies. | `assets` | `upload_asset`, `get_asset_url` | [DEEP_MODULE_ARCHITECTURE.md](./DEEP_MODULE_ARCHITECTURE.md) |

---

## 4. Cluster 4: AI Intelligence, Self-Improvement & Capabilities

Domains providing AI model clients, capability synchronization, self-reflection, and evolutionary fine-tuning.

| Domain | Sub-Domains | Core Responsibilities | Key Database Tables | Bound Agent Capabilities | Mandatory Best Practices |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`ai`** | `core`, `router`, `token_budget` | Multi-model provider client (Gemini, OpenAI, Anthropic, Ollama), model fallback, token counters. | `ai_call_logs`, `ai_token_budgets` | `execute_llm_call`, `estimate_tokens` | [AGENT_AUTONOMY_AND_EVOLUTION.md](./AGENT_AUTONOMY_AND_EVOLUTION.md) |
| **`tools`** | `v1`, `capabilities`, `registry` | Central agent tool registry (455 tools), TypeBox / Zod schemas, W3C distributed tracing. | `tool_definitions`, `tool_execution_logs` | `list_available_mcp_capabilities` | [TOOL_AUTHORING_AND_IDEMPOTENCY.md](./TOOL_AUTHORING_AND_IDEMPOTENCY.md) |
| **`capabilities`** | `core`, `reconciler`, `manifest` | ACDD capability engine, bi-directional code ⇄ markdown doc synchronization. | `capabilities`, `capability_manifests` | `sync_capability_manifest`, `validate_capability`| [TOOL_AUTHORING_AND_IDEMPOTENCY.md](./TOOL_AUTHORING_AND_IDEMPOTENCY.md) |
| **`evolution`** | `evo_devo`, `patcher`, `canary` | Genetic prompt evolution, directive patches, golden sample harness, canary sandboxes. | `evolution_runs`, `directive_patches`, `canary_evals`| `apply_directive_patch`, `evaluate_canary` | [AGENT_AUTONOMY_AND_EVOLUTION.md](./AGENT_AUTONOMY_AND_EVOLUTION.md) |
| **`self-improvement`**| `reflection`, `mutation`, `eval`| Autonomous post-run criticism (`criticService`), error diagnosis, failure reflections. | `critique_records`, `reflection_entries` | `trigger_self_reflection`, `review_mistakes` | [AGENT_AUTONOMY_AND_EVOLUTION.md](./AGENT_AUTONOMY_AND_EVOLUTION.md) |
| **`improvement`** | `continuous_learning`, `feedback_loops`| Continuous system self-improvement, operational retrospectives, KPI benchmarking. | `improvement_initiatives` | `record_improvement_signal` | [AGENT_AUTONOMY_AND_EVOLUTION.md](./AGENT_AUTONOMY_AND_EVOLUTION.md) |
| **`learning`** | `ssr_check`, `rl_feedback`, `heuristics`| Component SSR verification, headless smoke test harness, heuristic scoring. | `component_render_results` | `verify_component_ssr` | [COMPONENT_AUTHORING_AND_VERIFICATION.md](./COMPONENT_AUTHORING_AND_VERIFICATION.md) |
| **`behavioral-intelligence`**| `profiler`, `drift_detector` | Agent cognitive profiling, tone analysis, behavioral drift tracking. | `agent_behavior_profiles` | `profile_agent_behavior` | [AGENT_AUTONOMY_AND_EVOLUTION.md](./AGENT_AUTONOMY_AND_EVOLUTION.md) |
| **`prediction-intelligence`**| `forecasting`, `projections` | Time-series forecasting, resource exhaustion prediction, capacity forecasting. | `forecast_models`, `forecast_predictions` | `generate_metric_forecast` | [REALTIME_TELEMETRY_AND_STREAMS.md](./REALTIME_TELEMETRY_AND_STREAMS.md) |

---

## 5. Cluster 5: Governance, Safety, Compliance & Admin

Domains protecting data integrity, enforcing human oversight, and administering organizations.

| Domain | Sub-Domains | Core Responsibilities | Key Database Tables | Bound Agent Capabilities | Mandatory Best Practices |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`governance`** | `hil_forms`, `approval_queue`, `contracts` | Human-in-the-Loop (HIL) form triggers, supervisory approval queues, ratification. | `hil_approval_requests`, `hil_ratifications` | `submit_hil_approval_request`, `review_hil_decision`| [AGENT_HIL_ESCALATION_CONTRACT.md](../platform/03-human-in-the-loop-governance/AGENT_HIL_ESCALATION_CONTRACT.md) |
| **`governor`** | `autonomy_limits`, `rate_limiter`, `circuits` | L1–L5 autonomy gatekeeper, step budget limits, blast radius circuit breakers. | `governor_policies`, `budget_usage_records` | `check_autonomy_envelope`, `trip_circuit_breaker` | [AGENT_AUTONOMY_AND_EVOLUTION.md](./AGENT_AUTONOMY_AND_EVOLUTION.md) |
| **`rules`** | `evaluator`, `compiler`, `assertions` | Business rule engine, compliance assertions, invariant policy validation. | `system_rules`, `rule_executions` | `evaluate_rule_set`, `assert_business_invariants` | [DEEP_MODULE_ARCHITECTURE.md](./DEEP_MODULE_ARCHITECTURE.md) |
| **`compliance`** | `audit_trail`, `tamper_evidence` | SOC2 / ISO compliance checks, tamper-evident hash chaining, data retention policies. | `compliance_records`, `retention_policies` | `verify_audit_hash_chain` | [DATABASE_MIGRATION_GUIDE.md](./DATABASE_MIGRATION_GUIDE.md) |
| **`privacy`** | `core` | Reversible PII/PAI tokenization and tenant-scoped detokenization before cloud or tool egress. | Ephemeral in-memory token store | N/A | [DEEP_MODULE_ARCHITECTURE.md](./DEEP_MODULE_ARCHITECTURE.md) |
| **`audit`** | `forensics`, `operator_logs` | Immutable audit logging, operator action tracking, security event recording. | `audit_logs`, `security_events` | `log_audit_action`, `query_audit_trail` | [DEEP_MODULE_ARCHITECTURE.md](./DEEP_MODULE_ARCHITECTURE.md) |
| **`admin`** | `settings`, `dead_letter`, `usage` | Platform administrative controls, DLQ inspection, reporting maintenance, quiet hours. | `system_settings`, `dead_letter_queue` | `replay_dead_letter`, `update_system_settings` | [accidental-data-loss-protocol.md](../../.agent/rules/accidental-data-loss-protocol.md) |
| **`auth`** | `session`, `rbac`, `tokens` | JWT / session authentication, RBAC permission resolution, role enforcement. | `users`, `sessions`, `roles`, `permissions` | `validate_session`, `check_user_permissions` | [DEEP_MODULE_ARCHITECTURE.md](./DEEP_MODULE_ARCHITECTURE.md) |
| **`org`** | `tenants`, `teams`, `members` | Multi-tenant isolation, organization hierarchies, team memberships. | `organizations`, `teams`, `organization_members` | `get_organization_context`, `invite_member` | [DEEP_MODULE_ARCHITECTURE.md](./DEEP_MODULE_ARCHITECTURE.md) |
| **`billing`** | `stripe`, `credits`, `invoices` | Stripe billing integration, API token credit balances, subscription tier limits. | `subscriptions`, `billing_invoices`, `credit_balances`| `charge_token_credits`, `get_subscription_status` | [DEEP_MODULE_ARCHITECTURE.md](./DEEP_MODULE_ARCHITECTURE.md) |

---

## 6. Cluster 6: UI Pods, Application Forge & Frontend Experience

Domains responsible for packaged UI components, dynamic app generation, visual canvas, and onboarding walkthroughs.

| Domain / Path | Sub-Domains / Pods | Core Responsibilities | Target Assets | Mandatory Best Practices |
| :--- | :--- | :--- | :--- | :--- |
| **`server/domain/core/ui/components/packaged`** | 63 Builder Pods (ProjectPlanning, HILGovernance, TacticalMap, AgentUpskilling, ToolScaffold, etc.) | Self-contained, dual-export interactive UI pods with schema validation and headless SSR verification. | `.tsx` files in `packaged/` | [COMPONENT_AUTHORING_AND_VERIFICATION.md](./COMPONENT_AUTHORING_AND_VERIFICATION.md)<br>[THEME_AND_TOKEN_SYSTEM.md](./THEME_AND_TOKEN_SYSTEM.md) |
| **`packages/design-system`** | `primitives`, `layout`, `tokens` | FormalLayout, SMT mathematical verification, WCAG 48px hitboxes, semantic tokens. | `@oddjob/design-system` | [FORMAL_LAYOUT_AND_WCAG_VERIFICATION.md](./FORMAL_LAYOUT_AND_WCAG_VERIFICATION.md)<br>[THEME_AND_TOKEN_SYSTEM.md](./THEME_AND_TOKEN_SYSTEM.md) |
| **`apps`** | `runtime`, `instant_apps`, `manifests`| Dynamic Forged App runtime, Instant App generation, app lifecycle execution. | `apps`, `app_deployments` | [oddjob-workflow-and-app-assembly/SKILL.md](../../.agent/skills/oddjob-workflow-and-app-assembly/SKILL.md) |
| **`canvas`** | `node_editor`, `wires`, `compiler` | Visual node-based workflow editor, drag-and-drop capability composition. | `canvas_boards`, `canvas_nodes` | [oddjob-workflow-and-app-assembly/SKILL.md](../../.agent/skills/oddjob-workflow-and-app-assembly/SKILL.md) |
| **`client/src/lib/tutorial-engine.ts`** | `score_engine`, `playlists`, `anchors`| S.C.O.R.E. guided walkthroughs, `data-tutorial` anchoring, interactive tour execution. | `client/src/lib/tutorial-*` | [SCORE_AUTHORING_RUNBOOK.md](../tutorials/SCORE_AUTHORING_RUNBOOK.md) |
| **`agora`** | `marketplace`, `templates`, `ratings` | Shared template marketplace, community agents, app sharing and ratings. | `marketplace_items`, `template_ratings` | [DEEP_MODULE_ARCHITECTURE.md](./DEEP_MODULE_ARCHITECTURE.md) |
| **`scaffold`** | `blueprints`, `generators`, `packs` | Application blueprint synthesis, pod scaffold generators, boilerplate authoring. | `scaffolds` | `generate_app_scaffold` | [COMPONENT_AUTHORING_AND_VERIFICATION.md](./COMPONENT_AUTHORING_AND_VERIFICATION.md) |
| **`resource-catalog`** | `component_index`, `pod_registry` | Component and pod catalog, ontology action/object/link registries. | `resource_catalog_items` | `query_resource_catalog` | [COMPONENT_AUTHORING_AND_VERIFICATION.md](./COMPONENT_AUTHORING_AND_VERIFICATION.md) |

---

## 7. Cluster 7: Infrastructure, Integration & Core Services

Domains powering database access, job queues, external connectors, caching, and developer tooling.

| Domain | Sub-Domains | Core Responsibilities | Key Database Tables / Primitives | Mandatory Best Practices |
| :--- | :--- | :--- | :--- | :--- |
| **`infrastructure`** | `database`, `janitor`, `connection_pool` | PostgreSQL & SQLite connection lifecycle, database pool management, Janitor GC. | `db.ts`, `janitor.service.ts` | [DATABASE_MIGRATION_GUIDE.md](./DATABASE_MIGRATION_GUIDE.md) |
| **`cache`** | `memory`, `redis_cache`, `invalidation` | Multi-tier memory and Redis caching, TTL expiration policies, cache tagging. | Redis Key-Value Store | [DEEP_MODULE_ARCHITECTURE.md](./DEEP_MODULE_ARCHITECTURE.md) |
| **`queue`** | `bullmq`, `redis_queue`, `priorities` | Background job queuing, priority queues, rate-limited job dispatch. | Redis Queues & Streams | [TOOL_AUTHORING_AND_IDEMPOTENCY.md](./TOOL_AUTHORING_AND_IDEMPOTENCY.md) |
| **`schedules`** | `cron`, `interval_runner`, `one_shot` | Declarative cron scheduling, recurring job triggers, timer events. | `schedules`, `scheduled_triggers` | [TOOL_AUTHORING_AND_IDEMPOTENCY.md](./TOOL_AUTHORING_AND_IDEMPOTENCY.md) |
| **`integrations`** | `slack`, `jira`, `github`, `hubspot` | Third-party SaaS webhook listeners, OAuth token refresh, external API wrappers. | `integration_connections`, `oauth_tokens` | [TOOL_AUTHORING_AND_IDEMPOTENCY.md](./TOOL_AUTHORING_AND_IDEMPOTENCY.md) |
| **`sdlc-pipeline`** | `build_checks`, `static_analysis` | Automated CI pipeline checks, AST architecture auditing, code quality verification. | N/A (Scripts & Harnesses) | [DEEP_MODULE_ARCHITECTURE.md](./DEEP_MODULE_ARCHITECTURE.md) |
| **`qa`** | `synthetic_evals`, `test_scenarios` | Synthetic test scenarios, QA evaluation runs, automated assessment pipelines. | `qa_evaluations` | [E2E_PLAYWRIGHT_TESTING.md](./E2E_PLAYWRIGHT_TESTING.md) |
| **`testing`** | `harnesses`, `mocks`, `e2e_fixtures` | Vitest unit test suites, Playwright E2E testing fixtures, synthetic seed data. | `tests/e2e/`, `*.test.ts` | [E2E_PLAYWRIGHT_TESTING.md](./E2E_PLAYWRIGHT_TESTING.md) |
| **`diagnostics`** | `health`, `probes`, `memory_check` | Health probes (`/api/health`), heartbeat endpoints, heap allocation monitoring. | N/A (Live HTTP Probes) | [REALTIME_TELEMETRY_AND_STREAMS.md](./REALTIME_TELEMETRY_AND_STREAMS.md) |
| **`analytics`** | `usage_rollups`, `metrics` | Platform usage analytics, telemetry rollups, metrics aggregation. | `analytics_events`, `usage_summaries` | [REALTIME_TELEMETRY_AND_STREAMS.md](./REALTIME_TELEMETRY_AND_STREAMS.md) |
| **`python`** | `sandbox`, `pyodide`, `executor` | Isolated Python execution environment, Pyodide and containerized code execution. | `python_execution_jobs` | [TOOL_AUTHORING_AND_IDEMPOTENCY.md](./TOOL_AUTHORING_AND_IDEMPOTENCY.md) |
| **`sales`** | `pipelines`, `opportunities`, `deals` | Sales pipeline tracking, deal stages, revenue projections. | `sales_deals`, `sales_pipelines` | [DEEP_MODULE_ARCHITECTURE.md](./DEEP_MODULE_ARCHITECTURE.md) |
| **`prospecting`** | `leads`, `campaigns`, `enrichment` | Automated B2B lead prospecting, contact enrichment, outreach sequences. | `leads`, `prospect_campaigns` | [DEEP_MODULE_ARCHITECTURE.md](./DEEP_MODULE_ARCHITECTURE.md) |
| **`ecommerce`** | `catalog`, `checkout`, `cart` | Product catalogs, checkout flows, order processing. | `orders`, `order_items`, `products` | [DATABASE_MIGRATION_GUIDE.md](./DATABASE_MIGRATION_GUIDE.md) |
| **`finance`** | `ledger`, `transactions`, `currency` | Immutable financial ledger, transaction tracking, accounting records. | `financial_transactions` | [DATABASE_MIGRATION_GUIDE.md](./DATABASE_MIGRATION_GUIDE.md) |
| **`pagination`** | `cursor_streaming`, `offsets` | Universal cursor-based pagination and streaming response utilities. | N/A (Streaming utilities) | [DEEP_MODULE_ARCHITECTURE.md](./DEEP_MODULE_ARCHITECTURE.md) |
| **`system`** | `heartbeat`, `diagnostics`, `host_os` | Core system diagnostics, process heartbeat, OS environment telemetry. | `system_telemetry` | [REALTIME_TELEMETRY_AND_STREAMS.md](./REALTIME_TELEMETRY_AND_STREAMS.md) |

---

## ⚡ Quick Lookup: By File Path Prefix

When an agent is assigned a file or task, consult this table for instantaneous resolution:

| File Path Prefix | Primary Domain Cluster | Mandatory Lint / Test Gate | Reference Guide |
| :--- | :--- | :--- | :--- |
| `client/src/components/**/*.tsx` | Cluster 6: UI & Design | `npm run lint:theme` | [THEME_AND_TOKEN_SYSTEM.md](./THEME_AND_TOKEN_SYSTEM.md) |
| `server/domain/core/ui/components/packaged/**/*.tsx` | Cluster 6: UI Pods | `npm run components:verify` | [COMPONENT_AUTHORING_AND_VERIFICATION.md](./COMPONENT_AUTHORING_AND_VERIFICATION.md) |
| `server/domain/**/*.route.ts` | Cluster 1–5: Backend Routes | `npm run lint:arch` | [DEEP_MODULE_ARCHITECTURE.md](./DEEP_MODULE_ARCHITECTURE.md) |
| `shared/schema/**/*.ts` | Cluster 5 & 7: Data Models | `npm run check:schema-drift` | [DATABASE_MIGRATION_GUIDE.md](./DATABASE_MIGRATION_GUIDE.md) |
| `server/domain/tools/**/*.ts` | Cluster 4: Tool Registry | `npm run check:tool-idempotency` | [TOOL_AUTHORING_AND_IDEMPOTENCY.md](./TOOL_AUTHORING_AND_IDEMPOTENCY.md) |
| `client/src/lib/tutorial-*` | Cluster 6: Onboarding Engine | `npm run test:drift` | [SCORE_AUTHORING_RUNBOOK.md](../tutorials/SCORE_AUTHORING_RUNBOOK.md) |
| `server/domain/spatial/**/*.ts` | Cluster 2: Spatial Intelligence | `npm run check` | [REALTIME_TELEMETRY_AND_STREAMS.md](./REALTIME_TELEMETRY_AND_STREAMS.md) |
| `server/domain/knowledge/**/*.ts` | Cluster 3: Knowledge Garden | `npm run check` | [KNOWLEDGE_GRAPH_AND_MEMORY_HYGIENE.md](./KNOWLEDGE_GRAPH_AND_MEMORY_HYGIENE.md) |
| `server/domain/agents/**/*.ts` | Cluster 1: Agent Orchestrator | `npm run check` | [AGENT_AUTONOMY_AND_EVOLUTION.md](./AGENT_AUTONOMY_AND_EVOLUTION.md) |
