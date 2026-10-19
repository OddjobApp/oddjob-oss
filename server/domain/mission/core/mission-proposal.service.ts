import { v4 as uuidv4 } from "uuid";
import { db } from "@server/database_service.js";
import { approvalRequests, missions } from "@shared/schema/index.js";
import type { CapabilityContract } from "@shared/schema/missions/core.js";
import { eq } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { auditService } from "@domain/audit/core/audit-service.js";

const logger = createLogger("MissionProposal");

/**
 * Propose-and-approve for mission actions initiated from a conversational surface
 * (e.g. the Slack bot). The assistant never acts directly; it creates a *proposal*
 * (a pending `approvalRequests` row) that a human approves, at which point the
 * action runs. Two kinds:
 *   - "mission_proposal"  → launch an existing mission (P3)
 *   - "mission_synthesis" → synthesize a NEW mission via GMS when none fits (P4);
 *                           deployed as a DRAFT for human review before it can run.
 *
 * Reuses the existing `approvalRequests` store (also surfaces in the Decision Inbox).
 */
export interface MissionProposalContext {
    organizationId: number;
    missionId: number;
    requestedBy: string;
    reason: string;
    inputs?: Record<string, unknown>;
    channelId?: string;
    threadTs?: string;
    platform?: string;
}

export interface MissionSynthesisContext {
    organizationId: number;
    requestedBy: string;
    request: string;
    reason: string;
    channelId?: string;
    threadTs?: string;
    platform?: string;
}

export interface MissionResearchContext {
    organizationId: number;
    requestedBy: string;
    question: string;
    reason: string;
    topic?: string;
    channelId?: string;
    threadTs?: string;
    platform?: string;
    sessionKey?: string;
    originAgentCardId?: number;
    originAgentName?: string;
}

/** Best-effort mapping of a GMS blueprint's JSON-schema I/O into a CapabilityContract. */
function contractFromBlueprint(blueprint: any, sourceRequest: string): CapabilityContract {
    const propsToFields = (schema: any, required = false) => {
        const props = schema && typeof schema === "object" ? schema.properties ?? schema : {};
        const req: string[] = Array.isArray(schema?.required) ? schema.required : [];
        return Object.entries(props || {})
            .slice(0, 8)
            .map(([name, def]: [string, any]) => ({
                name,
                type: def?.type ?? "string",
                required: required ? req.includes(name) : undefined,
                description: def?.description,
            }));
    };
    return {
        purpose: blueprint?.description || blueprint?.name || sourceRequest,
        whenToUse: `Synthesized to handle: ${sourceRequest}`,
        inputs: propsToFields(blueprint?.inputSchema, true) as any,
        outputs: propsToFields(blueprint?.outputSchema) as any,
        costClass: "medium",
        generatedBy: "auto",
        generatedAt: new Date().toISOString(),
    };
}

async function insertRow(values: Record<string, any>): Promise<number> {
    const [row] = await db.insert(approvalRequests).values(values as any).returning({ id: approvalRequests.id });
    return row.id;
}

