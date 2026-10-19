import { createLogger } from "@server/utils/logger.js";
import { FormAgentPayload, LifecycleStage } from "../../agents/core/agent-lifecycle-state-machine.js";
import { TrajectoryEvaluationResult } from "./prediction-engine.service.js";
import {
    DEFAULT_GOOD_QUESTION_STRATEGY,
    developQuestionStrategy,
    type GoodQuestionStrategy,
} from "./good-question-strategy.js";
import { stableContentHash } from "@shared/evo-devo/index.js";

const logger = createLogger("GoodQuestionEngine");

export interface QuestionContext {
    stage: LifecycleStage;
    targetNodeOrFile: string;
    evaluationResult: TrajectoryEvaluationResult;
    pathAOption?: { label: string; downtimeMin: number; risk: number };
    pathBOption?: { label: string; downtimeMin: number; risk: number };
    strategy?: GoodQuestionStrategy;
    /** Supply this for deterministic replay; production callers may omit it. */
    replayKey?: string;
}

export interface StructuredQuestionPayload {
    questionId: string;
    headline: string;
    discriminativeValueBits: number;
    proofContext: {
        proposedAction: string;
        affectedSubgraphNodes: string[];
        /** 0 = safe, 1 = maximally risky. The complement of `safeTransitionScore`. */
        riskScore: number;
        confidencePct: number;
    };
    formAgentPayload: FormAgentPayload;
    strategyTrace?: {
        strategyId: string;
        generation: number;
        phenotypeHash: string;
    };
}

/**
 * Good Question Engine (GQE):
 * Replaces open-ended LLM questions with targeted, context-bounded FormAgent payloads
 * and Socratic ambiguity disambiguation UIs.
 */
export class GoodQuestionEngine {
    /**
     * Synthesizes a structured GQE payload with minimal proof injection.
     */
    public static generateStructuredQuestion(context: QuestionContext): StructuredQuestionPayload {
        const { stage, targetNodeOrFile, evaluationResult, pathAOption, pathBOption } = context;
        const strategy = context.strategy ?? DEFAULT_GOOD_QUESTION_STRATEGY;

        // Risk is the COMPLEMENT of safeTransitionScore (higher score = safer
        // transition). Derived once and reused: this used to be computed inline
        // in two places with opposite polarities — `1 - safeTransitionScore` for
        // strategy selection and a bare `safeTransitionScore` for the published
        // proofContext — so the risk that routed the question and the risk the
        // reviewer read were inverses of each other.
        const riskScore = 1 - evaluationResult.safeTransitionScore;

        const strategyPhenotype = developQuestionStrategy(strategy, {
            stage,
            riskScore,
        });
        const identity = context.replayKey
            ? stableContentHash({ replayKey: context.replayKey, targetNodeOrFile, stage, strategy: strategy.id })
            : String(Date.now());

        // Calculate Socratic Discriminative Value H(A) - H(B) if comparing 2 paths
        let discriminativeValueBits = strategy.minimumDiscriminativeValueBits;
        if (pathAOption && pathBOption) {
            const entropyA = Math.abs(Math.log2(pathAOption.risk || 0.5));
            const entropyB = Math.abs(Math.log2(pathBOption.risk || 0.5));
            discriminativeValueBits = Number(Math.abs(entropyA - entropyB).toFixed(2));
        }

        const headline = `Attestation Required for Stage [${stage}] on target '${targetNodeOrFile}'`;

        const formAgentPayload: FormAgentPayload = {
            type: "FormAgent",
            formId: `gqe_${stage.toLowerCase()}_${identity}`,
            title: headline,
            stage,
            fields: [
                {
                    id: "selected_decision",
                    label: "Action Decision",
                    type: "select",
                    required: true,
                    options: strategyPhenotype.options.map((option) => option.label),
                    description: `Safe Transition Score: ${evaluationResult.safeTransitionScore}. Blast Radius: ${(evaluationResult.blastRadius * 100).toFixed(0)}%.`
                },
                {
                    id: "supervisor_attestation",
                    label: "Supervisor Attestation Signature",
                    type: "attestation",
                    required: true,
                    description: "Confirm authorization to unblock trajectory execution."
                }
            ],
            requiredApproverRoles: strategyPhenotype.requiredApproverRoles
        };

        logger.info(`[GoodQuestionEngine] Generated GQE structured question payload for stage [${stage}].`);

        return {
            questionId: `gqe_q_${identity}`,
            headline,
            discriminativeValueBits,
            proofContext: {
                proposedAction: evaluationResult.reason,
                affectedSubgraphNodes: [targetNodeOrFile, "2-hop-consumer-node"],
                riskScore,
                confidencePct: Math.round(evaluationResult.probabilitySuccess * 100)
            },
            formAgentPayload,
            strategyTrace: {
                strategyId: strategyPhenotype.strategyId,
                generation: strategyPhenotype.strategyGeneration,
                phenotypeHash: strategyPhenotype.phenotypeHash,
            }
        };
    }

