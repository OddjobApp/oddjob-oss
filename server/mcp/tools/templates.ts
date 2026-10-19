import { Tool } from "@modelcontextprotocol/sdk/types.js";

export const templateToolDefinitions: Tool[] = [
    {
        name: "list_templates",
        description:
            "List available pipeline templates in the template gallery. " +
            "Use this to discover pre-built workflows an agent can deploy with one call to instantiate_template.",
        inputSchema: {
            type: "object",
            properties: {
                search:   { type: "string",  description: "Filter by name keyword" },
                category: { type: "string",  description: "Filter by category (e.g. 'data', 'marketing', 'general')" },
                limit:    { type: "number",  description: "Max results (default 10)" },
            },
        },
    },
    {
        name: "get_template_details",
        description:
            "Get full configuration detail for a specific template, including its parameter schema. " +
            "Read this before calling instantiate_template so you know which parameters to pass.",
        inputSchema: {
            type: "object",
            properties: {
                templateId:   { type: "number", description: "Numeric template ID" },
                templateName: { type: "string", description: "Partial name match (used if ID is unknown)" },
            },
        },
    },
    {
        name: "instantiate_template",
        description:
            "Create a live pipeline from a template. Substitutes any {{placeholder}} variables in the template " +
            "config with the supplied parameters, creates all required jobs and steps, and returns the new pipeline. " +
            "Call get_template_details first to discover available parameters.",
        inputSchema: {
            type: "object",
            properties: {
                templateId: {
                    type: "number",
                    description: "ID of the template to instantiate",
                },
                name: {
                    type: "string",
                    description: "Name for the new pipeline. Defaults to '<template name> (Copy)'.",
                },
                parameters: {
                    type: "object",
                    description: "Key/value map of {{placeholder}} substitutions defined by the template's parameterSchema.",
                    additionalProperties: true,
                },
            },
            required: ["templateId"],
        },
    },
];
