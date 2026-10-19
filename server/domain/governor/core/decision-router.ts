/**
 * Decision Router
 * 
 * Unified bridge between the Molt Protocol (Redis Streams) and the
 * approval_requests table (PostgreSQL). Persists every decision request
 * to the DB and fans out notifications across configured channels.
 * 
 * This replaces the direct MoltProducer.propose() call in ALM alerts
 * when supervision is "full", adding persistence and multi-channel support.
 */

import { db } from "@server/database_service.js";
import { approvalRequests, saasConnectors, jobs } from "@shared/schema/index.js";
import { MoltProducer } from "./molt-producer.js";
import { generateExternalToken } from "../../../domain/core/auth/jwt.service.js";
import { createLogger } from "@server/utils/logger.js";
import { eq, and } from "drizzle-orm";
import { formPublishingService } from "./form-publishing-service.js";
import { nodeRedisClient as sharedRedis, redisService } from "../../../domain/core/infrastructure/redis/redis-client.js";
import { randomUUID } from "crypto";

const logger = createLogger("DecisionRouter");

export type NotificationChannel = "copilot" | "inbox" | "slack" | "email" | "sms";

export interface DecisionNewPayload {
    type: 'decision:new';
    eventId: string;
    requestId: number;
    toolName: string;
    riskLevel: 'low' | 'medium' | 'high';
    description: string;
    missionId: number | null;
    createdAt: string;
}

export interface DecisionResolvedPayload {
    type: 'decision:resolved';
    eventId: string;
    requestId: number;
    newStatus: 'approved' | 'rejected' | 'snoozed';
    resolvedAt: string;
}

export type DecisionEventPayload = DecisionNewPayload | DecisionResolvedPayload;

/**
 * The predicates that constitute the active auto-approval policy.
 *
 * These names ARE the policy vocabulary. There is no rule engine behind this
 * gate — `governor_policy_rules` is never read here — so a policy comparison
 * has to cite a predicate name and a commit rather than a rule version.
 */
export type AutoApprovalPredicate =
    | "isTrustedSystemShell"
    | "isSafeDiagnosticShellCommand"
    | "isReadOnlyFileTool"
    | "isLowRiskRoutineTool"
    | "isAutoApprovedForgeBuild"
    | "isErrorReview"
    | "isSupervisorJob";

/**
 * What the active policy decided, and which rule decided it.
 *
 * The baseline for non-authorizing shadow comparison. `activePolicySource` is
 * always `"code"`: it is a standing reminder, in the data, that the "active
 * policy" is TypeScript at a commit and not a versioned rule record — so a
 * comparison artifact is never read as two rule versions being compared.
 */
export interface ActivePolicyDecision {
    decision: "auto_approve" | "route_to_human";
    decidingPredicate: AutoApprovalPredicate | null;
    reason: string | null;
    activePolicySource: "code";
    sourceCommit: string;
    sourceLocation: string;
}

export interface DecisionRequest {
    sessionId: string;
    jobId?: number;
    executionId?: string;

    // What needs approval
    tool: string;
    params: any;
    goal: string;
    riskLevel: "low" | "medium" | "high";
    description?: string;

    // Who should approve
    approverType: "internal" | "external";
    approverId?: string;
    approverEmail?: string;
    approverPhone?: string;

    // Routing
    channels: NotificationChannel[];
    timeoutMs?: number;
    isEvolutionary?: boolean;
    organizationId?: number;
    missionId?: number;
    noWait?: boolean;
    metadata?: Record<string, unknown>;
}

export interface DecisionResult {
    approved: boolean;
    snoozed?: boolean;
    snoozedUntil?: Date;
    reason?: string;
    source: "redis" | "db" | "timeout" | "auto" | "snooze";
    requestId?: number;
    modifiedOutput?: any;
}

export class DecisionRouter {
    private producer: MoltProducer | null = null;
    private redis = sharedRedis;
    private blockingClient: any = null;

    private async getBlockingClient() {
        if (!this.blockingClient) {
            const { Redis } = await import("ioredis");
            const { getRedisOptions } = await import("../../../domain/core/infrastructure/redis/redis-client.js");
            const url = process.env.REDIS_URL || "redis://127.0.0.1:6379";
            this.blockingClient = new Redis(url, { ...getRedisOptions(), connectionName: "oddjob:decision-router-blocking" });
        }
        return this.blockingClient;
    }

