
import { db } from "@server/database_service.js";
import { agentDeployments, jobs, pipelines } from "@shared/schema/index.js";
import type { Pipeline, AgentDeployment } from "@shared/schema/index.js";

import { eq, and } from "drizzle-orm";
import { InputValidationService } from "@domain/core/input-validation.service.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("AgentDeploymentService");

export interface AgentFormManifest {
    [pipelineId: string]: {
        pipelineName: string;
        fields: any[];
        /**
         * Serve this form deterministically on the agent's first turn, with no
         * model call. Declared by the blueprint via `job.config.intakeForm`;
         * at most one form per agent should set it.
         */
        servesInitialTurn?: boolean;
    };
}

export class AgentDeploymentService {
    /**
     * Update the form manifest for a deployment
     * Scans all allowed pipelines and caches their input requirements
     */
    static async updateManifest(deploymentId: number): Promise<AgentFormManifest> {
        const [deployment] = await db.select().from(agentDeployments).where(eq(agentDeployments.id, deploymentId)).limit(1);
        if (!deployment) throw new Error("Deployment not found");

        const allowedPipelineIds = deployment.allowedPipelineIds || [];
        const manifest: AgentFormManifest = {};

        for (const pipelineId of allowedPipelineIds) {
            try {
                // Fetch pipeline details
                const [pipeline] = await db.select({
                    id: pipelines.id,
                    name: pipelines.name
                }).from(pipelines).where(eq(pipelines.id, pipelineId)).limit(1);

                // Fetch parameters using InputValidationService
                const params = await InputValidationService.getParamsForPipeline(pipelineId);

                const fields = params.map((p: any) => ({
                    name: p.name,
                    label: p.label || p.name,
                    type: p.dataType || 'string',
                    required: p.isRequired,
                    description: p.description,
                    placeholder: p.defaultValue,
                    pattern: p.pattern,
                    patternMessage: p.patternMessage,
                    options: p.allowedValues,
                    minLength: p.minLength,
                    maxLength: p.maxLength,
                    minValue: p.minValue,
                    maxValue: p.maxValue
                }));

                manifest[pipelineId.toString()] = {
                    pipelineName: pipeline?.name || `Pipeline ${pipelineId}`,
                    fields
                };

                logger.debug(`Manifest for ${pipelineId}:`, { fieldCount: fields.length });
            } catch (err) {
                logger.error(`Failed to generate manifest for pipeline ${pipelineId}`, { error: err });
            }
        }

        // 2. Fetch all standalone form agents for the organization
        try {
            const formAgents = await db.select().from(jobs).where(and(
                eq(jobs.organizationId, deployment.organizationId),
                eq(jobs.type, "form_agent")
            ));

            for (const agent of formAgents) {
                const config = agent.config as any;
                if (config?.formSchema?.fields) {
                    manifest[`job_${agent.id}`] = {
                        pipelineName: agent.name,
                        fields: config.formSchema.fields.map((f: any) => ({
                            name: f.key,
                            label: f.label || f.key,
                            type: f.type || 'string',
                            required: f.required,
                            description: f.description,
                            placeholder: f.placeholder || f.defaultValue,
                            options: f.options,
                            pattern: f.pattern,
                            patternMessage: f.patternMessage,
                            minLength: f.minLength,
                            maxLength: f.maxLength,
                            minValue: f.minValue,
                            maxValue: f.maxValue
                        }))
                    };
                }
            }
        } catch (err) {
            logger.error(`Failed to fetch standalone form agents for deployment ${deploymentId}`, { error: err });
        }

        // 3. Asset-service deterministic forms (intent/diagnostic/restock/feedback/escalation).
        // Built from the blueprint-owned `assetForms` on the agent's job config when present,
        // otherwise from the resolver's defaults. This makes the blueprint the source of truth.
        try {
            const [job] = await db.select({ config: jobs.config }).from(jobs).where(eq(jobs.id, deployment.jobId)).limit(1);
            const blueprintAssetForms = (job?.config as any)?.assetForms ?? null;
            const isAssetServiceAgent = blueprintAssetForms
                || (job?.config as any)?.allowedTools?.includes?.("generate_diagnostic_questions")
                || (deployment.slug && String(deployment.slug).includes("service-bot"));
            if (isAssetServiceAgent) {
                const { chatFormResolver } = await import("@domain/asset-service/chat-form-resolver.service.js");
                Object.assign(manifest, chatFormResolver.buildFullManifest(blueprintAssetForms));
                // Refresh the Redis block cache so served forms reflect the new manifest.
                try {
                    const { formBlockService } = await import("@domain/asset-service/form-block.service.js");
                    await formBlockService.invalidate(deployment.organizationId);
                } catch { /* non-fatal */ }
            }
        } catch (err) {
            logger.error(`Failed to merge asset-service forms for deployment ${deploymentId}`, { error: err });
        }

        // 4. Blueprint-declared intake form — the structured turn an agent serves
        // first, with no model call. Same ownership model as `assetForms` above:
        // the blueprint puts it on the job config, and the manifest is where every
        // consumer (the chat route's fast path, the derived fallback routes) finds
        // it. Merged last so a blueprint can deliberately override a generated
        // pipeline form of the same id.
        try {
            const [job] = await db.select({ config: jobs.config }).from(jobs).where(eq(jobs.id, deployment.jobId)).limit(1);
            const intakeForm = (job?.config as any)?.intakeForm;
            if (intakeForm?.formId && Array.isArray(intakeForm.fields) && intakeForm.fields.length > 0) {
                manifest[intakeForm.formId] = {
                    pipelineName: intakeForm.pipelineName || intakeForm.formId,
                    fields: intakeForm.fields,
                    servesInitialTurn: intakeForm.servesInitialTurn !== false,
                };
                logger.info(`Merged blueprint intake form "${intakeForm.formId}" for deployment ${deploymentId}`);
            }
        } catch (err) {
            logger.error(`Failed to merge blueprint intake form for deployment ${deploymentId}`, { error: err });
        }

        await db.update(agentDeployments)
            .set({
                formManifest: manifest,
                updatedAt: new Date()
            })
            .where(eq(agentDeployments.id, deploymentId));

        logger.info(`Updated form manifest for deployment ${deploymentId}`, {
            pipelineCount: allowedPipelineIds.length,
            formAgentCount: Object.keys(manifest).length - allowedPipelineIds.length
        });

        // Fallback routes are derived FROM the form manifest, so they must be
        // regenerated whenever it changes — otherwise a newly granted form is
        // unreachable in limp mode until the next deploy.
        try {
            const { agentFallbackService } = await import("./agent-fallback.service.js");
            await agentFallbackService.derive(deploymentId);
        } catch (err: any) {
            logger.warn(`Failed to re-derive fallbacks after manifest update for ${deploymentId}`, { error: err.message });
        }

        return manifest;
    }

