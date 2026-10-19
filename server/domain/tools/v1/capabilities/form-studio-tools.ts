import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ToolContext, ToolDefinition } from "./types.js";
import type { OrgContext } from "@server/utils/auth-context.js";
import { requireToolOrgId } from "./org-context.js";
import { FORM_CHANGE_PROPOSAL, FORM_CREATE_PROPOSAL, FORM_STUDIO_POD, type FormChangeProposal, type FormCreateProposal } from "@shared/form-studio-crew.js";
import type { StudioDefinition } from "@shared/form-studio.js";
import { summarizeChanges, type DefinitionChange } from "@shared/form-studio-merge.js";

/**
 * Form Studio in a CREW room: mount it on a form, draft a change, apply a
 * drafted change.
 *
 * Only mounting is offered to agents. Drafting runs a model against the form and
 * applying writes a revision, so both are reached from the room's own direct
 * path (crew-form-studio.service.ts), after it has decided a message asks for
 * them, and never picked by a model mid-turn.
 */

const VIEWS = ["sources", "structure", "logic", "results", "tests", "preview", "publish"] as const;

function toOrgContext(context: ToolContext): OrgContext {
    return {
        userId: (context as { userId?: string })?.userId ?? "agent",
        organizationId: requireToolOrgId(context),
        isAdmin: Boolean((context as { isAdmin?: boolean })?.isAdmin),
        // Form Studio reads are org-scoped for everyone; a room never reaches another tenant's forms.
        isSuperAdmin: false,
        isOrgAdmin: Boolean((context as { isOrgAdmin?: boolean })?.isOrgAdmin),
    };
}

/**
 * The form a room means: by id, by exact name, or the longest form name the text
 * contains, so "open the succession review form" finds "Succession review" and
 * not a form called "Review".
 */
export function resolveForm<T extends { id: number; name: string }>(forms: T[], formId?: number, reference?: string): T | null {
    if (formId) return forms.find((form) => form.id === formId) ?? null;
    const wanted = (reference ?? "").trim().toLowerCase();
    if (!wanted) return null;
    const exact = forms.find((form) => form.name.trim().toLowerCase() === wanted);
    if (exact) return exact;
    const contained = forms
        .filter((form) => form.name.trim() && wanted.includes(form.name.trim().toLowerCase()))
        .sort((a, b) => b.name.length - a.name.length);
    if (contained[0]) return contained[0];
    if (wanted.length >= 3) {
        const substring = forms
            .filter((form) => form.name.trim() && form.name.trim().toLowerCase().includes(wanted))
            .sort((a, b) => a.name.length - b.name.length);
        if (substring[0]) return substring[0];
    }
    return null;
}

/** What a proposal changes, as lines an author can read on the card. */
export function describeChanges(changes: DefinitionChange[]): string[] {
    const plural = (noun: string, n: number) => (n === 1 ? noun.toLowerCase() : `${noun.toLowerCase()}s`);
    return changes.flatMap((change) => [
        ...(change.added.length ? [`Added ${plural(change.noun, change.added.length)}: ${change.added.join(", ")}`] : []),
        ...(change.changed.length ? [`Changed ${plural(change.noun, change.changed.length)}: ${change.changed.join(", ")}`] : []),
        ...(change.removed.length ? [`Removed ${plural(change.noun, change.removed.length)}: ${change.removed.join(", ")}`] : []),
    ]);
}

/**
 * A name for a form asked for in words: the thing after "build a", up to where the
 * request goes on to say what it does. "Build a mortgage calculator that saves to a
 * dataset" is "Mortgage calculator".
 */
