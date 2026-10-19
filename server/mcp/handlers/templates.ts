import { z } from "zod";
import { templatesService } from "@domain/core/infrastructure/templates.service.js";
import { successResponse, errorResponse, type ToolContext } from "./utils.js";

export const ListTemplatesInput = z.object({
    search: z.string().optional(),
    category: z.string().optional(),
    limit: z.number().optional().default(10),
});

export const GetTemplateDetailsInput = z.object({
    templateId: z.number().optional(),
    templateName: z.string().optional(),
});

export async function handleListTemplates(args: unknown, context?: ToolContext) {
    try {
        const input = ListTemplatesInput.parse(args);
        const results = await templatesService.listTemplates();

        let filtered = results;
        if (input.search) {
            const searchLower = input.search.toLowerCase();
            filtered = results.filter(t => t.name.toLowerCase().includes(searchLower));
        }
        if (input.category) {
            filtered = filtered.filter(t => t.category === input.category);
        }

        return successResponse(
            filtered.slice(0, input.limit),
            `Found ${filtered.length} templates`
        );
    } catch (error: any) {
        return errorResponse(error.message);
    }
}

export async function handleGetTemplateDetails(args: unknown, context?: ToolContext) {
    try {
        const input = GetTemplateDetailsInput.parse(args);
        const all = await templatesService.listTemplates();

        let template;
        if (input.templateId) {
            template = all.find(t => t.id === input.templateId);
        } else if (input.templateName) {
            template = all.find(t => t.name.toLowerCase().includes(input.templateName!.toLowerCase()));
        }

        if (!template) {
            return errorResponse("Template not found");
        }

        return successResponse(template, `Template: ${template.name}`);
    } catch (error: any) {
        return errorResponse(error.message);
    }
}

export const InstantiateTemplateInput = z.object({
    templateId: z.number().describe("ID of the template to instantiate"),
    name: z.string().optional().describe("Name for the new pipeline (defaults to '<template> (Copy)')"),
    parameters: z.record(z.any()).optional().describe("Key/value pairs to substitute {{placeholders}} in the template config"),
});

export async function handleInstantiateTemplate(args: unknown, context?: ToolContext) {
    try {
        const input = InstantiateTemplateInput.parse(args);

        if (!context?.organizationId || !context?.userId) {
            return errorResponse("Organization and user context required to instantiate a template");
        }

        const pipeline = await templatesService.instantiateTemplate(
            input.templateId,
            { name: input.name, parameters: input.parameters },
            { organizationId: context.organizationId, userId: context.userId },
        );

        return successResponse(pipeline, `Pipeline "${pipeline.name}" created from template (ID: ${pipeline.id})`);
    } catch (error: any) {
        return errorResponse(error.message);
    }
}