    /**
     * Get deployment by jobId
     */
    static async getByJobId(jobId: number, organizationId: number): Promise<AgentDeployment | null> {
        const deployment = await db.query.agentDeployments.findFirst({
            where: and(
                eq(agentDeployments.jobId, jobId),
                eq(agentDeployments.organizationId, organizationId)
            )
        });
        return deployment || null;
    }

    /**
     * Get deployment by slug
     */
    static async getBySlug(slug: string): Promise<AgentDeployment | null> {
        const deployment = await db.query.agentDeployments.findFirst({
            where: eq(agentDeployments.slug, slug)
        });
        return deployment || null;
    }

    /**
     * Get deployment by ID
     */
    static async getById(id: number): Promise<AgentDeployment | null> {
        const [deployment] = await db.select().from(agentDeployments).where(eq(agentDeployments.id, id)).limit(1);
        return deployment || null;
    }

    /**
     * Update or create a deployment
     */
    static async upsert(data: Partial<AgentDeployment> & { jobId: number; organizationId: number }): Promise<AgentDeployment> {
        const existing = await this.getByJobId(data.jobId, data.organizationId);

        let deployment: AgentDeployment;
        if (existing) {
            const [updated] = await db.update(agentDeployments)
                .set({
                    ...data,
                    updatedAt: new Date(),
                })
                .where(eq(agentDeployments.id, existing.id))
                .returning();
            deployment = updated;
        } else {
            const [inserted] = await db.insert(agentDeployments)
                .values(data as any)
                .returning();
            deployment = inserted;
        }

        // Every agent gets a deterministic limp mode at synthesis time. This runs
        // on the single chokepoint all creation paths funnel through (the deploy
        // route, blueprint synthesis, legacy migration), so an agent cannot come
        // into existence without one. Non-fatal: a derivation failure must not
        // block the deployment itself, and the backfill script will catch it.
        try {
            deployment = await this.syncFallbacks(deployment);
        } catch (err: any) {
            logger.warn(`Failed to derive fallbacks for deployment ${deployment.id}`, { error: err.message });
        }

        return deployment;
    }

    /**
     * Regenerate the deterministic fallback manifest for a deployment.
     *
     * Called after any change to the agent's permissions, since routes are
     * derived from formManifest/allowedPipelineIds/allowedTools and would
     * otherwise drift from what the agent is actually allowed to do.
     */
    static async syncFallbacks(deployment: AgentDeployment): Promise<AgentDeployment> {
        const { agentFallbackService } = await import("./agent-fallback.service.js");
        const manifest = await agentFallbackService.derive(deployment.id);
        return { ...deployment, fallbackManifest: manifest } as AgentDeployment;
    }

    /**
     * Update branding (specifically for avatar upload)
     */
    static async updateBranding(id: number, brandingConfig: any): Promise<void> {
        await db.update(agentDeployments)
            .set({ brandingConfig })
            .where(eq(agentDeployments.id, id));
    }

