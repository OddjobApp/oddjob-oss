/**
 * Slack Integration Service
 * Handles slash commands, interactions, notifications
 */

import { db } from "@server/database_service.js";
import {
    slackWorkspaces,
    slackCommands,
    slackInteractions,
    slackNotifications,
    slackChannelSubscriptions,
    slackUserContexts,
    type InsertSlackWorkspace,
    type InsertSlackCommand,
    type InsertSlackInteraction,
    type InsertSlackNotification,
} from "@shared/schema/index.js";
import { eq, and, desc } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import type { OrgContext } from "@server/utils/auth-context.js";
import { ForbiddenError } from "@server/utils/errors.js";
import type { PlatformResource, ResourceAction } from "@shared/resource-catalog.js";
import type { SlackWorkspaceSettings } from "./slack-workspace-settings.js";

const logger = createLogger("SlackService");

// Slack API base URL
const SLACK_API_BASE = "https://slack.com/api";

interface SlackCommandPayload {
    token: string;
    team_id: string;
    team_domain: string;
    channel_id: string;
    channel_name: string;
    user_id: string;
    user_name: string;
    command: string;
    text: string;
    response_url: string;
    trigger_id: string;
}

interface SlackInteractionPayload {
    type: string;
    user: { id: string; username: string };
    channel: { id: string; name: string };
    team: { id: string; domain: string };
    actions?: Array<{
        action_id: string;
        block_id: string;
        value: string;
        text: { type: string; text: string };
    }>;
    view?: {
        callback_id: string;
        state: { values: Record<string, any> };
    };
    trigger_id: string;
    response_url: string;
}

interface CommandHandlerResult {
    text?: string;
    blocks?: any[];
    response_type?: "ephemeral" | "in_channel";
    attachments?: any[];
}

/**
 * Execution context for a one-click resource action confirmed from Slack. `orgContext` is built
 * fresh from the real Slack-linked Oddjob user's actual admin role (see buildOddjobOrgContext) -
 * never the blanket-superadmin x-internal-token bypass - so each dispatch entry below can gate on
 * it exactly like the real HTTP route's middleware would.
 */
interface ResourceActionExecContext {
    orgContext: OrgContext;
    oddjobUserId: string;
    oddjobUsername: string;
}

type ResourceActionHandler = (
    resource: PlatformResource,
    body: Record<string, unknown> | undefined,
    ctx: ResourceActionExecContext,
) => Promise<{ text: string }>;

/**
 * Per-(resourceType, actionId) execution handlers reachable from a Slack "Confirm & Run" button.
 * Every entry here calls the exact same domain-service function its real HTTP route calls, and
 * every entry whose real route is gated by requireOrgAdminOrSuper re-checks ctx.orgContext.isAdmin
 * before doing anything (cycle resume/pause, app audit). Actions whose real route only requires
 * requireAuth rely on the org-scoped resource refetch in handleResourceActionExecute for visibility -
 * the same boundary their route enforces, just re-derived from the real Slack-linked user instead of
 * a session. Actions not listed here (app deploy/app_deployment publish - unsafe partial-field
 * update risk; dataset export - returns a CSV file stream, not Slack-renderable; pipeline_step edit,
 * hil_form submit - no safe static defaultValue for their required body) are link-only in Slack.
 */
const RESOURCE_ACTION_DISPATCH: Partial<Record<string, Record<string, ResourceActionHandler>>> = {
    cycle: {
        resume: async (resource, _body, ctx) => {
            if (!ctx.orgContext.isAdmin) {
                throw new ForbiddenError("Only org admins or superadmins can resume a cycle");
            }
            if (!ctx.orgContext.isSuperAdmin && !ctx.orgContext.organizationId) {
                throw new ForbiddenError("Organization context required for non-super admins");
            }
            const { operationalCycles } = await import("@shared/schema/index.js");
            const { cacheService } = await import("@domain/cache/cache.service.js");
            const conditions = [eq(operationalCycles.id, Number(resource.id))];
            if (!ctx.orgContext.isSuperAdmin && ctx.orgContext.organizationId) {
                conditions.push(eq(operationalCycles.organizationId, ctx.orgContext.organizationId));
            }
            const [updated] = await db
                .update(operationalCycles)
                .set({ status: "active", updatedAt: new Date() })
                .where(and(...conditions))
                .returning({ id: operationalCycles.id });
            if (!updated) throw new ForbiddenError("Cycle not found or access denied");
            await cacheService.invalidate(`cycle:metadata:${resource.id}`);
            return { text: `✅ Cycle *${resource.name}* resumed.` };
        },
        pause: async (resource, _body, ctx) => {
            if (!ctx.orgContext.isAdmin) {
                throw new ForbiddenError("Only org admins or superadmins can pause a cycle");
            }
            if (!ctx.orgContext.isSuperAdmin && !ctx.orgContext.organizationId) {
                throw new ForbiddenError("Organization context required for non-super admins");
            }
            const { operationalCycles } = await import("@shared/schema/index.js");
            const { cacheService } = await import("@domain/cache/cache.service.js");
            const conditions = [eq(operationalCycles.id, Number(resource.id))];
            if (!ctx.orgContext.isSuperAdmin && ctx.orgContext.organizationId) {
                conditions.push(eq(operationalCycles.organizationId, ctx.orgContext.organizationId));
            }
            const [updated] = await db
                .update(operationalCycles)
                .set({ status: "paused", updatedAt: new Date() })
                .where(and(...conditions))
                .returning({ id: operationalCycles.id });
            if (!updated) throw new ForbiddenError("Cycle not found or access denied");
            await cacheService.invalidate(`cycle:metadata:${resource.id}`);
            return { text: `⏸️ Cycle *${resource.name}* paused.` };
        },
    },
    mission: {
        run: async (resource, _body, ctx) => {
            const { missionService } = await import("@domain/mission/core/mission.service.js");
            const result = await missionService.launchMission(Number(resource.id), ctx.oddjobUserId, ctx.orgContext.organizationId);
            if (!result.success) throw new Error(result.error || "Mission launch failed");
            return { text: `✅ Mission *${resource.name}* launched (execution ${result.executionId}).` };
        },
    },
    mission_run: {
        resume: async (resource) => {
            const { missionRunService } = await import("@domain/mission/core/mission-run.service.js");
            await missionRunService.resumeMissionRun(Number(resource.id), undefined);
            return { text: `▶️ Mission run *${resource.name}* resumed.` };
        },
    },
    pipeline: {
        run: async (resource, _body, ctx) => {
            const { pipelineService } = await import("@domain/pipeline/core/pipeline.service.js");
            await pipelineService.run(Number(resource.id), { input: {} }, ctx.orgContext);
            return { text: `✅ Pipeline *${resource.name}* started.` };
        },
    },
    job: {
        test: async (resource, _body, ctx) => {
            const { jobService } = await import("@domain/jobs/job.service.js");
            const { jobTestService } = await import("@domain/jobs/core/job-test.service.js");
            const job = await jobService.getById(Number(resource.id), ctx.orgContext);
            await jobTestService.testGenericJob(job, job.config || {}, {
                input: { triggeredBy: "slack", triggeredByUserId: ctx.oddjobUserId },
            });
            return { text: `✅ Job *${resource.name}* test run started.` };
        },
    },
    dataset: {
        extract: async (resource, _body, ctx) => {
            const { processDatasetExtraction } = await import("@domain/knowledge/core/dataset/dataset-extraction.js");
            const result = await processDatasetExtraction(Number(resource.id), ctx.oddjobUserId);
            return result
                ? { text: `✅ Knowledge graph extraction triggered for *${resource.name}*.` }
                : { text: `⚠️ No extraction performed for *${resource.name}* (missing config?).` };
        },
        validate: async (resource, _body, ctx) => {
            const { datasetService } = await import("@domain/knowledge/core/dataset-service.js");
            const { items } = await datasetService.getItems(Number(resource.id), ctx.orgContext, { limit: 10000 });
            return { text: `✅ Validation check triggered for *${resource.name}* (${items.length} items).` };
        },
    },
    approval_request: {
        approve: async (resource, _body, ctx) => {
            const { approvalService } = await import("@domain/integrations/core/approval.service.js");
            await approvalService.processDecision(
                Number(resource.id),
                { decision: "approved", comments: `Approved via Slack by ${ctx.oddjobUsername}` },
                ctx.oddjobUserId,
                ctx.oddjobUsername,
            );
            return { text: `✅ Approval request *${resource.name}* approved.` };
        },
        reject: async (resource, _body, ctx) => {
            const { approvalService } = await import("@domain/integrations/core/approval.service.js");
            await approvalService.processDecision(
                Number(resource.id),
                { decision: "rejected", comments: `Rejected via Slack by ${ctx.oddjobUsername}` },
                ctx.oddjobUserId,
                ctx.oddjobUsername,
            );
            return { text: `❌ Approval request *${resource.name}* rejected.` };
        },
    },
    app: {
        audit: async (resource, _body, ctx) => {
            if (!ctx.orgContext.isAdmin) {
                throw new ForbiddenError("Only org admins or superadmins can run a shadow audit");
            }
            if (!ctx.orgContext.organizationId) throw new ForbiddenError("Organization context required");
            const { appShadowAuditService } = await import("@domain/apps/app-shadow-audit.service.js");
            const findings = await appShadowAuditService.runAudit(Number(resource.id), ctx.orgContext.organizationId);
            const count = Array.isArray(findings) ? findings.length : undefined;
            return { text: `✅ Shadow audit run for *${resource.name}*.${count !== undefined ? ` ${count} finding(s).` : ""}` };
        },
    },
    schedule: {
        enable: async (resource, body, ctx) => {
            const { scheduleService } = await import("@domain/schedules/core/schedule.service.js");
            await scheduleService.updateSchedule(Number(resource.id), body ?? { isActive: true }, ctx.orgContext);
            return { text: `✅ Schedule *${resource.name}* enabled.` };
        },
        disable: async (resource, body, ctx) => {
            const { scheduleService } = await import("@domain/schedules/core/schedule.service.js");
            await scheduleService.updateSchedule(Number(resource.id), body ?? { isActive: false }, ctx.orgContext);
            return { text: `⏸️ Schedule *${resource.name}* disabled.` };
        },
    },
    credential: {
        test: async (resource, _body, ctx) => {
            const { credentialsService } = await import("@domain/auth/core/credentials-service.js");
            const result = await credentialsService.testConnection(
                Number(resource.id),
                ctx.orgContext.organizationId,
                ctx.orgContext.isSuperAdmin,
            );
            return {
                text: result?.success
                    ? `✅ Credential *${resource.name}* test succeeded: ${result.message ?? "OK"}`
                    : `❌ Credential *${resource.name}* test failed: ${result?.message ?? "unknown error"}`,
            };
        },
    },
};

