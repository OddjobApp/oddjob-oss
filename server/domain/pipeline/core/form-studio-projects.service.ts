import { and, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { approvalRequests, hilForms } from "@shared/schema/index.js";
import { projectResources } from "@shared/schema/projects.js";
import { operationalCycles } from "@shared/schema/operational-cycles.js";
import { datasets } from "@shared/schema/datasets.js";
import { asStudioDefinition } from "@shared/form-studio.js";
import { effectiveLinkAudience, linkAudienceOf, type FormLinkAudience } from "@shared/form-studio-link.js";
import type { OrgContext } from "@server/utils/auth-context.js";
import { formProject, hiddenFormIds } from "./form-studio-access.js";

/**
 * A Project Space's Forms tab: the project's forms, the stages waiting in its
 * cycles, recent results, and the datasets its responses are recorded in.
 *
 * The caller has already been allowed to read the project. Forms attached to it
 * from a private project the caller cannot read are still left out, and every
 * query is limited to the organization by equality.
 */
export async function projectFormsOverview(ctx: OrgContext, projectId: number) {
    const organizationId = ctx.organizationId as number;
    const [attached, cycles, hidden] = await Promise.all([
        db.select({ formId: projectResources.resourceId }).from(projectResources)
            .where(and(eq(projectResources.projectId, projectId), eq(projectResources.resourceType, "form"))),
        db.select({ id: operationalCycles.id }).from(operationalCycles)
            .where(and(eq(operationalCycles.projectId, projectId), eq(operationalCycles.organizationId, organizationId))),
        hiddenFormIds(ctx),
    ]);
    const formIds = [...new Set(attached.map((row) => row.formId))].filter((id) => !hidden.has(id));
    const cycleIds = cycles.map((cycle) => String(cycle.id));

    const { formStudioLibrary } = await import("./form-studio-library.service.js");
    const forms = formIds.length ? (await formStudioLibrary.list(ctx)).filter((row) => formIds.includes(row.id)) : [];
    const names = new Map(forms.map((form) => [form.id, form.name]));
    // Who each published form's link is for, decided by the project the form belongs to.
    const linkConfigs = formIds.length
        ? await db.select({ id: hilForms.id, securityConfig: hilForms.securityConfig }).from(hilForms)
            .where(and(inArray(hilForms.id, formIds), eq(hilForms.organizationId, organizationId)))
        : [];
    const audiences = new Map<number, FormLinkAudience>();
    for (const row of linkConfigs) {
        const home = await formProject(row.id);
        audiences.set(row.id, effectiveLinkAudience(linkAudienceOf(row.securityConfig), home?.visibility === "private"));
    }
    const formsWithLinks = forms.map((form) => ({ ...form, linkAudience: form.releaseNumber ? audiences.get(form.id) ?? "anyone" : null }));

    // Stage requests for this project's forms, and for any form a cycle of this project is filling in.
    const stageScopes: SQL[] = [];
    if (formIds.length) stageScopes.push(inArray(sql<string>`${approvalRequests.modifiedOutput}->>'formId'`, formIds.map(String)));
    if (cycleIds.length) {
        stageScopes.push(sql`${approvalRequests.modifiedOutput}->>'responseId' in (
            select ${hilForms.id}::text from ${hilForms}
            where ${hilForms.kind} = 'response' and ${hilForms.organizationId} = ${organizationId}
              and ${hilForms.config}->'formStudioResponse'->'origin'->>'cycleId' in (${sql.join(cycleIds.map((id) => sql`${id}`), sql`, `)})
        )`);
    }
    const stageRows = stageScopes.length
        ? await db.select({ id: approvalRequests.id, approverEmail: approvalRequests.approverEmail, createdAt: approvalRequests.createdAt, modifiedOutput: approvalRequests.modifiedOutput })
            .from(approvalRequests)
            .where(and(
                eq(approvalRequests.organizationId, organizationId),
                eq(approvalRequests.status, "pending"),
                sql`${approvalRequests.modifiedOutput}->>'kind' = 'form_stage'`,
                or(...stageScopes),
            ))
            .orderBy(desc(approvalRequests.createdAt))
            .limit(50)
        : [];
    const waitingStages = stageRows
        .map((row) => ({ row, stage: (row.modifiedOutput ?? {}) as Record<string, any> }))
        .filter(({ stage }) => !hidden.has(Number(stage.formId)))
        .map(({ row, stage }) => ({
            approvalId: row.id,
            formId: Number(stage.formId),
            formName: String(stage.formName ?? names.get(Number(stage.formId)) ?? "Form"),
            stageTitle: String(stage.stageTitle ?? stage.stageId ?? "Stage"),
            responseId: Number(stage.responseId),
            approverEmail: row.approverEmail,
            waitingSince: row.createdAt,
        }));

    const responseFormId = sql<string>`${hilForms.config}->'formStudioResponse'->>'formId'`;
    const resultRows = formIds.length
        ? await db.select({ id: hilForms.id, submittedAt: hilForms.submittedAt, config: hilForms.config }).from(hilForms)
            .where(and(
                eq(hilForms.kind, "response"),
                eq(hilForms.organizationId, organizationId),
                eq(hilForms.status, "completed"),
                inArray(responseFormId, formIds.map(String)),
            ))
            .orderBy(desc(hilForms.submittedAt))
            .limit(20)
        : [];
    const recentResults = resultRows.map((row) => {
        const state = ((row.config ?? {}) as any).formStudioResponse ?? {};
        return {
            responseId: row.id,
            formId: Number(state.formId),
            formName: names.get(Number(state.formId)) ?? state.formName ?? "Form",
            releaseNumber: state.releaseNumber ?? null,
            status: state.decision?.state === "decided" ? state.decision.status : null,
            submittedAt: row.submittedAt,
        };
    });

    // The datasets these forms record their responses in, as their definitions name them.
    const definitions = formIds.length
        ? await db.select({ id: hilForms.id, schema: hilForms.schema }).from(hilForms)
            .where(and(inArray(hilForms.id, formIds), eq(hilForms.organizationId, organizationId)))
        : [];
    const formsByDataset = new Map<number, string[]>();
    for (const definition of definitions) {
        try {
            const datasetId = asStudioDefinition(definition.schema).studio.dataset?.datasetId;
            if (datasetId) formsByDataset.set(datasetId, [...(formsByDataset.get(datasetId) ?? []), names.get(definition.id) ?? "Form"]);
        } catch {
            // A definition the Studio cannot read names no dataset.
        }
    }
    const datasetRows = formsByDataset.size
        ? await db.select({ id: datasets.id, name: datasets.name, description: datasets.description }).from(datasets)
            .where(and(inArray(datasets.id, [...formsByDataset.keys()]), eq(datasets.organizationId, organizationId)))
        : [];
    const responseDatasets = datasetRows.map((dataset) => ({ ...dataset, forms: formsByDataset.get(dataset.id) ?? [] }));

    return { forms: formsWithLinks, waitingStages, recentResults, responseDatasets };
}
