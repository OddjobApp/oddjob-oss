import { nodeRedisClient as sharedRedis } from "../../../domain/core/infrastructure/redis/redis-client.js";
import { messagingService } from "../../../domain/integrations/messaging-service.js";
import crypto from "crypto";
import { db } from "@server/database_service.js";
import { missions, missionMembers, approvalRequests, users } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";
import { generateExternalToken } from "../../../domain/core/auth/jwt.service.js";
import { TraceContext } from "@domain/core/infrastructure/tracing/trace-context.service.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("MoltProducer");

/**
 * Read-only research / knowledge-lookup tools that may be auto-approved when a
 * high-risk manifest step escalates as `SIG_USER_ALERT:<tool>`. These perform
 * NO writes, executions, or external side effects — they only search or read,
 * so a human approval adds latency with no decision to make (the org operator
 * opted these into auto-approval).
 *
 * INVARIANT: every entry must be side-effect-free. Tools that create, publish,
 * update, delete, execute, move money, or otherwise mutate state must NEVER be
 * listed here — they stay gated behind human review in `produce()`. By
 * convention the read-only tools are named `search_*` / `get_*` / `list_*` /
 * `explore_*` / `browse_*`; writers are `create_*` / `publish_*` / `update_*`.
 */
const READ_ONLY_SIG_TOOLS = new Set<string>([
    // Web research (read-only) — original allow-list
    "google_search",
    "browse_web",
    // Unified knowledge-base search
    "search_unified_knowledge",
    // Knowledge-graph & document search / lookups (all read-only)
    "search_knowledge_graph",
    "search_documents",
    "get_document_content",
    "get_documents_for_entity",
    "get_entity_details",
    "get_graph_statistics",
    "explore_relationships",
    "list_documents",
    "list_concepts",
    "neural_log_extractor",
    "NEURAL_LOG_EXTRACTOR",
    "gms_core_synthesizer",
    "GMS_CORE_SYNTHESIZER",
    "behavioral_resonance_detector",
    "BEHAVIORAL_RESONANCE_DETECTOR",
    // Mission, Cycle, & Resource Read-Only Lookups
    "list_missions",
    "get_mission",
    "list_hil_forms",
    "get_hil_form",
    "list_datasets",
    "get_dataset",
    "list_pipelines",
    "get_pipeline",
    "list_jobs",
    "get_job",
    "list_apps",
    "get_app",
    "list_agents",
    "get_agent",
    "list_projects",
    "get_project",
    "list_organizations",
    "get_organization",
    "get_cycle",
    "list_cycles",
]);

/**
 * Proposal-only tools that may be auto-approved when escalated as
 * `SIG_USER_ALERT:<tool>`. Unlike READ_ONLY_SIG_TOOLS these are NOT side-effect
 * free — they write a proposal row (and may notify) — but their ONLY effect is
 * to create a proposal that STILL requires a separate human approval before any
 * real action (research run, spend, KB write) happens. Requiring a preliminary
 * approval just to *raise* that proposal is redundant friction: the operator
 * ends up approving twice for a single decision. Auto-approving the tool call
 * here removes the first, redundant gate while leaving the real safety gate —
 * the proposal's own approval — fully intact.
 *
 * INVARIANT: every entry must be a `propose_*` tool whose downstream action is
 * itself human-gated (creates an approvalRequest / mission proposal that cannot
 * execute without a subsequent approval). A tool that performs the action
 * directly must NEVER be listed here — it belongs behind human review. Entries
 * are lowercased (matched against the lowercased tool name).
 */
const PROPOSAL_ONLY_SIG_TOOLS = new Set<string>([
    "propose_research_mission",   // createResearch → proposal; research runs only on approval
    "propose_mission",            // create → proposal; mission launches only on approval
    "propose_mission_synthesis",  // createSynthesis → proposal; on approval synthesizes a DRAFT for review
]);

/**
 * Pipeline execution tools that may be auto-approved when escalated as
 * `SIG_USER_ALERT:<tool>`. These tools have already completed input validation,
 * nonce verification, and access control checks before the SIG_USER_ALERT is
 * raised, making the secondary approval gate redundant friction. The downstream
 * pipeline executor enforces its own permission boundaries.
 *
 * INVARIANT: every entry must be a pipeline orchestration tool that performs its
 * own pre-execution validation (nonce, access control, parameter validation).
 * Raw state-mutating tools without such safeguards must NOT be listed here.
 */
const PIPELINE_EXECUTION_SIG_TOOLS = new Set<string>([
    "trigger_pipeline",   // nonce + access-control validated before SIG_USER_ALERT is raised
    "show_pipeline_input_form", // read-only form render — no side effects
    "get_pipeline_status",      // read-only status poll
]);

