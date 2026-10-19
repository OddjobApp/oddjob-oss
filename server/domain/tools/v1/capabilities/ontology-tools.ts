import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./types.js";
import { ontologyService, type OntologyCtx } from "../../../knowledge/core/ontology.service.js";

/**
 * Ontology tools. Every call is org-scoped via the ToolContext — we resolve a
 * non-null organizationId here and hand the service an OntologyCtx. A missing org
 * id is refused (never defaulted), so a tool call can't leak across tenants.
 */
function toOntologyCtx(context: ToolContext): OntologyCtx {
    const organizationId = context?.organizationId;
    if (typeof organizationId !== "number") {
        throw new Error("Ontology tools require an organization context.");
    }
    return {
        organizationId,
        userId: context?.userId,
        isSuperAdmin: context?.isSuperAdmin,
        missionId: context?.missionId ?? undefined,
        missionRunId: context?.missionRunId ?? undefined,
        sessionId: context?.traceId,
    };
}

export const ONTOLOGY_TOOLS: Record<string, ToolDefinition> = {
    ontology_list_object_types: {
        name: "ontology_list_object_types",
        idempotency: "read-safe",
        label: "List Ontology Object Types",
        group: "Ontology",
        description: "Discover the business Object Types available in this organization's Ontology.",
        parameters: z.object({}),
        execute: async (_params: any, context: ToolContext) => {
            try {
                const types = await ontologyService.listObjectTypes(toOntologyCtx(context));
                if (types.length === 0) return "No Object Types are defined for this organization yet.";
                return JSON.stringify(types, null, 2);
            } catch (e: any) {
                return `Ontology List Types Error: ${e.message}`;
            }
        },
    },

    ontology_list_objects: {
        name: "ontology_list_objects",
        idempotency: "read-safe",
        label: "List Ontology Objects",
        group: "Ontology",
        description: "List instances of a specific business Object Type in the Palantir-style Ontology layer.",
        parameters: z.object({
            objectType: z.string().describe("The name of the Object Type to list (e.g. 'Mission')"),
            limit: z.number().int().min(1).max(200).optional().describe("Max instances to return (default 50)"),
        }),
        execute: async ({ objectType, limit }: any, context: ToolContext) => {
            try {
                const objects = await ontologyService.listObjects(toOntologyCtx(context), objectType, { limit });
                if (objects.length === 0) return `No objects found of type '${objectType}'.`;
                return JSON.stringify(objects, null, 2);
            } catch (e: any) {
                return `Ontology List Error: ${e.message}`;
            }
        },
    },

    ontology_get_object: {
        name: "ontology_get_object",
        idempotency: "read-safe",
        label: "Get Ontology Object",
        group: "Ontology",
        description: "Retrieve a specific instance of a business Object by its ID.",
        parameters: z.object({
            objectType: z.string().describe("The name of the Object Type (e.g. 'Mission')"),
            id: z.any().describe("The ID of the instance to retrieve"),
        }),
        execute: async ({ objectType, id }: any, context: ToolContext) => {
            try {
                const obj = await ontologyService.getObject(toOntologyCtx(context), objectType, id);
                return JSON.stringify(obj, null, 2);
            } catch (e: any) {
                return `Ontology Get Error: ${e.message}`;
            }
        },
    },

    ontology_list_link_types: {
        name: "ontology_list_link_types",
        idempotency: "read-safe",
        label: "List Ontology Link Types",
        group: "Ontology",
        description:
            "Discover the declared relationships between this organization's Object Types — what you can traverse, " +
            "and under which name in each direction (e.g. 'App Deployment --deploys--> App', read back as 'deployed_by').",
        parameters: z.object({
            objectType: z.string().optional().describe("Only links touching this Object Type, in either direction."),
        }),
        execute: async ({ objectType }: any, context: ToolContext) => {
            try {
                const links = await ontologyService.listLinkTypes(toOntologyCtx(context), objectType);
                if (links.length === 0) {
                    return objectType
                        ? `No relationships are declared for '${objectType}' yet.`
                        : "No relationships are declared in this organization's Ontology yet.";
                }
                return JSON.stringify(links, null, 2);
            } catch (e: any) {
                return `Ontology List Link Types Error: ${e.message}`;
            }
        },
    },

    ontology_traverse_link: {
        name: "ontology_traverse_link",
        idempotency: "read-safe",
        label: "Traverse an Ontology Relationship",
        group: "Ontology",
        description:
            "Follow a declared relationship from one object to the objects on its other end — 'which App does this " +
            "deployment deploy?', or from the far end, 'which deployments deploy this App?'. Use the name from " +
            "ontology_list_link_types: either the forward name or its inverse, whichever direction you are reading. " +
            "If the result says complete=false, more matches may exist beyond those returned — do not report it as the full set.",
        parameters: z.object({
            objectType: z.string().describe("Object Type of the object you already have, e.g. 'App Deployment'."),
            id: z.union([z.string(), z.number()]).describe("Its id."),
            link: z.string().describe("Relationship name to follow, forward or inverse, e.g. 'deploys' or 'deployed_by'."),
            limit: z.number().optional().describe("Max related objects to return (default 50, max 200)."),
        }),
        execute: async ({ objectType, id, link, limit }: any, context: ToolContext) => {
            try {
                const result = await ontologyService.traverse(toOntologyCtx(context), { objectType, id, link, limit });
                if (result.objects.length === 0) {
                    return result.note
                        ? `No objects are related through '${link}'. ${result.note}`
                        : `No objects are related to ${objectType} ${id} through '${link}'.`;
                }
                return JSON.stringify(result, null, 2);
            } catch (e: any) {
                return `Ontology Traverse Link Error: ${e.message}`;
            }
        },
    },

    ontology_define_link_type: {
        name: "ontology_define_link_type",
        idempotency: "idempotent",
        label: "Declare an Ontology Relationship",
        group: "Ontology",
        riskLevel: "low",
        description:
            "Declare a governed relationship between two Object Types. Derived links follow an existing source " +
            "property; materialized links store explicit edges between materialized Ontology Objects. Call the list " +
            "tools first. The declaration requires human approval.",
        parameters: z.object({
            backing: z.enum(["derived", "materialized"]).default("derived"),
            sourceType: z.string().describe("Object Type the relationship starts from, e.g. 'App Deployment'."),
            name: z.string().describe("Forward name, read source -> target, e.g. 'deploys'."),
            inverseName: z.string().describe("Reverse name, read target -> source, e.g. 'deployed_by'."),
            sourceProperty: z.string().optional().describe("Derived links only: source property carrying the join key, e.g. 'appId'."),
            targetType: z.string().optional().describe("Object Type the relationship points at, e.g. 'App'. Omit only for a polymorphic link."),
            targetProperty: z.string().optional().describe("Property on the target it matches. Defaults to 'id'."),
            cardinality: z.enum(["one_to_one", "one_to_many", "many_to_many"]).optional(),
            description: z.string().optional(),
            targetTypeProperty: z.string().optional().describe("Polymorphic links only: property naming the target's Object Type."),
            targetTypeMap: z.record(z.string()).optional().describe("Polymorphic links only: maps that property's values to Object Type names."),
        }).superRefine((value, ctx) => {
            if (value.backing === "derived" && !value.sourceProperty) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sourceProperty"], message: "Required for a derived link." });
            }
            if (value.backing === "materialized" && !value.targetType) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["targetType"], message: "Required for a materialized link." });
            }
        }),
        execute: async (params: any, context: ToolContext) => {
            try {
                // Routed through executeAction rather than calling defineLinkType
                // directly, so the approval gate and the audit row are not optional.
                const result = await ontologyService.executeAction(
                    toOntologyCtx(context),
                    "define_link_type",
                    params,
                );
                return JSON.stringify(result, null, 2);
            } catch (e: any) {
                return `Ontology Define Link Type Error: ${e.message}`;
            }
        },
    },

    ontology_link_objects: {
        name: "ontology_link_objects",
        idempotency: "idempotent",
        label: "Link Ontology Objects",
        group: "Ontology",
        riskLevel: "low",
        description: "Create a governed stored edge between two materialized Ontology Objects. Re-linking the same pair is idempotent.",
        parameters: z.object({
            sourceType: z.string(),
            linkName: z.string().describe("Forward relationship name declared on the source Object Type."),
            sourceId: z.union([z.string(), z.number()]),
            targetId: z.union([z.string(), z.number()]),
        }),
        execute: async (params: any, context: ToolContext) => {
            try {
                return JSON.stringify(await ontologyService.executeAction(toOntologyCtx(context), "link_objects", params), null, 2);
            } catch (e: any) {
                return `Ontology Link Objects Error: ${e.message}`;
            }
        },
    },

    ontology_unlink_objects: {
        name: "ontology_unlink_objects",
        idempotency: "idempotent",
        label: "Unlink Ontology Objects",
        group: "Ontology",
        riskLevel: "low",
        description: "Remove a governed stored edge between two materialized Ontology Objects. Removing a missing edge is idempotent.",
        parameters: z.object({
            sourceType: z.string(),
            linkName: z.string().describe("Forward relationship name declared on the source Object Type."),
            sourceId: z.union([z.string(), z.number()]),
            targetId: z.union([z.string(), z.number()]),
        }),
        execute: async (params: any, context: ToolContext) => {
            try {
                return JSON.stringify(await ontologyService.executeAction(toOntologyCtx(context), "unlink_objects", params), null, 2);
            } catch (e: any) {
                return `Ontology Unlink Objects Error: ${e.message}`;
            }
        },
    },

    ontology_execute_action: {
        name: "ontology_execute_action",
        idempotency: "none",
        label: "Execute Ontology Action",
        group: "Ontology",
        description: "Execute a pre-validated business Action on an Ontology Object instance. Write actions require approval.",
        parameters: z.object({
            actionName: z.string().describe("The name of the Action to execute (e.g. 'assign_technician')"),
            parameters: z.record(z.any()).describe("Parameters matching the action schema"),
        }),
        execute: async ({ actionName, parameters }: any, context: ToolContext) => {
            try {
                const result = await ontologyService.executeAction(toOntologyCtx(context), actionName, parameters);
                return JSON.stringify(result, null, 2);
            } catch (e: any) {
                return `Ontology Action Execution Error: ${e.message}`;
            }
        },
    },
};
