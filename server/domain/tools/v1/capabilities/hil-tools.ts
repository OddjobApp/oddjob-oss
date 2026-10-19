import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./types.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("HilTools");

/**
 * Human-in-the-loop forms for agents.
 *
 * An agent frequently needs something only a person can supply — an approval, a
 * value it must not invent, a decision between options. Until now its only move
 * was to ask in prose and hope the answer came back parseable. These let it put
 * a real form in front of a human instead.
 *
 * `request_human_input` WRITES: it publishes a form that a person is expected to
 * fill in. That is a deliberate product decision — crew agents otherwise get
 * reads and ephemeral render surfaces only. The blast radius is bounded by what
 * the form itself can do (collect values; it triggers nothing on submit), and by
 * org scoping, but an agent can create these without a confirmation step.
 */

/** Field types the form renderer understands. Anything else is coerced to text. */
const FIELD_TYPES = ["text", "textarea", "number", "date", "select", "checkbox"] as const;

export const HIL_TOOLS: Record<string, ToolDefinition> = {
    list_hil_forms: {
        name: "list_hil_forms",
        label: "List Human Input Forms",
        group: "Human Input",
        description:
            "List the human-input forms already available in this organization. Check here before creating a new one — reusing an existing form keeps the library from filling with near-duplicates.",
        parameters: z.object({}),
        idempotency: "read-safe",
        riskLevel: "low",
        execute: async (_args: any, context: ToolContext) => {
            try {
                const orgId = context?.organizationId;
                if (!orgId) return { success: false, error: "No organization context." };

                const { db } = await import("@server/database_service.js");
                const { hilForms } = await import("@shared/schema/index.js");
                const { and, eq } = await import("drizzle-orm");

                const rows = await db
                    .select({
                        id: hilForms.id,
                        name: hilForms.name,
                        description: hilForms.description,
                        schema: hilForms.schema,
                    })
                    .from(hilForms)
                    .where(and(
                        eq(hilForms.organizationId, orgId),
                        // The library: not every request ever asked, nor stored responses.
                        eq(hilForms.kind, "template"),
                        eq(hilForms.isArchived, false),
                    ));

                return {
                    success: true,
                    forms: rows.map(r => ({
                        id: r.id,
                        name: r.name,
                        description: r.description,
                        fields: ((r.schema as any)?.fields ?? []).map((f: any) => f.key),
                    })),
                };
            } catch (error: any) {
                logger.error("list_hil_forms failed", error);
                return { success: false, error: error?.message ?? "Unknown error" };
            }
        },
    },

    request_human_input: {
        name: "request_human_input",
        label: "Request Human Input",
        group: "Human Input",
        description:
            "Put a form in front of a person when you need information only they can give — an approval, a value you must not guess, or a choice between options. Use this instead of asking in prose when the answer needs to be structured. Do not use it for anything you can look up yourself.",
        parameters: z.object({
            name: z
                .string()
                .min(3)
                .max(120)
                .describe("Short title the person will see. Say what you are asking for."),
            fields: z
                .array(z.object({
                    key: z.string().min(1).describe("Machine name for the answer, e.g. budget_cap."),
                    label: z.string().min(1).describe("What the person reads."),
                    type: z.enum(FIELD_TYPES).default("text"),
                    required: z.boolean().default(true),
                    options: z.array(z.string()).optional().describe("Choices, for select fields."),
                    description: z.string().optional(),
                }))
                .min(1)
                .max(20)
                .describe("Keep this short. A form with twenty questions does not get filled in."),
        }),
        // Not read-safe, and deliberately not marked as such: it publishes a
        // form into the org's library that a human is then asked to complete.
        idempotency: "idempotent",
        riskLevel: "low",
        execute: async ({ name, fields }: any, context: ToolContext) => {
            try {
                const orgId = context?.organizationId;
                const userId = (context as any)?.userId;
                if (!orgId) return { success: false, error: "No organization context." };

                const { formPublishingService } = await import(
                    "@domain/governor/core/form-publishing-service.js"
                );
                const { hilRequests } = await import("@domain/pipeline/core/hil-requests.service.js");
                const { db } = await import("@server/database_service.js");
                const { hilForms } = await import("@shared/schema/index.js");
                const { eq } = await import("drizzle-orm");

                // The template: reused when this organization already has one asking
                // for the same fields, so an agent repeating itself stacks no copies.
                const templateId = await formPublishingService.publish(name, fields, orgId, userId);
                const [template] = templateId
                    ? await db.select().from(hilForms).where(eq(hilForms.id, templateId)).limit(1)
                    : [];
                if (!template) {
                    return { success: false, error: "The form could not be published." };
                }

                // The request. This tool used to stop at publishing the template and
                // report "Asked for N values", when nobody had been asked anything.
                const request = await hilRequests.createFromTemplate(template, {
                    source: "agent",
                    organizationId: orgId,
                    createdBy: userId ?? null,
                });

                logger.info(`[HIL] Agent asked for input with form "${name}" (template ${template.id}, request ${request.id}) in org ${orgId}`);

                return {
                    success: true,
                    formId: template.id,
                    requestId: request.id,
                    name,
                    fieldCount: fields.length,
                    // The room renders these inline; the request row stays the record.
                    schema: { fields: ((template.schema as any)?.fields ?? fields) },
                    message: `Asked for ${fields.length} value${fields.length === 1 ? "" : "s"} with the form "${name}". The request is waiting in the organization's notifications.`,
                    nextStep:
                        "Carry on without the answer. Do not block waiting for it, and do not re-ask for the same values in prose.",
                };
            } catch (error: any) {
                logger.error("request_human_input failed", error);
                return { success: false, error: error?.message ?? "Unknown error" };
            }
        },
    },
};
