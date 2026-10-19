/**
 * Template Revision Service
 *
 * Post-task review pipeline. When a mission run completes, examines the run
 * against the template that spawned it and uses an LLM to propose concrete
 * improvements to the template config. Proposals land in template_proposals
 * with status='pending' and require a human to approve or reject.
 *
 * On approval the proposed_config replaces the template's config, the
 * version is bumped, sibling pending proposals are marked 'superseded', and
 * the run is appended to the template's performanceHistory.
 *
 * Gated:
 *   - skip shadow runs (no production signal)
 *   - skip if mission has no source_template_id
 *   - skip if run dynamicTrace is empty (nothing to learn from)
 *   - skip if no quality signal (success + no negative scoring events)
 *
 * LLM: systemAiService('auditor') -> Gemini-first per platform policy.
 */

import { db } from "@server/database_service.js";
import {
    missions,
    missionRuns,
    missionTemplates,
    templateProposals,
    scoringEvents,
    type TemplateProposal,
} from "@shared/schema/index.js";
import { eq, and, desc, sql } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { systemAiService } from "@domain/ai/core/system-ai.service.js";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";

const logger = createLogger("TemplateRevision");

const MAX_TRACE_CHARS = 4000;
const MIN_TRACE_EVENTS = 1;

export interface ProposeOutcome {
    proposed: boolean;
    proposalId?: number;
    reason?: string;
}

