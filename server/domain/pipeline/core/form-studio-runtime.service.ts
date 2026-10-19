import { and, eq, sql } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { datasets, hilForms, pipelines, users } from "@shared/schema/index.js";
import type { OrgContext } from "@server/utils/auth-context.js";
import { createFormStudioRuntime, type RuntimeDeps } from "./form-studio-runtime.js";

/**
 * The real dependencies behind the Form Studio runtime.
 *
 * Every read is scoped to the form's organization. A form's dataset and pipeline
 * ids come from its definition, which an author writes, so an id from another
 * organization is refused here rather than trusted.
 */

/** An organization-scoped context for writes made on a respondent's behalf; never a super admin. */
function formContext(organizationId: number): OrgContext {
    return { userId: "form-studio", organizationId, isAdmin: false, isSuperAdmin: false, isOrgAdmin: false };
}

const responseScope = (responseId: number, organizationId: number) =>
    and(eq(hilForms.id, responseId), eq(hilForms.kind, "response"), eq(hilForms.organizationId, organizationId));

export const formStudioRuntimeDeps: RuntimeDeps = {
    async addDatasetItem({ organizationId, datasetId, data, rawData }) {
        const [dataset] = await db.select({ id: datasets.id }).from(datasets)
            .where(and(eq(datasets.id, datasetId), eq(datasets.organizationId, organizationId))).limit(1);
        if (!dataset) throw new Error(`Dataset #${datasetId} is not in this organization.`);
        const { datasetService } = await import("@domain/knowledge/core/dataset-service.js");
        const result = await datasetService.addItems(datasetId, [{ data, rawData }], formContext(organizationId));
        return { itemId: result.items?.[0]?.id };
    },

    async pipelineInOrg(pipelineId, organizationId) {
        const [pipeline] = await db.select({ id: pipelines.id }).from(pipelines)
            .where(and(eq(pipelines.id, pipelineId), eq(pipelines.organizationId, organizationId))).limit(1);
        return Boolean(pipeline);
    },

    async formOwner(createdBy) {
        if (!createdBy) return { id: null, email: null };
        const [owner] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, createdBy)).limit(1);
        return { id: owner?.id ?? null, email: owner?.email ?? null };
    },

    async createApproval({ organizationId, executionId, approverId, approverEmail, context }) {
        const { approvalService } = await import("@domain/integrations/core/approval.service.js");
        const request = await approvalService.createApprovalRequest({
            executionId,
            approverType: "internal",
            ...(approverId ? { approverId } : {}),
            approverEmail,
            status: "pending",
            organizationId,
            context,
        });
        return { id: request.id };
    },

    async publishEvent({ organizationId, formId, payload }) {
        const { eventStream } = await import("@domain/core/infrastructure/event-stream.service.js");
        // A pipeline subscribes with a trigger on event type "form_submitted", filtered
        // with, for example, event.payload.formId == 55.
        await eventStream.publish("form_submitted", payload, { organizationId, subject: `form:${formId}` }, "form-studio");
    },

    async loadResponse(responseId, organizationId) {
        const [row] = await db.select({ id: hilForms.id, data: hilForms.data, config: hilForms.config }).from(hilForms)
            .where(responseScope(responseId, organizationId)).limit(1);
        if (!row) return null;
        return {
            id: row.id,
            data: (row.data ?? {}) as Record<string, unknown>,
            runtime: ((row.config ?? {}) as any).formStudioResponse?.runtime ?? null,
        };
    },

    async saveSubmission(responseId, organizationId, record) {
        await db.update(hilForms)
            .set({ config: sql`jsonb_set(coalesce(${hilForms.config}, '{}'::jsonb), '{formStudioResponse,runtime}', ${JSON.stringify(record)}::jsonb, true)`, updatedAt: new Date() })
            .where(responseScope(responseId, organizationId));
    },

    async saveAction(responseId, organizationId, actionId, record) {
        // One action's entry, set in place, so two actions decided at once cannot
        // overwrite each other's outcome.
        await db.update(hilForms)
            .set({
                config: sql`jsonb_set(coalesce(${hilForms.config}, '{}'::jsonb), ARRAY['formStudioResponse', 'runtime', 'actions', ${actionId}]::text[], ${JSON.stringify(record)}::jsonb, true)`,
                updatedAt: new Date(),
            })
            .where(responseScope(responseId, organizationId));
    },

    async startPipeline({ pipelineId, userId, variables }) {
        const { pipelineExecutor } = await import("@server/core/pipeline-executor.js");
        const result = await pipelineExecutor.executePipeline(pipelineId, userId, null, null, variables);
        return { success: Boolean(result?.success), executionId: result?.executionId, error: result?.error };
    },

    async sendNotification(input) {
        const { notificationService } = await import("./notification.service.js");
        await notificationService.send(input);
    },

    now: () => new Date(),
};

export const formStudioRuntime = createFormStudioRuntime(formStudioRuntimeDeps);
