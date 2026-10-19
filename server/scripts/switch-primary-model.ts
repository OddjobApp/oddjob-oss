/**
 * Switch the primary LLM model, for example Claude Opus 5.5 to Claude Sonnet 5.5.
 *
 *   npx tsx server/scripts/switch-primary-model.ts                      # dry run, Opus 5.5 -> Sonnet 5.5
 *   npx tsx server/scripts/switch-primary-model.ts --apply              # make the change
 *   npx tsx server/scripts/switch-primary-model.ts --from claude-opus-5-5 --to claude-sonnet-5-5 --org 291 --apply
 *
 * A CREW agent answers with the model its card is bound to
 * (agent_cards.model_binding_model_id), or, when unbound, its org's default
 * llm_models row (model-resolver.service.ts). So, for every llm_models row of
 * the `from` model (per org, and the shared rows with no org):
 *
 *   1. Ensure a row for the `to` model beside it: same provider, org, limits and
 *      capabilities. An existing row is reused, so a second run adds nothing.
 *   2. Rebind agent cards bound to the `from` row to the `to` row.
 *   3. If the `from` row is a default, move the default to the `to` row.
 *      A default on any other model is left alone.
 *
 * The `from` rows stay, active, so an agent can still be pointed back at them.
 * Everything runs in one transaction. Without --apply it is rolled back after
 * printing the plan. Nothing is read from the agent's prompts or turns.
 *
 * Pricing for the `to` model must exist in server/domain/ai/core/cost-registry.ts,
 * or its spend is recorded at the default rate; the script warns when it doesn't.
 */
import dotenv from "dotenv";
dotenv.config();

import { and, eq, isNull, sql } from "drizzle-orm";
import { db, pool } from "@server/database_service.js";
import { llmModels } from "@shared/schema/ai/llm-router.js";
import { agentCards } from "@shared/schema/index.js";
import { MODEL_PRICING } from "@server/domain/ai/core/cost-registry.js";

interface Args {
    from: string;
    to: string;
    org: number | null;
    apply: boolean;
}

function parseArgs(argv: string[]): Args {
    const value = (flag: string) => {
        const i = argv.indexOf(flag);
        return i >= 0 ? argv[i + 1] : undefined;
    };
    const org = value("--org");
    const args: Args = {
        from: value("--from") ?? "claude-opus-5-5",
        to: value("--to") ?? "claude-sonnet-5-5",
        org: org === undefined ? null : Number(org),
        apply: argv.includes("--apply"),
    };
    if (args.org !== null && (!Number.isInteger(args.org) || args.org <= 0)) throw new Error(`--org must be a positive integer, got ${org}`);
    if (args.from === args.to) throw new Error("--from and --to name the same model");
    return args;
}

/** "claude-sonnet-5-5" -> "Claude Sonnet 5.5" (matches seed-llm-providers.ts). */
export function displayNameFor(modelId: string): string {
    return modelId
        .replace(/^claude-/, "Claude ")
        .replace(/-(\d+)-(\d+)$/, " $1.$2")
        .replace(/-/g, " ")
        .replace(/\b(\w)/g, (m) => m.toUpperCase());
}

/** Thrown to roll the transaction back after a dry run. */
class DryRun extends Error {}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const host = (() => {
        try { return new URL(process.env.DATABASE_URL ?? "").host || "(unknown)"; } catch { return "(unparseable DATABASE_URL)"; }
    })();
    console.log(`Database: ${host}`);
    console.log(`Switch: ${args.from} -> ${args.to}${args.org ? ` (org ${args.org} only)` : " (all orgs and shared rows)"}`);
    console.log(args.apply ? "Mode: APPLY\n" : "Mode: dry run (nothing is written; pass --apply to make the change)\n");
    if (!MODEL_PRICING[args.to]) {
        console.warn(`WARNING: ${args.to} has no entry in cost-registry.ts; its spend will be recorded at the default rate.\n`);
    }

    let totals = { rowsAdded: 0, cardsMoved: 0, defaultsMoved: 0 };
    try {
        await db.transaction(async (tx) => {
            const fromRows = await tx
                .select()
                .from(llmModels)
                .where(and(
                    eq(llmModels.modelId, args.from),
                    args.org === null ? sql`true` : eq(llmModels.organizationId, args.org),
                ));
            if (fromRows.length === 0) {
                console.log(`No ${args.from} rows found. Nothing to do.`);
                return;
            }

            for (const from of fromRows) {
                const scope = from.organizationId === null ? "shared (no org)" : `org ${from.organizationId}`;
                // One `to` row per org and provider; reuse it when it exists.
                const [existing] = await tx
                    .select()
                    .from(llmModels)
                    .where(and(
                        eq(llmModels.modelId, args.to),
                        eq(llmModels.providerId, from.providerId),
                        from.organizationId === null ? isNull(llmModels.organizationId) : eq(llmModels.organizationId, from.organizationId),
                    ))
                    .limit(1);
                let toId = existing?.id;
                if (!toId) {
                    const [created] = await tx
                        .insert(llmModels)
                        .values({
                            providerId: from.providerId,
                            organizationId: from.organizationId,
                            modelId: args.to,
                            displayName: displayNameFor(args.to),
                            contextWindow: from.contextWindow,
                            maxOutputTokens: from.maxOutputTokens,
                            supportsStreaming: from.supportsStreaming,
                            supportsVision: from.supportsVision,
                            supportsFunctions: from.supportsFunctions,
                            supportsJsonMode: from.supportsJsonMode,
                            qualityScore: from.qualityScore,
                            speedScore: from.speedScore,
                            costScore: from.costScore,
                            priority: from.priority,
                            capabilities: from.capabilities,
                            isActive: true,
                            isDefault: false,
                        })
                        .returning({ id: llmModels.id });
                    toId = created.id;
                    totals.rowsAdded++;
                }

                // Cards bound to the `from` row. A shared row can be bound by cards in any org.
                const moved = await tx
                    .update(agentCards)
                    .set({ modelBindingModelId: toId, modelBindingProviderId: from.providerId })
                    .where(eq(agentCards.modelBindingModelId, from.id))
                    .returning({ id: agentCards.id });
                totals.cardsMoved += moved.length;

                let defaultNote = "default unchanged";
                if (from.isDefault) {
                    await tx.update(llmModels).set({ isDefault: false, updatedAt: new Date() }).where(eq(llmModels.id, from.id));
                    await tx.update(llmModels).set({ isDefault: true, isActive: true, updatedAt: new Date() }).where(eq(llmModels.id, toId));
                    totals.defaultsMoved++;
                    defaultNote = `default moved to ${args.to}`;
                }
                console.log(
                    `${scope}: ${args.from} row ${from.id} -> ${args.to} row ${toId}${existing ? " (existing)" : " (added)"}; ` +
                        `${moved.length} agent card(s) moved; ${defaultNote}`,
                );
            }

            console.log(`\nTotal: ${totals.rowsAdded} row(s) added, ${totals.cardsMoved} card(s) moved, ${totals.defaultsMoved} default(s) moved.`);
            if (!args.apply) throw new DryRun();
        });
        if (args.apply) console.log("Applied.");
    } catch (err) {
        if (err instanceof DryRun) console.log("Dry run: rolled back. Re-run with --apply to make these changes.");
        else throw err;
    }
}

main()
    .then(async () => {
        await pool.end?.();
        process.exit(0);
    })
    .catch(async (err) => {
        console.error("Failed, nothing was changed:", err?.message ?? err);
        await pool.end?.();
        process.exit(1);
    });