/**
 * A `SIG_USER_ALERT:<tool>` command is auto-approvable when its tool is either
 * side-effect-free (READ_ONLY_SIG_TOOLS), proposal-only with a preserved
 * downstream human gate (PROPOSAL_ONLY_SIG_TOOLS), or a pipeline execution tool
 * that performs its own pre-execution validation (PIPELINE_EXECUTION_SIG_TOOLS).
 */
export function isAutoApprovableSigTool(toolNameLower: string): boolean {
    return READ_ONLY_SIG_TOOLS.has(toolNameLower)
        || PROPOSAL_ONLY_SIG_TOOLS.has(toolNameLower)
        || PIPELINE_EXECUTION_SIG_TOOLS.has(toolNameLower);
}

export interface MoltEvent {
    type: string;
    payload: any;
    sessionId: string;
    timestamp: number;
    signature?: string;
}

export class MoltProducer {
    private redis = sharedRedis;
    private streamKey = "molt:events";
    private sessionId: string;
    private organizationId?: number;
    private missionId?: number;

    constructor(sessionId: string, organizationId?: number, missionId?: number) {
        this.sessionId = sessionId;
        this.organizationId = organizationId;
        this.missionId = missionId;
    }

    /** Redis key that tracks consecutive Consensus Timeouts for loop detection. */
    private timeoutCounterKey(): string {
        return `molt:timeout_count:${this.sessionId}`;
    }

    public getMissionId(): number | undefined {
        return this.missionId;
    }

    public getOrganizationId(): number | undefined {
        return this.organizationId;
    }

    private getSecret(): string {
        return process.env.SESSION_SECRET || "default-secret-at-least-32-chars-long-!!";
    }

    private signPayload(type: string, payload: any, timestamp: string): string {
        const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
        return crypto
            .createHmac('sha256', this.getSecret())
            .update(`${type}:${this.sessionId}:${payloadStr}:${timestamp}`)
            .digest('hex');
    }

    async publish(type: string, payload: any, traceContext?: TraceContext) {
        const validTypes = ['PROPOSAL', 'DECISION', 'VOTE', 'HEARTBEAT', 'AUDIT'];
        if (!validTypes.includes(type)) {
            throw new Error(`Invalid molt event type: ${type}`);
        }

        const timestamp = Date.now().toString();
        const signature = this.signPayload(type, payload, timestamp);

        const id = await this.redis.xadd(
            this.streamKey,
            '*',
            'type', type,
            'sessionId', this.sessionId,
            'payload', typeof payload === 'string' ? payload : JSON.stringify(payload),
            'timestamp', timestamp,
            'signature', signature,
            'traceparent', traceContext?.traceId || '',
            'tracestate', traceContext?.spanId || ''
        );
        if (!id) throw new Error("Failed to publish molt event");
        return id;
    }

    verify(type: string, payload: any, timestamp: string, signature: string): boolean {
        const expectedSignature = this.signPayload(type, payload, timestamp);

        try {
            return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
        } catch (err) {
            return false;
        }
    }