    /**
     * Notify any active DecisionRouter instances that a decision has been made.
     * This uses a Redis list as a notification bridge to avoid 500ms DB polling latency.
     */
    async notifyDecision(requestId: number): Promise<void> {
        try {
            const key = `decision:notify:${requestId}`;
            await this.redis.lpush(key, "ready");
            await this.redis.expire(key, 60); // TTL 1m in case of orphan notifications
            logger.info(`Decision notification sent for request ${requestId}`);
        } catch (err) {
            logger.error(`Failed to send decision notification for ${requestId}`, err);
        }
    }

    /**
     * Publish a decision event to Redis Pub/Sub for real-time SSE delivery.
     * Non-blocking: logs failure and continues without interrupting request flow.
     */
    private async publishDecisionEvent(
        type: 'decision:new' | 'decision:resolved',
        organizationId: number,
        payload: DecisionEventPayload
    ): Promise<void> {
        try {
            const channel = `decisions:${organizationId}`;
            await redisService.publisher.publish(channel, JSON.stringify(payload));
            logger.info(`[DecisionRouter] Published ${type} event to ${channel} (requestId=${payload.requestId})`);
        } catch (err) {
            logger.error(`[DecisionRouter] Failed to publish ${type} event for org ${organizationId}`, err);
            // Non-blocking: continue processing without interrupting request flow
        }
    }

    /**
     * Publish a decision:resolved event when an approval request transitions
     * from pending to approved/rejected/snoozed. Called by approval service
     * after status transition.
     */
    async publishResolution(
        requestId: number,
        organizationId: number,
        newStatus: 'approved' | 'rejected' | 'snoozed'
    ): Promise<void> {
        const payload: DecisionResolvedPayload = {
            type: 'decision:resolved',
            eventId: randomUUID(),
            requestId,
            newStatus,
            resolvedAt: new Date().toISOString(),
        };
        await this.publishDecisionEvent('decision:resolved', organizationId, payload);
    }

    // Only requests where the server itself sets approverId/approverEmail to 'system'
    // qualify as trusted system shells. Caller-controlled fields like sessionId
    // prefix or jobId absence are not reliable and are intentionally excluded.
    private static isTrustedSystemShell(tool: string, req: DecisionRequest): boolean {
        if (tool !== 'shell') return false;
        return req.approverId === 'system' || req.approverEmail === 'system';
    }

    // Commands that produce read-only system telemetry with no sensitive path access.
    // cat/tail/head are excluded — they read arbitrary file content. `env` and
    // `printenv` are excluded — in this process they print API keys, DATABASE_URL
    // and the JWT secret.
    private static readonly SAFE_DIAGNOSTIC_COMMANDS = new Set([
        'ps', 'uptime', 'whoami', 'pwd', 'date', 'hostname', 'uname',
        'free', 'df', 'top', 'netstat', 'ping', 'ls', 'lsof', 'wc',
    ]);

    private static readonly SENSITIVE_PATH =
        /(?:^|[\/\\])(?:etc|proc|sys|root)(?:[\/\\]|$)|shadow|passwd|\.ssh|\.env|\.aws|\.git-credentials|\.npmrc|id_rsa/i;

    private static isSafeDiagnosticShellCommand(tool: string, params: Record<string, unknown>): boolean {
        if (tool !== 'shell' || !params) return false;

        // Callers are inconsistent about the key, so three aliases are accepted. EVERY
        // alias that is present must pass on its own: reading them as a `??` chain let
        // an empty `command` (not nullish) win while `cmd` carried the real payload.
        const present = [params.command, params.CommandLine, params.cmd].filter(v => v !== undefined && v !== null);
        if (present.length === 0) return false;
        return present.every(raw => typeof raw === 'string' && DecisionRouter.isSafeDiagnosticCommandLine(raw));
    }

