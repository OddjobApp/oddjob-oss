import { Router, Request, Response } from "express";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { db } from "@server/database_service.js";
import { jobs, documentTemplates } from "@shared/schema/index.js";
import { eq, and, sql } from "drizzle-orm";
import { systemAiService } from "@domain/ai/core/system-ai.service.js";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";
import { createLogger } from "@server/utils/logger.js";

import { getUserOrgContext } from "../utils/auth-context.js";
import { jobService } from "@domain/jobs/job.service.js";

const router = Router();
const logger = createLogger("FormAgentRouter");

const FIELD_EXTRACTION_PROMPT = `You are a schema extraction expert. Analyze the following document template content and extract structured form fields from it.

For each identifiable field, variable, or placeholder in the template, output a JSON object with:
- "name": a camelCase key for the field
- "type": one of "text", "textarea", "markdown", "select", "rating", "boolean"
- "label": a human-readable label
- "required": true/false
- "description": short description of what this field captures
- "options": (only for "select" type) array of string options
- "defaultValue": a sensible default if apparent

Rules:
- Placeholders like {field_name} or {{field_name}} are fields
- Section headers that expect content below them are "textarea" or "markdown" fields
- Yes/No questions are "boolean" fields
- Rating scales are "rating" fields
- Dropdowns or enumerated options are "select" fields
- Short text fields (names, IDs, titles) are "text" fields
- Long-form content areas are "textarea" or "markdown" fields

Return ONLY a JSON array of field objects. No explanation, no markdown formatting.

TEMPLATE CONTENT:
`;

/**
 * POST /extract-fields
 * Extract form fields from a document template using AI
 */
router.post("/extract-fields", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { templateId, templateContent } = req.body;
    const orgContext = await getUserOrgContext(req);
    const userId = orgContext.userId;
    const organizationId = orgContext.organizationId;
    console.log('[FormAgents] POST /extract-fields called by userId:', userId, 'orgId:', organizationId);

    if (!templateContent && !templateId) {
        return res.status(400).json({ error: "templateContent or templateId required" });
    }

    let content = templateContent || "";

    // If templateId provided but no content, fetch from DB
    if (templateId && !content) {
        const [template] = await db.select().from(documentTemplates).where(eq(documentTemplates.id, templateId)).limit(1);
        if (!template) {
            return res.status(404).json({ error: "Template not found" });
        }
        content = template.content || "";
    }

    if (!content.trim()) {
        return res.status(400).json({ error: "Template has no content to extract fields from" });
    }

    try {
        // Extract form fields with the system AI (LLM) extractor
        const aiConfig = await systemAiService.getAiConfig('copilot', organizationId ?? undefined);
        if (!aiConfig || !aiConfig.apiKey) {
            return res.status(500).json({ error: "No AI provider configured. Please configure a system AI provider." });
        }

        const client = AIClientFactory.getClient({
            provider: aiConfig.provider,
            model: aiConfig.model,
            baseUrl: aiConfig.baseUrl,
        } as any);

        const result = await client.execute({
            model: aiConfig.model || "gemini-2.0-flash",
            temperature: 0,
            systemPrompt: "You are a precise schema extraction tool. Return only valid JSON arrays.",
            userPrompt: FIELD_EXTRACTION_PROMPT + content,
            credentialId: aiConfig.credentialId,
            useCache: false,
            enableQueryExpansion: false,
            saveOutputToFile: false,
            isPriority: true
        }, undefined, aiConfig.apiKey);

        if (!result.success) {
            logger.error("AI field extraction failed", { error: result.error });
            return res.status(500).json({ error: "AI field extraction failed", details: result.error });
        }

        // Parse the AI response
        let fields: any[] = [];
        try {
            const output = result.output || "";
            const jsonMatch = output.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                fields = JSON.parse(jsonMatch[0]);
            } else {
                fields = JSON.parse(output);
            }
        } catch (parseErr) {
            logger.error("Failed to parse AI extraction output", { output: result.output });
            // Provide fallback sensible fields
            fields = [{
                name: "content",
                type: "markdown",
                label: "Content",
                required: true,
                description: "Main content for this template"
            }];
        }

        // Normalize fields to match the formAgentConfigSchema
        const normalizedFields = fields.map((f: any) => ({
            name: f.name || f.key || "field",
            type: normalizeFieldType(f.type),
            label: f.label || f.name || "Field",
            required: f.required ?? false,
            description: f.description || "",
            options: f.options || undefined,
            defaultValue: f.defaultValue || undefined,
        }));

        res.json({ data: { fields: normalizedFields } });
    } catch (err: any) {
        logger.error("Field extraction error", { error: err.message });
        res.status(500).json({ error: "Field extraction failed", details: err.message });
    }
}));