export const templateRevisionService = {
    /**
     * Examine a completed mission run and, if there's signal, produce a
     * proposed revision to the source template. Idempotent: never proposes
     * if a pending proposal already exists for the same run.
     */
    async proposeRevisionFromRun(missionRunId: number): Promise<ProposeOutcome> {
        const startedAt = Date.now();

        const [run] = await db.select().from(missionRuns).where(eq(missionRuns.id, missionRunId)).limit(1);
        if (!run) return { proposed: false, reason: "run_not_found" };
        if (run.status !== "completed") return { proposed: false, reason: "run_not_completed" };
        if (run.isShadow) return { proposed: false, reason: "shadow_run" };
        if (!run.missionId) return { proposed: false, reason: "no_mission_id" };

        const [mission] = await db.select().from(missions).where(eq(missions.id, run.missionId)).limit(1);
        if (!mission) return { proposed: false, reason: "mission_not_found" };
        if (!mission.sourceTemplateId) return { proposed: false, reason: "no_source_template" };

        const [template] = await db.select().from(missionTemplates)
            .where(eq(missionTemplates.id, mission.sourceTemplateId)).limit(1);
        if (!template) return { proposed: false, reason: "template_not_found" };

        // Idempotency: never double-propose for the same run.
        const [existing] = await db.select().from(templateProposals)
            .where(and(
                eq(templateProposals.sourceMissionRunId, missionRunId),
                eq(templateProposals.status, "pending"),
            )).limit(1);
        if (existing) return { proposed: false, reason: "proposal_pending_for_run", proposalId: existing.id };

        // Signal check: trace must have events and there must be SOME signal
        // worth proposing. Without signal we'd waste tokens generating "no
        // changes needed" proposals every successful run.
        const trace = Array.isArray(run.dynamicTrace) ? run.dynamicTrace as any[] : [];
        if (trace.length < MIN_TRACE_EVENTS) return { proposed: false, reason: "trace_too_thin" };

        const negativeSignal = await loadNegativeSignal(missionRunId);
        const hasSignal = run.isSuccess === false
            || (run.failureReason ?? "").length > 0
            || negativeSignal.events.length > 0;
        if (!hasSignal) return { proposed: false, reason: "no_signal" };

        // Append to performance history regardless of whether we propose.
        await appendPerformanceHistory(template.id, {
            runId: missionRunId,
            success: run.isSuccess ?? null,
            failureReason: run.failureReason ?? null,
            costUsd: run.costUsd ?? null,
            at: new Date().toISOString(),
        });

        // LLM pass: generate the proposed revision.
        const aiConfig = (await systemAiService.getAiConfig("auditor", run.organizationId ?? undefined))
            ?? { provider: "google", model: "gemini-2.0-flash", apiKey: "" };
        const aiClient = AIClientFactory.getClient({ provider: aiConfig.provider, baseUrl: (aiConfig as any).baseUrl } as any);

        const prompt = buildRevisionPrompt({
            template,
            run,
            trace,
            failureReason: run.failureReason ?? null,
            negativeSignal,
        });

        const result = await aiClient.execute({
            model: aiConfig.model,
            userPrompt: prompt,
            temperature: 0,
            requestType: "json",
        } as any, undefined, aiConfig.apiKey || "");

        if (!result.success || !result.output) {
            return { proposed: false, reason: `llm_failed: ${result.error || "no_output"}` };
        }

        let parsed: { proposedConfig?: Record<string, unknown>; diffSummary?: string; rationale?: string; skip?: boolean; skipReason?: string };
        try {
            parsed = JSON.parse(result.output);
        } catch {
            return { proposed: false, reason: "llm_parse_failed" };
        }

        if (parsed.skip) return { proposed: false, reason: `llm_skip: ${parsed.skipReason ?? "no_change"}` };
        if (!parsed.proposedConfig || !parsed.diffSummary || !parsed.rationale) {
            return { proposed: false, reason: "llm_incomplete" };
        }

        const proposedVersion = bumpVersion(template.version);

        const [inserted] = await db.insert(templateProposals).values({
            organizationId: run.organizationId!,
            sourceTemplateId: template.id,
            sourceMissionRunId: missionRunId,
            proposedConfig: parsed.proposedConfig,
            diffSummary: parsed.diffSummary,
            rationale: parsed.rationale,
            proposedVersion,
            status: "pending",
        }).returning();

        logger.info(`[TemplateRevision] Proposed revision for template ${template.id} from run ${missionRunId} (proposal=${inserted.id}, elapsed=${Date.now() - startedAt}ms)`);
        return { proposed: true, proposalId: inserted.id };
    },

    async listPending(organizationId: number, opts: { limit?: number; templateId?: number } = {}): Promise<TemplateProposal[]> {
        const conds = [
            eq(templateProposals.organizationId, organizationId),
            eq(templateProposals.status, "pending"),
        ];
        if (opts.templateId) conds.push(eq(templateProposals.sourceTemplateId, opts.templateId));
        return db.select().from(templateProposals)
            .where(and(...conds))
            .orderBy(desc(templateProposals.createdAt))
            .limit(opts.limit ?? 50);
    },

    async getById(id: number, organizationId: number): Promise<TemplateProposal | null> {
        const [row] = await db.select().from(templateProposals)
            .where(and(
                eq(templateProposals.id, id),
                eq(templateProposals.organizationId, organizationId),
            )).limit(1);
        return row ?? null;
    },

    /**
     * Approve a proposal: overwrite the template config, bump version,
     * append to performanceHistory, and mark sibling pending proposals as
     * 'superseded' so reviewers don't approve stale diffs.
     *
     * Safety check: the proposed config must preserve the top-level key set
     * of the original config. If the LLM-generated diff drops a required key,
     * downstream missions could break silently. Reviewers can pass force=true
     * to override (e.g., when the missing key was genuinely obsolete).
     */
    async approve(
        proposalId: number,
        organizationId: number,
        reviewerId: string,
        comments?: string,
        force: boolean = false,
    ): Promise<{ success: boolean; templateId?: number; newVersion?: string; missingKeys?: string[] }> {
        const proposal = await this.getById(proposalId, organizationId);
        if (!proposal) return { success: false };
        if (proposal.status !== "pending") return { success: false };

        // Schema-shape validation: the proposed config must keep every top-level
        // key from the current config. Missing keys block approval unless
        // forced — most callers should investigate before overriding.
        const [currentTemplate] = await db.select().from(missionTemplates)
            .where(eq(missionTemplates.id, proposal.sourceTemplateId)).limit(1);
        if (!currentTemplate) return { success: false };

        const missingKeys = diffMissingKeys(currentTemplate.config, proposal.proposedConfig);
        if (missingKeys.length > 0 && !force) {
            logger.warn(`[TemplateRevision] Approval blocked — proposal ${proposalId} drops keys: ${missingKeys.join(", ")}`);
            return { success: false, missingKeys };
        }

        const newVersion = proposal.proposedVersion ?? bumpVersion(null);

        await db.transaction(async (tx) => {
            await tx.update(missionTemplates)
                .set({ config: proposal.proposedConfig, version: newVersion })
                .where(eq(missionTemplates.id, proposal.sourceTemplateId));

            await tx.update(templateProposals)
                .set({
                    status: "approved",
                    reviewedBy: reviewerId,
                    reviewedAt: new Date(),
                    reviewerComments: comments ?? null,
                    updatedAt: new Date(),
                })
                .where(eq(templateProposals.id, proposalId));

            // Supersede sibling pending proposals for the same template
            await tx.update(templateProposals)
                .set({ status: "superseded", updatedAt: new Date() })
                .where(and(
                    eq(templateProposals.sourceTemplateId, proposal.sourceTemplateId),
                    eq(templateProposals.status, "pending"),
                ));
        });

        logger.info(`[TemplateRevision] Approved proposal ${proposalId} for template ${proposal.sourceTemplateId} (new version ${newVersion})`);
        return { success: true, templateId: proposal.sourceTemplateId, newVersion };
    },

    async reject(proposalId: number, organizationId: number, reviewerId: string, comments: string): Promise<{ success: boolean }> {
        const proposal = await this.getById(proposalId, organizationId);
        if (!proposal) return { success: false };
        if (proposal.status !== "pending") return { success: false };

        await db.update(templateProposals)
            .set({
                status: "rejected",
                reviewedBy: reviewerId,
                reviewedAt: new Date(),
                reviewerComments: comments,
                updatedAt: new Date(),
            })
            .where(eq(templateProposals.id, proposalId));

        logger.info(`[TemplateRevision] Rejected proposal ${proposalId}`);
        return { success: true };
    },
};

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Returns top-level keys present in `current` but missing from `proposed`.
 * Used as a safety check before applying an LLM-generated config: if the
 * model dropped a key the downstream code depends on, approval blocks.
 * Operates on top-level keys only; nested drops aren't caught here (would
 * require schema definitions per template type, which Oddjob doesn't have).
 */