export const slackService = {
    /**
     * Resolve Slack user to Oddjob user using slackHandle
     */
    async resolveSlackUser(slackUserName: string, organizationId: number): Promise<any> {
        const { userService } = await import("@domain/org/core/user.service.js");
        const user = await userService.getUserBySlackHandle(slackUserName, organizationId);
        
        // If not found in org, try global (for Superadmins)
        if (!user) {
            const globalUser = await userService.getUserBySlackHandle(slackUserName);
            if (globalUser) {
                // Verify if they are a superadmin
                const { adminRoles } = await import("@shared/schema/index.js");
                const [role] = await db.select().from(adminRoles).where(eq(adminRoles.userId, globalUser.id)).limit(1);
                if (role?.role === 'super_admin') {
                    return globalUser;
                }
            }
        }
        
        return user;
    },

    /**
     * Get bot token for a workspace
     * Tries encrypted credentials first, falls back to plaintext for backwards compatibility
     */
    async getBotToken(workspaceId: number): Promise<string | null> {
        const { encryptedCredentialsService } = await import("@domain/auth/core/encrypted-credentials.service.js");
        const { isEncryptionAvailable } = await import("@server/utils/encryption.js");
        
        const [workspace] = await db.select({ botToken: slackWorkspaces.botToken, organizationId: slackWorkspaces.organizationId })
            .from(slackWorkspaces)
            .where(eq(slackWorkspaces.id, workspaceId))
            .limit(1);

        if (workspace && isEncryptionAvailable()) {
            const encrypted = await encryptedCredentialsService.retrieve(
                workspace.organizationId,
                'slack_workspace',
                workspaceId,
                'bot_token'
            );
            if (encrypted?.token) {
                return encrypted.token;
            }
        }
        
        return workspace?.botToken || null;
    },

    /**
     * Store tokens in encrypted form (migration helper)
     */
    async encryptWorkspaceTokens(workspaceId: number): Promise<boolean> {
        const { encryptedCredentialsService } = await import("@domain/auth/core/encrypted-credentials.service.js");
        const { isEncryptionAvailable } = await import("@server/utils/encryption.js");
        
        if (!isEncryptionAvailable()) {
            logger.warn("Encryption not available - cannot encrypt tokens");
            return false;
        }
        
        try {
            const [workspace] = await db.select()
                .from(slackWorkspaces)
                .where(eq(slackWorkspaces.id, workspaceId))
                .limit(1);
            
            if (!workspace) {
                logger.error(`Workspace ${workspaceId} not found`);
                return false;
            }
            
            // Store bot token if present
            if (workspace.botToken) {
                await encryptedCredentialsService.store(
                    workspace.organizationId,
                    'slack_workspace',
                    workspaceId,
                    'bot_token',
                    { token: workspace.botToken }
                );
            }
            
            // Store user token if present
            if (workspace.userToken) {
                await encryptedCredentialsService.store(
                    workspace.organizationId,
                    'slack_workspace',
                    workspaceId,
                    'user_token',
                    { token: workspace.userToken }
                );
            }
            
            logger.info(`Encrypted tokens for workspace ${workspaceId}`);
            return true;
        } catch (err: any) {
            logger.error(`Failed to encrypt tokens for workspace ${workspaceId}:`, err.message);
            return false;
        }
    },

    /**
     * Install Slack workspace
     */
    async installWorkspace(data: { 
        code: string; 
        organizationId: number; 
        installedBy: number;
        defaultChannel?: string;
        notifyOnMissionComplete?: boolean;
        notifyOnJobFailure?: boolean;
        notifyOnApproval?: boolean;
    }): Promise<any> {
        const { encryptedCredentialsService } = await import("@domain/auth/core/encrypted-credentials.service.js");
        const { isEncryptionAvailable } = await import("@server/utils/encryption.js");
        
        // Exchange OAuth code for tokens
        const tokenResponse = await fetch(`${SLACK_API_BASE}/oauth.v2.access`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                client_id: process.env.SLACK_CLIENT_ID!,
                client_secret: process.env.SLACK_CLIENT_SECRET!,
                code: data.code,
            }),
        }).then(r => r.json());

        if (!tokenResponse.ok) {
            throw new Error(`Slack OAuth failed: ${tokenResponse.error}`);
        }

        // Get team info
        const teamInfo = await fetch(`${SLACK_API_BASE}/team.info`, {
            headers: { Authorization: `Bearer ${tokenResponse.access_token}` },
        }).then(r => r.json());

        // Store workspace (tokens will be encrypted separately)
        const [workspace] = await db.insert(slackWorkspaces).values({
            organizationId: data.organizationId,
            teamId: tokenResponse.team.id,
            teamName: teamInfo.team?.name || tokenResponse.team.name,
            botToken: isEncryptionAvailable() ? '[encrypted]' : tokenResponse.access_token,  // Placeholder if encrypted
            userToken: isEncryptionAvailable() ? '[encrypted]' : tokenResponse.authed_user?.access_token,
            botUserId: tokenResponse.bot_user_id,
            installedBy: data.installedBy,
            defaultChannel: data.defaultChannel,
            notifyOnMissionComplete: data.notifyOnMissionComplete ?? true,
            notifyOnJobFailure: data.notifyOnJobFailure ?? true,
            notifyOnApproval: data.notifyOnApproval ?? true,
        }).returning();

        // Store tokens encrypted if available
        if (isEncryptionAvailable()) {
            try {
                await encryptedCredentialsService.store(
                    data.organizationId,
                    'slack_workspace',
                    workspace.id,
                    'bot_token',
                    { token: tokenResponse.access_token }
                );
                
                if (tokenResponse.authed_user?.access_token) {
                    await encryptedCredentialsService.store(
                        data.organizationId,
                        'slack_workspace',
                        workspace.id,
                        'user_token',
                        { token: tokenResponse.authed_user.access_token }
                    );
                }
                
                logger.info(`Stored encrypted tokens for workspace ${workspace.id}`);
            } catch (err: any) {
                logger.error(`Failed to store encrypted tokens for workspace ${workspace.id}:`, err.message);
                // Continue - workspace is created, but warn about unencrypted tokens
                logger.warn(`Workspace ${workspace.id} created with placeholder tokens - encryption failed`);
            }
        } else {
            logger.warn(`Encryption not available - storing tokens in plaintext for workspace ${workspace.id}`);
        }

        logger.info(`Installed Slack workspace: ${workspace.teamName}`);

        // Send welcome message
        await this.sendMessage(workspace.id, {
            channel: data.defaultChannel || "#general",
            text: `🎉 Oddjob is now connected to ${workspace.teamName}!\n\nUse \`/oddjob help\` to get started.`,
        });

        return workspace;
    },

    /**
     * Handle incoming slash command
     */
    async handleCommand(payload: SlackCommandPayload): Promise<CommandHandlerResult> {
        // Find workspace
        const [workspace] = await db
            .select()
            .from(slackWorkspaces)
            .where(and(
                eq(slackWorkspaces.teamId, payload.team_id),
                eq(slackWorkspaces.isActive, true)
            ))
            .limit(1);

        if (!workspace) {
            return { text: "❌ This Slack workspace is not connected to Oddjob." };
        }

        // Get effective organization ID (handle context switching)
        const organizationId = await this.getEffectiveOrganizationId(payload.user_id, payload.team_id, workspace.organizationId);
        
        // Log command
        await db.insert(slackCommands).values({
            workspaceId: workspace.id,
            organizationId: organizationId,
            command: payload.command,
            text: payload.text,
            responseUrl: payload.response_url,
            channelId: payload.channel_id,
            channelName: payload.channel_name,
            userId: payload.user_id,
            userName: payload.user_name,
            teamId: payload.team_id,
            triggerId: payload.trigger_id,
        } as InsertSlackCommand);

        // Parse command
        const args = payload.text.trim().split(/\s+/);
        const subcommand = args[0]?.toLowerCase();

        // Route to handler
        switch (subcommand) {
            case "run":
            case "execute":
                return this.handleRunCommand(workspace, args.slice(1), payload, organizationId);
            case "status":
                return this.handleStatusCommand(workspace, args.slice(1), payload, organizationId);
            case "jobs":
                return this.handleJobsCommand(workspace, args.slice(1), payload, organizationId);
            case "missions":
                return this.handleMissionsCommand(workspace, args.slice(1), payload, organizationId);
            case "collections":
                return this.handleCollectionsCommand(workspace, args.slice(1), payload, organizationId);
            case "approve":
                return this.handleApproveCommand(workspace, args.slice(1), payload, organizationId);
            case "instruct":
                return this.handleInstructCommand(workspace, args.slice(1), payload, organizationId);
            case "teach":
                return this.handleTeachCommand(workspace, args.slice(1), payload, organizationId);
            case "switch":
            case "switch-org":
                return this.handleSwitchCommand(workspace, args.slice(1), payload);
            case "find":
                return this.handleFindCommand(args.slice(1), payload, organizationId);
            case "help":
                return this.handleHelpCommand();
            default:
                // Unrecognized subcommand text: treat the whole thing as a natural-language
                // intent ("pause the renewal sweep mission") rather than just showing help.
                if (!subcommand) return this.handleHelpCommand();
                return this.handleFindCommand(args, payload, organizationId);
        }
    },

    /**
     * Get effective organization ID for a user (handles context switching)
     */
    async getEffectiveOrganizationId(userId: string, teamId: string, defaultOrgId: number): Promise<number> {
        const [context] = await db
            .select({ organizationId: slackUserContexts.organizationId })
            .from(slackUserContexts)
            .where(and(
                eq(slackUserContexts.userId, userId),
                eq(slackUserContexts.teamId, teamId)
            ))
            .limit(1);
        
        return context?.organizationId || defaultOrgId;
    },

    /**
     * Handle /oddjob switch <org-id>
     */
    async handleSwitchCommand(workspace: any, args: string[], payload: SlackCommandPayload): Promise<CommandHandlerResult> {
        // 1. Verify Superadmin status
        const { adminRoles, users } = await import("@shared/schema/index.js");
        
        // Resolve user by slack handle (globally)
        const [user] = await db.select().from(users).where(eq(users.slackHandle, payload.user_name)).limit(1);
        if (!user) {
            return { text: "❌ Could not resolve your Oddjob user profile. Please ensure your Slack handle is set in your profile." };
        }

        const [adminRole] = await db
            .select()
            .from(adminRoles)
            .where(eq(adminRoles.userId, user.id))
            .limit(1);

        if (adminRole?.role !== "super_admin") {
            return { text: "🚫 Access Denied: Only Superadmins can switch organization context." };
        }

        if (args.length === 0) {
            // Reset context
            await db.delete(slackUserContexts).where(and(
                eq(slackUserContexts.userId, payload.user_id),
                eq(slackUserContexts.teamId, payload.team_id)
            ));
            return { text: "🔄 Context reset to workspace default organization." };
        }

        const targetOrgId = parseInt(args[0]);
        if (isNaN(targetOrgId)) {
            return { text: "❌ Invalid Organization ID. Please provide a numeric ID." };
        }

        // Verify target org exists
        const { orgs } = await import("@shared/schema/index.js");
        const [targetOrg] = await db.select().from(orgs).where(eq(orgs.id, targetOrgId)).limit(1);
        if (!targetOrg) {
            return { text: `❌ Organization ${targetOrgId} not found.` };
        }

        // Update or insert context
        const [existing] = await db.select().from(slackUserContexts).where(and(
            eq(slackUserContexts.userId, payload.user_id),
            eq(slackUserContexts.teamId, payload.team_id)
        )).limit(1);

        if (existing) {
            await db.update(slackUserContexts)
                .set({ organizationId: targetOrgId, updatedAt: new Date() })
                .where(eq(slackUserContexts.id, existing.id));
        } else {
            await db.insert(slackUserContexts).values({
                userId: payload.user_id,
                teamId: payload.team_id,
                organizationId: targetOrgId
            });
        }

        return { text: `✅ Context switched to *${targetOrg.name}* (ID: ${targetOrgId}).` };
    },

    /**
     * Handle /oddjob run <job-id-or-name>
     */
    async handleRunCommand(workspace: any, args: string[], payload: SlackCommandPayload, organizationId: number): Promise<CommandHandlerResult> {
        if (args.length === 0) {
            return { text: "❌ Please specify a job ID or name. Example: `/oddjob run my-job`" };
        }

        const jobIdentifier = args[0];

        // Import job service dynamically
        const { jobService } = await import("@domain/jobs/job.service.js");

        // Find job by ID or name
        let job;
        const orgContext = { organizationId, userId: payload.user_id, isAdmin: false, isSuperAdmin: false, isOrgAdmin: false };
        if (/^\d+$/.test(jobIdentifier)) {
            job = await jobService.getById(parseInt(jobIdentifier), orgContext);
        } else {
            const { items: jobsFound } = await jobService.list(orgContext, { search: jobIdentifier, limit: 1 });
            job = jobsFound[0];
        }

        if (!job) {
            return { text: `❌ Job "${jobIdentifier}" not found.` };
        }

        // Resolve Slack user to Oddjob user
        const oddjobUser = await this.resolveSlackUser(payload.user_name, organizationId);

        // Execute job
        try {
            const { jobTestService } = await import("@domain/jobs/job-test.service.js");
            const result = await jobTestService.testGenericJob(job, job.config || {}, {
                input: {
                    triggeredBy: "slack",
                    triggeredByUserId: oddjobUser?.id || payload.user_id,
                }
            });

            return {
                text: `✅ Job *${job.name}* started!`,
                blocks: [
                    {
                        type: "section",
                        text: {
                            type: "mrkdwn",
                            text: `✅ *Job Started*\n*${job.name}* (ID: ${job.id})`,
                        },
                    },
                    {
                        type: "actions",
                        elements: [
                            {
                                type: "button",
                                text: { type: "plain_text", text: "View Status" },
                                url: `${process.env.APP_URL}/jobs/${job.id}`,
                            },
                        ],
                    },
                ],
            };
        } catch (err: any) {
            return { text: `❌ Failed to start job: ${err.message}` };
        }
    },

    /**
     * Handle /oddjob instruct <task-description>
     */
    async handleInstructCommand(workspace: any, args: string[], payload: SlackCommandPayload, organizationId: number): Promise<CommandHandlerResult> {
        if (args.length === 0) {
            return { text: "❌ Please provide an instruction. Example: `/oddjob instruct analyze recent logs for errors`" };
        }

        const instructionText = args.join(" ");
        const { instructionNodeService } = await import("@domain/knowledge/core/instruction-node.service.js");

        try {
            const instruction = await instructionNodeService.create(
                organizationId,
                instructionText.slice(0, 50) + (instructionText.length > 50 ? "..." : ""),
                instructionText,
                { 
                    priority: "medium", 
                    autoExecute: true,
                    targetDomain: "slack"
                }
            );

            return {
                text: `?? **Instruction Queued:** I've added this to my persistent memory.\n> ${instructionText}\n\nMy strategic heartbeat will process this autonomously and report back in the next pulse.`,
                blocks: [
                    {
                        type: "section",
                        text: {
                            type: "mrkdwn",
                            text: `?? **Instruction Queued:** I've added this to my persistent memory.\n\n> _${instructionText}_`
                        }
                    },
                    {
                        type: "context",
                        elements: [
                            { type: "mrkdwn", text: `*ID:* \`${instruction.id}\` | *Status:* \`pending\` | *Mode:* \`Autonomous Execution\`` }
                        ]
                    }
                ]
            };
        } catch (err: any) {
            return { text: `❌ Failed to queue instruction: ${err.message}` };
        }
    },

    /**
     * Handle /oddjob status <job-id>
     */
    async handleStatusCommand(workspace: any, args: string[], payload: SlackCommandPayload, organizationId: number): Promise<CommandHandlerResult> {
        if (args.length === 0) {
            return { text: "❌ Please specify a job ID. Example: `/oddjob status 123`" };
        }

        const jobId = parseInt(args[0]);
        if (isNaN(jobId)) {
            return { text: "❌ Invalid job ID. Please provide a number." };
        }

        // Import services
        const { jobService } = await import("@domain/jobs/job.service.js");
        const { jobHealthService } = await import("@domain/jobs/core/job-health.service.js");
        
        const job = await jobService.getById(jobId, { organizationId, userId: payload.user_id, isAdmin: false, isSuperAdmin: false, isOrgAdmin: false });
        if (!job) {
            return { text: `❌ Job ${jobId} not found.` };
        }

        const health = await jobHealthService.calculateHealthScore(job.id);
        const status = jobHealthService.getHealthStatus(health.overall);

        return {
            blocks: [
                {
                    type: "header",
                    text: {
                        type: "plain_text",
                        text: `📊 Job Status: ${job.name}`,
                    },
                },
                {
                    type: "section",
                    fields: [
                        {
                            type: "mrkdwn",
                            text: `*Health Score:*\n${health.overall}% - ${status.label}`,
                        },
                        {
                            type: "mrkdwn",
                            text: `*Success Rate:*\n${health.successRate}%`,
                        },
                        {
                            type: "mrkdwn",
                            text: `*Response Time:*\n${health.avgResponseTimeScore}%`,
                        },
                        {
                            type: "mrkdwn",
                            text: `*Status:*\n${job.lifecycleStatus}`,
                        },
                    ],
                },
            ],
        };
    },

    /**
     * Handle /oddjob jobs
     */
    async handleJobsCommand(workspace: any, args: string[], payload: SlackCommandPayload, organizationId: number): Promise<CommandHandlerResult> {
        const { jobService } = await import("@domain/jobs/job.service.js");
        
        const { items: jobs } = await jobService.list({ organizationId, userId: payload.user_id, isAdmin: false, isSuperAdmin: false, isOrgAdmin: false }, { limit: 10 });

        const jobList = jobs.map((j: any) => `• *${j.name}* (ID: ${j.id}) - ${j.lifecycleStatus}`).join("\n");

        return {
            text: `*Recent Jobs:*\n${jobList}`,
            blocks: [
                {
                    type: "header",
                    text: { type: "plain_text", text: "📋 Recent Jobs" },
                },
                {
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: jobList || "No jobs found.",
                    },
                },
                {
                    type: "actions",
                    elements: [
                        {
                            type: "button",
                            text: { type: "plain_text", text: "View All Jobs" },
                            url: `${process.env.APP_URL}/jobs`,
                        },
                    ],
                },
            ],
        };
    },

    /**
     * Handle /oddjob missions
     */
    async handleMissionsCommand(workspace: any, args: string[], payload: SlackCommandPayload, organizationId: number): Promise<CommandHandlerResult> {
        const { missionService } = await import("@domain/mission/core/mission.service.js");
        
        const missions = await missionService.listMissions(organizationId);
        const recentMissions = missions.slice(0, 10);

        const missionList = recentMissions.map((m: any) => `• *${m.name}* (ID: ${m.id}) - ${m.status}`).join("\n");

        return {
            text: `*Recent Missions:*\n${missionList}`,
            blocks: [
                {
                    type: "header",
                    text: { type: "plain_text", text: "🚀 Recent Missions" },
                },
                {
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: missionList || "No missions found.",
                    },
                },
                {
                    type: "actions",
                    elements: [
                        {
                            type: "button",
                            text: { type: "plain_text", text: "View All Missions" },
                            url: `${process.env.APP_URL}/missions`,
                        },
                    ],
                },
            ],
        };
    },

    /**
     * Handle /oddjob collections
     */
    async handleCollectionsCommand(workspace: any, args: string[], payload: SlackCommandPayload, organizationId: number): Promise<CommandHandlerResult> {
        const { collectionService } = await import("@domain/knowledge/core/collection.service.js");
        
        const collections = await collectionService.listCollections({ organizationId: organizationId } as any);
        const recentCollections = collections.slice(0, 10);

        const collectionList = recentCollections.map((c: any) => `• *${c.name}* (ID: ${c.id}) - ${c.jobCount} items`).join("\n");

        return {
            text: `*Recent Collections:*\n${collectionList}`,
            blocks: [
                {
                    type: "header",
                    text: { type: "plain_text", text: "📁 Recent Collections" },
                },
                {
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: collectionList || "No collections found.",
                    },
                },
            ],
        };
    },

    /**
     * Handle /oddjob approve <approval-id>
     */
    async handleApproveCommand(workspace: any, args: string[], payload: SlackCommandPayload, organizationId: number): Promise<CommandHandlerResult> {
        if (args.length === 0) {
            // List pending approvals
            const { approvalService } = await import("@domain/integrations/core/approval.service.js");
            const approvals = await approvalService.listPending("system", "", { isOrgAdmin: true, organizationId: organizationId });

            if (approvals.length === 0) {
                return { text: "✅ No pending approvals!" };
            }

            return {
                blocks: [
                    {
                        type: "header",
                        text: { type: "plain_text", text: "⏳ Pending Approvals" },
                    },
                    ...approvals.map((a: any) => ({
                        type: "section",
                        text: {
                            type: "mrkdwn",
                            text: `*${a.jobName}* (ID: ${a.id})\nRequested by ${a.requesterName}`,
                        },
                        accessory: {
                            type: "button",
                            text: { type: "plain_text", text: "Approve" },
                            style: "primary",
                            action_id: `approve_${a.id}`,
                            value: a.id.toString(),
                        },
                    })),
                ],
            };
        }

        // Approve specific request
        const approvalId = parseInt(args[0]);
        const { approvalService } = await import("@domain/integrations/core/approval.service.js");

        // Resolve Slack user to Oddjob user
        const oddjobUser = await this.resolveSlackUser(payload.user_name, workspace.organizationId);

        try {
            await approvalService.processDecision(approvalId, {
                decision: "approved",
                comments: `Approved via Slack by ${payload.user_name}`,
            }, oddjobUser?.id || payload.user_id, oddjobUser?.username || payload.user_name);

            return { text: `✅ Approval ${approvalId} approved!` };
        } catch (err: any) {
            return { text: `❌ Failed to approve: ${err.message}` };
        }
    },

    /**
     * Handle /oddjob teach <goal>
     * Launches Teach-a-Task in Computer Use Studio directly from Slack
     */
    async handleTeachCommand(workspace: any, args: string[], payload: SlackCommandPayload, organizationId: number): Promise<CommandHandlerResult> {
        const goal = args.join(" ").trim();
        if (!goal) {
            return { text: "❌ Please specify what task you want to teach. Example: `/oddjob teach Search Wikipedia for Paris`" };
        }

        try {
            const { trycuaService } = await import("../trycua/trycua-service.js");
            await trycuaService.assertEnabled(organizationId);
        } catch {
            return {
                text: "⚠️ Computer Use is not enabled for this organization. An admin must enable it under *Admin → Settings → Computer Use*.",
            };
        }

        const encodedGoal = encodeURIComponent(goal);
        const baseUrl = process.env.APP_URL || "";
        const teachUrl = `${baseUrl}/workspace/computer?teach=1&goal=${encodedGoal}&studio=computer`;

        return {
            text: `🎯 Teach-a-Task session prepared for *${goal}*`,
            blocks: [
                {
                    type: "header",
                    text: { type: "plain_text", text: "🎯 Teach-a-Task: Browser Workflow" },
                },
                {
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: `*Goal:* "${goal}"\n*Operator:* <@${payload.user_id}>\n\nClick below to open the cloud desktop in *Teach Mode*. Your demonstration will be recorded, sanitized with zero secret leaks, and automatically parameterized into an active reusable skill.`,
                    },
                },
                {
                    type: "actions",
                    elements: [
                        {
                            type: "button",
                            text: {
                                type: "plain_text",
                                text: "🖥️ Open Desktop in Teach Mode",
                                emoji: true,
                            },
                            url: teachUrl,
                            style: "primary",
                        },
                    ],
                },
                {
                    type: "context",
                    elements: [
                        {
                            type: "mrkdwn",
                            text: "🔒 _Zero-Trust: Passwords, OTPs, and payment card numbers are cryptographically redacted from all recordings._",
                        },
                    ],
                },
            ],
        };
    },

    /**
     * Builds a real OrgContext for a known Oddjob user id, scoped to a target org, by mirroring
     * the same adminRoles lookup getUserOrgContext does for an HTTP session - so a resolved
     * Slack-linked user gets the exact same isAdmin/isSuperAdmin/isOrgAdmin flags their own
     * session would carry. Never use the x-internal-token blanket-superadmin bypass for this -
     * that would let any Slack user act as superadmin.
     */
    async buildOddjobOrgContext(oddjobUserId: string | undefined, organizationId: number): Promise<OrgContext> {
        if (!oddjobUserId) {
            return { userId: "unknown", organizationId, isAdmin: false, isSuperAdmin: false, isOrgAdmin: false };
        }
        const { adminRoles } = await import("@shared/schema/index.js");
        const [adminRole] = await db.select().from(adminRoles).where(eq(adminRoles.userId, oddjobUserId)).limit(1);
        const isSuperAdmin = adminRole?.role === "super_admin";
        const isOrgAdmin = adminRole?.role === "org_admin" && adminRole.organizationId === organizationId;
        return {
            userId: oddjobUserId,
            organizationId,
            isAdmin: isSuperAdmin || isOrgAdmin,
            isSuperAdmin,
            isOrgAdmin,
        };
    },

    /**
     * An action is only offered a one-click "Confirm & Run" button when it has a dispatch handler
     * AND every required param field has a statically-known defaultValue - otherwise the body
     * can't be safely auto-filled and the action is link-only.
     */
    isOneClickConfirmable(resourceType: string, action: ResourceAction): boolean {
        if (!RESOURCE_ACTION_DISPATCH[resourceType]?.[action.id]) return false;
        const requiredFields = action.params?.fields.filter((field) => field.required) ?? [];
        return requiredFields.every((field) => field.defaultValue !== undefined);
    },

    /**
     * Builds the request body for a one-click action from its params schema's defaultValue-backed
     * fields only - never from client-supplied/cached state.
     */
    buildDefaultActionBody(action: ResourceAction): Record<string, unknown> | undefined {
        if (!action.params || action.params.location !== "body") return undefined;
        const body: Record<string, unknown> = {};
        for (const field of action.params.fields) {
            if (field.defaultValue !== undefined) body[field.name] = field.defaultValue;
        }
        return body;
    },

    /**
     * Handle /oddjob find <free text>
     */
    async handleFindCommand(args: string[], payload: SlackCommandPayload, organizationId: number): Promise<CommandHandlerResult> {
        const query = args.join(" ").trim();
        if (!query) {
            return { text: "❌ Tell me what to find. Example: `/oddjob find pause the renewal sweep mission`" };
        }
        return this.runIntentSearch(query, payload, organizationId);
    },

    /**
     * Resolves a free-text intent to ranked (resource, action) matches via routeResourceIntent and
     * renders each as a Slack block: a "Confirm & Run" button (with a native Slack confirm dialog)
     * when the matched action is one-click-confirmable, otherwise a "View in Oddjob" link only.
     * Uses the real Slack-linked user's own org context (not a hardcoded fake one) so results never
     * exceed what that user could actually see via the catalog API.
     */
    async runIntentSearch(query: string, payload: SlackCommandPayload, organizationId: number): Promise<CommandHandlerResult> {
        const { routeResourceIntent } = await import("@domain/resource-catalog/resource-intent.service.js");
        const { RESOURCE_TYPE_DEFINITIONS } = await import("@shared/resource-catalog.js");

        const oddjobUser = await this.resolveSlackUser(payload.user_name, organizationId);
        const orgContext = await this.buildOddjobOrgContext(oddjobUser?.id, organizationId);

        const result = await routeResourceIntent(orgContext, query, { limit: 3 });
        if (result.matches.length === 0) {
            return { text: `🔍 No matching resource found for: _${query}_` };
        }

        const blocks: any[] = [
            { type: "header", text: { type: "plain_text", text: "🔍 Resource Catalog Matches" } },
        ];

        for (const match of result.matches) {
            const { resource, action: matchedAction, blastRadius } = match;
            const lines = [
                `*${resource.name}* (${RESOURCE_TYPE_DEFINITIONS[resource.type].label}${resource.status ? `, ${resource.status}` : ""})`,
                `Suggested action: *${matchedAction.label}*`,
            ];
            if (blastRadius) {
                lines.push(`⚠️ Impacts ${blastRadius.impactedCount} downstream resource(s)${blastRadius.truncated ? " (truncated)" : ""}`);
            }

            const section: any = {
                type: "section",
                text: { type: "mrkdwn", text: lines.join("\n") },
            };

            if (this.isOneClickConfirmable(resource.type, matchedAction)) {
                section.accessory = {
                    type: "button",
                    text: { type: "plain_text", text: `Confirm: ${matchedAction.label}` },
                    style: matchedAction.destructive ? "danger" : "primary",
                    action_id: "resource_action_execute",
                    value: `${resource.key}::${matchedAction.id}`,
                    confirm: {
                        title: { type: "plain_text", text: "Are you sure?" },
                        text: { type: "mrkdwn", text: `${matchedAction.label} on *${resource.name}*?` },
                        confirm: { type: "plain_text", text: "Yes, run it" },
                        deny: { type: "plain_text", text: "Cancel" },
                    },
                };
            } else {
                const url = resource.url
                    ? `${process.env.APP_URL ?? ""}${resource.url}`
                    : `${process.env.APP_URL ?? ""}/resource-catalog/${resource.key}`;
                section.accessory = {
                    type: "button",
                    text: { type: "plain_text", text: "View in Oddjob" },
                    url,
                };
            }

            blocks.push(section);
        }

        return { text: `Found ${result.matches.length} match(es) for: ${query}`, blocks };
    },

    /**
     * Handle /oddjob help
     */
    handleHelpCommand(): CommandHandlerResult {
        return {
            text: "*Oddjob Slack Commands:*",
            blocks: [
                {
                    type: "header",
                    text: { type: "plain_text", text: "🤖 Oddjob Help" },
                },
                {
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: `*Available Commands:*
\`/oddjob run <job-id>\` - Execute a job
\`/oddjob status <job-id>\` - Check job health
\`/oddjob jobs\` - List recent jobs
\`/oddjob missions\` - List recent missions
\`/oddjob collections\` - List recent collections
\`/oddjob approve [approval-id]\` - List or approve pending requests
\`/oddjob instruct <task>\` - Queue a persistent instruction for the agent
\`/oddjob switch <org-id>\` - Switch organization context (Superadmins only)
\`/oddjob find <description>\` - Find a resource (mission, pipeline, cycle, etc.) and confirm an action on it
\`/oddjob <anything else>\` - Also treated as a find, e.g. \`/oddjob pause the renewal sweep mission\`
\`/oddjob help\` - Show this help message`,
                    },
                },
                {
                    type: "context",
                    elements: [
                        {
                            type: "mrkdwn",
                            text: `Need more help? Visit <${process.env.APP_URL}|Oddjob Dashboard>`,
                        },
                    ],
                },
            ],
        };
    },

    /**
     * Handle interactive component (button clicks, etc.)
     */
    async handleInteraction(payload: SlackInteractionPayload): Promise<any> {
        // Find workspace
        const [workspace] = await db
            .select()
            .from(slackWorkspaces)
            .where(and(
                eq(slackWorkspaces.teamId, payload.team.id),
                eq(slackWorkspaces.isActive, true)
            ))
            .limit(1);

        if (!workspace) {
            return { text: "Workspace not found" };
        }

        // Get effective organization ID
        const organizationId = await this.getEffectiveOrganizationId(payload.user.id, payload.team.id, workspace.organizationId);

        // Log interaction
        const action = payload.actions?.[0];
        await db.insert(slackInteractions).values({
            workspaceId: workspace.id,
            organizationId: organizationId,
            type: payload.type,
            actionId: action?.action_id,
            blockId: action?.block_id,
            callbackId: payload.view?.callback_id,
            payload: payload as any,
            userId: payload.user.id,
            userName: payload.user.username,
            channelId: payload.channel?.id,
            channelName: payload.channel?.name,
            teamId: payload.team.id,
            actionType: this.parseActionType(action?.action_id),
            actionValue: action?.value,
        } as InsertSlackInteraction);

        // Process action
        // Mission steering/approvals
        if (action?.action_id?.startsWith("mission:")) {
            const { conversationalBridgeService } = await import("@domain/integrations/conversational-bridge.service.js");
            return conversationalBridgeService.handleSlackAction(payload);
        }

        if (action?.action_id?.startsWith("approve_")) {
            return this.processApprovalAction(workspace, action.value, payload.user.id, payload.user.username, organizationId);
        }

        if (action?.action_id?.startsWith("reject_")) {
            return this.processRejectionAction(workspace, action.value, payload.user.id, payload.user.username, organizationId);
        }

        if (action?.action_id === "resource_action_execute") {
            return this.handleResourceActionExecute(action.value, payload, organizationId);
        }

        return { text: "Action processed" };
    },

    /**
     * Executes a one-click "Confirm & Run" resource action clicked from a /oddjob find result.
     * Never trusts the client-encoded value beyond the resourceKey/actionId pair: resolves the
     * real Slack-linked Oddjob user, builds their real OrgContext (mirroring the role a live
     * session would carry), re-fetches the resource fresh through that org context (the same
     * org-visibility boundary getResourceByKey already enforces for every collector), re-checks
     * any admin gate the action's real route requires, and only then dispatches to the matching
     * domain-service call - the same call its own HTTP route would make.
     */
    async handleResourceActionExecute(value: string, payload: SlackInteractionPayload, organizationId: number): Promise<any> {
        const [resourceKey, actionId] = (value ?? "").split("::");
        if (!resourceKey || !actionId) {
            return { text: "❌ Malformed action reference.", replace_original: true };
        }

        const oddjobUser = await this.resolveSlackUser(payload.user.username, organizationId);
        if (!oddjobUser?.id) {
            return {
                text: "❌ Could not verify your Oddjob identity for this org - link your Slack account in Oddjob first.",
                replace_original: true,
            };
        }

        const orgContext = await this.buildOddjobOrgContext(oddjobUser.id, organizationId);

        try {
            const { resourceCatalogService } = await import("@domain/resource-catalog/resource-catalog.service.js");
            const resource = await resourceCatalogService.getResourceByKey(resourceKey, orgContext);

            const freshAction = resource.actions.find((candidate) => candidate.id === actionId);
            if (!freshAction) {
                return { text: `❌ Action *${actionId}* is no longer available on *${resource.name}*.`, replace_original: true };
            }

            const handler = RESOURCE_ACTION_DISPATCH[resource.type]?.[freshAction.id];
            if (!handler) {
                return { text: `❌ This action can't be run from Slack. Use the Oddjob dashboard.`, replace_original: true };
            }

            const body = this.buildDefaultActionBody(freshAction);
            const result = await handler(resource, body, {
                orgContext,
                oddjobUserId: oddjobUser.id,
                oddjobUsername: oddjobUser.username ?? payload.user.username,
            });

            return { text: result.text, replace_original: true };
        } catch (err: any) {
            return { text: `❌ Failed: ${err.message}`, replace_original: true };
        }
    },

    /**
     * Parse action type from action_id
     */
    parseActionType(actionId?: string): string | undefined {
        if (!actionId) return undefined;
        if (actionId.startsWith("approve_")) return "approve";
        if (actionId.startsWith("reject_")) return "reject";
        if (actionId.startsWith("run_")) return "run_job";
        if (actionId.startsWith("view_")) return "view";
        if (actionId === "resource_action_execute") return "resource_action_execute";
        return "unknown";
    },

    /**
     * Process approval action
     */
    async processApprovalAction(workspace: any, approvalId: string, slackUserId: string, slackUserName: string, organizationId: number): Promise<any> {
        const { approvalService } = await import("@domain/integrations/core/approval.service.js");

        // Resolve Slack user to Oddjob user
        const oddjobUser = await this.resolveSlackUser(slackUserName, organizationId);

        try {
            await approvalService.processDecision(parseInt(approvalId), {
                decision: "approved",
                comments: `Approved via Slack by ${slackUserName}`,
            }, oddjobUser?.id || slackUserId, oddjobUser?.username || slackUserName);

            return {
                text: "✅ Approved successfully!",
                replace_original: true,
            };
        } catch (err: any) {
            return { text: `❌ Failed to approve: ${err.message}` };
        }
    },

    /**
     * Process rejection action
     */
    async processRejectionAction(workspace: any, approvalId: string, slackUserId: string, slackUserName: string, organizationId: number): Promise<any> {
        const { approvalService } = await import("@domain/integrations/core/approval.service.js");

        // Resolve Slack user to Oddjob user
        const oddjobUser = await this.resolveSlackUser(slackUserName, organizationId);

        try {
            await approvalService.processDecision(parseInt(approvalId), {
                decision: "rejected",
                comments: `Rejected via Slack by ${slackUserName}`,
            }, oddjobUser?.id || slackUserId, oddjobUser?.username || slackUserName);

            return {
                text: "❌ Rejected",
                replace_original: true,
            };
        } catch (err: any) {
            return { text: `❌ Failed to reject: ${err.message}` };
        }
    },

    /**
     * Send message to Slack
     */
    async sendMessage(workspaceId: number, message: { channel: string; text: string; blocks?: any[]; threadTs?: string }): Promise<any> {
        const [workspace] = await db
            .select({ id: slackWorkspaces.id, defaultChannel: slackWorkspaces.defaultChannel })
            .from(slackWorkspaces)
            .where(eq(slackWorkspaces.id, workspaceId))
            .limit(1);

        if (!workspace) {
            throw new Error("Workspace not found");
        }

        // Get bot token (encrypted or plaintext)
        const botToken = await this.getBotToken(workspaceId);
        if (!botToken) {
            throw new Error("No bot token available for workspace");
        }

        const response = await fetch(`${SLACK_API_BASE}/chat.postMessage`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${botToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                channel: message.channel,
                text: message.text,
                blocks: message.blocks,
                thread_ts: message.threadTs,
            }),
        }).then(r => r.json());

        if (!response.ok) {
            throw new Error(`Failed to send message: ${response.error}`);
        }

        return response;
    },

    /**
     * Send notification for an event
     */
    async sendNotification(workspaceId: number, type: string, data: any): Promise<any[]> {
        const [workspace] = await db
            .select()
            .from(slackWorkspaces)
            .where(eq(slackWorkspaces.id, workspaceId))
            .limit(1);

        if (!workspace) return [];

        // 1. Get Authorized Channels based on subscriptions
        const authorizedChannels = await this.getAuthorizedChannels(workspaceId, type, data);
        
        // Add default channel if no specific subscriptions exist and workspace-level setting is ON
        if (authorizedChannels.length === 0) {
            if (type === "mission_complete" && workspace.notifyOnMissionComplete) authorizedChannels.push(workspace.defaultChannel || "#general");
            if (type === "job_failure" && workspace.notifyOnJobFailure) authorizedChannels.push(workspace.defaultChannel || "#general");
            if (type === "approval_requested" && workspace.notifyOnApproval) authorizedChannels.push(workspace.defaultChannel || "#general");
            if (type === "app_launched" && workspace.notifyOnAppLaunched) authorizedChannels.push(workspace.defaultChannel || "#general");
        }

        if (authorizedChannels.length === 0) return [];

        // Build message based on type
        let message: any;
        switch (type) {
            case "mission_complete":
                message = this.buildMissionCompleteMessage(data);
                break;
            case "job_failure":
                message = this.buildJobFailureMessage(data);
                break;
            case "approval_requested":
                message = this.buildApprovalMessage(data);
                break;
            case "app_launched":
                message = this.buildAppLaunchedMessage(data);
                break;
            default:
                message = { text: `Notification: ${type}` };
        }

        const results = [];
        for (const channelId of authorizedChannels) {
            // Log notification
            const [notification] = await db.insert(slackNotifications).values({
                workspaceId,
                organizationId: workspace.organizationId,
                type,
                channelId: channelId,
                messageText: message.text,
                messageBlocks: message.blocks,
                jobId: data.jobId,
                missionId: data.missionId,
                approvalRequestId: data.approvalRequestId,
                hasInteractiveBlocks: !!message.blocks?.find((b: any) => b.type === "actions"),
            } as InsertSlackNotification).returning();

            // Send to Slack
            try {
                const notificationResult = await this.sendMessage(workspaceId, {
                    channel: channelId,
                    ...message,
                });

                // Update with delivery status
                await db.update(slackNotifications)
                    .set({
                        deliveryStatus: "delivered",
                        slackMessageTs: notificationResult.ts,
                        deliveredAt: new Date(),
                    })
                    .where(eq(slackNotifications.id, notification.id));

                results.push(notificationResult);
            } catch (err: any) {
                await db.update(slackNotifications)
                    .set({
                        deliveryStatus: "failed",
                        errorMessage: err.message,
                    })
                    .where(eq(slackNotifications.id, notification.id));
                logger.error(`Failed to send notification to channel ${channelId}: ${err.message}`);
            }
        }

        return results;
    },

    /**
     * Get channels authorized to receive this specific notification
     */
    async getAuthorizedChannels(workspaceId: number, type: string, data: any): Promise<string[]> {
        const subscriptions = await db
            .select()
            .from(slackChannelSubscriptions)
            .where(and(
                eq(slackChannelSubscriptions.workspaceId, workspaceId),
                eq(slackChannelSubscriptions.isActive, true)
            ));

        const authorizedChannels: string[] = [];

        for (const sub of subscriptions) {
            let isAuthorized = false;

            // Type filters
            if (type === "mission_complete" && sub.notifyMissions) isAuthorized = true;
            if (type === "job_failure" && sub.notifyJobs) isAuthorized = true;
            if (type === "approval_requested" && sub.notifyApprovals) isAuthorized = true;
            if (type === "app_launched" && sub.notifyApps) isAuthorized = true;

            // Entity-specific filters (if provided, they must match)
            if (isAuthorized) {
                if (data.missionId && sub.subscribedMissionIds) {
                    const missionIds = sub.subscribedMissionIds as number[];
                    if (!missionIds.includes(data.missionId)) isAuthorized = false;
                }
                if (data.jobId && sub.subscribedJobIds) {
                    const jobIds = sub.subscribedJobIds as number[];
                    if (!jobIds.includes(data.jobId)) isAuthorized = false;
                }
            }

            if (isAuthorized) {
                authorizedChannels.push(sub.channelId);
            }
        }

        return [...new Set(authorizedChannels)]; // Unique channels
    },

    /**
     * Build mission complete message
     */
    buildMissionCompleteMessage(data: any): any {
        return {
            text: `✅ Mission "${data.missionName}" completed successfully!`,
            blocks: [
                {
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: `✅ *Mission Complete*\n*${data.missionName}* finished successfully!`,
                    },
                },
                {
                    type: "context",
                    elements: [
                        {
                            type: "mrkdwn",
                            text: `Duration: ${data.duration}s | Jobs: ${data.jobCount}`,
                        },
                    ],
                },
                {
                    type: "actions",
                    elements: [
                        {
                            type: "button",
                            text: { type: "plain_text", text: "View Results" },
                            url: `${process.env.APP_URL}/missions/${data.missionId}`,
                        },
                    ],
                },
            ],
        };
    },

    /**
     * Build job failure message
     */
    buildJobFailureMessage(data: any): any {
        return {
            text: `❌ Job "${data.jobName}" failed!`,
            blocks: [
                {
                    type: "header",
                    text: { type: "plain_text", text: "❌ Job Failed" },
                },
                {
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: `*${data.jobName}* (ID: ${data.jobId})\nError: ${data.errorMessage}`,
                    },
                },
                {
                    type: "actions",
                    elements: [
                        {
                            type: "button",
                            text: { type: "plain_text", text: "View Details" },
                            url: `${process.env.APP_URL}/jobs/${data.jobId}`,
                        },
                        {
                            type: "button",
                            text: { type: "plain_text", text: "Retry Job" },
                            action_id: `retry_${data.jobId}`,
                            value: data.jobId.toString(),
                        },
                    ],
                },
            ],
        };
    },

    /**
     * Build approval request message
     */
    buildApprovalMessage(data: any): any {
        return {
            text: `⏳ Approval requested for "${data.jobName}"`,
            blocks: [
                {
                    type: "header",
                    text: { type: "plain_text", text: "⏳ Approval Requested" },
                },
                {
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: `*${data.jobName}*\nRequested by: ${data.requesterName}\n${data.description || ""}`,
                    },
                },
                {
                    type: "actions",
                    elements: [
                        {
                            type: "button",
                            text: { type: "plain_text", text: "Approve" },
                            style: "primary",
                            action_id: `approve_${data.approvalRequestId}`,
                            value: data.approvalRequestId.toString(),
                        },
                        {
                            type: "button",
                            text: { type: "plain_text", text: "Reject" },
                            style: "danger",
                            action_id: `reject_${data.approvalRequestId}`,
                            value: data.approvalRequestId.toString(),
                        },
                        {
                            type: "button",
                            text: { type: "plain_text", text: "View" },
                            url: `${process.env.APP_URL}/control/decisions/${data.approvalRequestId}`,
                        },
                    ],
                },
            ],
        };
    },

    /**
     * Build app launched message
     */
    buildAppLaunchedMessage(data: any): any {
        const appUrl = data.publicUrl || `${process.env.APP_URL}/app/${data.slug}`;
        return {
            text: `🚀 App "${data.name || data.slug}" is now live!`,
            blocks: [
                {
                    type: "header",
                    text: { type: "plain_text", text: "🚀 App Launched" },
                },
                {
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: `*${data.name || data.slug}* is now live and ready to use!`,
                    },
                },
                {
                    type: "context",
                    elements: [
                        {
                            type: "mrkdwn",
                            text: `App ID: ${data.appId} | Organization: ${data.organizationName || data.organizationId}`,
                        },
                    ],
                },
                {
                    type: "actions",
                    elements: [
                        {
                            type: "button",
                            text: { type: "plain_text", text: "Open App" },
                            style: "primary",
                            url: appUrl,
                        },
                        {
                            type: "button",
                            text: { type: "plain_text", text: "View in Builder" },
                            url: `${process.env.APP_URL}/builder/apps/${data.appId}`,
                        },
                    ],
                },
            ],
        };
    },

    /**
     * Get workspace by ID
     */
    async getWorkspaceById(id: number): Promise<any> {
        const [workspace] = await db
            .select()
            .from(slackWorkspaces)
            .where(eq(slackWorkspaces.id, id))
            .limit(1);
        return workspace;
    },

    /**
     * Get workspace by team ID
     */
    async getWorkspaceByTeamId(teamId: string): Promise<any> {
        const [workspace] = await db
            .select()
            .from(slackWorkspaces)
            .where(eq(slackWorkspaces.teamId, teamId))
            .limit(1);
        return workspace;
    },

    /**
     * List workspaces for organization
     */
    async listWorkspaces(organizationId: number): Promise<any[]> {
        return await db
            .select()
            .from(slackWorkspaces)
            .where(eq(slackWorkspaces.organizationId, organizationId))
            .orderBy(desc(slackWorkspaces.installedAt));
    },

    async disconnectWorkspace(id: number, organizationId: number): Promise<boolean> {
        const [workspace] = await db.update(slackWorkspaces)
            .set({ isActive: false, updatedAt: new Date() })
            .where(and(eq(slackWorkspaces.id, id), eq(slackWorkspaces.organizationId, organizationId)))
            .returning({ id: slackWorkspaces.id });
        return Boolean(workspace);
    },

    async updateWorkspaceSettings(
        id: number,
        organizationId: number,
        settings: SlackWorkspaceSettings,
    ): Promise<boolean> {
        const [workspace] = await db.update(slackWorkspaces)
            .set({ ...settings, updatedAt: new Date() })
            .where(and(eq(slackWorkspaces.id, id), eq(slackWorkspaces.organizationId, organizationId)))
            .returning({ id: slackWorkspaces.id });
        return Boolean(workspace);
    },
};