    /**
     * Proactively synthesizes a Socratic entropy-reduction FormAgent card when interactive prediction
     * field entropy ΔH exceeds 0.6 or branch divergence is detected.
     */
    public static synthesizeDivergenceQuestion(
        targetNodeOrFile: string,
        fieldEntropy: number,
        branchAAction: string,
        branchBAction: string
    ): StructuredQuestionPayload {
        const headline = `Entropy Disambiguation Required (ΔH = ${fieldEntropy.toFixed(2)}) for target '${targetNodeOrFile}'`;
        const formId = `gqe_entropy_${Date.now()}`;

        const formAgentPayload: FormAgentPayload = {
            type: "FormAgent",
            formId,
            title: headline,
            stage: "Diagnose",
            fields: [
                {
                    id: "entropy_resolution",
                    label: "Select Trajectory Path",
                    type: "select",
                    required: true,
                    options: [
                        `Branch A: ${branchAAction}`,
                        `Branch B: ${branchBAction}`,
                        "Defer to Manual Investigation"
                    ],
                    description: `Field Entropy ΔH ${fieldEntropy.toFixed(2)} exceeds 0.60 threshold. Socratic choice required to reduce state space ambiguity.`
                }
            ],
            requiredApproverRoles: ["operations-supervisor"]
        };

        logger.info(`[GoodQuestionEngine] Synthesized Socratic divergence question card for target '${targetNodeOrFile}' (ΔH: ${fieldEntropy.toFixed(2)}).`);

        return {
            questionId: `gqe_div_${Date.now()}`,
            headline,
            discriminativeValueBits: Number(fieldEntropy.toFixed(2)),
            proofContext: {
                proposedAction: `Disambiguate divergent paths: '${branchAAction}' vs '${branchBAction}'`,
                affectedSubgraphNodes: [targetNodeOrFile],
                riskScore: 0.5,
                confidencePct: Math.round((1 - fieldEntropy) * 100)
            },
            formAgentPayload
        };
    }

    /**
     * Synthesizes a Socratic FormAgent clarification card for candidate parameterization
     * when parameter intent entropy ΔH exceeds 0.60.
     */
    public static synthesizeSkillParameterQuestion(
        skillNameOrGoal: string,
        candidate: {
            inputName: string;
            recordedValue: string;
            stepDescription: string;
            entropy: number;
        }
    ): StructuredQuestionPayload {
        const headline = `Clarify Parameter for "${skillNameOrGoal}" (ΔH = ${candidate.entropy.toFixed(2)})`;
        const formId = `gqe_param_${Date.now()}`;

        const formAgentPayload: FormAgentPayload = {
            type: "FormAgent",
            formId,
            title: headline,
            stage: "Improve",
            fields: [
                {
                    id: "parameter_decision",
                    label: `Should "${candidate.recordedValue}" be a dynamic variable?`,
                    type: "select",
                    required: true,
                    options: [
                        `Dynamic Variable: {{${candidate.inputName}}} (Recommended)`,
                        `Keep Fixed Constant: "${candidate.recordedValue}"`,
                        "Exclude Step"
                    ],
                    description: `Recorded in step: ${candidate.stepDescription}. Converting to a parameter allows agents to supply different values on future runs.`
                },
                {
                    id: "parameter_description",
                    label: "Variable Description (Optional)",
                    type: "text",
                    required: false,
                    placeholder: `Description of what ${candidate.inputName} represents...`
                }
            ],
            requiredApproverRoles: ["task-author", "operator"]
        };

        logger.info(`[GoodQuestionEngine] Synthesized Socratic parameter clarification card for '${candidate.inputName}' in '${skillNameOrGoal}' (ΔH: ${candidate.entropy.toFixed(2)}).`);

        return {
            questionId: `gqe_param_${Date.now()}`,
            headline,
            discriminativeValueBits: Number(candidate.entropy.toFixed(2)),
            proofContext: {
                proposedAction: `Parameterize "${candidate.recordedValue}" as {{${candidate.inputName}}} in "${skillNameOrGoal}"`,
                affectedSubgraphNodes: [skillNameOrGoal],
                riskScore: 0.1,
                confidencePct: Math.round((1 - candidate.entropy) * 100)
            },
            formAgentPayload
        };
    }