function diffMissingKeys(current: unknown, proposed: unknown): string[] {
    if (!isPlainObject(current) || !isPlainObject(proposed)) return [];
    const currentKeys = Object.keys(current);
    return currentKeys.filter(k => !(k in proposed));
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

async function loadNegativeSignal(missionRunId: number): Promise<{ events: Array<{ ruleId: number | null; vector: string | null; at: string }> }> {
    try {
        const rows = await db.select({
            id: scoringEvents.id,
            ruleId: scoringEvents.ruleId,
            vectorState: scoringEvents.vectorState,
            createdAt: scoringEvents.createdAt,
        }).from(scoringEvents)
            .where(eq(scoringEvents.sessionId, `mission-run-${missionRunId}`))
            .limit(20);
        // Negative signals: vector 'S' (symptom) per evaluation.service.ts convention
        const events = rows
            .filter(r => {
                const vs = r.vectorState as Record<string, unknown> | null;
                return vs && Object.keys(vs).some(k => k === "S");
            })
            .map(r => ({
                ruleId: r.ruleId ?? null,
                vector: "S",
                at: r.createdAt?.toISOString() ?? new Date().toISOString(),
            }));
        return { events };
    } catch {
        return { events: [] };
    }
}

async function appendPerformanceHistory(templateId: number, entry: Record<string, unknown>): Promise<void> {
    try {
        await db.update(missionTemplates)
            .set({
                performanceHistory: sql`COALESCE(${missionTemplates.performanceHistory}, '[]'::jsonb) || ${JSON.stringify([entry])}::jsonb`,
            })
            .where(eq(missionTemplates.id, templateId));
    } catch (err: any) {
        logger.warn(`[TemplateRevision] Failed to append performance history: ${err.message}`);
    }
}

function bumpVersion(current: string | null | undefined): string {
    if (!current) return "1.0.1";
    const m = current.match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!m) return `${current}.1`;
    return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

function buildRevisionPrompt(args: {
    template: typeof missionTemplates.$inferSelect;
    run: typeof missionRuns.$inferSelect;
    trace: any[];
    failureReason: string | null;
    negativeSignal: { events: Array<{ ruleId: number | null; vector: string | null }> };
}): string {
    const traceJson = JSON.stringify(args.trace).slice(0, MAX_TRACE_CHARS);
    return `You review mission template revisions. The template below was used to spawn a mission run that just completed.
Based on the run, propose a concrete improvement to the template's config OR skip if no change is warranted.

CURRENT TEMPLATE (id ${args.template.id}, version ${args.template.version}):
name: ${args.template.name}
description: ${args.template.description ?? ""}
config:
${JSON.stringify(args.template.config, null, 2)}

RUN OUTCOME:
- status: ${args.run.status}
- isSuccess: ${args.run.isSuccess}
- failureReason: ${args.failureReason ?? "(none)"}
- negativeScoringEvents: ${args.negativeSignal.events.length}
- trace (truncated):
${traceJson}

Output JSON with EXACTLY one of these shapes:

To propose a revision:
{
  "proposedConfig": {<full new config object — not a delta>},
  "diffSummary": "1-2 sentence summary of what changed",
  "rationale": "Why this change improves the template, grounded in the run outcome"
}

To decline (run gives insufficient signal or template is already optimal):
{ "skip": true, "skipReason": "short reason" }

Rules:
- The proposedConfig MUST preserve the schema/shape of the current config; only change values or add new fields.
- Ground rationale in specific things from the run trace or failureReason. No generic advice.
- If the run succeeded and there are no negative signals, prefer skip with skipReason="no_change_needed".
- Return JSON ONLY. No prose.`;
}
