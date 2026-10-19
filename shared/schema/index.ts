// ============================================================================
// ODDJOB DETERMINISTIC SCHEMA REGISTRY (MACH 2)
// ============================================================================
// Order of exports is critical for Drizzle module resolution.
// Foundational -> Functional -> Domain -> Orchestration -> Ephemeral

// 1. FOUNDATIONAL (Auth & System)
export * from "./auth.js";
export * from "./system.js";
export * from "./api-keys.js";
export * from "./integrations.js";
export * from "./integrations/slack.js";
export * from "./user-memory.js";
export * from "./integrations/trycua.js";
export * from "./omnichannel.js";
export * from "./ai/llm-router.js";
export * from "./ai/transference.js";
export * from "./encrypted-credentials.js";
export * from "./billing.js";
// Project Spaces: the durable scope between orgs and cycles. Must precede
// operational-cycles.js, which carries the one real project_id column (§5.3).
export * from "./projects.js";

// 2. SHARED & INFRASTRUCTURE
export * from "./licensing.js";
export * from "./versioning.js";
export * from "./schedules.js";
export * from "./cost-ledger.js";
export * from "./evals.js";
export * from "./heartbeat-triggers.js";
export * from "./observability.js";
export * from "./audit.js";
export * from "./errors.js";
export * from "./alerts.js";
export * from "./infrastructure/performance-monitoring.js";

// 3. FUNCTIONAL (Pipelines & Jobs)
export * from "./pipelines/index.js";
// Workflow lifecycle references pipelines, so it must follow them.
export * from "./workflows.js";
export * from "./jobs/index.js";
export * from "./agent/index.js";
export * from "./agents/reflection.js";
export * from "./agent-deployments.js";
export * from "./agent-sessions.js";
export * from "./pipelineInputParams.js";
export * from "./pipelineOutputParams.js";
export * from "./job-collections.js";
export * from "./skills.js";
export * from "./skill-integration.js";
export * from "./competencies.js";
export * from "./shortlinks.js";

// 4. DOMAIN SPECIALIZATIONS (Non-Knowledge Dependencies)
export * from "./governor.js";
export * from "./governance-ops.js";
export * from "./knowledge-packs.js";
export * from "./agent-governance.js";
export * from "./policy-violations.js";
export * from "./agent-performance.js";
export * from "./supervisor.js";
export * from "./hil.js";
export * from "./mcp-servers.js";
export * from "./mcp-auth.js";
export * from "./crm.js";
export * from "./prospecting.js";
export * from "./sales.js";
export * from "./antigravity.js";
export * from "./agent-cards.js";
export * from "./studio-entitlements.js";
export * from "./intent-router.js";
export * from "./signal-intelligence.js";
export * from "./crew.js";
export * from './financial-snapshots.js';
export * from "./attachments.js";
export * from "./spatial-regions.js";
export * from "./spatial-knowledge.js";
export * from "./agent-beliefs.js";
export * from "./kafka-events.js";

// 5. ORCHESTRATION (Missions & Apps)
export * from "./missions/index.js";
export * from "./mission-agent-assignments.js";
export * from "./agora.js";
export * from "./swarm.js";
export * from "./apps.js";
export * from "./infrastructure/phase-1a.js";
export * from "./infrastructure/phase-1b.js";
export * from "./mission-deliverables.js";
export * from "./mission-learned-patterns.js";
export * from "./templates.js";
export * from "./document-templates.js";
export * from "./blueprints.js";
export * from "./operational-cycles.js";
export * from "./cycle-builder-draft.js";
export * from "./cycle-builder-drafts.js";
export * from "./resources.js";
export * from "./resource-catalog-edges.js";
export * from "./team-collaboration.js";
export * from "./integration-ecosystem.js";
export * from "./generation-sessions.js";
export * from "./artifact-registry.js";

// Capability Sync (ACDD bi-directional capability & documentation engine)
export * from "./capabilities/index.js";

// Evidence-driven improvement loops (opportunities, observations, hypotheses)
export * from "./improvement/index.js";

// 6. KNOWLEDGE (The Core Graph)
export * from "./knowledge/index.js";

// 7. KNOWLEDGE-DEPENDENT DOMAINS
export * from "./rescue.js";
export * from "./datasets.js";
export * from "./ontology/index.js";

// 8. ANALYTICS & FEEDBACK
export * from "./analytics.js";
export * from "./copilot-observability.js";
export * from "./tool-invocations.js";
export * from "./training.js";
export * from "./scoring.js";
export * from "./performance-snapshots.js";
export * from "./evaluation.js";
export * from "./video-feedback.js";
export * from "./evaluation-result.js";
export * from "./failure-pattern.js";
export * from "./harness-proposal.js";
export * from "./evo-devo.js";

// 9. ADAPTIVE LEARNING
export * from "./learning/index.js";

// 10. EPHEMERAL
export * from "./ephemeral.js";
export * from "./connectors.js";

// 11. PREDICTION INTELLIGENCE DOMAIN
export * from "./prediction/quants.js";
export * from "./prediction/plugin-runtime.js";
export * from "./prediction/realm-mesh.js";
export * from "./prediction/predictions.js";
export * from "./prediction/source-performance.js";
export * from "./prediction/pruning.js";
export * from "./prediction/memory.js";
export * from "./prediction/graph.js";

// 9. ADAPTIVE LEARNING
export * from "./learning/index.js";

// 10. EPHEMERAL
export * from "./ephemeral.js";
export * from "./connectors.js";

// 11. PREDICTION INTELLIGENCE DOMAIN
export * from "./prediction/quants.js";
export * from "./prediction/plugin-runtime.js";
export * from "./prediction/realm-mesh.js";
export * from "./prediction/predictions.js";
export * from "./prediction/source-performance.js";
export * from "./prediction/pruning.js";
export * from "./prediction/memory.js";
export * from "./prediction/graph.js";
export * from "./prediction/hidden-state.js";
export * from "./prediction/diff.js";
export * from "./prediction/windowing.js";
export * from "./prediction/canonical-event.js";
export * from "./prediction/context.js";
export * from "./prediction/governance.js";
export * from "./prediction/calibration.js";
export * from "./xray-documentation.js";
export * from "./xray-operations.js";
export * from "./assembly-blueprint.js";
export * from "./blueprint-sessions.js";
export * from "./document-block.schema.js";

export * from "./scribe.js";
export * from "./media-studio.js";
export * from "./app-reviews.js";
export * from "./push.js";
export * from "./marketplace/marketplace-listing.js";