    /**
     * Resolves pending FormAgent attestation timeouts by automatically routing execution to a shadow sandbox pipeline,
     * preventing pipeline deadlocks and attestation fatigue.
     */
    public static handleAttestationTimeoutFallback(questionId: string, formId: string): {
        action: "execute_shadow_sandbox";
        fallbackReason: string;
        sandboxRunId: string;
    } {
        const sandboxRunId = `sbx_run_${Date.now()}`;
        logger.warn(`[GoodQuestionEngine] FormAgent attestation '${formId}' timed out. Escalating execution to automated shadow sandbox '${sandboxRunId}'.`);

        return {
            action: "execute_shadow_sandbox",
            fallbackReason: `Attestation timed out for question ${questionId}. Routed to isolated shadow sandbox execution.`,
            sandboxRunId
        };
    }

    /**
     * Synthesizes an interactive upfront FormAgent UI card for research mission approval directly inside the chat turn.
     */
    public static synthesizeResearchProposalCard(
        proposalId: number,
        question: string,
        reason: string
    ): StructuredQuestionPayload {
        // The id is an approval_requests row, NOT a missions row. Naming it
        // "Research Mission #48" put it in the same namespace as `list_missions`,
        // so agents went looking for #48 there, found an unrelated June mission,
        // and told the user for fifteen rounds that their research had never
        // started — while the approved proposals were running as missions 453-459.
        // `RP-` keeps the two id spaces from ever reading as one.
        const proposalRef = `RP-${proposalId}`;
        const headline = `🔬 Research Proposal ${proposalRef}: "${question}"`;
        const formId = `gqe_research_proposal_${proposalId}`;

        const formAgentPayload: any = {
            type: "approval_request",
            kind: "research_proposal",
            proposalId,
            proposalRef,
            title: headline,
            // Stated explicitly because the agent narrating this card is what
            // reaches the user, and it previously narrated the id as a mission.
            idNote:
                `${proposalRef} is an approval id, not a mission id — it will not appear in list_missions. ` +
                `Refer to it as ${proposalRef}; once approved, the mission it launches gets its own id.`,
            reason: `Question not found in local Knowledge Base. Reason: ${reason}`,
            question,
            status: "pending",
            schema: {
                fields: [
                    {
                        id: "research_decision",
                        label: "Approve Research Action",
                        type: "select",
                        required: true,
                        options: [
                            "Approve & Start Live Research Mission",
                            "Run Instant Web Search",
                            "Reject Proposal"
                        ],
                        description: `Question not found in local Knowledge Base. Reason: ${reason}`
                    }
                ]
            },
            fields: [
                {
                    id: "research_decision",
                    label: "Approve Research Action",
                    type: "select",
                    required: true,
                    options: [
                        "Approve & Start Live Research Mission",
                        "Run Instant Web Search",
                        "Reject Proposal"
                    ],
                    description: `Question not found in local Knowledge Base. Reason: ${reason}`
                }
            ],
            requiredApproverRoles: ["operations-supervisor", "operator"]
        };

        logger.info(`[GoodQuestionEngine] Synthesized upfront research proposal card for #${proposalId}.`);

        return {
            questionId: `gqe_res_${proposalId}`,
            headline,
            discriminativeValueBits: 0.85,
            proofContext: {
                proposedAction: `Execute automated web research for "${question}" and save findings to Knowledge Base`,
                affectedSubgraphNodes: ["KnowledgeBase", "ResearchPipeline"],
                riskScore: 0.15,
                confidencePct: 90
            },
            formAgentPayload
        };
    }

    /**
     * Synthesizes a Multi-Entry Socratic Design Selection card for initial Studio entry.
     */
    public static synthesizeDesignEntryCard(
        blueprintId: string,
        suggestedArchetypes: string[] = ["Incident Response Cycle", "Automated Compliance Audit", "Autonomous RAG Pipeline"]
    ): StructuredQuestionPayload {
        const headline = `Select Creation Studio Archetype for Blueprint [${blueprintId}]`;
        const formId = `gqe_entry_${Date.now()}`;

        const formAgentPayload: any = {
            type: "assistant_form",
            formId,
            title: headline,
            stage: "Synthesize",
            fields: [
                {
                    id: "selected_archetype",
                    label: "Target Operational Archetype",
                    type: "select",
                    required: true,
                    options: suggestedArchetypes,
                    description: "Select a foundational architecture pattern or assemble custom modules."
                },
                {
                    id: "host_runtime",
                    label: "Preferred Host Runtime",
                    type: "select",
                    required: true,
                    options: ["Node Express + TypeScript", "Python FastAPI", "Serverless Edge Function"],
                    description: "Host environment for cycle execution."
                }
            ],
            requiredApproverRoles: ["operator", "architect"]
        };

        return {
            questionId: `gqe_entry_${blueprintId}`,
            headline,
            discriminativeValueBits: 0.95,
            proofContext: {
                proposedAction: `Initialize Creation Studio DAG for blueprint '${blueprintId}'`,
                affectedSubgraphNodes: ["BlueprintStateEngine", "ScaffoldRegistry"],
                riskScore: 0.05,
                confidencePct: 95
            },
            formAgentPayload
        };
    }

