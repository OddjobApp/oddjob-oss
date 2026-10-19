import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { projectSaasBindings, saasConnectors } from "@shared/schema/index.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("ProjectBindingService");

/** Which platform each resource kind belongs to. */
const KIND_PLATFORM: Record<string, string> = {
    confluence_space: "confluence",
    jira_project: "jira",
};

export interface BindResourceInput {
    orgId: number;
    projectId: number;
    resourceKind: string;
    resourceKey: string;
    resourceName?: string | null;
    resourceType?: string | null;
    externalId?: string | null;
    webUrl?: string | null;
    boundBy?: string | null;
}

export const projectBindingService = {
    /**
     * Binds an external resource to a project.
     *
     * The connector is resolved rather than passed in: a caller should name the
     * space, not the row id of the connection it happens to arrive through. The
     * project's own connector wins over the organization's, matching how
     * getConfluenceDefaultSpace resolves.
     *
     * Idempotent — re-binding the same key refreshes the discovered name and
     * type instead of failing, so a renamed space does not require an unbind.
     */
    async bind(input: BindResourceInput) {
        const platform = KIND_PLATFORM[input.resourceKind];
        if (!platform) {
            throw new Error(
                `Unknown resource kind "${input.resourceKind}". Expected one of: ${Object.keys(KIND_PLATFORM).join(", ")}.`,
            );
        }

        const [connector] = await db
            .select({ id: saasConnectors.id })
            .from(saasConnectors)
            .where(and(
                eq(saasConnectors.orgId, input.orgId),
                eq(saasConnectors.platform, platform),
                or(isNull(saasConnectors.projectId), eq(saasConnectors.projectId, input.projectId)),
            ))
            .orderBy(sql`${saasConnectors.projectId} DESC NULLS LAST`)
            .limit(1);

        if (!connector) {
            throw new Error(
                `No ${platform} connection is available to this project. Connect ${platform} before binding a resource.`,
            );
        }

        const [binding] = await db
            .insert(projectSaasBindings)
            .values({
                orgId: input.orgId,
                projectId: input.projectId,
                connectorId: connector.id,
                resourceKind: input.resourceKind,
                resourceKey: input.resourceKey,
                resourceName: input.resourceName ?? null,
                resourceType: input.resourceType ?? null,
                externalId: input.externalId ?? null,
                webUrl: input.webUrl ?? null,
                boundBy: input.boundBy ?? null,
            })
            .onConflictDoUpdate({
                target: [
                    projectSaasBindings.projectId,
                    projectSaasBindings.connectorId,
                    projectSaasBindings.resourceKey,
                ],
                set: {
                    resourceName: input.resourceName ?? null,
                    resourceType: input.resourceType ?? null,
                    externalId: input.externalId ?? null,
                    webUrl: input.webUrl ?? null,
                    updatedAt: new Date(),
                },
            })
            .returning();

        logger.info(
            `Bound ${input.resourceKind} ${input.resourceKey} to project ${input.projectId} via connector ${connector.id}`,
        );
        return binding;
    },

    /** Everything this project reaches, newest binding first. */
    async listForProject(orgId: number, projectId: number) {
        return db
            .select()
            .from(projectSaasBindings)
            .where(and(
                eq(projectSaasBindings.orgId, orgId),
                eq(projectSaasBindings.projectId, projectId),
            ))
            .orderBy(desc(projectSaasBindings.createdAt));
    },

    async unbind(orgId: number, projectId: number, bindingId: number) {
        const [removed] = await db
            .delete(projectSaasBindings)
            .where(and(
                eq(projectSaasBindings.id, bindingId),
                eq(projectSaasBindings.orgId, orgId),
                eq(projectSaasBindings.projectId, projectId),
            ))
            .returning();
        return removed ?? null;
    },
};
