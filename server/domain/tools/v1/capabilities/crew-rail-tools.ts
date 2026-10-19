/**
 * CREW Specialized Rail Capability Tools
 *
 * Provides structured runtime tools for:
 * 1. Decision Matrix & Deliberation Rail (mode: "decide")
 * 2. Governance & HITL Approval Gate Rail (mode: "operate" / "review")
 * 3. Forensic Incident & RCA Timeline Rail (mode: "investigate")
 */

import { z } from "zod";
import type { ToolDefinition } from "./types.js";
import { createLogger } from "@server/utils/logger.js";
import { PredictionEngine } from "../../../ai/core/prediction-engine.service.js";

const logger = createLogger("CrewRailTools");

export const CREW_RAIL_TOOLS: Record<string, ToolDefinition> = {
    propose_decision_matrix: {
        name: "propose_decision_matrix",
        idempotency: "read-safe",
        label: "Propose Multi-Criteria Decision Matrix",
        group: "Deliberation",
        description: "Mounts or updates an interactive Decision Matrix Rail in the CREW room with candidate options, weighted criteria, scoring breakdown, and persona stances.",
        parameters: z.object({
            topic: z.string().describe("The core architectural or strategic question under deliberation"),
            candidates: z.array(z.object({
                id: z.string(),
                name: z.string(),
                description: z.string().optional(),
                scores: z.record(z.string(), z.number()).describe("Score 1-10 per criterion key"),
                overallScore: z.number().optional(),
                pros: z.array(z.string()).optional(),
                cons: z.array(z.string()).optional(),
            })).describe("Candidate options being evaluated"),
            criteria: z.array(z.object({
                key: z.string(),
                label: z.string(),
                weight: z.number().min(0.1).max(5.0).default(1.0).describe("Importance weight multiplier"),
                description: z.string().optional(),
            })).describe("Evaluation criteria (e.g. Latency, Cost, Security, BATNA)"),
            personaStances: z.array(z.object({
                agentName: z.string(),
                preferredCandidateId: z.string(),
                confidence: z.number().min(0).max(100),
                rationale: z.string(),
            })).optional().describe("Individual agent voting positions and confidence scores"),
            recommendedCandidateId: z.string().optional().describe("Current leading candidate based on weighted score"),
            consensusPercentage: z.number().min(0).max(100).optional().default(50),
        }),
        execute: async (params: any, context?: any) => {
            const criteria = params.criteria || [];
            const candidates = (params.candidates || []).map((c: any) => {
                let weightedTotal = 0;
                let weightSum = 0;
                criteria.forEach((crit: any) => {
                    const score = c.scores?.[crit.key] ?? 5;
                    const weight = crit.weight ?? 1;
                    weightedTotal += score * weight;
                    weightSum += weight;
                });
                const computedOverall = weightSum > 0 ? Number((weightedTotal / weightSum).toFixed(1)) : 5;
                return {
                    ...c,
                    overallScore: c.overallScore ?? computedOverall,
                };
            });

            // Sort candidates descending by overallScore
            candidates.sort((a: any, b: any) => (b.overallScore || 0) - (a.overallScore || 0));
            const topCandidate = candidates[0];

            logger.info(`[DecisionMatrix] Evaluated ${candidates.length} candidates for "${params.topic}". Top: ${topCandidate?.name}`);

            return JSON.stringify({
                type: "crew_decision_matrix_pod",
                module: "CrewDecisionMatrixRail",
                topic: params.topic,
                candidates,
                criteria,
                personaStances: params.personaStances || [],
                recommendedCandidateId: params.recommendedCandidateId || topCandidate?.id,
                consensusPercentage: params.consensusPercentage ?? 75,
                updatedAt: new Date().toISOString(),
            });
        },
    },

    request_governance_approval: {
        name: "request_governance_approval",
        idempotency: "read-safe",
        label: "Request Governance Action Approval",
        group: "Governance",
        description: "Shows a high-stakes action to the room for human review, with its blast radius. A sign-off is posted to the room as a message; it is not recorded as an approval and nothing executes the action.",
        parameters: z.object({
            actionKey: z.string().describe("Unique identifier for this action item"),
            actionTitle: z.string().describe("Descriptive title of the proposed action (e.g. Deploy Fleet Migration 0089)"),
            riskTier: z.enum(["low", "medium", "high", "critical"]).default("medium").describe("Security & data loss risk classification"),
            requestedBy: z.string().describe("The agent card or persona proposing this action"),
            blastRadius: z.object({
                affectedServices: z.array(z.string()).optional(),
                dataDestructionRisk: z.boolean().default(false),
                estimatedCostUsd: z.number().optional(),
                tenantsImpactedCount: z.number().optional(),
                summary: z.string().optional(),
            }),
            executionPayload: z.record(z.string(), z.any()).describe("What the action would run, shown for review. Nothing executes it."),
            requiresDualSignOff: z.boolean().optional().default(false),
        }),
        execute: async (params: any, context?: any) => {
            logger.info(`[GovernanceGate] Action requested: "${params.actionTitle}" (Risk: ${params.riskTier}) by ${params.requestedBy}`);

            return JSON.stringify({
                type: "crew_governance_gate_pod",
                module: "CrewGovernanceGateRail",
                checkpoint: {
                    id: `gov-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
                    actionKey: params.actionKey,
                    actionTitle: params.actionTitle,
                    riskTier: params.riskTier,
                    requestedBy: params.requestedBy,
                    blastRadius: params.blastRadius,
                    executionPayload: params.executionPayload,
                    status: "pending",
                    requiresDualSignOff: params.requiresDualSignOff ?? false,
                    requestedAt: new Date().toISOString(),
                },
            });
        },
    },

    pin_forensic_event: {
        name: "pin_forensic_event",
        idempotency: "read-safe",
        label: "Pin Forensic Timeline Event",
        group: "Diagnostics",
        description: "Pins a chronological event, error log anomaly, or root cause hypothesis card into the Forensic Incident Timeline Rail.",
        parameters: z.object({
            incidentTitle: z.string().optional().default("System Incident Investigation"),
            eventTimestamp: z.string().describe("ISO timestamp or relative time of the event (e.g. 2026-08-28T05:14:00Z)"),
            severity: z.enum(["info", "warning", "error", "critical"]).default("warning"),
            source: z.string().describe("Originating microservice, worker pod, or DB shard"),
            description: z.string().describe("Observed symptom, error trace, or state anomaly"),
            hypothesis: z.object({
                statement: z.string(),
                confidence: z.enum(["low", "medium", "high", "confirmed", "disproved"]),
                supportingAgents: z.array(z.string()).optional(),
            }).optional(),
        }),
        execute: async (params: any, context?: any) => {
            logger.info(`[ForensicTimeline] Pinned event [${params.severity}] from ${params.source} at ${params.eventTimestamp}`);

            return JSON.stringify({
                type: "crew_forensic_timeline_pod",
                module: "CrewForensicTimelineRail",
                incidentTitle: params.incidentTitle,
                event: {
                    id: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
                    timestamp: params.eventTimestamp,
                    severity: params.severity,
                    source: params.source,
                    description: params.description,
                    hypothesis: params.hypothesis,
                },
            });
        },
    },

    dispatch_spatial_squad: {
        name: "dispatch_spatial_squad",
        idempotency: "none",
        label: "Dispatch Hybrid Spatial Squad",
        group: "SpatialOperations",
        description: "Evaluates safety trajectory and dispatches a hybrid human-agent squad to a target Uber H3 hexagonal cell index, mounting a Governance Gate approval checkpoint.",
        parameters: z.object({
            targetH3Index: z.string().describe("Target Uber H3 hexagonal cell index (e.g. '8828308281fffff')"),
            squadId: z.string().describe("Identifier of the hybrid squad (e.g. 'squad-4')"),
            missionObjective: z.string().describe("Operational objective of the field dispatch"),
            estimatedDurationMinutes: z.number().optional().default(30),
            assetRiskClass: z.enum(["routine", "high", "critical"]).default("high"),
            assignedPersonnel: z.array(z.string()).optional().default([]),
            // --- Squad result routing (Seam 6) ---
            targetScribeDocumentId: z
                .string()
                .optional()
                .describe(
                    "If set, the squad's analysis result is written as a new Scribe section when the squad " +
                    "completes. The crew webhook handler calls scribe_update_node with the spatial analysis summary.",
                ),
            targetDatasetId: z
                .string()
                .optional()
                .describe(
                    "If set, result rows are appended to this dataset table when the squad completes.",
                ),
            notifyOnCompletion: z
                .boolean()
                .optional()
                .default(true)
                .describe(
                    "If true (default), posts a CREW turn summarising the squad result when the squad completes.",
                ),
        }),
        execute: async (params: any, context?: any) => {
            // 1. Evaluate trajectory safety via Bayesian PredictionEngine.
            //
            // The engine classifies risk from the target name when none is
            // given, and the target here is an H3 cell index — a string with no
            // risk signal in it. The dispatch already knows the asset's class,
            // so it is passed through explicitly; the engine treats that as
            // authoritative. Its band is routine/elevated/critical, which is not
            // the same vocabulary as the tool's routine/high/critical.
            const target = `geo:h3:${params.targetH3Index}`;
            const riskClass = ({ routine: "routine", high: "elevated", critical: "critical" } as const)[
                params.assetRiskClass as "routine" | "high" | "critical"
            ] ?? "elevated";

            const trajectoryResult = PredictionEngine.evaluateTrajectory({
                currentState: {
                    stage: "Observe",
                    targetFileOrNode: target,
                    riskClass,
                },
                candidateNextStep: {
                    stage: "Improve",
                    targetFileOrNode: target,
                    confidenceScore: params.assetRiskClass === "critical" ? 0.95 : 0.90,
                    riskClass,
                },
            });

            const riskTier = params.assetRiskClass === "critical" ? "critical" : params.assetRiskClass === "high" ? "high" : "medium";
            const requiresDualSignOff = params.assetRiskClass === "critical" || trajectoryResult.safeTransitionScore < 0.85;

            logger.info(
                `[SpatialDispatch] Squad '${params.squadId}' dispatch requested to H3 hex '${params.targetH3Index}'. Trajectory safety: ${trajectoryResult.safeTransitionScore} (Tier: ${riskTier})`
            );

            return JSON.stringify({
                type: "crew_governance_gate_pod",
                module: "CrewGovernanceGateRail",
                checkpoint: {
                    id: `dispatch-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
                    actionKey: "dispatch_spatial_squad",
                    actionTitle: `Dispatch ${params.squadId} → Hex ${params.targetH3Index}`,
                    riskTier,
                    requestedBy: "SpatialDispatcher",
                    blastRadius: {
                        affectedServices: ["spatial_fleet", "field_telemetry"],
                        dataDestructionRisk: false,
                        estimatedCostUsd: params.estimatedDurationMinutes * 5,
                        tenantsImpactedCount: 1,
                        summary: `${params.missionObjective} (Safety Score: ${(trajectoryResult.safeTransitionScore * 100).toFixed(1)}%)`,
                    },
                    executionPayload: {
                        squadId: params.squadId,
                        targetH3Index: params.targetH3Index,
                        missionObjective: params.missionObjective,
                        estimatedDurationMinutes: params.estimatedDurationMinutes,
                        trajectoryScore: trajectoryResult.safeTransitionScore,
                        assignedPersonnel: params.assignedPersonnel,
                        // Result routing — carried through approval so the webhook has them.
                        ...(params.targetScribeDocumentId ? { targetScribeDocumentId: params.targetScribeDocumentId } : {}),
                        ...(params.targetDatasetId ? { targetDatasetId: params.targetDatasetId } : {}),
                        notifyOnCompletion: params.notifyOnCompletion !== false,
                    },
                    status: "pending",
                    requiresDualSignOff,
                    requestedAt: new Date().toISOString(),
                },
            });
        },
    },

    ratify_decision: {
        name: "ratify_decision",
        idempotency: "read-safe",
        label: "Ratify Durable Decision",
        group: "Deliberation",
        description: "Formally proposes or ratifies a strategic or architectural decision in the room with evaluated alternatives, rationale, and confidence score.",
        parameters: z.object({
            statement: z.string().describe("The clear, concise decision statement agreed upon (e.g., 'Adopt BullMQ with Redis persistence for async job queue')"),
            rationale: z.string().optional().describe("Why this decision was chosen over competing options"),
            alternatives: z.array(z.string()).optional().default([]).describe("Alternatives that were evaluated and rejected"),
            confidence: z.number().min(0).max(100).optional().default(85).describe("Confidence score (0-100)"),
            evidenceTurnIds: z.array(z.number()).optional().default([]).describe("Turn IDs in the discussion that provided backing evidence"),
        }),
        execute: async (params: any, context?: any) => {
            logger.info(`[DecisionRatification] Decision proposed/ratified: "${params.statement}" (Confidence: ${params.confidence}%)`);
            return JSON.stringify({
                type: "decision_ratification",
                statement: params.statement,
                rationale: params.rationale ?? null,
                alternatives: params.alternatives ?? [],
                confidence: params.confidence ?? 85,
                evidenceTurnIds: params.evidenceTurnIds ?? [],
                status: "proposed",
                createdBy: context?.speakerName ?? context?.agentName ?? "Agent",
                round: context?.round ?? 1,
            });
        },
    },

    record_commitment: {
        name: "record_commitment",
        idempotency: "read-safe",
        label: "Record Action Commitment",
        group: "Deliberation",
        description: "Locks in an explicit action commitment or responsibility for an agent or participant with target deadline and expected deliverables.",
        parameters: z.object({
            title: z.string().describe("Clear action title (e.g. 'Scaffold Drizzle schema migration 0086 for durable state')"),
            detail: z.string().optional().describe("Implementation plan, dependencies, and execution details"),
            ownerType: z.enum(["user", "agent", "team"]).default("agent").describe("Owner type"),
            ownerId: z.string().describe("Assignee name or agent handle (e.g. '@DatabaseSpecialist' or '@Architect')"),
            dueAt: z.string().optional().describe("Target completion ISO timestamp or round description"),
        }),
        execute: async (params: any, context?: any) => {
            logger.info(`[Commitment] Commitment recorded: "${params.title}" for ${params.ownerId}`);
            return JSON.stringify({
                type: "commitment_contract",
                title: params.title,
                detail: params.detail ?? null,
                ownerType: params.ownerType ?? "agent",
                ownerId: params.ownerId,
                dueAt: params.dueAt ?? null,
                status: "open",
                createdBy: context?.speakerName ?? context?.agentName ?? "Agent",
            });
        },
    },

    verify_claim: {
        name: "verify_claim",
        idempotency: "read-safe",
        label: "Verify Empirical Claim",
        group: "Deliberation",
        description: "Asserts an empirical claim or fact with backing evidence citations and multi-agent stance tracking.",
        parameters: z.object({
            claim: z.string().describe("The empirical claim or factual assertion (e.g. 'P99 API latency reduced by 42% after connection pooling fix')"),
            confidence: z.number().min(0).max(100).optional().default(85).describe("Confidence score in percentage"),
            agreementLevel: z.number().min(0).max(100).optional().default(75).describe("Estimated room agreement percentage"),
            evidence: z.array(z.object({
                label: z.string(),
                uri: z.string().optional(),
                excerpt: z.string().optional(),
            })).optional().default([]).describe("Evidence citations or database/source excerpts"),
            positions: z.array(z.object({
                agentName: z.string(),
                position: z.enum(["agree", "disagree", "neutral"]),
                rationale: z.string().optional(),
            })).optional().default([]).describe("Known agent stances on this claim"),
        }),
        execute: async (params: any, context?: any) => {
            logger.info(`[ClaimVerification] Claim asserted: "${params.claim}" (Confidence: ${params.confidence}%)`);
            return JSON.stringify({
                type: "claim_verification",
                claim: params.claim,
                confidence: params.confidence ?? 85,
                agreementLevel: params.agreementLevel ?? 75,
                evidence: params.evidence ?? [],
                positions: params.positions ?? [],
                status: "unverified",
                createdBy: context?.speakerName ?? context?.agentName ?? "Agent",
            });
        },
    },
};

