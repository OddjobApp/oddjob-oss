import { and, eq, sql } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { jobs, missionTemplates } from "@shared/schema/index.js";
import { getOrgConditions } from "@server/utils/org-conditions.js";
import type { OrgContext } from "@server/utils/auth-context.js";

export type FormUse =
  | { type: "pipeline_step"; via: "id"; jobId: number; name: string }
  | { type: "mission_template"; via: "name"; templateId: number; name: string; stepOrder: number | null }
  | { type: "org_forge"; via: "name"; templateKey: string };

/**
 * What depends on each form, and how it finds it.
 *
 * - A human-approval job names its form by id (`config.formId`), so a rename is safe.
 * - A mission template's HIL sequence names it by `formRef`, and the pipeline
 *   executor looks that name up when the step runs, so a rename breaks the step.
 * - An Org Forge install matches its template's form by name on reinstall.
 *
 * Instant-app form blocks carry a form id inside chat and app payloads that are
 * not indexed anywhere, so they are not listed.
 */
export async function formUsage(forms: Array<{ id: number; name: string; config: unknown }>, ctx: OrgContext, executor: any = db): Promise<Map<number, FormUse[]>> {
    const uses = new Map<number, FormUse[]>(forms.map((form) => [form.id, []]));
    if (!forms.length) return uses;
    const orgCtx = { ...ctx, isSuperAdmin: false };
    const byName = new Map<string, number[]>();
    for (const form of forms) byName.set(form.name, [...(byName.get(form.name) ?? []), form.id]);

    const approvalJobs: Array<{ id: number; name: string; formId: string | null }> = await executor
        .select({ id: jobs.id, name: jobs.name, formId: sql<string | null>`${jobs.config}->>'formId'` })
        .from(jobs)
        .where(and(eq(jobs.type, "human_approval"), sql`${jobs.config}->>'formId' IS NOT NULL`, ...getOrgConditions(orgCtx, jobs, false)));
    for (const job of approvalJobs) {
        uses.get(Number(job.formId))?.push({ type: "pipeline_step", via: "id", jobId: job.id, name: job.name });
    }

    // Shared templates count too: the executor finds a template by mission name
    // without an organization filter, and resolves its formRef in this org.
    const templates: Array<{ id: number; name: string; config: unknown }> = await executor
        .select({ id: missionTemplates.id, name: missionTemplates.name, config: missionTemplates.config })
        .from(missionTemplates)
        .where(and(sql`jsonb_typeof(${missionTemplates.config}->'sequence') = 'array'`, ...getOrgConditions(orgCtx, missionTemplates, true)));
    for (const template of templates) {
        for (const step of (template.config as any).sequence as any[]) {
            if (!step?.requiresHuman || typeof step.formRef !== "string") continue;
            for (const formId of byName.get(step.formRef) ?? []) {
                uses.get(formId)!.push({ type: "mission_template", via: "name", templateId: template.id, name: template.name, stepOrder: typeof step.order === "number" ? step.order : null });
            }
        }
    }

    for (const form of forms) {
        const templateKey = (form.config as any)?.formId;
        if (typeof templateKey === "string" && templateKey) uses.get(form.id)!.push({ type: "org_forge", via: "name", templateKey });
    }
    return uses;
}

export function describeUses(uses: FormUse[]): string {
    return uses
        .map((use) => (use.type === "pipeline_step" ? `pipeline step "${use.name}"` : use.type === "mission_template" ? `mission template "${use.name}"` : `Org Forge template form "${use.templateKey}"`))
        .join(", ");
}
