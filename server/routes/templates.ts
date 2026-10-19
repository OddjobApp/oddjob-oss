// @ts-nocheck
import { type Express, type Request, type Response } from "express";
import { validateIdParam } from "@server/utils/api-utils.js";
import * as fs from "fs/promises";
import * as path from "path";
import { schemaMappingTemplates, pipelineTemplates, orgSettings } from "@shared/schema/index.js";
import { getUserOrgContext } from "../utils/auth-context.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { createLogger } from "@server/utils/logger.js";
import { templatesService } from "@domain/core/infrastructure/templates.service.js";
import { AgentDeploymentService } from "../domain/agents/agent-deployment.service.js";

const logger = createLogger('Templates');

export function registerTemplateRoutes(app: Express) {

    // =============================================
    // PIPELINE TEMPLATES
    // =============================================

    // Get all pipeline templates
    app.get("/api/templates", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const { category, search } = req.query;
        const orgContext = await getUserOrgContext(req);

        // Fetch org settings for filtering
        const settings = await AgentDeploymentService.getOrgSettings(orgContext.organizationId!);
        const allowedJobTypes = settings?.allowedJobTypes as string[] | undefined;

        // Note: Pipeline templates are global (not org-specific)
        const templates = await templatesService.listTemplates();

        // Helper to check if a type is allowed
        const isTypeAllowed = (type: string) => {
            if (!allowedJobTypes) return true;
            if (allowedJobTypes.length === 0) return false;
            return allowedJobTypes.includes(type);
        };

        // Filter in-memory
        let filtered = templates.filter(t => {
            // Check config for restricted types
            const config = t.config as any;
            if (!config) return true;

            const typesUsed = new Set<string>();

            // Check 'jobs' array
            if (Array.isArray(config.jobs)) {
                config.jobs.forEach((j: any) => {
                    if (j.type) typesUsed.add(j.type);
                });
            }

            // Check 'steps' array
            if (Array.isArray(config.steps)) {
                config.steps.forEach((s: any) => {
                    if (s.moduleType === 'job' && s.jobConfig?.type) {
                        typesUsed.add(s.jobConfig.type);
                    }
                    // Check implicit types from templates
                    if (s.moduleType === 'iterator_template') typesUsed.add('iterator');
                    if (s.moduleType === 'decision_template') typesUsed.add('decision');
                    // Add other implicit templates if needed (repeater_template -> iterator/repeater)
                    if (s.moduleType === 'repeater_template') typesUsed.add('iterator');
                });
            }

            // If any used type is disallowed, filter out this template
            for (const type of typesUsed) {
                if (!isTypeAllowed(type)) return false;
            }
            return true;
        });

        if (category && category !== 'all') {
            filtered = filtered.filter(t => t.category === category);
        }
        if (search) {
            const searchLower = String(search).toLowerCase();
            filtered = filtered.filter(t =>
                t.name.toLowerCase().includes(searchLower) ||
                (t.description?.toLowerCase().includes(searchLower))
            );
        }

        res.json(filtered);
    }));

    // Get single pipeline template
    app.get("/api/templates/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const id = validateIdParam(req.params.id);

        const template = await templatesService.getTemplate(id);

        if (!template) {
            return res.status(404).json({ error: "Template not found" });
        }

        res.json(template);
    }));

    // Create pipeline template (admin only)
    app.post("/api/templates", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const orgContext = await getUserOrgContext(req);

        if (!orgContext.isAdmin) {
            return res.status(403).json({ error: "Admin access required" });
        }

        const { name, description, category, icon, config, parameterSchema, isFeatured } = req.body;

        const template = await templatesService.createTemplate({
            name,
            description,
            category: category || 'general',
            icon,
            config,
            parameterSchema,
            isFeatured: isFeatured || false,
            createdBy: orgContext.userId
        });

        logger.info('Created pipeline template', { templateId: template.id, name });
        res.json(template);
    }));

    // Delete pipeline template (admin only)
    app.delete("/api/templates/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const orgContext = await getUserOrgContext(req);

        if (!orgContext.isAdmin) {
            return res.status(403).json({ error: "Admin access required" });
        }

        const id = validateIdParam(req.params.id);
        await templatesService.deleteTemplate(id, orgContext);

        logger.info('Deleted pipeline template', { templateId: id });
        res.status(204).send();
    }));

    // Instantiate a template (create pipeline from template)
    app.post("/api/templates/:id/instantiate", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const id = validateIdParam(req.params.id);
        const { name, parameters } = req.body;
        const orgContext = await getUserOrgContext(req);

        logger.info('Instantiating template', { templateId: id, name, orgId: orgContext.organizationId });

        const pipeline = await templatesService.instantiateTemplate(
            id,
            { name, parameters },
            { organizationId: orgContext.organizationId!, userId: orgContext.userId }
        );

        res.json(pipeline);
    }));

    // Initialize a wizard session for a template
    app.post("/api/templates/:id/wizard-session", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const id = validateIdParam(req.params.id);
        const orgContext = await getUserOrgContext(req);

        const template = await templatesService.getTemplate(id);
        if (!template) {
            return res.status(404).json({ error: "Template not found" });
        }

        const { db } = await import("@server/db");
        const { pipelines } = await import("@shared/schema");

        // Create a draft pipeline to hold the jobs for this wizard session
        const [pipeline] = await db.insert(pipelines).values({
            name: `${template.name} (Draft)`,
            description: template.description || '',
            organizationId: orgContext.organizationId,
            lifecycleStatus: 'draft',
            settings: { fromWizard: true }
        }).returning();

        logger.info('Created wizard session', { templateId: id, pipelineId: pipeline.id });

        res.json({
            sessionId: Date.now(), // Simplified session ID
            pipelineId: pipeline.id,
            templateConfig: template.config
        });
    }));

    // =============================================
    // SCHEMA MAPPING TEMPLATES
    // =============================================

    // Get all schema mapping templates for the user's organization
    app.get("/api/templates/schema-mappings", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const orgContext = await getUserOrgContext(req);

        const templates = await templatesService.listSchemaMappingTemplates(orgContext.organizationId!);

        res.json(templates);
    }));

    // Create a new schema mapping template
    app.post("/api/templates/schema-mappings", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const orgContext = await getUserOrgContext(req);
        const { name, description, mappingConfig } = req.body;

        const template = await templatesService.createSchemaMappingTemplate({
            name,
            description,
            mappingConfig,
            organizationId: orgContext.organizationId!
        });

        logger.info('Created schema mapping template', {
            templateId: template.id,
            organizationId: orgContext.organizationId
        });

        res.json(template);
    }));

    // Delete a schema mapping template
    app.delete("/api/templates/schema-mappings/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const orgContext = await getUserOrgContext(req);
        const id = validateIdParam(req.params.id);
        await templatesService.deleteSchemaMappingTemplate(id, orgContext.organizationId!);

        res.status(204).send();
    }));

    // =============================================
    // AGENT TEMPLATES (Static Registry)
    // =============================================

    app.get("/api/agent-templates", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        try {
            const templatePath = path.join(process.cwd(), "server", "templates", "agents.json");
            const data = await fs.readFile(templatePath, "utf-8");
            const templates = JSON.parse(data);
            res.json(templates);
        } catch (error) {
            logger.error("Failed to load agent templates", { error });
            // Return empty array if file missing or parse error, to avoid breaking UI
            res.json([]);
        }
    }));
}

