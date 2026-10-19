import { and, eq } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { hilForms } from "@shared/schema/index.js";
import type { OrgContext } from "@server/utils/auth-context.js";
import { getOrgConditions } from "@server/utils/org-conditions.js";
import { BadRequestError, ConflictError, NotFoundError } from "@server/utils/errors.js";
import {
    formCreateSchema,
    formUpdateSchema,
    missingRequiredFields,
    toBlockForm,
    type BlockForm,
} from "./hil-form-contracts.js";

export type HilFormRow = typeof hilForms.$inferSelect;

/**
 * Every read and write of a legacy HIL form by id, scoped to the caller's org.
 *
 * GET, PUT and DELETE /api/forms/:id looked forms up by id alone, so any signed-in
 * user could read, rewrite or delete another tenant's forms. Scoping lives here,
 * once, rather than in each route handler.
 *
 * `allowGlobal` is false: a null organizationId matches only rows with no org,
 * never every tenant (see org-conditions.ts).
 */
function scope(orgContext: OrgContext) {
    return getOrgConditions(orgContext, hilForms, false);
}

function describeIssues(issues: Array<{ path: (string | number)[]; message: string }>): string {
    return issues.map((issue) => (issue.path.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message)).join("; ");
}

function asSubmission(data: unknown): Record<string, unknown> {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new BadRequestError("Submission data must be an object of field values.");
    }
    return data as Record<string, unknown>;
}

/**
 * Complete a pending request and resume whatever is waiting on it.
 *
 * Only requests accept answers, and only while pending. Completing a template
 * would overwrite the definition with one person's answers. Status alone cannot
 * tell them apart: builder templates saved before `kind` existed were "pending".
 * `submittedBy` references users.id, so app-token callers pass undefined.
 */
async function completePendingForm(form: HilFormRow, data: Record<string, unknown>, submittedBy: string | undefined) {
    if (form.kind !== "request") {
        throw new ConflictError(
            `"${form.name}" is a form ${form.kind}, not a request, so it cannot be submitted. Only a pending request accepts answers.`,
        );
    }
    if (form.status !== "pending") {
        throw new ConflictError(
            `"${form.name}" is ${form.status ?? "not pending"}, so it cannot be submitted. Only a pending request accepts answers.`,
        );
    }
    const { hilService } = await import("./hil.service.js");
    await hilService.submitForm(form.id, submittedBy, data);
    return { id: form.id, status: "completed" as const };
}

