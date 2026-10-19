/**
 * Standing Agent Service
 *
 * One-call provisioning for a continuously-running agent: a job (the
 * executable definition), an agent deployment (the addressable runtime the
 * heartbeat binds to), and optionally a heartbeat trigger that materializes
 * inbound items into launched missions.
 *
 * The approval boundary is stored on the deployment — the outbound send gate
 * resolves it via the executing job — and also folded into the system prompt
 * so the model sees its own rules.
 */

import { db } from "@server/database_service.js";
import { createLogger } from "@server/utils/logger.js";
import { heartbeatTriggers, insertHeartbeatTriggerSchema } from "@shared/schema/heartbeat-triggers.js";
import { agentOrgRoles } from "@shared/schema/agent-deployments.js";
import type { HeartbeatTrigger } from "@shared/schema/heartbeat-triggers.js";
import { requireOrgId, type OrgContext } from "@server/utils/auth-context.js";
import type { Job } from "@shared/schema/index.js";

const logger = createLogger("StandingAgentService");

export interface StandingAgentInput {
    name: string;
    description?: string;
    instructions: string;
    tools?: string[];
    approvalBoundary?: string;
    orgRole?: (typeof agentOrgRoles)[number];
    heartbeat?: {
        sourceType: HeartbeatTrigger["sourceType"];
        sourceConfig: Record<string, unknown>;
        pollingIntervalMs: number;
        missionTitleTemplate?: string;
        missionPriority?: "low" | "normal" | "high";
    };
}

export interface StandingAgentResult {
    job: Job;
    deployment: { id: number; slug: string; title: string };
    heartbeatTrigger: HeartbeatTrigger | null;
}

export const standingAgentService = {
    async provision(
        orgContext: OrgContext,
        userId: string,
        input: StandingAgentInput,
    ): Promise<StandingAgentResult> {
        const organizationId = requireOrgId(orgContext);

        const systemPrompt = input.approvalBoundary
            ? `${input.instructions}\n\nApproval boundary — these rules are mandatory:\n${input.approvalBoundary}`
            : input.instructions;

        // 1. The agent job — the executable definition the mission runs.
        const { jobService } = await import("../../jobs/job.service.js");
        const job = await jobService.create(
            {
                name: input.name,
                type: "agent",
                description: input.description ?? null,
                config: {
                    systemPrompt,
                    ...(input.tools ? { tools: input.tools } : {}),
                },
                isActive: true,
            },
            orgContext,
        );

        // 2. The deployment — makes the agent addressable for heartbeats/missions.
        const { AgentDeploymentService } = await import("../agent-deployment.service.js");
        const slugBase =
            input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "agent";
        const deployment = await AgentDeploymentService.upsert({
            jobId: job.id,
            organizationId,
            slug: `${slugBase}-${Date.now().toString(36)}`,
            title: input.name,
            description: input.description ?? null,
            accessPolicy: "internal_only",
            allowedTools: input.tools ?? null,
            orgRole: input.orgRole ?? "worker",
            // Hard-enforced by the outbound send gate on the mission path
            // (job → deployment lookup); also folded into the system prompt.
            approvalBoundary: input.approvalBoundary ?? null,
            createdBy: userId,
        } as any);

        // 3. Optional heartbeat trigger bound to this deployment.
        let trigger: HeartbeatTrigger | null = null;
        if (input.heartbeat) {
            const payload = insertHeartbeatTriggerSchema.parse({
                orgId: organizationId,
                agentDeploymentId: deployment.id,
                name: `${input.name} — ${input.heartbeat.sourceType} watch`,
                sourceType: input.heartbeat.sourceType,
                sourceConfig: input.heartbeat.sourceConfig,
                pollingIntervalMs: input.heartbeat.pollingIntervalMs,
                missionTitleTemplate: input.heartbeat.missionTitleTemplate,
                missionPriority: input.heartbeat.missionPriority ?? "normal",
                createdBy: userId,
            });

            const [created] = await db.insert(heartbeatTriggers).values(payload).returning();
            trigger = created;

            try {
                const { startHeartbeatWorker } = await import("../../../workers/heartbeat-worker.js");
                const worker = startHeartbeatWorker();
                await worker.scheduleTrigger(created);
            } catch {
                // Non-fatal — trigger is persisted; the worker picks it up on boot.
            }
        }

        logger.info(
            `Provisioned standing agent "${input.name}" (job=${job.id}, deployment=${deployment.id}` +
            `${trigger ? `, trigger=${trigger.id}` : ""}) for org ${organizationId}`,
        );

        return {
            job,
            deployment: { id: deployment.id, slug: deployment.slug, title: deployment.title },
            heartbeatTrigger: trigger,
        };
    },
};