    /**
     * Update deployment metadata by deployment id.
     */
    static async updateDeployment(id: number, data: Partial<AgentDeployment>): Promise<AgentDeployment | null> {
        const [updated] = await db.update(agentDeployments)
            .set({
                ...data,
                updatedAt: new Date()
            } as any)
            .where(eq(agentDeployments.id, id))
            .returning();
        return updated || null;
    }

    /**
     * List recent messages
     */
    static async listRecentMessages(jobId: number, userId: string, limit: number = 50) {
        const { agentChatMessages } = await import("@shared/schema/index.js");
        const { desc } = await import("drizzle-orm");

        return await db.select({
            id: agentChatMessages.id,
            role: agentChatMessages.role,
            content: agentChatMessages.content,
            timestamp: agentChatMessages.createdAt,
            rating: agentChatMessages.rating,
            feedbackReason: agentChatMessages.feedbackReason,
            metadata: agentChatMessages.metadata
        })
            .from(agentChatMessages)
            .where(and(
                eq(agentChatMessages.jobId, jobId),
                eq(agentChatMessages.userId, userId)
            ))
            .orderBy(desc(agentChatMessages.createdAt))
            .limit(limit);
    }

    /**
     * List recent run steps
     */
    static async listRecentSteps(jobId: number, sessionId?: string, limit: number = 100) {
        const { agentRunSteps } = await import("@shared/schema/index.js");
        const { desc } = await import("drizzle-orm");

        return await db.select()
            .from(agentRunSteps)
            .where(and(
                eq(agentRunSteps.jobId, jobId),
                sessionId ? eq(agentRunSteps.userId, sessionId) : undefined
            ))
            .orderBy(desc(agentRunSteps.createdAt))
            .limit(limit);
    }

    /**
     * Get organization settings
     */
    static async getOrgSettings(organizationId: number) {
        const { orgSettings } = await import("@shared/schema/index.js");
        const [settings] = await db.select().from(orgSettings).where(eq(orgSettings.organizationId, organizationId)).limit(1);
        return settings;
    }

    /**
     * Get job by ID and organization
     */
    static async getJobById(jobId: number, organizationId: number) {
        const { jobs } = await import("@shared/schema/index.js");
        const [job] = await db.select().from(jobs).where(and(
            eq(jobs.id, jobId),
            eq(jobs.organizationId, organizationId)
        ));
        return job;
    }

    /**
     * List all agent deployments for an organization.
     */
    static async listDeployments(organizationId: number): Promise<any[]> {
        const { desc, inArray, sql } = await import("drizzle-orm");
        const deployments = await db.select()
            .from(agentDeployments)
            .where(eq(agentDeployments.organizationId, organizationId))
            .orderBy(desc(agentDeployments.updatedAt));

        if (deployments.length === 0) return [];

        // Get unique pipeline IDs across all deployments
        const pipelineIds = new Set<number>();
        for (const dep of deployments) {
            if (dep.allowedPipelineIds) {
                for (const pid of dep.allowedPipelineIds) {
                    pipelineIds.add(pid);
                }
            }
        }

        // Fetch pipeline names
        const pipelineMap = new Map<number, string>();
        if (pipelineIds.size > 0) {
            const fetchedPipelines = await db.select({ id: pipelines.id, name: pipelines.name })
                .from(pipelines)
                .where(inArray(pipelines.id, Array.from(pipelineIds)));
            for (const p of fetchedPipelines) {
                pipelineMap.set(p.id, p.name);
            }
        }

        // Fetch metrics per deployment
        const { agentChatMessages } = await import("@shared/schema/index.js");
        const jobIds = deployments.map(d => d.jobId);
        
        let metrics: any[] = [];
        try {
            metrics = await db.select({
                jobId: agentChatMessages.jobId,
                averageRating: sql<number>`avg(${agentChatMessages.rating})`,
                totalInteractions: sql<number>`count(${agentChatMessages.id})`
            })
            .from(agentChatMessages)
            .where(inArray(agentChatMessages.jobId, jobIds))
            .groupBy(agentChatMessages.jobId);
        } catch (err) {
            logger.warn("Failed to fetch agent metrics", undefined, err);
        }

        const metricsMap = new Map<number, any>();
        for (const m of metrics) {
            metricsMap.set(m.jobId, m);
        }

        return deployments.map(dep => {
            const depPipelineNames = (dep.allowedPipelineIds || []).map(id => pipelineMap.get(id)).filter(Boolean);
            const m = metricsMap.get(dep.jobId) || { averageRating: 0, totalInteractions: 0 };
            return {
                ...dep,
                pipelineNames: depPipelineNames,
                stats: {
                    averageRating: m.averageRating ? Number(m.averageRating).toFixed(1) : null,
                    totalInteractions: Number(m.totalInteractions || 0)
                }
            };
        });
    }
}


