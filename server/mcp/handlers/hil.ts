import { db } from "../../database_service.js";
import { hilForms } from "@shared/schema/index.js";
import { eq, and, ilike, or } from "drizzle-orm";
import { errorResponse, type ToolContext } from "./utils.js";
import { ListHilFormsInput, GetHilFormInput, RequestHumanInputInput } from "../tools/hil.js";
import { decisionRouter } from "@domain/governor/index.js";
import { assertOrgId } from "@server/utils/auth-context.js";

/*
 * Every handler requires the caller's organization. List and get used
 * `orgId ? eq(...) : undefined`, which becomes no condition at all for a caller
 * without one, so they returned every tenant's forms.
 */

export async function handleListHilForms(args: unknown, context?: ToolContext) {
    try {
        const { search } = ListHilFormsInput.parse(args);
        const orgId = assertOrgId(context?.organizationId);

        const forms = await db.select()
            .from(hilForms)
            .where(
                and(
                    eq(hilForms.organizationId, orgId),
                    // The library: templates only, not runtime requests or stored responses.
                    eq(hilForms.kind, "template"),
                    eq(hilForms.isArchived, false),
                    search ? or(ilike(hilForms.name, `%${search}%`), ilike(hilForms.description, `%${search}%`)) : undefined
                )
            );

        return {
            content: [{ type: "text", text: JSON.stringify(forms, null, 2) }]
        };
    } catch (err) {
        return errorResponse(`Failed to list HIL forms: ${err}`);
    }
}

export async function handleGetHilForm(args: unknown, context?: ToolContext) {
    try {
        const { formId, name } = GetHilFormInput.parse(args);
        const orgId = assertOrgId(context?.organizationId);
        if (!formId && !name) return errorResponse("Provide a formId or a name.");

        const [form] = await db.select()
            .from(hilForms)
            .where(
                and(
                    eq(hilForms.organizationId, orgId),
                    formId ? eq(hilForms.id, formId) : and(eq(hilForms.name, name!), eq(hilForms.kind, "template"))
                )
            )
            .limit(1);

        if (!form) return errorResponse("HIL form not found");

        return {
            content: [{ type: "text", text: JSON.stringify(form, null, 2) }]
        };
    } catch (err) {
        return errorResponse(`Failed to get HIL form: ${err}`);
    }
}

export async function handleRequestHumanInput(args: unknown, context?: ToolContext) {
    try {
        const parsed = RequestHumanInputInput.parse(args);
        const orgId = assertOrgId(context?.organizationId);
        const userId = context?.userId || "mcp-user";

        // Map to the decision router request format. The organization is passed
        // explicitly: this used to send jobId 1, and the router published the form
        // into whichever organization owned job 1.
        const result = await decisionRouter.requestDecision({
            sessionId: `mcp_${Date.now()}`, // Required session ID
            executionId: `mcp_hil_${Date.now()}`,
            organizationId: orgId,
            approverId: userId, // DecisionRouter uses approverId
            approverType: "internal",
            approverEmail: undefined, // Use undefined instead of null
            tool: "show_pipeline_input_form",
            goal: parsed.description || `Input required for ${parsed.pipelineName}`,
            riskLevel: "medium",
            description: parsed.description || "MCP-initiated input request",
            channels: ["copilot"],
            params: {
                type: "input_request",
                pipelineName: parsed.pipelineName,
                fields: parsed.fields
            }
        });

        return {
            content: [{ type: "text", text: `HIL request initiated. Decision result: ${JSON.stringify(result, null, 2)}` }]
        };
    } catch (err) {
        return errorResponse(`Failed to request human input: ${err}`);
    }
}
