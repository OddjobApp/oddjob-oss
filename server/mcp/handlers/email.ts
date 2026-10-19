
import { ResendGateway } from "../../integrations/resend-gateway.js";
import { db } from "../../database_service.js";
import { saasConnectors } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";
import { SendEmailInput } from "../tools/email.js";
import { successResponse, errorResponse, getOrgContext, type ToolContext } from "./utils.js";
import { requireToolPermission } from "../auth.js";
import { assertOrgId } from "@server/utils/auth-context.js";

export async function handleSendEmail(args: unknown, context?: ToolContext) {
    try {
        const input = SendEmailInput.parse(args);
        const ctx = context ? await getOrgContext(context) : null;
        const orgId = assertOrgId(ctx?.organizationId);

        // Permission Check
        if (context) {
            const perm = requireToolPermission("send_email", (context as any).permissions || []);
            if (!perm.allowed) return errorResponse(perm.error);
        }

        // Retrieve Resend credentials from database
        const [connector] = await db
            .select()
            .from(saasConnectors)
            .where(
                and(
                    eq(saasConnectors.orgId, orgId),
                    eq(saasConnectors.platform, "resend")
                )
            )
            .limit(1);

        if (!connector) {
            return errorResponse("Resend connector not configured for this organization.");
        }

        const credentials = connector.credentials as Record<string, any>;
        const apiKey = credentials.api_key || credentials.apiKey; // Support both casing conventions

        if (!apiKey) {
            return errorResponse("Resend API key not found in connector configuration.");
        }

        // Initialize Resend gateway
        const gateway = new ResendGateway(apiKey, orgId);

        const data = await gateway.sendEmail({
            from: input.from,
            to: input.to,
            subject: input.subject,
            html: input.html,
            text: input.text,
            cc: input.cc,
            bcc: input.bcc,
            reply_to: input.reply_to,
        });

        return successResponse(data, `Email sent successfully to ${input.to.join(", ")}`);

    } catch (error: any) {
        return errorResponse(error.message);
    }
}

