import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./types.js";
import type { OrgContext } from "@server/utils/auth-context.js";
import { calculationOperationEnum } from "@shared/schema/knowledge/calculations.js";
import { calculationService } from "../../../knowledge/core/calculations/calculation.service.js";
import { requireToolOrgId } from "./org-context.js";

/**
 * Builds the OrgContext the calculation service expects from the looser
 * ToolContext an agent tool is handed.
 *
 * Spreading ToolContext directly does not satisfy OrgContext: userId and the
 * three admin flags are optional there and required here, so every call site
 * below failed to type-check.
 */
function toOrgContext(context: ToolContext): OrgContext {
    return {
        userId: (context as { userId?: string })?.userId ?? "agent",
        organizationId: requireToolOrgId(context),
        isAdmin: Boolean((context as { isAdmin?: boolean })?.isAdmin),
        isSuperAdmin: Boolean((context as { isSuperAdmin?: boolean })?.isSuperAdmin),
        isOrgAdmin: Boolean((context as { isOrgAdmin?: boolean })?.isOrgAdmin),
    };
}

export const CALCULATION_TOOLS: Record<string, ToolDefinition> = {
    create_calculation_node: {
        name: "create_calculation_node",
        label: "Create Calculation Node",
        group: "Knowledge Graph Calculations",
        description: "Creates a Neuro-Symbolic calculation node on a target Knowledge Graph node (supports FORMULA, MOVING_AVERAGE, YEAR_OVER_YEAR, MONTE_CARLO_SIMULATION, BAYESIAN_INFERENCE, CONSTRAINT_CHECK, PAGERANK, MODEL_PREDICTION, etc.).",
        riskLevel: "low",
        idempotency: "idempotent",
        parameters: z.object({
            nodeId: z.number().describe("ID of the Knowledge Node to attach calculation to"),
            // The operations the service evaluates. This list used to be its own copy,
            // with YOY_GROWTH, MONTE_CARLO, BAYESIAN and THRESHOLD: names the service
            // has no case for, so an agent could create a node that never ran.
            operation: z.enum(calculationOperationEnum).describe("Calculation operation type"),
            formula: z.string().optional().describe("Arithmetic formula expression (e.g., 'price * quantity')"),
            inputReferences: z.array(z.object({
                nodeId: z.number(),
                variable: z.string(),
                field: z.string().optional().describe("Explicit source property path; required for financial records, e.g. Balance or TotalAmt"),
                currency: z.string().regex(/^[A-Z]{3}$/).optional().describe("Verified source currency for monetary inputs, e.g. USD"),
            })).optional().describe("List of input variable node references"),
            outputUnit: z.string().optional().describe("Output unit label (e.g. USD, %, ms)"),
        }),
        execute: async (params: any, context: ToolContext) => {
            try {
                const orgCtx = toOrgContext(context);
                const calculation = await calculationService.createCalculation({
                    nodeId: params.nodeId,
                    organizationId: orgCtx.organizationId!,
                    operation: params.operation,
                    formula: params.formula || "",
                    inputReferences: params.inputReferences || [],
                    outputUnit: params.outputUnit,
                }, orgCtx);
                return JSON.stringify({ success: true, calculation });
            } catch (err: any) {
                return `Error creating calculation node: ${err.message}`;
            }
        }
    },

    execute_calculation_node: {
        name: "execute_calculation_node",
        label: "Execute Calculation Node",
        group: "Knowledge Graph Calculations",
        description: "Executes a calculation node and returns the evaluated result and timing metrics.",
        riskLevel: "low",
        idempotency: "read-safe",
        parameters: z.object({
            calculationId: z.number().describe("ID of the calculation node to execute"),
            forceRecalculate: z.boolean().optional().default(true).describe("Whether to bypass cached result"),
        }),
        execute: async (params: any, context: ToolContext) => {
            try {
                const orgCtx = toOrgContext(context);
                const result = await calculationService.executeCalculation(params.calculationId, orgCtx, {
                    forceRecalculate: params.forceRecalculate ?? true,
                    triggeredBy: "agent_tool",
                });
                return JSON.stringify(result);
            } catch (err: any) {
                return `Error executing calculation node: ${err.message}`;
            }
        }
    },

    list_calculation_nodes: {
        name: "list_calculation_nodes",
        label: "List Calculation Nodes",
        group: "Knowledge Graph Calculations",
        description: "Lists calculation nodes for the organization with optional status and operation filters.",
        riskLevel: "low",
        idempotency: "read-safe",
        parameters: z.object({
            status: z.string().optional().describe("Filter by status (ACTIVE, INACTIVE)"),
            operation: z.string().optional().describe("Filter by operation (e.g. FORMULA, MONTE_CARLO)"),
            limit: z.number().optional().default(20),
        }),
        execute: async (params: any, context: ToolContext) => {
            try {
                const orgCtx = toOrgContext(context);
                const res = await calculationService.listCalculations(orgCtx, {
                    status: params.status,
                    operation: params.operation,
                    limit: params.limit || 20,
                });
                return JSON.stringify(res);
            } catch (err: any) {
                return `Error listing calculation nodes: ${err.message}`;
            }
        }
    }
};