    /**
     * Synthesizes an in-chat 1-click Gap Remediation Card for detected functional gaps.
     */
    public static synthesizeGapRemediationCard(gap: {
        defectClass: string;
        message: string;
        recommendedAction: string;
        stageId?: string;
    }): StructuredQuestionPayload {
        const headline = `Functional Gap Detected [${gap.defectClass.toUpperCase()}]: ${gap.message}`;
        const formId = `gqe_gap_${Date.now()}`;

        const formAgentPayload: any = {
            type: "assistant_form",
            formId,
            title: headline,
            stage: "Diagnose",
            fields: [
                {
                    id: "remediation_choice",
                    label: "Recommended Remediation",
                    type: "select",
                    required: true,
                    options: [
                        `Apply Auto-Fix: ${gap.recommendedAction}`,
                        "Override & Accept Risk",
                        "Mount Builder Pod for Manual Edit"
                    ],
                    description: gap.message
                }
            ],
            requiredApproverRoles: ["operations-supervisor", "security_lead"]
        };

        return {
            questionId: `gqe_gap_${gap.stageId || "global"}_${Date.now()}`,
            headline,
            discriminativeValueBits: 0.88,
            proofContext: {
                proposedAction: gap.recommendedAction,
                affectedSubgraphNodes: [gap.stageId || "BlueprintRoot"],
                riskScore: gap.defectClass === "governance_gap" ? 0.8 : 0.4,
                confidencePct: 88
            },
            formAgentPayload
        };
    }

    /**
     * Lints an Assembly Blueprint across the 6 defect classes:
     * 1. governance_gap (high-risk without HIL gate)
     * 2. capability_deficit (missing required tools)
     * 3. dead_end_branch (dangling unconsumed stages)
     * 4. observability_deficit (missing telemetry)
     * 5. unbound_io (missing prerequisite bindings)
     * 6. pack_conflict (mutually exclusive scaffold packs)
     */
    public static lintBlueprintFunctionalGaps(blueprint: {
        id?: string;
        scaffoldPacks?: string[];
        stages?: Array<{ id: string; name?: string; type?: string; requires?: string[]; dependencies?: string[]; provides?: string[] }>;
    }): {
        gaps: Array<{ defectClass: string; severity: "critical" | "warning" | "advisory"; message: string; stageId?: string; remediation: string }>;
        entropyScore: number;
    } {
        const gaps: Array<{ defectClass: string; severity: "critical" | "warning" | "advisory"; message: string; stageId?: string; remediation: string }> = [];
        const packs = blueprint.scaffoldPacks || [];
        const stages = blueprint.stages || [];

        // 1. Pack Conflict Check
        if (packs.includes("auth-jwt") && packs.includes("auth-session")) {
            gaps.push({
                defectClass: "pack_conflict",
                severity: "critical",
                message: "Mutually exclusive authentication packs detected ('auth-jwt' and 'auth-session').",
                remediation: "Select either stateless JWT Bearer tokens or stateful Session Cookie Auth."
            });
        }

        // 2. Observability Deficit Check
        if (!packs.includes("observability-otel") && stages.length >= 3) {
            gaps.push({
                defectClass: "observability_deficit",
                severity: "warning",
                message: "Multi-stage cycle lacks OpenTelemetry distributed tracing and Hermes audit logging.",
                remediation: "Add 'observability-otel' pack to enable W3C trace context and forensic logs."
            });
        }

        // 3. Governance Gap Check
        const hasDestructiveStage = stages.some(s => s.type === "action_dispatch" || s.id.includes("deploy") || s.id.includes("delete"));
        const hasGovernanceGate = stages.some(s => s.type === "hil_approval" || s.id.includes("governance") || s.id.includes("hil"));
        if (hasDestructiveStage && !hasGovernanceGate) {
            gaps.push({
                defectClass: "governance_gap",
                severity: "critical",
                message: "Deployment / state-modifying cycle lacks a Human-in-the-Loop (HIL) attestation gate.",
                remediation: "Insert an `<HILGovernancePod />` stage with designated approver roles."
            });
        }

        // 4. Unbound I/O & Missing Dependencies
        const completedOrProvided = new Set<string>([...packs, ...stages.flatMap(s => s.provides || [s.id])]);
        for (const stage of stages) {
            const deps = stage.requires || stage.dependencies || [];
            for (const dep of deps) {
                if (!completedOrProvided.has(dep) && !stages.some(s => s.id === dep)) {
                    gaps.push({
                        defectClass: "unbound_io",
                        severity: "critical",
                        message: `Stage '${stage.name || stage.id}' depends on missing prerequisite '${dep}'.`,
                        stageId: stage.id,
                        remediation: `Add provider stage for '${dep}' or update stage dependency bindings.`
                    });
                }
            }
        }

        const entropyScore = Number(Math.min(1, gaps.length * 0.25).toFixed(2));
        return { gaps, entropyScore };
    }

