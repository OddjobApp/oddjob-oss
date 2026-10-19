
import { db } from "@server/database_service.js";
import { pipelineTemplates, schemaMappingTemplates, pipelines, pipelineSteps, jobs } from "@shared/schema/index.js";
import { eq, desc, and } from "drizzle-orm";
import { BadRequestError, NotFoundError, ForbiddenError } from "@server/utils/errors.js";

export const templatesService = {
    /**
     * List all templates
     */
    async listTemplates() {
        return await db
            .select()
            .from(pipelineTemplates)
            .orderBy(desc(pipelineTemplates.isFeatured), desc(pipelineTemplates.createdAt));
    },

    /**
     * Get a single template by ID
     */
    async getTemplate(templateId: number) {
        const [template] = await db
            .select()
            .from(pipelineTemplates)
            .where(eq(pipelineTemplates.id, templateId))
            .limit(1);
        return template ?? null;
    },

    /**
     * Create a new pipeline template
     */
    async createTemplate(input: {
        name: string;
        description?: string;
        category?: string;
        icon?: string;
        config: any;
        parameterSchema?: any;
        isFeatured?: boolean;
        createdBy: string;
    }) {
        const [template] = await db
            .insert(pipelineTemplates)
            .values({
                name: input.name,
                description: input.description,
                category: input.category ?? "general",
                icon: input.icon,
                config: input.config,
                parameterSchema: input.parameterSchema ?? {},
                isFeatured: input.isFeatured ?? false,
                createdBy: input.createdBy,
            } as any)
            .returning();
        return template;
    },

    /**
     * List schema mapping templates for an org
     */
    async listSchemaMappingTemplates(organizationId: number) {
        return await db
            .select()
            .from(schemaMappingTemplates)
            .where(eq(schemaMappingTemplates.organizationId, organizationId))
            .orderBy(desc(schemaMappingTemplates.id));
    },

    /**
     * Create a schema mapping template
     */
    async createSchemaMappingTemplate(input: {
        name: string;
        description?: string;
        mappingConfig: any;
        organizationId: number;
    }) {
        const [template] = await db
            .insert(schemaMappingTemplates)
            .values({
                name: input.name,
                description: input.description,
                mappingConfig: input.mappingConfig,
                organizationId: input.organizationId,
            } as any)
            .returning();
        return template;
    },

    /**
     * Delete a schema mapping template (org-scoped)
     */
    async deleteSchemaMappingTemplate(templateId: number, organizationId: number) {
        const [existing] = await db
            .select()
            .from(schemaMappingTemplates)
            .where(and(
                eq(schemaMappingTemplates.id, templateId),
                eq(schemaMappingTemplates.organizationId, organizationId),
            ))
            .limit(1);

        if (!existing) throw new NotFoundError("Schema mapping template not found");

        await db
            .delete(schemaMappingTemplates)
            .where(eq(schemaMappingTemplates.id, templateId));
    },

    /**
     * Delete a template
     */
    async deleteTemplate(templateId: number, orgContext: { isAdmin: boolean }) {
        if (!orgContext.isAdmin) {
            throw new ForbiddenError("Only admins can delete templates");
        }

        const [template] = await db
            .select()
            .from(pipelineTemplates)
            .where(eq(pipelineTemplates.id, templateId))
            .limit(1);

        if (!template) {
            throw new NotFoundError("Template not found");
        }

        await db
            .delete(pipelineTemplates)
            .where(eq(pipelineTemplates.id, templateId));
    },

    /**
     * Instantiate a pipeline from a template
     */
    async instantiateTemplate(
        templateId: number,
        input: { name?: string; parameters?: Record<string, any> },
        context: { organizationId: number | null; userId: string }
    ) {
        const { name, parameters } = input;
        const { organizationId, userId } = context;

        // 1. Get Template
        const [template] = await db
            .select()
            .from(pipelineTemplates)
            .where(eq(pipelineTemplates.id, templateId))
            .limit(1);

        if (!template) {
            throw new NotFoundError("Template not found");
        }

        // 2. Validate Parameters
        const config = template.config as any;
        if (!config || !config.steps) {
            throw new BadRequestError("Template configuration is missing steps");
        }

        // 3. Process Config (Replace parameters)
        let configStr = JSON.stringify(config);

        if (parameters) {
            for (const [key, value] of Object.entries(parameters)) {
                const pattern = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g');
                configStr = configStr.replace(pattern, String(value));
            }
        }

        const processedConfig = JSON.parse(configStr);

        // 4. Create Pipeline
        const pipelineData = {
            name: name || `${template.name} (Copy)`,
            description: processedConfig.description || template.description,
            triggerType: processedConfig.triggerType || "manual",
            triggerCredentialId: processedConfig.triggerCredentialId,
            isActive: true,
            organizationId,
            createdBy: userId,
        };

        const [newPipeline] = await db.insert(pipelines).values(pipelineData).returning();

        // 5. Create Jobs & Steps
        if (processedConfig.jobs && Array.isArray(processedConfig.jobs)) {
            const jobIdMap = new Map<number | string, number>();

            for (const jobDef of processedConfig.jobs) {
                const { id: _, ...jobData } = jobDef;
                jobData.organizationId = organizationId;
                jobData.createdBy = userId;

                const [newJob] = await db.insert(jobs).values(jobData).returning();

                if (jobDef.id) {
                    jobIdMap.set(jobDef.id, newJob.id);
                }
            }

            if (processedConfig.steps && Array.isArray(processedConfig.steps)) {
                for (const step of processedConfig.steps) {
                    let realJobId = step.jobId;
                    if (jobIdMap.has(step.jobId)) {
                        realJobId = jobIdMap.get(step.jobId);
                    }

                    await db.insert(pipelineSteps).values({
                        pipelineId: newPipeline.id,
                        jobId: realJobId,
                        order: step.order,
                        moduleType: step.moduleType,
                        runOnCondition: step.runOnCondition || 'on_success',
                        onFailureAction: step.onFailureAction || 'Stop Pipeline',
                        destinationStepId: null,
                        outputName: step.outputName,
                        waitDurationSeconds: step.waitDurationSeconds,
                        conditionExpression: step.conditionExpression,
                        decisionNodeConfig: step.decisionNodeConfig,
                    });
                }
            }
        }

        return newPipeline;
    },

    /**
     * Create Template from Existing Pipeline
     */
    async createTemplateFromPipeline(
        input: { pipelineId: number; name: string; description?: string; category?: string },
        userId: string
    ) {
        const { pipelineId, name, description, category } = input;

        // 1. Fetch Source Pipeline
        const [pipeline] = await db
            .select()
            .from(pipelines)
            .where(eq(pipelines.id, pipelineId))
            .limit(1);

        if (!pipeline) throw new NotFoundError("Source pipeline not found");

        // 2. Fetch Steps & Jobs
        const steps = await db
            .select({
                step: pipelineSteps,
                job: jobs
            })
            .from(pipelineSteps)
            .innerJoin(jobs, eq(pipelineSteps.jobId, jobs.id))
            .where(eq(pipelineSteps.pipelineId, pipelineId))
            .orderBy(pipelineSteps.order);

        // 3. Construct Template Config
        const templateConfig = {
            description: pipeline.description,
            triggerType: pipeline.triggerType,
            jobs: steps.map(({ job }) => ({
                id: `job-${job.id}`,
                name: job.name,
                type: job.type,
                config: job.config,
                tool: job.tool
            })),
            steps: steps.map(({ step, job }) => ({
                jobId: `job-${job.id}`,
                order: step.order,
                outputName: step.outputName,
                runOnCondition: step.runOnCondition,
                waitDurationSeconds: step.waitDurationSeconds,
                moduleType: step.moduleType,
                conditionExpression: step.conditionExpression,
                decisionNodeConfig: step.decisionNodeConfig,
                onFailureAction: step.onFailureAction,
            }))
        };

        // 4. Create Template Record
        const [newTemplate] = await db.insert(pipelineTemplates).values({
            name,
            description: description || pipeline.description,
            category: category || "custom",
            config: templateConfig as any,
            parameterSchema: {},
            createdBy: userId,
            isFeatured: false
        } as any).returning();

        return newTemplate;
    },

    /**
     * Start Wizard Session (Draft Pipeline)
     */
    async startWizardSession(
        templateId: number,
        context: { organizationId: number | null; userId: string }
    ) {
        const { organizationId, userId } = context;

        const [template] = await db
            .select()
            .from(pipelineTemplates)
            .where(eq(pipelineTemplates.id, templateId))
            .limit(1);

        if (!template) throw new NotFoundError("Template not found");

        const config = template.config as any;

        // Create Draft Pipeline
        const [draftPipeline] = await db.insert(pipelines).values({
            name: `${template.name} (Draft)`,
            description: template.description,
            triggerType: config.triggerType || "manual",
            isActive: false,
            lifecycleStatus: 'draft',
            organizationId,
            createdBy: userId,
        }).returning();

        return {
            sessionId: draftPipeline.id,
            pipelineId: draftPipeline.id,
            templateConfig: config,
            parameterSchema: template.parameterSchema
        };
    }
};