    private static isSafeDiagnosticCommandLine(raw: string): boolean {
        const command = raw.trim();
        // A blank command used to fall through every segment to `return true`.
        if (!command) return false;

        // The shell tool runs through child_process.exec — `/bin/sh -c`, or cmd.exe on
        // Windows. Each of these executes or discloses without the first token ever
        // leaving the allow-list: redirection and substitution; `$VAR` / `%VAR%`
        // expansion (`wc $DATABASE_URL` prints the secret in its error, `ping
        // %JWT_SECRET%` sends it out over DNS); cmd.exe's `^` escape; and a newline,
        // which is a command separator that the segment split below never saw, so
        // "ls\nrm -rf /" read as one `ls` segment.
        if (/[<>`$%^\r\n]/.test(command)) return false;

        const segments = command.split(/[|&;]/).map(s => s.trim());
        for (let i = 0; i < segments.length; i++) {
            if (!segments[i]) continue;
            const [name, ...args] = segments[i].split(/\s+/);
            if (args.some(arg => DecisionRouter.SENSITIVE_PATH.test(arg))) return false;

            const command = name.toLowerCase();
            if (command === 'grep') {
                // grep is only a filter over another allow-listed command's output
                // (`ps -ef | grep node`); as the first command it reads files.
                if (i === 0 || !DecisionRouter.isPipedGrepFilter(args)) return false;
                continue;
            }

            if (!DecisionRouter.SAFE_DIAGNOSTIC_COMMANDS.has(command)) return false;
            const unsafeArg = DecisionRouter.UNSAFE_DIAGNOSTIC_ARGS[command];
            if (unsafeArg && args.some(a => unsafeArg.test(a))) return false;
        }
        return true;
    }

    /**
     * Arguments that turn an allow-listed command into a file read or an environment
     * dump. The command allow-list alone is not enough: each of these auto-approved.
     */
    private static readonly UNSAFE_DIAGNOSTIC_ARGS: Record<string, RegExp> = {
        // `date -f FILE` parses FILE line by line and prints each unparseable line in
        // its error — i.e. the file.
        date: /^(?:-[a-zA-Z]*f|--file)/,
        // `hostname -F FILE` reads the name from FILE and echoes it back on failure.
        hostname: /^(?:-[a-zA-Z]*F|--file)/,
        // BSD-style ps options (no dash) containing `e` append every process's
        // ENVIRONMENT — this server's API keys included: `ps auxe`, `ps eww`.
        // Dashed `-e` only means "every process" and stays allowed.
        ps: /^[a-zA-Z]*e[a-zA-Z]*$/,
        // `--files0-from=F` reads a list of names from F and echoes missing ones.
        wc: /^--files0-from/,
    };

    /**
     * An ALLOW-list for grep's arguments, replacing a deny-list of dangerous flags
     * that kept missing spellings: `-ER` walked past a lowercase-only recursion
     * class, and `-e.` / `--regexp=.` hid the pattern in a flag so a following
     * filename counted as the "pattern" operand.
     *
     * Allowed: boolean flags that only change matching or output, and exactly ONE
     * pattern — as the operand, or as the argument after a bare `-e`. With one
     * pattern and no other operand, grep can only read its piped stdin.
     */
    private static isPipedGrepFilter(args: string[]): boolean {
        let patterns = 0;
        for (let k = 0; k < args.length; k++) {
            const arg = args[k];
            if (arg === '-e') {
                if (k + 1 >= args.length) return false;
                patterns++;
                k++;
                continue;
            }
            if (arg.startsWith('-')) {
                if (!/^-[ivwxcnEFoqs]+$/.test(arg)) return false;
                continue;
            }
            patterns++;
        }
        return patterns === 1;
    }

    private static isReadOnlyFileTool(tool: string): boolean {
        // Pure read operations on files or in-mission blackboard state.
        // file_list + get_blackboard added per HIL frequency audit (100%
        // historical approval rate, never rejected).
        return tool === 'file_read'
            || tool === 'view_file'
            || tool === 'read_file'
            || tool === 'file_list'
            || tool === 'get_blackboard';
    }

    /**
     * Tools that have a perfect historical approval record across all orgs
     * and don't have privileged side effects worth gating:
     *   - browse_web / google_search: read-only external research
     *   - update_blackboard: writes to the mission's own scratch space
     *   - swarm_bid_approval: internal swarm coordination
     *
     * Added per HIL frequency audit — these were generating ~88 approval
     * requests with 100% approval rate, adding latency for no human value.
     */
    // Exact names after normalisation. Some of these used to match as SUBSTRINGS
    // (`includes('logextractor')`), so `delete_everything_log_extractor`
    // auto-approved. The request body is never consulted for the tool's identity:
    // an empty tool name used to fall back to caller-supplied `params.tool`.
    private static readonly LOW_RISK_ROUTINE_TOOLS = new Set([
        'browseweb', 'googlesearch', 'updateblackboard', 'swarmbidapproval',
        'neurallogextractor', 'gmscoresynthesizer', 'behavioralresonancedetector',
    ]);

    private static isLowRiskRoutineTool(tool: string): boolean {
        const normalized = String(tool ?? '').toLowerCase().replace(/[\s_\-]/g, '');
        return DecisionRouter.LOW_RISK_ROUTINE_TOOLS.has(normalized);
    }

    /**
     * Allow-list auto-approval for FORGE_BUILD_CONTAINER requests on
     * specific orgs (env: AUTO_APPROVE_FORGE_BUILD_ORG_IDS, comma-separated).
     * Skipped entirely when the env var is unset, so default behavior is
     * preserved. Use sparingly — these are high-risk container builds.
     *
     * Example: AUTO_APPROVE_FORGE_BUILD_ORG_IDS=287,42
     */
    private static isAutoApprovedForgeBuild(tool: string, req: DecisionRequest): boolean {
        if (tool !== "FORGE_BUILD_CONTAINER") return false;
        const raw = process.env.AUTO_APPROVE_FORGE_BUILD_ORG_IDS;
        if (!raw) return false;
        const allowList = raw.split(",").map(s => Number(s.trim())).filter(Number.isFinite);
        if (allowList.length === 0) return false;
        return req.organizationId != null && allowList.includes(req.organizationId);
    }

    // Scoped to the escalation tool. `params` is the caller's own body, and a bare
    // `params.type === "error_review"` clause used to auto-approve ANY tool that
    // carried the marker — `shell` with `rm -rf /` included. The only producer,
    // error-recovery.service's escalateToHIL, already sends tool "error_escalation".
    private static isErrorReview(tool: string): boolean {
        return tool === "error_escalation";
    }

    /**
     * The predicates that ARE the active auto-approval policy, in the exact
     * order they are evaluated.
     *
     * `governor_policy_rules` is not consulted anywhere in this file — the
     * active policy is this list, at whatever commit is deployed. Keeping the
     * order in one place is what lets the gate, the logged reason, and the
     * policy-baseline description below agree with each other. They previously
     * did not: the reason was a separate ternary in a different order, so a
     * request satisfying both `isTrustedSystemShell` and `isReadOnlyFileTool`
     * was gated by the former and reported as the latter, and
     * `isSafeDiagnosticShellCommand` — evaluated second — was only ever
     * reported as the final fallthrough.
     */
    private static autoApprovalPredicateOrder(
        request: DecisionRequest,
        isSupervisorJob: boolean,
    ): Array<{ name: AutoApprovalPredicate; matched: boolean; reason: () => string }> {
        return [
            {
                name: "isTrustedSystemShell",
                matched: DecisionRouter.isTrustedSystemShell(request.tool, request),
                reason: () => "trusted system shell",
            },
            {
                name: "isSafeDiagnosticShellCommand",
                matched: DecisionRouter.isSafeDiagnosticShellCommand(request.tool, request.params),
                reason: () => "safe diagnostic command",
            },
            {
                name: "isReadOnlyFileTool",
                matched: DecisionRouter.isReadOnlyFileTool(request.tool),
                reason: () => "read-only file/blackboard tool",
            },
            {
                name: "isLowRiskRoutineTool",
                matched: DecisionRouter.isLowRiskRoutineTool(request.tool),
                reason: () => `low-risk routine tool (${request.tool})`,
            },
            {
                name: "isAutoApprovedForgeBuild",
                matched: DecisionRouter.isAutoApprovedForgeBuild(request.tool, request),
                reason: () => `forge build allow-listed org ${request.organizationId}`,
            },
            {
                name: "isErrorReview",
                matched: DecisionRouter.isErrorReview(request.tool),
                reason: () => "error review auto-approved",
            },
            {
                name: "isSupervisorJob",
                matched: isSupervisorJob,
                reason: () => "supervisor/mission launcher job for TECHHEAD7",
            },
        ];
    }

    /**
     * Which predicate decided this request — the FIRST match in evaluation
     * order, so it names what the gate actually did rather than what a
     * separately-ordered list would have said.
     */
    static resolveAutoApprovalPredicate(
        request: DecisionRequest,
        isSupervisorJob: boolean,
    ): { predicate: AutoApprovalPredicate; reason: string } | null {
        const hit = DecisionRouter.autoApprovalPredicateOrder(request, isSupervisorJob).find(p => p.matched);
        return hit ? { predicate: hit.name, reason: hit.reason() } : null;
    }

    /**
     * Describe the active policy's decision for a normalized request, without
     * routing, persisting, or authorizing anything.
     *
     * This is the baseline a candidate policy is compared against. It exists
     * because there is no versioned rule text to quote: `activePolicySource` is
     * `"code"` precisely so a comparison artifact cannot be mistaken for two
     * compared rule versions.
     */
    static describeActivePolicyDecision(
        request: DecisionRequest,
        isSupervisorJob = false,
    ): ActivePolicyDecision {
        const hit = DecisionRouter.resolveAutoApprovalPredicate(request, isSupervisorJob);
        return {
            decision: hit ? "auto_approve" : "route_to_human",
            decidingPredicate: hit?.predicate ?? null,
            reason: hit?.reason ?? null,
            activePolicySource: "code",
            // No build SHA is stamped in this repo yet; report it honestly rather
            // than inventing a version for a policy that has none.
            sourceCommit: process.env.GIT_COMMIT_SHA?.trim() || "unstamped",
            sourceLocation: "server/domain/governor/core/decision-router.ts",
        };
    }

    /**
     * Route a decision request through configured channels.
     *
     * 1. Persist to approval_requests (durable)
     * 2. Publish to Redis Streams for real-time listeners
     * 3. Fan out notifications (email, slack, etc.)
     * 4. Wait for decision (poll DB + Redis)
     */
    async requestDecision(request: DecisionRequest): Promise<DecisionResult> {
        const timeoutMs = request.timeoutMs || 30000; // 30s default

        // `request.jobId &&` previously left this `number | boolean | undefined`,
        // which was invisible while the value was only used in a truthy context.
        const isSupervisorJob: boolean = request.organizationId === 291 && request.jobId != null && await (async (jobId: number) => {
            try {
                const [job] = await db.select({ type: jobs.type, name: jobs.name })
                    .from(jobs)
                    .where(eq(jobs.id, jobId))
                    .limit(1);
                return !!job && (job.type === 'supervisor' || job.name === 'Mission Launcher');
            } catch (err) {
                logger.error(`[DecisionRouter] Failed to check supervisor job status:`, err);
                return false;
            }
        })(request.jobId);

        // One resolution drives both the gate and the reported reason, so they
        // can no longer disagree about which rule fired.
        const autoApproval = DecisionRouter.resolveAutoApprovalPredicate(request, isSupervisorJob);

        if (autoApproval) {
            const reason = autoApproval.reason;
            logger.info(
                `[DecisionRouter] Auto-approving: tool=${request.tool}, predicate=${autoApproval.predicate}, reason=${reason}`,
            );
            return {
                approved: true,
                source: "auto",
                reason: `Auto-approved: ${reason}`,
            };
        }

        // 2. Persist to DB
        let requestId: number | undefined;
        let finalToken = "";
        try {
            const [row] = await db.insert(approvalRequests).values({
                executionId: request.executionId || `alm_${request.sessionId}_${Date.now()}`,
                jobId: request.jobId ?? null,
                toolName: request.tool,
                toolArgs: request.params,
                approverType: request.approverType,
                approverId: request.approverId || null,
                approverEmail: request.approverEmail || "admin@example.com",
                status: "pending",
                isEvolutionary: request.isEvolutionary || false,
                organizationId: request.organizationId || null,
                missionId: request.missionId || null,
                token: `pending-${randomUUID()}`, // Unique placeholder; replaced after requestId is known.
                modifiedOutput: {
                    tool: request.tool,
                    params: request.params,
                    goal: request.goal,
                    risk: request.riskLevel,
                    description: request.description,
                    moltSessionId: request.sessionId, // CRITICAL: Allow resumption feedback
                    governance: request.metadata ?? undefined,
                } as any
            }).returning();

            requestId = row.id;

            // Generate token for external access WITH the requestId
            finalToken = generateExternalToken({
                executionId: request.executionId || `alm_${Date.now()}`,
                formId: 0, // Using 0 as a flag for direct approval_request deep links
                requestId: requestId,
                email: request.approverEmail || "system",
                role: request.approverType,
            });

            // Update the row with the final token
            await db.update(approvalRequests).set({ token: finalToken }).where(eq(approvalRequests.id, requestId));

            logger.info(`Decision request ${requestId} created for ${request.tool} (${request.riskLevel} risk)`);

            // Publish decision:new event to Redis Pub/Sub for real-time SSE delivery
            if (request.organizationId != null) {
                const decisionNewPayload: DecisionNewPayload = {
                    type: 'decision:new',
                    eventId: randomUUID(),
                    requestId: requestId!,
                    toolName: (request.tool && request.tool !== "unknown") ? request.tool : "Approval Request",
                    riskLevel: request.riskLevel,
                    description: (request.description || request.goal || "").trim() || "Approval pending review",
                    missionId: request.missionId || null,
                    createdAt: new Date().toISOString(),
                };
                // Fire-and-forget: non-blocking publish within 100ms of DB write
                this.publishDecisionEvent('decision:new', request.organizationId, decisionNewPayload);
            }

            // 2b. If this is an input_request, publish to Forms Library for persistence/reuse
            // An input request naming an existing form (a pipeline step's) already has
            // its template. Publishing again created a template named after the tool,
            // "human_form_input", every time a step asked for input.
            if (request.params?.type === 'input_request' && request.params.fields && request.params.formId == null) {
                // The request's own organization first. Resolving only from jobId put the
                // form in whichever organization owned that job, and the MCP handler sent
                // jobId 1 for every request.
                let formOrgId: number | undefined = request.organizationId ?? undefined;
                if (formOrgId === undefined && request.jobId) {
                    const [jobRow] = await db.select({ organizationId: jobs.organizationId })
                        .from(jobs).where(eq(jobs.id, request.jobId)).limit(1);
                    formOrgId = jobRow?.organizationId ?? undefined;
                }
                if (formOrgId === undefined) {
                    logger.warn(`Input request ${requestId} has no organization; its form was not published to a library.`);
                } else {
                    await formPublishingService.publish(
                        request.params.pipelineName || request.tool,
                        request.params.fields,
                        formOrgId,
                        request.approverId
                    );
                }
            }
        } catch (err) {
            logger.error("Failed to persist decision request", err);
            // Fall through to Redis-only path
        }

        // 3. Publish to Redis for real-time listeners
        if (request.channels.includes("copilot") || request.channels.includes("inbox")) {
            try {
                this.producer = new MoltProducer(request.sessionId);
                const proposalId = await this.producer.publish("PROPOSAL", {
                    requestId,
                    tool: request.tool,
                    params: request.params,
                    goal: request.goal,
                    risk: request.riskLevel,
                    description: request.description,
                    channels: request.channels,
                });
                logger.info(`Decision published to Redis: ${proposalId}`);

                // 3b. Update DB record with proposalId for resumption bridge
                if (requestId) {
                    await db.update(approvalRequests)
                        .set({
                            modifiedOutput: {
                                ...request.params, // Include original params
                                moltSessionId: request.sessionId,
                                proposalId: proposalId,
                                tool: request.tool,
                                goal: request.goal,
                                risk: request.riskLevel,
                                description: request.description,
                                governance: request.metadata ?? undefined,
                            } as any
                        })
                        .where(eq(approvalRequests.id, requestId));
                }
            } catch (err) {
                logger.error("Failed to publish to Redis", err);
            }
        }

        // 4. Fan out to external channels
        await this.fanOutNotifications(request, finalToken, requestId);

        // 5. If noWait is requested, return immediately
        if (request.noWait) {
            return {
                approved: false,
                source: "db",
                requestId,
                modifiedOutput: request.params
            };
        }

        // 6. Wait for decision (poll DB)
        const decision = await this.waitForDecision(requestId, request.sessionId, timeoutMs);

        // 7. Fire-and-forget: detect repeated HIL approval patterns
        if (decision.approved && request.organizationId) {
            try {
                const { hilPatternDetectorService } = await import("@domain/agents/core/kb-extensions/index.js");
                const repositoryId = request.params?.repositoryId || "unknown";
                hilPatternDetectorService.onApproval(
                    request.organizationId,
                    repositoryId,
                    request.tool,
                    request.params || {},
                    request.missionId,
                    requestId
                ).catch(() => {});
            } catch {}
        }

        return decision;
    }

    /**
     * Fan out notifications to configured channels.
     */
    public async fanOutNotifications(
        request: DecisionRequest,
        token: string,
        requestId?: number
    ): Promise<void> {
        const baseUrl = process.env.APP_URL || "http://localhost:5000";

        for (const channel of request.channels) {
            try {
                switch (channel) {
                    case "email":
                        if (request.approverEmail) {
                            const { gmailService } = await import("../../../domain/integrations/gmail-service.js");
                            const hasGmail = await gmailService.loadCredentials(null);
                            if (hasGmail) {
                                const link = `${baseUrl}/external/task?token=${token}`;

                                await gmailService.sendHilNotification(
                                    null,
                                    request.approverEmail,
                                    link,
                                    {
                                        pipelineName: "Agent Decision",
                                        stepName: `${request.tool} approval`,
                                        formName: request.description || request.tool,
                                    }
                                );
                                logger.info(`Email notification sent to ${request.approverEmail}`);
                            }
                        }
                        break;

                    case "slack": {
                        // Resolve the org from the jobId, then find a Slack connector
                        let orgId: number | null = request.organizationId || null;
                        if (!orgId && request.jobId) {
                            const [jobRow] = await db.select({ organizationId: jobs.organizationId })
                                .from(jobs)
                                .where(eq(jobs.id, request.jobId))
                                .limit(1);
                            orgId = jobRow?.organizationId ?? null;
                        }

                        if (orgId) {
                            const [slackConnector] = await db.select()
                                .from(saasConnectors)
                                .where(and(eq(saasConnectors.orgId, orgId), eq(saasConnectors.platform, "slack")))
                                .limit(1);

                            if (slackConnector) {
                                const creds = slackConnector.credentials as any;
                                const slackToken = creds?.bot_token || creds?.api_token || creds?.token;
                                if (slackToken) {
                                    const { getSlackClient } = await import("../../integrations/slack-service.js");
                                    const slackClient = await getSlackClient(slackToken);

                                    const approvalLink = `${baseUrl}/external/task?token=${token}`;

                                    const riskEmoji = request.riskLevel === "high" ? "🔴" : request.riskLevel === "medium" ? "🟡" : "🟢";
                                    const messageText = `${riskEmoji} *Agent Decision Required*\n*Tool:* \`${request.tool}\`\n*Risk:* ${request.riskLevel}\n*Description:* ${request.description || request.goal}\n<${approvalLink}|Review & Approve>`;

                                    // Try to DM the approver by email lookup, fall back to a general channel
                                    let channelId: string | null = null;
                                    if (request.approverEmail) {
                                        const slackUser = await slackClient.lookupUserByEmail(request.approverEmail);
                                        channelId = slackUser?.id || null;
                                    }
                                    if (!channelId) {
                                        const channels = await slackClient.getChannels(1);
                                        channelId = channels?.[0]?.id || null;
                                    }

                                    if (channelId) {
                                        await slackClient.postMessage(channelId, messageText);
                                        logger.info(`Slack notification sent for decision ${requestId} to channel ${channelId}`);
                                    } else {
                                        logger.warn(`[DecisionRouter] Slack: no channel resolved for decision ${requestId}`);
                                    }
                                }
                            } else {
                                logger.warn(`[DecisionRouter] No Slack connector found for org ${orgId}`);
                            }
                        } else {
                            logger.warn(`[DecisionRouter] Slack: could not resolve org for jobId ${request.jobId}`);
                        }
                        break;
                    }

                    case "sms": {
                        const toNumber = request.approverPhone;
                        if (!toNumber) {
                            logger.warn(`[DecisionRouter] SMS: no approverPhone on decision ${requestId}`);
                            break;
                        }
                        let smsOrgId: number | null = request.organizationId || null;
                        if (!smsOrgId && request.jobId) {
                            const [jobRow] = await db.select({ organizationId: jobs.organizationId })
                                .from(jobs)
                                .where(eq(jobs.id, request.jobId))
                                .limit(1);
                            smsOrgId = jobRow?.organizationId ?? null;
                        }
                        const { getTwilioConfig, twilioRequest } = await import("../../tools/v1/capabilities/twilio-helpers.js");
                        const twilioConfig = await getTwilioConfig(smsOrgId);
                        if (!twilioConfig) {
                            logger.warn(`[DecisionRouter] SMS: Twilio not configured for org ${smsOrgId}`);
                            break;
                        }
                        const approvalLink = `${baseUrl}/external/task?token=${token}`;
                        const riskLabel = request.riskLevel === "high" ? "HIGH" : request.riskLevel === "medium" ? "MEDIUM" : "LOW";
                        const smsBody = `[Oddjob] Agent decision required (${riskLabel} risk): ${request.description || request.tool}. Approve at: ${approvalLink}`;
                        await twilioRequest(twilioConfig, "/Messages.json", {
                            To: toNumber,
                            From: twilioConfig.fromNumber,
                            Body: smsBody,
                        });
                        logger.info(`[DecisionRouter] SMS sent to ${toNumber} for decision ${requestId}`);
                        break;
                    }

                    case "copilot":
                    case "inbox":
                        // These are handled via Redis pub + DB polling
                        break;
                }
            } catch (err) {
                logger.error(`Failed to notify via ${channel}`, err);
            }
        }
    }

    /**
     * Poll DB for decision, falling back to Redis.
     */
    private async waitForDecision(
        requestId: number | undefined,
        sessionId: string,
        timeoutMs: number
    ): Promise<DecisionResult> {
        const startTime = Date.now();
        const notifyKey = requestId ? `decision:notify:${requestId}` : null;

        return new Promise(async (resolve) => {
            const check = async () => {
                if (requestId) {
                    try {
                        const [row] = await db.select()
                            .from(approvalRequests)
                            .where(eq(approvalRequests.id, requestId))
                            .limit(1);

                        if (row && row.status !== "pending") {
                            this.cleanup();
                            if (notifyKey) await this.redis.del(notifyKey).catch(() => {});
                            resolve({
                                approved: row.status === "approved",
                                snoozed: row.status === "snoozed",
                                snoozedUntil: row.snoozedUntil || undefined,
                                reason: row.comments || (row.status === "snoozed" ? "Snoozed by user" : undefined),
                                source: row.status === "snoozed" ? "snooze" : "db",
                                requestId,
                                modifiedOutput: row.modifiedOutput
                            });
                            return true;
                        }
                    } catch (err) {
                        logger.error("Failed to poll DB for decision", err);
                    }
                }
                return false;
            };

            // 1. Initial check
            if (await check()) return;

            // 2. Hybrid Waiting Strategy: Blocking Redis check + DB Polling Fallback
            const pollInterval = 5000; // Slower DB fallback since we have Redis signals now
            let isResolved = false;

            // Background DB fallback loop
            const fallbackInterval = setInterval(async () => {
                if (isResolved) return;
                if (Date.now() - startTime > timeoutMs) {
                    isResolved = true;
                    clearInterval(fallbackInterval);
                    this.cleanup();
                    if (notifyKey) await this.redis.del(notifyKey).catch(() => {});
                    resolve({ approved: false, reason: "Decision timeout", source: "timeout", requestId });
                    return;
                }
                if (await check()) {
                    isResolved = true;
                    clearInterval(fallbackInterval);
                }
            }, pollInterval);

            // Redis immediate wake-up loop
            while (!isResolved && Date.now() - startTime < timeoutMs) {
                if (!notifyKey) break;

                const remaining = Math.max(1, timeoutMs - (Date.now() - startTime));
                const waitSec = Math.ceil(Math.min(pollInterval, remaining) / 1000);

                try {
                    // BLPOP for immediate wake up when notifyDecision() is called
                    // Use dedicated blocking client to avoid blocking the shared connection
                    const bClient = await this.getBlockingClient();
                    const result = await bClient.blpop(notifyKey, waitSec);
                    if (result && !isResolved) {
                        if (await check()) {
                            isResolved = true;
                            clearInterval(fallbackInterval);
                            break;
                        }
                    }
                } catch (err) {
                    // Redis error? Fall back to DB interval only
                    break; 
                }
            }
        });
    }

    /**
     * Snoozes an active decision request.
     */
    async snoozeRequest(requestId: number, snoozedUntil: Date, comments?: string): Promise<boolean> {
        try {
            // Fetch the request to get organizationId before updating
            const [existing] = await db.select({ organizationId: approvalRequests.organizationId })
                .from(approvalRequests)
                .where(eq(approvalRequests.id, requestId))
                .limit(1);

            await db.update(approvalRequests)
                .set({
                    status: "snoozed",
                    snoozedUntil,
                    comments: comments || "Snoozed for later review"
                } as any)
                .where(eq(approvalRequests.id, requestId));
            
            logger.info(`Decision request ${requestId} snoozed until ${snoozedUntil.toISOString()}`);

            // Publish decision:resolved event for snooze transition
            if (existing?.organizationId != null) {
                await this.publishResolution(requestId, existing.organizationId, 'snoozed');
            }

            return true;
        } catch (err) {
            logger.error(`Failed to snooze request ${requestId}`, err);
            return false;
        }
    }

    private async cleanup() {
        if (this.producer) {
            try {
                await this.producer.disconnect();
            } catch (_) { }
            this.producer = null;
        }
    }
}

// Singleton
export const decisionRouter = new DecisionRouter();