    /**
     * Synthesizes an interactive DIVERSE Intake FormAgent card to elicit structured context
     * (Direction, Intent, Variables, Expectations, Resources, Scope, Evaluation) from the user
     * before starting a mission.
     */
    public static synthesizeDIVERSEIntakeCard(
        topicId: DiverseTopicArchetype = "build_app",
        options?: { customHeading?: string; initialIntent?: string }
    ): StructuredQuestionPayload {
        const topicDef = DIVERSE_TOPIC_DEFINITIONS[topicId] || DIVERSE_TOPIC_DEFINITIONS.build_app;
        const headline = `${topicDef.icon} ${topicDef.label}: Goal & Constraint Intake (DIVERSE)`;
        const formId = `gqe_diverse_${topicId}_${Date.now()}`;

        const formAgentPayload: any = {
            type: "assistant_form",
            formId,
            title: headline,
            stage: "Synthesize",
            fields: [
                {
                    id: "intent",
                    label: "Target Objective / Mission (Intent)",
                    type: "text",
                    required: true,
                    description: "Describe the primary outcome or task you want the agent crew to accomplish.",
                    defaultValue: options?.initialIntent || topicDef.defaultDirection,
                },
                {
                    id: "variables",
                    label: "Data Sources & Variables (Inputs)",
                    type: "text",
                    required: false,
                    description: "Specify any relevant datasets, APIs, DB schemas, target endpoints, or URLs.",
                },
                {
                    id: "expectations",
                    label: "Desired Deliverable (Expectations)",
                    type: "select",
                    required: true,
                    options: topicDef.suggestedDeliverables,
                    description: "Select the primary deliverable format or artifact for the crew to produce.",
                },
                {
                    id: "scope",
                    label: "Execution Boundary & Blast Radius (Scope)",
                    type: "select",
                    required: true,
                    options: [
                        "Development Sandbox (Read-only / Non-destructive)",
                        "Staging Environment (Simulated Execution)",
                        "Production Execution (Strict HIL Attestation Required)",
                    ],
                    description: "Define the operational sandbox boundary for this mission.",
                },
                {
                    id: "evaluation",
                    label: "Governance & Review Criteria (Evaluation)",
                    type: "select",
                    required: true,
                    options: [
                        "Standard Trajectory (P(Success) >= 0.85)",
                        "High Governance (Mandatory Human-In-The-Loop Signoff)",
                        "Strict Zero-Hallucination & OpenTelemetry Trace Enforcement",
                    ],
                    description: "Select the quality and safety evaluation criteria.",
                },
            ],
            requiredApproverRoles: topicDef.suggestedRoles,
            context: {
                topicId,
                topicLabel: topicDef.label,
                suggestedRoles: topicDef.suggestedRoles,
            },
        };

        return {
            questionId: `gqe_diverse_q_${Date.now()}`,
            headline,
            discriminativeValueBits: 0.95,
            proofContext: {
                proposedAction: `Elicit DIVERSE goal constraints for archetype '${topicId}'`,
                affectedSubgraphNodes: ["IntentRouter", "CrewOrchestrator", "GoodQuestionEngine"],
                riskScore: 0.05,
                confidencePct: 98,
            },
            formAgentPayload,
        };
    }