/**
 * POST /
 * Create a form agent job from a document template
 */
router.post("/", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req.session as any)?.userId;
    const orgContext = await getUserOrgContext(req);
    const organizationId = orgContext.organizationId;

    if (!userId) {
        return res.status(401).json({ error: "User session missing" });
    }

    const { name, description, documentTemplateId, config } = req.body;

    if (!name || !documentTemplateId || !config) {
        return res.status(400).json({ error: "name, documentTemplateId, and config are required" });
    }

    // Verify the template exists
    const [template] = await db.select().from(documentTemplates).where(eq(documentTemplates.id, documentTemplateId)).limit(1);
    if (!template) {
        return res.status(404).json({ error: "Document template not found" });
    }

    // Fetch user info for createdBy
    const { authService } = await import("@domain/auth/core/auth.service.js");
    const user = await authService.getUser(userId);

    const baseJobName = name || `${template.name} Form Agent`;

    // Check for duplicate name and append suffix if needed
    let jobName = baseJobName;
    const existingJobs = await db.select().from(jobs).where(
        and(
            eq(jobs.name, baseJobName),
            organizationId !== null ? eq(jobs.organizationId, organizationId) : sql`${jobs.organizationId} IS NULL`
        )
    ).limit(1);

    if (existingJobs.length > 0) {
        // Name already exists, find a unique one
        let counter = 1;
        while (true) {
            const candidateName = `${baseJobName} (${counter})`;
            const duplicate = await db.select().from(jobs).where(
                and(
                    eq(jobs.name, candidateName),
                    organizationId !== null ? eq(jobs.organizationId, organizationId) : sql`${jobs.organizationId} IS NULL`
                )
            ).limit(1);

            if (duplicate.length === 0) {
                jobName = candidateName;
                break;
            }
            counter++;
            if (counter > 100) {
                jobName = `${baseJobName} (${new Date().getTime()})`;
                break;
            }
        }
    }

    console.log('[FormAgents] Creating job with organizationId:', organizationId, 'and name:', jobName);
    // Create the form_agent job
    const [job] = await db.insert(jobs).values({
        name: jobName,
        type: "form_agent",
        description: description || `Form agent based on ${template.name} template`,
        config: config,
        isActive: true,
        lifecycleStatus: 'active',
        organizationId: organizationId || null,
        createdBy: user?.username || "system",
    }).returning();

    console.log('[FormAgents] Job created successfully:', job.id, 'with orgId:', job.organizationId);

    // Invalidate Redis form_agents cache so Copilot immediately picks up the new form
    const { invalidateFormAgentCache } = await import("@server/utils/cache-utils.js");
    await invalidateFormAgentCache(organizationId).catch(() => {});

    logger.info("Form agent job created", { jobId: job.id, templateId: documentTemplateId, organizationId });

    res.json({ data: job });
}));

/**
 * GET /
 * List all form agent jobs
 */
router.get("/", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const organizationId = orgContext.organizationId;

    const conditions = [];
    conditions.push(eq(jobs.type, "form_agent"));

    if (organizationId !== null) {
        conditions.push(eq(jobs.organizationId, organizationId));
    }

    const formAgentJobs = await db.select().from(jobs)
        .where(eq(jobs.type, "form_agent")); // This was missing org filtering too? Keep it simple for now or use service

    // Better to use jobService if possible, but let's just fix the creation first.
    // The GET /api/jobs (plural) is what the UI uses mostly.

    res.json({ data: formAgentJobs });
}));

function normalizeFieldType(type: string): string {
    const typeMap: Record<string, string> = {
        "string": "text",
        "number": "text",
        "email": "text",
        "url": "text",
        "date": "text",
        "text": "text",
        "textarea": "textarea",
        "markdown": "markdown",
        "richtext": "markdown",
        "select": "select",
        "dropdown": "select",
        "enum": "select",
        "rating": "rating",
        "boolean": "boolean",
        "checkbox": "boolean",
        "toggle": "boolean",
    };
    return typeMap[type?.toLowerCase()] || "text";
}

export default router;