export function formNameFrom(instruction: string): string {
    const match = instruction.match(
        /\b(?:build|create|make|design|draft|set\s+up|put\s+together|generate)\s+(?:me\s+|us\s+)?(?:a|an|new|another|one)\s+(?:new\s+|quick\s+|simple\s+)?([\s\S]{1,80}?)(?=\s+(?:that|which|to|so|with|and|where)\b|[.?!,;]|$)/i,
    );
    const phrase = (match?.[1] ?? instruction).trim().replace(/\s+/g, " ").slice(0, 80) || "New form";
    return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

/**
 * What a drafted form holds, as lines an author can read on the card. A dataset or
 * pipeline the draft names is reported as named, not as working: responses are not
 * written to datasets and actions do not run until the runtime phase.
 */
export function describeNewForm(definition: StudioDefinition): string[] {
    const list = (items: string[], limit = 8) => `${items.slice(0, limit).join(", ")}${items.length > limit ? `, and ${items.length - limit} more` : ""}`;
    const { studio } = definition;
    const lines: string[] = [];
    const fields = definition.fields.map((field) => field.label || field.key);
    lines.push(fields.length ? `Fields: ${list(fields)}` : "No fields yet");
    if (studio.pages.length > 1) lines.push(`Pages: ${list(studio.pages.map((page) => page.title))}`);
    if (studio.stages.length) lines.push(`Stages: ${list(studio.stages.map((stage) => stage.title))}`);
    if (studio.results.length) lines.push(`Results: ${list(studio.results.map((block) => block.title))}`);
    if (studio.decisionRules.length) lines.push(`Decision rules: ${studio.decisionRules.length}`);
    if (studio.dataset) lines.push(`Names dataset #${studio.dataset.datasetId} for its responses; responses are not written there yet`);
    const pipelines = studio.actions.filter((action) => action.type === "start_pipeline");
    if (pipelines.length) lines.push(`Declares ${pipelines.length} pipeline ${pipelines.length === 1 ? "run" : "runs"} for approval; actions do not run yet`);
    return lines;
}

function studioPod(form: { id: number; name: string; revision: number }, view: string, extra: Record<string, unknown> = {}) {
    return {
        type: FORM_STUDIO_POD,
        module: "FormStudioPod",
        component: "FormStudioPod",
        formId: form.id,
        formName: form.name,
        revision: form.revision,
        view,
        ...extra,
        props: { formId: form.id, view },
    };
}

/** The revision a stale write names, or null when the error is something else. */
function staleRevision(error: unknown): number | null {
    const details = (error as { details?: { reason?: string; currentRevision?: unknown } })?.details;
    return details?.reason === "stale_revision" && typeof details.currentRevision === "number" ? details.currentRevision : null;
}

export const FORM_STUDIO_TOOLS: Record<string, ToolDefinition> = {
    mount_form_studio: {
        name: "mount_form_studio",
        label: "Mount Form Studio",
        group: "Forms",
        idempotency: "read-safe",
        riskLevel: "low",
        description:
            "Opens Form Studio beside the CREW conversation on one of this organization's forms: questionnaires, " +
            "assessments, scorecards, intake and review forms, with their scoring, decision rules and results. Pass " +
            "formId, or formName with the form's name. Mounting is read-only: it never changes or publishes the form. " +
            "Changes are drafted as a diff the author applies, so do not describe a form as changed until then. Not " +
            "for applications (mount_app_studio) or documents (mount_scribe_studio).",
        parameters: z.object({
            formId: z.coerce.number().int().positive().optional().describe("Id of the form to open"),
            formName: z.string().max(2000).optional().describe("The form's name, or text that contains it"),
            view: z.enum(VIEWS).optional().default("structure").describe("Which studio tab to open on"),
        }),
        execute: async (params: { formId?: number; formName?: string; view?: (typeof VIEWS)[number] }, context: ToolContext) => {
            const ctx = toOrgContext(context);
            const { formStudioLibrary } = await import("@domain/pipeline/core/form-studio-library.service.js");
            const forms = (await formStudioLibrary.list(ctx)).filter((form) => !form.isArchived);
            let match = resolveForm(forms, params.formId, params.formName);
            if (!match && forms.length > 0) {
                const wanted = (params.formName ?? "").trim().toLowerCase();
                // Generic open request falls back to the most recently edited form
                if (!wanted || /\bform\s*(?:studio|atudio|studo|builder)\b/i.test(wanted) || /^(?:open|show|mount)?\s*(?:the\s+)?form(?:\s+studio)?$/i.test(wanted)) {
                    match = forms[0];
                }
            }
            if (!match) {
                // Naming what exists beats "not found": otherwise the next move is to invent a name.
                const names = forms.map((form) => form.name).slice(0, 15);
                const asked = params.formId ?? (params.formName ? `"${params.formName.slice(0, 120)}"` : "that request");
                return (
                    `No form in this organization matches ${asked}. ` +
                    (names.length
                        ? `Its forms are: ${names.join(", ")}. Say which one to open, or say "build a new form" to create one.`
                        : "It has no forms yet. Say \"build a new form\" to create one in Form Studio.")
                );
            }
            return JSON.stringify(studioPod(match, params.view ?? "structure", { state: match.state, legacy: match.legacy }));
        },
    },

    share_published_form: {
        name: "share_published_form",
        label: "Share a Published Form",
        group: "Forms",
        idempotency: "read-safe",
        riskLevel: "low",
        description:
            "Shows one of this organization's published forms in the conversation so the person can fill it in there. " +
            "Pass formName with the form's name, or formId. Only published forms can be shared. The person sees the " +
            "questions and the results meant for respondents, never reviewer scores, and their answers go to the form.",
        parameters: z.object({
            formId: z.coerce.number().int().positive().optional().describe("Id of the published form"),
            formName: z.string().max(2000).optional().describe("The form's name, or text that contains it"),
        }),
        execute: async (params: { formId?: number; formName?: string }, context: ToolContext) => {
            const ctx = toOrgContext(context);
            const { formStudioLibrary } = await import("@domain/pipeline/core/form-studio-library.service.js");
            const published = (await formStudioLibrary.list(ctx)).filter((form) => !form.isArchived && form.releaseNumber);
            const match = resolveForm(published, params.formId, params.formName);
            if (!match) {
                const names = published.map((form) => form.name).slice(0, 15);
                return names.length
                    ? `No published form matches ${params.formId ?? (params.formName ? `"${params.formName.slice(0, 120)}"` : "that request")}. Published forms: ${names.join(", ")}.`
                    : "This organization has no published forms to share.";
            }
            const { formStudioService } = await import("@domain/pipeline/core/form-studio.service.js");
            const form = await formStudioService.get(match.id, ctx);
            const token = form.published?.href.split("/").pop();
            if (!token) return `"${match.name}" is not published, so it cannot be shared yet.`;
            return JSON.stringify({ type: "form_studio_form", token, formName: form.name, releaseNumber: form.published!.releaseNumber });
        },
    },

    propose_form_change: {
        name: "propose_form_change",
        label: "Draft a Form Change",
        group: "Forms",
        idempotency: "read-safe",
        riskLevel: "low",
        description:
            "Drafts a change to a form against its current revision and returns it as a diff for the author to apply. " +
            "Writes nothing.",
        parameters: z.object({
            formId: z.coerce.number().int().positive(),
            instruction: z.string().min(1).max(4000),
        }),
        execute: async (params: { formId: number; instruction: string }, context: ToolContext) => {
            const ctx = toOrgContext(context);
            const { formStudioService } = await import("@domain/pipeline/core/form-studio.service.js");
            const form = await formStudioService.get(params.formId, ctx);
            let drafted: Awaited<ReturnType<typeof formStudioService.generate>>;
            try {
                drafted = await formStudioService.generate(form.id, form.revision, [], params.instruction, ctx);
            } catch (error) {
                const current = staleRevision(error);
                if (current === null) throw error;
                return `"${form.name}" changed while the change was being drafted (it is at revision ${current} now). Ask again to draft it against the current form.`;
            }
            const changes = describeChanges(summarizeChanges(form.schema, drafted.definition));
            if (!changes.length) {
                return `That would not change "${form.name}". Say more specifically what should change.`;
            }
            const proposal: FormChangeProposal & { type: string } = {
                type: FORM_CHANGE_PROPOSAL,
                proposalId: `formchg_${randomUUID().replace(/-/g, "")}`,
                formId: form.id,
                formName: form.name,
                baseRevision: form.revision,
                instruction: params.instruction,
                changes,
                checks: drafted.checks,
                definition: drafted.definition,
            };
            return JSON.stringify(proposal);
        },
    },

    propose_new_form: {
        name: "propose_new_form",
        label: "Draft a New Form",
        group: "Forms",
        idempotency: "read-safe",
        riskLevel: "low",
        description:
            "Drafts a new Form Studio form (a calculator, intake form, questionnaire, survey, assessment, scorecard or " +
            "checklist) from a request and returns it as a card for the author to create. Writes nothing.\n\n" +
            "Auto-Scribe mode: set autoScribeDraft to true and optionally supply scribeDocumentId to tell the room " +
            "that, once the form is submitted, a Scribe section should be drafted automatically from the responses. " +
            "The crew service reads this flag from the proposal payload and chains a scribe_update_node call after " +
            "the submission webhook fires.",
        parameters: z.object({
            instruction: z.string().min(1).max(4000),
            // --- Form → Scribe auto-draft (Seam 3) ---
            autoScribeDraft: z
                .boolean()
                .optional()
                .default(false)
                .describe(
                    "When true, the room will automatically draft a Scribe section from the form responses after " +
                    "the form is submitted. Pair with scribeDocumentId to target a specific document.",
                ),
            scribeDocumentId: z
                .string()
                .optional()
                .describe(
                    "ID of an existing Scribe document to append the auto-draft to. Omit to let the room create " +
                    "a new document titled '<FormName> — Submission Draft'.",
                ),
        }),
        execute: async (params: { instruction: string; autoScribeDraft?: boolean; scribeDocumentId?: string }, context: ToolContext) => {
            const ctx = toOrgContext(context);
            const { formStudioService } = await import("@domain/pipeline/core/form-studio.service.js");
            const drafted = await formStudioService.generateNew([], params.instruction, ctx);
            if (!drafted.definition.fields.length) {
                return "The draft came back without any questions, so there is nothing to create. Say what the form should ask.";
            }
            const proposal: FormCreateProposal & { type: string } = {
                type: FORM_CREATE_PROPOSAL,
                proposalId: `formnew_${randomUUID().replace(/-/g, "")}`,
                name: formNameFrom(params.instruction),
                instruction: params.instruction,
                summary: describeNewForm(drafted.definition),
                checks: drafted.checks,
                definition: drafted.definition,
                // Seam 3 fields — carried in the payload so the crew service reads them
                // after the submission webhook fires, without needing a second LLM turn.
                ...(params.autoScribeDraft ? { autoScribeDraft: true } : {}),
                ...(params.scribeDocumentId ? { scribeDocumentId: params.scribeDocumentId } : {}),
            };
            return JSON.stringify(proposal);
        },
    },

    create_form_from_proposal: {
        name: "create_form_from_proposal",
        label: "Create a Drafted Form",
        group: "Forms",
        idempotency: "none",
        riskLevel: "medium",
        description: "Creates the form a new-form card holds as a Form Studio draft, after the author pressed Create draft.",
        parameters: z.object({
            proposalId: z.string().min(8).max(64),
            name: z.string().min(1).max(300),
            instruction: z.string().min(1).max(4000),
            definition: z.record(z.any()),
        }),
        execute: async (
            params: { proposalId: string; name: string; instruction: string; definition: Record<string, unknown> },
            context: ToolContext,
        ) => {
            const ctx = toOrgContext(context);
            const { formStudioService } = await import("@domain/pipeline/core/form-studio.service.js");
            const created = await formStudioService.create(params.name, ctx, { schema: params.definition, description: params.instruction.slice(0, 1000) });
            return JSON.stringify(studioPod(created, "structure", {
                proposalId: params.proposalId,
                state: "draft",
                lastChange: { status: "created", revision: created.revision },
            }));
        },
    },

    apply_form_change: {
        name: "apply_form_change",
        label: "Apply a Form Change",
        group: "Forms",
        idempotency: "none",
        riskLevel: "medium",
        description:
            "Saves a change the author approved on its diff card as a new revision of the form. Refused when the form " +
            "has changed since the change was drafted.",
        parameters: z.object({
            formId: z.coerce.number().int().positive(),
            baseRevision: z.coerce.number().int().nonnegative(),
            proposalId: z.string().min(8).max(64),
            definition: z.record(z.any()),
            summary: z.string().min(1).max(300),
        }),
        execute: async (
            params: { formId: number; baseRevision: number; proposalId: string; definition: Record<string, unknown>; summary: string },
            context: ToolContext,
        ) => {
            const ctx = toOrgContext(context);
            const { formStudioService } = await import("@domain/pipeline/core/form-studio.service.js");
            try {
                const saved = await formStudioService.save(params.formId, params.baseRevision, { schema: params.definition }, ctx, params.summary);
                return JSON.stringify(studioPod(saved, "structure", {
                    proposalId: params.proposalId,
                    lastChange: { status: "applied", summary: params.summary, revision: saved.revision },
                }));
            } catch (error) {
                const current = staleRevision(error);
                if (current === null) throw error;
                return (
                    `Not applied: the form is at revision ${current} now, and this change was drafted against revision ` +
                    `${params.baseRevision}. Ask again and I'll draft it against the current form.`
                );
            }
        },
    },
};
