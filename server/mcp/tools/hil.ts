
import { z } from "zod";

export const hilFormToolDefinitions = [
    {
        name: "list_hil_forms",
        description: "List all published Human-In-The-Loop forms in the library. These forms are used to capture structured input from users during agent execution.",
        inputSchema: {
            type: "object",
            properties: {
                search: {
                    type: "string",
                    description: "Optional search term for form name or description"
                }
            }
        }
    },
    {
        name: "get_hil_form",
        description: "Retrieve a specific HIL form definition by its ID or name.",
        inputSchema: {
            type: "object",
            properties: {
                formId: {
                    type: "number",
                    description: "ID of the form"
                },
                name: {
                    type: "string",
                    description: "Name of the form"
                }
            }
        }
    },
    {
        name: "request_human_input",
        description: "Trigger a Human-In-The-Loop request by presenting a structured form to the user. The agent will wait for the user to submit the form before proceeding.",
        inputSchema: {
            type: "object",
            properties: {
                pipelineName: {
                    type: "string",
                    description: "Display name for the input request"
                },
                description: {
                    type: "string",
                    description: "Contextual information for the user"
                },
                fields: {
                    type: "array",
                    description: "Structured fields to present in the form",
                    items: {
                        type: "object",
                        properties: {
                            name: { type: "string", description: "Internal key for the field" },
                            label: { type: "string", description: "Display label for the field" },
                            type: { type: "string", enum: ["text", "number", "email", "select", "date"], description: "Input type" },
                            required: { type: "boolean" },
                            placeholder: { type: "string" },
                            options: { type: "array", items: { type: "string" }, description: "For select type" }
                        },
                        required: ["name", "label", "type"]
                    }
                }
            },
            required: ["pipelineName", "fields"]
        }
    }
];

export const ListHilFormsInput = z.object({
    search: z.string().optional()
});

export const GetHilFormInput = z.object({
    formId: z.number().optional(),
    name: z.string().optional()
});

export const RequestHumanInputInput = z.object({
    pipelineName: z.string(),
    description: z.string().optional(),
    fields: z.array(z.object({
        name: z.string(),
        label: z.string(),
        type: z.enum(["text", "number", "email", "select", "date"]),
        required: z.boolean().default(true),
        placeholder: z.string().optional(),
        options: z.array(z.string()).optional()
    }))
});

