import { db } from "@server/database_service.js";
import { hilForms, type HilRequestSource } from "@shared/schema/index.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("HilRequests");

export type HilFormRow = typeof hilForms.$inferSelect;

export interface CreateHilRequestInput {
    source: HilRequestSource;
    organizationId: number | null;
    name: string;
    description?: string | null;
    schema: Record<string, unknown>;
    config?: Record<string, unknown>;
    themeConfig?: unknown;
    securityConfig?: unknown;
    stepExecutionId?: number | null;
    templateFormId?: number | null;
    createdBy?: string | null;
    /**
     * Broadcast to connected channels (Slack/Teams). Turn off for callers that
     * already notify through their own route, such as decision-routed pipeline steps.
     */
    announce?: boolean;
}

/**
 * The one way to ask a person for input through a HIL form.
 *
 * Six writers inserted request rows by hand, each with its own status and naming,
 * and none of them announced anything. The Slack/Teams broadcast did exist, but it
 * hung off hilService.createForm, which only the Form Builder called, so it
 * announced templates being designed and never a real request. Requests now come
 * through here: marked as requests, linked to their template when there is one,
 * and announced.
 */
export const hilRequests = {
    async create(input: CreateHilRequestInput): Promise<HilFormRow> {
        const [row] = await db
            .insert(hilForms)
            .values({
                kind: "request",
                requestSource: input.source,
                status: "pending",
                isViewed: false,
                isArchived: false,
                name: input.name,
                description: input.description ?? null,
                schema: input.schema,
                config: input.config ?? {},
                organizationId: input.organizationId,
                stepExecutionId: input.stepExecutionId ?? null,
                templateFormId: input.templateFormId ?? null,
                createdBy: input.createdBy ?? null,
                ...(input.themeConfig ? { themeConfig: input.themeConfig } : {}),
                ...(input.securityConfig ? { securityConfig: input.securityConfig } : {}),
            })
            .returning();

        if (input.announce !== false) void announce(row);
        return row;
    },

    /** A request asking the questions of an existing template, which stays untouched. */
    async createFromTemplate(
        template: HilFormRow,
        input: Omit<CreateHilRequestInput, "name" | "schema" | "templateFormId"> & { name?: string },
    ): Promise<HilFormRow> {
        if (template.kind !== "template") {
            throw new Error(`Form ${template.id} is a ${template.kind}, not a template; a request can only be made from a template.`);
        }
        return hilRequests.create({
            ...input,
            name: input.name ?? template.name,
            description: input.description ?? template.description,
            schema: template.schema as Record<string, unknown>,
            themeConfig: input.themeConfig ?? template.themeConfig,
            securityConfig: input.securityConfig ?? template.securityConfig,
            templateFormId: template.id,
        });
    },
};

async function announce(row: HilFormRow): Promise<void> {
    // An app asking for a person lands in that app's CREW requests room, where it
    // can be answered in place. Posted first, so the channel message can link
    // straight to it rather than to an inbox that does not list HIL requests.
    let roomPath: string | undefined;
    if (row.requestSource === "app") {
        try {
            const { postAppRequestToCrew } = await import("@domain/crew/core/crew-app-requests.service.js");
            roomPath = (await postAppRequestToCrew(row))?.path;
        } catch (err: any) {
            logger.warn(`Could not post HIL request ${row.id} to CREW: ${err?.message ?? err}`);
        }
    }
    try {
        const { channelGateway } = await import("@domain/integrations/core/channel-gateway.service.js");
        await channelGateway.broadcastHilRequest(row, roomPath ? { path: roomPath, label: "Answer in Oddjob" } : undefined);
    } catch (err: any) {
        logger.warn(`Could not announce HIL request ${row.id}: ${err?.message ?? err}`);
    }
}