    /**
     * Creates a new proposal and shadow approval_request.
     */
    async createProposal(command: string, context: any, traceContext?: TraceContext): Promise<{ proposalId: string; shadowApprovalId?: number }> {
        // 1. Publish PROPOSAL
        const proposalId = await this.publish('PROPOSAL', { command, context }, traceContext);
        logger.info(`[MoltProducer] Proposal ${proposalId} published: ${command}`);

        // Check if this is a safe command that should be auto-approved.
        // Auto-approval covers read-only lookup tools (READ_ONLY_SIG_TOOLS) and
        // proposal-only tools whose real action stays human-gated downstream
        // (PROPOSAL_ONLY_SIG_TOOLS); any tool that acts directly stays human-gated.
        const isSafeCommand = command.startsWith("SIG_USER_ALERT:") &&
            isAutoApprovableSigTool(command.substring("SIG_USER_ALERT:".length).toLowerCase());

        if (isSafeCommand) {
            logger.info(`[MoltProducer] Auto-approving safe command: ${command}`);
            await this.publish('DECISION', {
                proposalId,
                command,
                approved: true,
                reason: "Auto-approved safe tool execution"
            }, traceContext);
        }

        // Hack for PoC: Store in local map so API can serve it
        const { pendingDecisions } = await import("../../../routes/agent-decision.js");

        logger.info(`[MoltProducer] Setting pending decision for session: ${this.sessionId}`);

        // 1.2 Create a shadow approval_request for database visibility & standard UI integration
        let shadowApprovalId: number | undefined;
        try {
            // Enhanced parsing: handle pipeline:123, job:456, or just a raw numeric ID
            const sessionParts = this.sessionId.split(':');
            const tail = sessionParts[sessionParts.length - 1];
            const executionId = (tail && !isNaN(Number(tail))) ? tail : "0";
            const jobId = context.jobId || 0;

            // Determine correct approver email
            let approverEmail = "admin@example.com"; // Verified admin fallback
            let approverId: string | null = null;

            if (this.missionId) {
                const [mission] = await db.select({ 
                    createdBy: missions.createdBy 
                }).from(missions).where(eq(missions.id, this.missionId)).limit(1);
                
                if (mission?.createdBy) {
                    const [creator] = await db.select({ 
                        email: users.email, 
                        id: users.id 
                    }).from(users).where(eq(users.id, mission.createdBy)).limit(1);
                    
                    if (creator?.email) {
                        approverEmail = creator.email;
                        approverId = creator.id;
                    }
                }
            }

            // Generate Token for external compatibility
            const token = generateExternalToken({
                executionId,
                formId: 0,
                email: approverEmail,
                role: 'internal',
                // @ts-ignore
                context: { ...context, sessionId: this.sessionId, proposalId }
            });

            const [request] = await db.insert(approvalRequests).values({
                executionId: this.sessionId, // Keep full session ID (e.g. pipeline:76) for better matching
                jobId: Number(jobId),
                approverType: 'internal',
                approverId: approverId,
                approverEmail: approverEmail,
                status: isSafeCommand ? 'approved' : 'pending',
                decisionAt: isSafeCommand ? new Date() : null,
                token,
                modifiedOutput: { 
                    moltSessionId: this.sessionId, 
                    proposalId,
                    command,
                    context 
                } as any
            }).returning();
            shadowApprovalId = request.id;
            logger.info(`[MoltProducer] Shadow approval_request ${shadowApprovalId} created for session ${this.sessionId}`);
        } catch (err) {
            logger.error("[MoltProducer] Failed to create shadow approval_request:", err);
        }

        if (isSafeCommand) {
            return { proposalId, shadowApprovalId };
        }

        pendingDecisions.set(this.sessionId, {
            proposalId,
            command,
            context,
            timestamp: Date.now(),
            shadowApprovalId
        });

        // 1.5 Notify external messaging providers (Slack/Teams) for human-in-the-loop
        try {
            const host = process.env.PUBLIC_URL || "http://localhost:5000";
            let missionContext = "";
            let strategists: string[] = [];

            if (this.missionId) {
                // Find mission strategists/owners
                const [mission] = await db.select().from(missions).where(eq(missions.id, this.missionId)).limit(1);
                if (mission) {
                    missionContext = ` for Mission "${mission.name}"`;
                }

                const members = await db.select()
                    .from(missionMembers)
                    .where(and(
                        eq(missionMembers.missionId, this.missionId),
                        eq(missionMembers.role, 'primary_strategist')
                    ));

                if (members.length > 0) {
                    strategists = members.map(m => m.entityId.toString());
                } else if (mission.createdBy) {
                    // Fallback to mission owner (creator)
                    strategists = [mission.createdBy];
                }
            }

            const mentionStr = strategists.length > 0
                ? `\nCC: ${strategists.map(s => `@${s}`).join(', ')}`
                : "";

            await messagingService.notify({
                title: `🚨 Agent Approval Required${missionContext}`,
                body: `Agent is requesting permission to execute: \`${command}\`${mentionStr}`,
                severity: 'warning',
                metadata: { sessionId: this.sessionId, proposalId, command, missionId: this.missionId },
                actions: [
                    {
                        label: "Approve",
                        actionId: `molt:approve:${this.sessionId}`,
                        style: 'primary'
                    },
                    {
                        label: "Reject",
                        actionId: `molt:reject:${this.sessionId}`,
                        style: 'danger'
                    },
                    {
                        label: "View Context",
                        url: `${host}/agent/decision?session=${this.sessionId}`
                    }
                ]
            }, this.organizationId);
        } catch (err) {
            logger.error("[MoltProducer] Failed to send external notification:", err);
        }

        return { proposalId, shadowApprovalId };
    }