export const missionProposalService = {
    /** Propose launching an EXISTING mission. */
    async create(ctx: MissionProposalContext): Promise<{ proposalId: number; missionName: string }> {
        const [mission] = await db
            .select({ id: missions.id, name: missions.name, organizationId: missions.organizationId })
            .from(missions)
            .where(eq(missions.id, ctx.missionId))
            .limit(1);
        if (!mission) throw new Error(`Mission ${ctx.missionId} not found`);
        if (mission.organizationId !== ctx.organizationId) {
            throw new Error(`Mission ${ctx.missionId} does not belong to this organization`);
        }

        const proposalId = await insertRow({
            executionId: `mission_proposal_${uuidv4()}`,
            toolName: "launch_mission",
            toolArgs: { missionId: ctx.missionId, inputs: ctx.inputs ?? {} },
            approverType: "internal",
            approverEmail: ctx.requestedBy || "slack-channel",
            organizationId: ctx.organizationId,
            status: "pending",
            token: uuidv4(),
            modifiedOutput: {
                kind: "mission_proposal",
                missionId: ctx.missionId,
                missionName: mission.name,
                reason: ctx.reason,
                inputs: ctx.inputs ?? {},
                requestedBy: ctx.requestedBy,
                channelId: ctx.channelId,
                threadTs: ctx.threadTs,
                platform: ctx.platform ?? "slack",
            },
        });
        logger.info(`Created mission-launch proposal ${proposalId} for mission ${ctx.missionId} (org ${ctx.organizationId})`);
        return { proposalId, missionName: mission.name };
    },

    /** Propose SYNTHESIZING a new mission (via GMS) when no existing mission fits. */
    async createSynthesis(ctx: MissionSynthesisContext): Promise<{ proposalId: number }> {
        const proposalId = await insertRow({
            executionId: `mission_synthesis_${uuidv4()}`,
            toolName: "gms_synthesize_missions",
            toolArgs: { request: ctx.request },
            approverType: "internal",
            approverEmail: ctx.requestedBy || "slack-channel",
            organizationId: ctx.organizationId,
            status: "pending",
            token: uuidv4(),
            modifiedOutput: {
                kind: "mission_synthesis",
                request: ctx.request,
                reason: ctx.reason,
                requestedBy: ctx.requestedBy,
                channelId: ctx.channelId,
                threadTs: ctx.threadTs,
                platform: ctx.platform ?? "slack",
            },
        });
        logger.info(`Created mission-synthesis proposal ${proposalId} (org ${ctx.organizationId})`);
        return { proposalId };
    },

    /**
     * Propose running a RESEARCH mission for a question the assistant could not
     * answer. On approval a dynamic research mission runs, and its completion hook
     * (MissionLifecycleHooks) stores the answer in the knowledge base and posts an
     * update to Assistant Updates.
     */
    async createResearch(ctx: MissionResearchContext): Promise<{ proposalId: number }> {
        const proposalId = await insertRow({
            executionId: `research_mission_${uuidv4()}`,
            toolName: "launch_research_mission",
            toolArgs: { question: ctx.question, topic: ctx.topic ?? null },
            approverType: "internal",
            approverEmail: ctx.requestedBy || "assistant",
            organizationId: ctx.organizationId,
            status: "pending",
            token: uuidv4(),
            modifiedOutput: {
                kind: "research_mission",
                question: ctx.question,
                topic: ctx.topic ?? null,
                reason: ctx.reason,
                requestedBy: ctx.requestedBy,
                channelId: ctx.channelId,
                threadTs: ctx.threadTs,
                platform: ctx.platform ?? "web",
                sessionKey: ctx.sessionKey,
                originAgentCardId: ctx.originAgentCardId,
                originAgentName: ctx.originAgentName,
            },
        });
        logger.info(`Created research-mission proposal ${proposalId} (org ${ctx.organizationId})`);
        return { proposalId };
    },

    /**
     * Resolve a pending proposal. Reject marks it rejected. Approve runs the action:
     *  - mission_proposal  → launch the mission (records run id)
     *  - mission_synthesis → synthesize + deploy a DRAFT mission (records mission id)
     * Idempotent: resolving a non-pending proposal is a no-op.
     */
    async resolve(
        proposalId: number,
        decision: "approved" | "rejected",
        resolvedBy: string,
    ): Promise<{ status: string; kind?: string; missionRunId?: number; synthesizedMissionId?: number; missionName?: string; score?: number; error?: string }> {
        const [row] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, proposalId)).limit(1);
        if (!row) return { status: "not_found", error: `Proposal ${proposalId} not found` };
        if (row.status !== "pending") return { status: row.status };

        const meta: any = row.modifiedOutput ?? {};
        const kind: string = meta.kind;
        if (kind !== "mission_proposal" && kind !== "mission_synthesis" && kind !== "research_mission") {
            return { status: "invalid", error: "Not a mission proposal" };
        }

        if (decision === "rejected") {
            await db.update(approvalRequests).set({ status: "rejected" }).where(eq(approvalRequests.id, proposalId));
            logger.info(`Proposal ${proposalId} (${kind}) rejected by ${resolvedBy}`);
            return { status: "rejected", kind, missionName: meta.missionName };
        }

        if (kind === "mission_proposal") {
            return this.executeLaunch(proposalId, row, meta, resolvedBy);
        }
        if (kind === "research_mission") {
            return this.executeResearch(proposalId, row, meta, resolvedBy);
        }
        return this.executeSynthesis(proposalId, row, meta, resolvedBy);
    },

    async executeLaunch(proposalId: number, row: any, meta: any, resolvedBy: string) {
        try {
            const { missionService } = await import("../index.js");
            const result = await missionService.launchMission(
                meta.missionId,
                resolvedBy || "slack-approver",
                row.organizationId ?? null,
                undefined,
                { inputs: meta.inputs, source: "slack_proposal", proposalId },
            );
            if (!result.success) {
                logger.error(`Proposal ${proposalId} approved but launch failed: ${result.error}`);
                return { status: "approved", kind: "mission_proposal", missionName: meta.missionName, error: result.error };
            }
            await db
                .update(approvalRequests)
                .set({ status: "approved", modifiedOutput: { ...meta, missionRunId: result.missionRunId } as any })
                .where(eq(approvalRequests.id, proposalId));
            logger.info(`Proposal ${proposalId} approved by ${resolvedBy} → mission run ${result.missionRunId}`);
            // Assistant action log + undo hint (Hermes #5) — recorded to the shared audit log.
            void auditService.log({
                userId: resolvedBy || "assistant",
                organizationId: row.organizationId ?? undefined,
                action: "EXECUTE",
                entityType: "mission_run",
                entityId: String(result.missionRunId),
                metadata: {
                    source: "assistant_proposal",
                    proposalId,
                    missionId: meta.missionId,
                    missionName: meta.missionName,
                    undoHint: { kind: "mission_run", action: "cancel", targetId: result.missionRunId, how: "Stop/cancel the mission run to halt it." },
                },
            });
            return { status: "approved", kind: "mission_proposal", missionRunId: result.missionRunId, missionName: meta.missionName };
        } catch (e: any) {
            logger.error(`Proposal ${proposalId} launch error: ${e.message}`);
            return { status: "approved", kind: "mission_proposal", missionName: meta.missionName, error: e.message };
        }
    },

    async executeSynthesis(proposalId: number, row: any, meta: any, resolvedBy: string) {
        try {
            const { getGMSOrchestrator } = await import("@server/core/gms/api/gms-orchestrator.js");
            const orchestrator = await getGMSOrchestrator();
            const response = await orchestrator.synthesizeMissions({
                request: meta.request,
                context: { organizationId: row.organizationId, userId: resolvedBy },
                options: { nCandidates: 3, includeShadowValidation: false },
            } as any);

            const candidate: any = response?.topRecommendation ?? response?.candidates?.[0];
            if (!candidate?.blueprint) {
                return { status: "approved", kind: "mission_synthesis", error: "Synthesis returned no viable candidate." };
            }
            const blueprint = candidate.blueprint;
            const score: number | undefined = candidate.verifierScore?.successProbability;

            // Deploy as a DRAFT mission for human review (never auto-run a fresh synthesis).
            const [created] = await db
                .insert(missions)
                .values({
                    name: blueprint.name || `Synthesized: ${String(meta.request).slice(0, 60)}`,
                    description: blueprint.description ?? meta.request,
                    objective: blueprint.description ?? meta.request,
                    organizationId: row.organizationId,
                    type: "mission_based",
                    status: "draft",
                    executionStrategy: "dynamic_autonomous",
                    capabilityContract: contractFromBlueprint(blueprint, meta.request),
                    blackboard: { synthesizedBlueprint: blueprint, source: "gms_synthesis", proposalId } as any,
                } as any)
                .returning({ id: missions.id, name: missions.name });

            await db
                .update(approvalRequests)
                .set({ status: "approved", modifiedOutput: { ...meta, synthesizedMissionId: created.id, score } as any })
                .where(eq(approvalRequests.id, proposalId));
            logger.info(`Proposal ${proposalId} approved → synthesized draft mission ${created.id} (score ${score ?? "n/a"})`);
            // Assistant action log + undo hint (Hermes #5) — recorded to the shared audit log.
            void auditService.log({
                userId: resolvedBy || "assistant",
                organizationId: row.organizationId ?? undefined,
                action: "CREATE",
                entityType: "mission",
                entityId: String(created.id),
                metadata: {
                    source: "assistant_proposal",
                    proposalId,
                    missionName: created.name,
                    score,
                    undoHint: { kind: "mission", action: "delete_draft", targetId: created.id, how: "Delete the draft mission if unwanted." },
                },
            });
            return { status: "approved", kind: "mission_synthesis", synthesizedMissionId: created.id, missionName: created.name, score };
        } catch (e: any) {
            logger.error(`Proposal ${proposalId} synthesis error: ${e.message}`);
            return { status: "approved", kind: "mission_synthesis", error: e.message };
        }
    },

    /**
     * Approve → create and launch a dynamic research mission for the question.
     * The run is tagged `source: "copilot_research"` in its missionContext so the
     * mission lifecycle completion hook can persist findings to the KB and notify
     * the assistant. Never auto-runs without this human approval step.
     */
    async executeResearch(proposalId: number, row: any, meta: any, resolvedBy: string) {
        try {
            const { missionService } = await import("../index.js");
            const orgId = row.organizationId ?? null;
            const question: string = meta.question;
            const topic: string | undefined = meta.topic ?? undefined;

            // Scope the request with the KB question engine so the autonomous research targets
            // concrete sub-questions rather than a vague objective. Best-effort: on any failure
            // the mission still runs against the base objective.
            let scopingBlock = "";
            let scopingQuestions: string[] = [];
            try {
                if (orgId) {
                    const { knowledgeBaseQuestionEngineService } = await import("../../agents/core/knowledge-base-question-engine.service.js");
                    scopingQuestions = await knowledgeBaseQuestionEngineService.generateScopingQuestions(question, orgId, topic);
                    if (scopingQuestions.length > 0) {
                        scopingBlock = `\n\nAddress these specific sub-questions in your research:\n` +
                            scopingQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n");
                    }
                }
            } catch (err: any) {
                logger.warn(`Research proposal ${proposalId} scoping failed (non-fatal): ${err.message}`);
            }

            const objective =
                `Research the following question and produce a concise, well-sourced briefing that answers it: "${question}". ` +
                `Gather information from the web and any relevant internal knowledge, verify it, and synthesize a clear, self-contained answer. ` +
                `The final result will be saved to the organization's knowledge base${topic ? ` under the topic "${topic}"` : ""}.` +
                scopingBlock;

            // Create a dynamic (autonomous) research mission for this question.
            const mission = await missionService.createMission({
                name: `Research: ${String(question).slice(0, 60)}`,
                objective,
                organizationId: orgId,
                type: "mission_based",
                executionStrategy: "dynamic_autonomous",
                budgetLimitUsd: 25.0,
            }, resolvedBy || "assistant");

            // Launch, tagging the run so the completion hook can detect + persist it.
            const result = await missionService.launchMission(
                mission.id,
                resolvedBy || "assistant",
                orgId,
                undefined,
                {
                    source: "copilot_research",
                    question,
                    topic: topic ?? null,
                    requestedByUserId: meta.requestedBy,
                    scopingQuestions,
                    proposalId,
                    sessionKey: meta.sessionKey ?? null,
                    originAgentCardId: meta.originAgentCardId ?? null,
                    originAgentName: meta.originAgentName ?? null,
                },
            );

            if (!result.success) {
                logger.error(`Research proposal ${proposalId} approved but launch failed: ${result.error}`);
                return { status: "approved", kind: "research_mission", synthesizedMissionId: mission.id, error: result.error };
            }

            await db
                .update(approvalRequests)
                .set({ status: "approved", modifiedOutput: { ...meta, missionId: mission.id, missionRunId: result.missionRunId } as any })
                .where(eq(approvalRequests.id, proposalId));
            logger.info(`Research proposal ${proposalId} approved by ${resolvedBy} → mission ${mission.id} run ${result.missionRunId}`);
            void auditService.log({
                userId: resolvedBy || "assistant",
                organizationId: orgId ?? undefined,
                action: "EXECUTE",
                entityType: "mission_run",
                entityId: String(result.missionRunId),
                metadata: {
                    source: "assistant_research_proposal",
                    proposalId,
                    missionId: mission.id,
                    question,
                    undoHint: { kind: "mission_run", action: "cancel", targetId: result.missionRunId, how: "Stop/cancel the research mission run to halt it." },
                },
            });
            return { status: "approved", kind: "research_mission", missionRunId: result.missionRunId, synthesizedMissionId: mission.id };
        } catch (e: any) {
            logger.error(`Research proposal ${proposalId} error: ${e.message}`);
            return { status: "approved", kind: "research_mission", error: e.message };
        }
    },
};