export const hilFormAccess = {
    async get(formId: number, orgContext: OrgContext): Promise<HilFormRow> {
        const [form] = await db
            .select()
            .from(hilForms)
            .where(and(eq(hilForms.id, formId), ...scope(orgContext)))
            .limit(1);
        // Missing and belonging to another org read the same, so ids cannot be probed.
        if (!form) throw new NotFoundError("HIL form not found");
        return form;
    },

    /** Author a template. Templates are `active`: they are definitions, not requests. */
    async createTemplate(input: unknown, organizationId: number, userId: string | undefined): Promise<HilFormRow> {
        if (input && typeof input === "object" && "stepExecutionId" in input && (input as any).stepExecutionId != null) {
            throw new BadRequestError(
                "stepExecutionId cannot be set here: a form is linked to a pipeline step by the step that runs it.",
            );
        }
        const body = input && typeof input === "object" ? { ...(input as Record<string, unknown>) } : input;
        if (body && typeof body === "object") delete (body as any).stepExecutionId;

        const parsed = formCreateSchema.safeParse(body);
        if (!parsed.success) throw new BadRequestError(`Invalid form: ${describeIssues(parsed.error.issues)}`);

        const { name, description, schema, themeConfig, securityConfig, config } = parsed.data;
        const [form] = await db
            .insert(hilForms)
            .values({
                name,
                description: description ?? null,
                schema: schema ?? { fields: [] },
                ...(themeConfig ? { themeConfig } : {}),
                ...(securityConfig ? { securityConfig } : {}),
                config: config ?? {},
                organizationId,
                createdBy: userId ?? null,
                kind: "template",
                status: "active",
            })
            .returning();
        return form;
    },

    async update(formId: number, input: unknown, orgContext: OrgContext): Promise<HilFormRow> {
        const parsed = formUpdateSchema.safeParse(input);
        if (!parsed.success) throw new BadRequestError(`Invalid form update: ${describeIssues(parsed.error.issues)}`);

        const changes: Record<string, unknown> = { ...parsed.data };
        const current = await this.get(formId, orgContext);
        const studio = (current.schema as Record<string, any> | null)?.studio;
        if (parsed.data.schema && studio && !(parsed.data.schema as Record<string, any>).studio) {
            // The Form Builder only knows `fields`. Saving its `{ fields }` over a
            // Form Studio definition would silently delete the form's pages, stages,
            // rules and results, so the Studio part is carried over.
            changes.schema = { ...(current.schema as Record<string, any>), ...parsed.data.schema, studio };
        }
        const formStudio = (current.config as Record<string, any> | null)?.formStudio;
        if (formStudio && (parsed.data.schema || parsed.data.name)) {
            // A Studio editor still open on the old revision must get a conflict on
            // its next save, not overwrite this change without knowing about it.
            // Clearing headSeq makes the Studio record this state as a revision
            // before its next change, so undo cannot silently discard it.
            changes.config = {
                ...(current.config as Record<string, any>),
                formStudio: { ...formStudio, revision: Number(formStudio.revision ?? 0) + 1, headSeq: undefined },
            };
        }

        const [updated] = await db
            .update(hilForms)
            .set({ ...changes, updatedAt: new Date() })
            .where(and(eq(hilForms.id, formId), ...scope(orgContext)))
            .returning();
        if (!updated) throw new NotFoundError("HIL form not found");
        return updated;
    },

    /** Archive, never delete: pipeline steps that point at the form by id keep resolving. */
    async archive(formId: number, orgContext: OrgContext): Promise<HilFormRow> {
        const [archived] = await db
            .update(hilForms)
            .set({ isArchived: true, updatedAt: new Date() })
            .where(and(eq(hilForms.id, formId), ...scope(orgContext)))
            .returning();
        if (!archived) throw new NotFoundError("HIL form not found");
        return archived;
    },

    async markViewed(formId: number, orgContext: OrgContext): Promise<void> {
        const [viewed] = await db
            .update(hilForms)
            .set({ isViewed: true, updatedAt: new Date() })
            .where(and(eq(hilForms.id, formId), ...scope(orgContext)))
            .returning({ id: hilForms.id });
        if (!viewed) throw new NotFoundError("HIL form not found");
    },

    /** Submit answers to a pending request in the caller's org. */
    async submit(formId: number, orgContext: OrgContext, data: unknown, submittedBy: string | undefined) {
        const submission = asSubmission(data);
        const form = await this.get(formId, orgContext);
        return completePendingForm(form, submission, submittedBy);
    },

    /** The form in the shape PlatformFormBlock renders. */
    async getBlockForm(formId: number, orgContext: OrgContext): Promise<{ form: BlockForm }> {
        const form = await this.get(formId, orgContext);
        if (form.isArchived) throw new NotFoundError("HIL form not found");
        return { form: toBlockForm(form) };
    },

    /**
     * A submission from PlatformFormBlock.
     *
     * A pending request is completed and its pipeline resumed. A template has no
     * request to complete, so its answers go to the dataset named by
     * `config.outputDatasetId`, the same rule the assistant intake form uses. With
     * no dataset there is nowhere to keep them, and the caller is told so.
     */
    async submitBlockForm(formId: number, orgContext: OrgContext, data: unknown, submittedBy: string | undefined) {
        const submission = asSubmission(data);
        const form = await this.get(formId, orgContext);
        if (form.isArchived) throw new NotFoundError("HIL form not found");

        const blockForm = toBlockForm(form);
        const missing = missingRequiredFields(blockForm.fields, submission);
        if (missing.length) {
            const labels = blockForm.fields.filter((field) => missing.includes(field.id)).map((field) => field.label);
            throw new BadRequestError(`Required: ${labels.join(", ")}`);
        }

        if (form.kind === "request") {
            return completePendingForm(form, submission, submittedBy);
        }
        if (form.kind !== "template") throw new NotFoundError("HIL form not found");

        const datasetId = Number((form.config as Record<string, unknown> | null)?.outputDatasetId);
        if (!Number.isInteger(datasetId) || datasetId <= 0) {
            throw new ConflictError(
                `"${form.name}" is a form template with no output dataset, so a submission has nowhere to be saved. ` +
                "Configure an output dataset for it, or submit a pending request instead.",
            );
        }

        const { datasetService } = await import("@domain/knowledge/core/dataset-service.js");
        const result = await datasetService.addItems(
            datasetId,
            [{ data: { ...submission, _submittedVia: "form_block", _formId: form.id, _submittedAt: new Date().toISOString() } }],
            orgContext,
        );
        const inserted = result?.inserted ?? 0;
        if (inserted === 0) {
            throw new ConflictError(`The submission was not saved to dataset ${datasetId}.${result?.errors?.length ? ` ${result.errors.join("; ")}` : ""}`);
        }
        return { id: form.id, status: "stored" as const, datasetId, inserted };
    },
};