    /**
     * Polls for a DECISION on a specific proposal.
     */
    async waitForDecision(proposalId: string, command: string, timeoutMs: number = 3600000): Promise<{ approved: boolean; reason?: string }> {
        const startTime = Date.now();
        logger.debug(`[MoltProducer] Starting poll loop for proposalId=${proposalId}.`);

        return new Promise((resolve, reject) => {
            const checkInterval = setInterval(async () => {
                const elapsed = Date.now() - startTime;

                if (elapsed % 5000 < 200) {
                    logger.debug(`[MoltProducer] Check. Elapsed: ${elapsed}ms / ${timeoutMs}ms`);
                }

                if (elapsed > timeoutMs) {
                    logger.debug(`[MoltProducer] Timeout reached!`);
                    clearInterval(checkInterval);

                    // Clear pending
                    const { pendingDecisions } = await import("../../../routes/agent-decision.js");
                    pendingDecisions.delete(this.sessionId);

                    // Track consecutive timeouts for loop-detection.
                    const counterKey = this.timeoutCounterKey();
                    const newCount = await this.redis.incr(counterKey).catch(() => 1);
                    // TTL: 1 hour — prevents stale counts across long pauses.
                    await this.redis.expire(counterKey, 3600).catch(() => {});

                    let reason: string;
                    if (newCount >= 2) {
                        reason = (
                            `Consensus Timeout (repeated ${newCount}×). ` +
                            `Do NOT repeat the same generic timeout message. Instead, ask the user a single, targeted question: ` +
                            `what specific information or clarification is needed to proceed with this action? ` +
                            `If the action is no longer needed, say so and stop waiting.`
                        );
                    } else {
                        reason = 'Consensus Timeout';
                    }

                    resolve({ approved: false, reason });
                    return;
                }

                try {
                    const messages = await this.redis.xrange(this.streamKey, proposalId, '+');

                    for (const [id, fields] of messages) {
                        const fieldMap = new Map<string, string>();
                        for (let i = 0; i < fields.length; i += 2) {
                            fieldMap.set(fields[i], fields[i + 1]);
                        }

                        if (fieldMap.get('type') === 'DECISION') {
                            const payloadStr = fieldMap.get('payload');
                            const payload = payloadStr ? JSON.parse(payloadStr) : {};

                            if (payload.proposalId === proposalId || payload.command === command) {
                                logger.debug(`[MoltProducer] MATCH FOUND for ${proposalId}! Approved: ${payload.approved}`);
                                clearInterval(checkInterval);
                                // Clear pending
                                const { pendingDecisions } = await import("../../../routes/agent-decision.js");
                                pendingDecisions.delete(this.sessionId);

                                // Reset timeout counter on any real decision (approved or rejected).
                                await this.redis.del(this.timeoutCounterKey()).catch(() => {});

                                resolve({
                                    approved: payload.approved === true,
                                    reason: payload.reason
                                });
                                return;
                            }
                        }
                    }
                } catch (error) {
                    console.error("Error polling Redis:", error);
                }
            }, 500); // Check every 500ms
        });
    }

    /**
     * Kept for backward compatibility but calls the new methods.
     */
    async propose(command: string, context: any, timeoutMs: number = 10000, traceContext?: TraceContext): Promise<{ approved: boolean; reason?: string }> {
        const { proposalId } = await this.createProposal(command, context, traceContext);
        return this.waitForDecision(proposalId, command, timeoutMs);
    }

    /**
     * Stage 3: Produce (Execute Step)
     * Executes a manifest step through the Molt consensus system.
     * High-risk steps trigger a SIG_USER_ALERT proposal.
     */
    async produce(step: { id: string; tool: string; risk: string; description: string; params: any }, timeoutMs: number = 3600000): Promise<{ approved: boolean; reason?: string }> {
        const { missionCorrelationService } = await import("../../mission/core/mission-correlation.service.js");
        const metadata = missionCorrelationService.getEventMetadata();
        const traceContext = metadata.correlationId ? { traceId: metadata.correlationId, spanId: metadata.correlationId, traceFlags: '01', depth: 0 } : undefined;
        
        // Fast-path bypass for read-only lookup tools (no side effects) and
        // proposal-only tools whose real action stays human-gated downstream.
        if (step.tool && isAutoApprovableSigTool(step.tool.toLowerCase())) {
            logger.info(`[MoltProducer] Bypassing consensus risk check for auto-approvable tool: ${step.tool}`);
            return { approved: true };
        }

        if (step.risk === 'high') {
            logger.info(`[MoltProducer] High-risk step detected: ${step.id} (${step.tool}). Triggering SIG_USER_ALERT.`);
            return this.propose(`SIG_USER_ALERT:${step.tool}`, {
                type: "strategic_intervention",
                stepId: step.id,
                description: step.description,
                params: step.params,
                risk: step.risk,
                missionId: this.missionId
            }, timeoutMs, traceContext);
        }

        // For low/medium risk, just publish a HEARTBEAT to signal execution start
        await this.publish('HEARTBEAT', { 
            status: 'executing', 
            stepId: step.id, 
            tool: step.tool,
            timestamp: Date.now()
        }, traceContext);
        
        return { approved: true };
    }

    async disconnect() {
        // No-op since we're using sharedRedis
    }
}