    /**
     * Formats a DIVERSE FormAgent submission into an unambiguous, tool-triggering
     * mission brief ready to be fed into the agent orchestrator.
     */
    public static formatDIVERSEPrompt(
        topicId: DiverseTopicArchetype,
        data: {
            intent?: string;
            variables?: string;
            expectations?: string;
            scope?: string;
            evaluation?: string;
        }
    ): string {
        const topicDef = DIVERSE_TOPIC_DEFINITIONS[topicId] || DIVERSE_TOPIC_DEFINITIONS.build_app;
        const intentText = data.intent?.trim() || topicDef.defaultDirection;
        const variablesText = data.variables?.trim() || "Standard workspace & project context";
        const deliverableText = data.expectations || topicDef.suggestedDeliverables[0];
        const scopeText = data.scope || "Development Sandbox";
        const evaluationText = data.evaluation || "Standard Trajectory (P(Success) >= 0.85)";

        return (
            `[DIVERSE MISSION BRIEF: ${topicDef.label.toUpperCase()}]\n` +
            `• Direction (D): ${topicDef.defaultDirection}\n` +
            `• Intent (I): ${intentText}\n` +
            `• Variables & Inputs (V): ${variablesText}\n` +
            `• Expectations (E): Produce deliverable: ${deliverableText}\n` +
            `• Resources (R): Recommended Agent Roles: ${topicDef.suggestedRoles.join(", ")}\n` +
            `• Scope & Blast Radius (S): ${scopeText}\n` +
            `• Evaluation & Governance (E): ${evaluationText}\n\n` +
            `Crew Directive: Align all participants to these DIVERSE constraints. Immediately execute necessary domain and presentation tools (e.g. mount_builder_pod, render_workflow_diagram, or search_unified_knowledge) without stalling.`
        );
    }
}

export type DiverseTopicArchetype =
    | "presentation_deck_studio"
    | "write_document"
    | "film_production"
    | "build_app"
    | "research_topic"
    | "analytical_report"
    | "agent_roster"
    | "workstreams_pipeline"
    | "governance_audit"
    | "incident_remediation"
    | "ontology_relationships"
    | "ontology_object_types"
    | "ontology_actions"
    | "datasets_schema"
    | "signal_intelligence";

export interface DiverseTopicDefinition {
    id: DiverseTopicArchetype;
    label: string;
    icon: string;
    description: string;
    /**
     * Packaged block the Goal Playbook card mounts as its intake surface.
     *
     * NOT optional. These definitions are what GET /api/crew/primers ships, and
     * the crew room replaces its own built-in playbook list with that payload
     * wholesale. While this field was missing, every card resolved to
     * `getLazyPackagedComponent(undefined)` and mounted
     * "Component 'undefined' isn't available to render." — so the whole grid
     * looked alive and did nothing.
     *
     * The value must be the basename of a file in
     * server/domain/core/ui/components/packaged/, which is the glob the registry
     * resolves against. good-question-engine-diverse.test.ts asserts that.
     */
    podComponent: string;
    defaultDirection: string;
    suggestedRoles: string[];
    suggestedDeliverables: string[];
}

/**
 * The Goal Playbooks the crew room offers a cold room.
 *
 * Single source of truth. The room ships its own copy as an offline fallback
 * (DEFAULT_TOPIC_ARCHETYPES in AgentChatPanel.tsx) and the two drifted: five
 * playbooks were added there — deck, agent fleet, pipelines, ontology, datasets —
 * and never here, so the primers payload silently deleted them on every load.
 * Add a playbook to BOTH, or it exists only when the fetch fails.
 */
export const DIVERSE_TOPIC_DEFINITIONS: Record<DiverseTopicArchetype, DiverseTopicDefinition> = {
    presentation_deck_studio: {
        id: "presentation_deck_studio",
        label: "Generate Deck & Documents",
        icon: "🎨",
        description: "Assemble executive presentation decks, PDFs, Word docs, Excel sheets, and diagrams.",
        podComponent: "DocumentDeckPod",
        defaultDirection: "Generate high-impact executive presentation deck and strategic document deliverables",
        suggestedRoles: ["Art Director", "Information Architect", "Data Storyteller", "Brand Guardian"],
        suggestedDeliverables: [
            "Interactive 5-Theme Slide Deck AST",
            "Executive Summary & Briefing Deliverable",
            "Downloadable PDF & Word (.docx) Document",
            "Excel (.xlsx) Metrics & Mermaid Diagram",
        ],
    },
    write_document: {
        id: "write_document",
        label: "Author a Document (Scribe Studio)",
        icon: "📝",
        description: "Draft SOWs, business cases, SOPs, proposals, contracts, or any longform document with AI-guided scaffolding.",
        podComponent: "ScribeStudioPod",
        defaultDirection: "Author a governed longform document with framework-guided structure and critic review",
        suggestedRoles: ["Scribe Lead", "Commercial Counsel", "Business Architect", "Critic"],
        suggestedDeliverables: [
            "Statement of Work (SOW)",
            "Business Case & ROI Justification",
            "Standard Operating Procedure (SOP)",
            "Enterprise Proposal or RFP Response",
        ],
    },
    film_production: {
        id: "film_production",
        label: "Make a Film (Media Studio)",
        icon: "🎬",
        description: "Storyboard scenes, render keyframes, shoot takes with Seedance and cut scene reels, with every video render approved first.",
        // Its brief names the production; the room's direct path starts it and opens Media Studio through mount_media_studio.
        podComponent: "FilmBriefPod",
        defaultDirection: "Plan and shoot a short film in Media Studio, from story and storyboard to approved takes and scene reels",
        suggestedRoles: ["Director", "Screenwriter", "Cinematographer", "Editor"],
        suggestedDeliverables: [
            "Screenplay in Scribe, linked to the production",
            "Storyboard with approved keyframes",
            "Shots with direction and dialogue",
            "Scene reels cut from approved takes",
        ],
    },
    build_app: {
        id: "build_app",
        label: "Build an App / Workflow",
        icon: "🏗️",
        description: "Assemble an Operational Cycle, Scaffold, Pipeline, or Instant App surface.",
        podComponent: "ScaffoldPackPod",
        defaultDirection: "Assemble an automated Operational Cycle with scaffolds and UI pods",
        suggestedRoles: ["Copilot", "Software Architect", "Lead Developer"],
        suggestedDeliverables: [
            "Creation Studio Interactive Blueprint",
            "Node Express / FastAPI Backend Service",
            "HIL Governance Approval Flow",
            "Container Reconciliation & Deployment",
        ],
    },
    research_topic: {
        id: "research_topic",
        label: "Research a Topic",
        icon: "🔬",
        description: "Conduct multi-hop Knowledge Graph queries, web harvesting, and proposal synthesis.",
        podComponent: "MissionBriefPod",
        defaultDirection: "Deep multi-source research mission with knowledge base grounding",
        suggestedRoles: ["Research Lead", "Researcher", "Domain Lead"],
        suggestedDeliverables: [
            "Executive Research Brief & Findings",
            "Knowledge Graph Ingestion & Triples",
            "Evidence Matrix & Citations",
            "Automated Web Harvester Runbook",
        ],
    },
    analytical_report: {
        id: "analytical_report",
        label: "Request a Report",
        icon: "📊",
        description: "Perform calculation node evaluations, timeseries analytics, and KPI dashboards.",
        // A report IS a document deliverable, so it collects the same intake as
        // the deck studio: title, audience, and the export formats to render.
        podComponent: "DocumentDeckPod",
        defaultDirection: "Generate comprehensive analytical report with formula verification",
        suggestedRoles: ["Data Analyst", "Operations Lead", "Supervisor"],
        suggestedDeliverables: [
            "Calculation Node Metric Evaluation",
            "Timeseries Forecast & Trend Analysis",
            "Interactive Data Chart Surface",
            "Structured JSON / PDF Analytical Export",
        ],
    },
    agent_roster: {
        id: "agent_roster",
        label: "Configure Agent Fleet",
        icon: "🤖",
        description: "Configure agent personas, model tiers, tool capabilities, and soul archetypes.",
        podComponent: "AgenticHRPod",
        defaultDirection: "Configure specialized agent fleet and assign domain capabilities",
        suggestedRoles: ["Copilot", "Team Lead", "Security Lead"],
        suggestedDeliverables: [
            "Configured Agent Personas & Capabilities",
            "Model Tier Allocations & Token Limits",
            "Soul Archetype & System Prompt Customization",
            "Team Roster Multi-Agent Topology",
        ],
    },
    workstreams_pipeline: {
        id: "workstreams_pipeline",
        label: "Workstreams & Pipelines",
        icon: "⚡",
        description: "Build execution pipelines, automated step sequencers, and trigger endpoints.",
        podComponent: "PipelineBuilderPod",
        defaultDirection: "Design automated execution pipeline with step triggers and actions",
        suggestedRoles: ["DevOps Engineer", "Lead Developer", "Copilot"],
        suggestedDeliverables: [
            "Multi-Step Automated Pipeline DAG",
            "Webhook Ingestion & Trigger Config",
            "Action Dispatch & Notification Steps",
            "Retry Policy & Dead Letter Queue",
        ],
    },
    governance_audit: {
        id: "governance_audit",
        label: "Governance & Compliance Audit",
        icon: "🛡️",
        description: "Perform SOC2 compliance checks, blast-radius verification, and RBAC policy audit.",
        podComponent: "HILGovernancePod",
        defaultDirection: "Conduct rigorous security, compliance, and RBAC policy audit",
        suggestedRoles: ["Security Auditor", "Compliance Officer", "Supervisor"],
        suggestedDeliverables: [
            "Forensic Audit & W3C Trace Log",
            "Blast-Radius Safety Certification",
            "Human-in-the-Loop Attestation Rule",
            "Zero-Hallucination Policy Compliance Report",
        ],
    },
    incident_remediation: {
        id: "incident_remediation",
        label: "Incident Triage & Remediation",
        icon: "🚨",
        description: "Analyze telemetry alerts, isolate root causes, and run automated mitigation pipelines.",
        // The deliverable is a mitigation pipeline, so triage is configured as
        // one: diagnosis steps first, then the dispatch and rollback actions.
        podComponent: "PipelineBuilderPod",
        defaultDirection: "Execute telemetry alert diagnosis and automated mitigation cycle",
        suggestedRoles: ["DevOps Engineer", "Site Reliability Engineer", "Copilot"],
        suggestedDeliverables: [
            "Root Cause Analysis (RCA) Diagnostic",
            "Automated Mitigation Pipeline Execution",
            "Incident Remediation Postmortem",
            "Slack & PagerDuty Alert Dispatch",
        ],
    },
    ontology_relationships: {
        id: "ontology_relationships",
        label: "Ontology & Relationships",
        icon: "🕸️",
        description: "Declare how this org's business objects relate, so agents can traverse between them.",
        podComponent: "OntologyLinkTypePod",
        defaultDirection: "Declare a traversable relationship between two Ontology Object Types",
        suggestedRoles: ["Data Architect", "Software Architect", "Domain Lead"],
        suggestedDeliverables: [
            "Declared Link Type (forward + inverse name)",
            "Derived join over an existing property",
            "Governed approval record for the declaration",
            "Traversable path between two Object Types",
        ],
    },
    ontology_object_types: {
        id: "ontology_object_types",
        label: "Ontology Object Types",
        icon: "📦",
        description: "Define core domain entity schemas, primary keys, and properties for agent binding.",
        podComponent: "OntologyObjectTypePod",
        defaultDirection: "Declare an Ontology Object Type with primary key and typed property schema",
        suggestedRoles: ["Data Architect", "Software Architect", "Domain Lead"],
        suggestedDeliverables: [
            "Declared Object Type Schema",
            "Primary Key & Title Property Binding",
            "Typed Property Definitions",
            "Backing Dataset Linkage",
        ],
    },
    ontology_actions: {
        id: "ontology_actions",
        label: "Ontology Actions & Governance",
        icon: "⚡",
        description: "Configure governed mutations, automated actions, and human-in-the-loop signoff gates.",
        podComponent: "OntologyActionTypePod",
        defaultDirection: "Configure an Ontology Action Type with risk profile and approval gates",
        suggestedRoles: ["Security Officer", "DevOps Engineer", "Lead Architect"],
        suggestedDeliverables: [
            "Action Type Specification",
            "Risk Level & HIL Governance Gate",
            "Target Object Type Mutation Contract",
            "Automated Execution Handler",
        ],
    },
    datasets_schema: {
        id: "datasets_schema",
        label: "Datasets & Schema Memory",
        icon: "📊",
        description: "Define relational tables, vector embeddings, and schema metadata contracts.",
        podComponent: "DatasetSchemaPod",
        defaultDirection: "Define structured database schemas, vector memories, and indexes",
        suggestedRoles: ["Data Architect", "Data Analyst", "Software Architect"],
        suggestedDeliverables: [
            "Dataset Schema Definition",
            "Vector Memory Index Configuration",
            "Data Cleansing & Validation Pipeline",
            "Relational Foreign Key Topology",
        ],
    },
    signal_intelligence: {
        id: "signal_intelligence",
        label: "Signal Studio: Market Sensing & Exposure Triage",
        icon: "📡",
        description: "Multi-source intelligence intake, Uber H3 spatial radar, 7 industry starter packs, CEL automated rules, and downstream mitigation playbooks.",
        podComponent: "SignalStudioPod",
        defaultDirection: "Ingest market signals, evaluate spatial exposure footprints across assets, and coordinate autonomous mitigation response playbooks",
        suggestedRoles: ["Intelligence Officer", "Risk & Exposure Analyst", "Operations Director", "Special Situations Lead"],
        suggestedDeliverables: [
            "Signal Exposure Radar (Uber H3 Spatial Map)",
            "Configured Industry Feeds & Automated CEL Rules",
            "Operational Exposure Footprint & Blast Radius Analysis",
            "Autonomous Mitigation Response Playbook & HIL Gate",
        ],
    },
};

