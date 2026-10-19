/**
 * Gives an organization the default LLM provider + model binding that crew rounds need.
 *
 * ModelResolverService.getOrgDefaultProvider requires a row in llm_models for the org
 * with is_default and is_active, joined to an active llm_providers row. Without it a
 * crew round dies with
 *
 *   "No available model provider: primary provider unavailable and no org default
 *    configured for org N"
 *
 * which the chat surfaces as the crew failing to respond.
 *
 * Seed provisioning creates an org's agent cards (Copilot included) but never creates
 * this binding, so a freshly seeded org gets a crew that cannot speak. Org 473 had 25
 * agent cards and 0 model bindings.
 *
 * The API key is read from the environment at run time and never passed as an
 * argument, so it does not appear in shell history or process listings. It is the same
 * key the org's own ai_provider credential already points at via env_var_name.
 *
 * Usage:
 *   npx tsx scripts/provision-org-model-binding.ts --org 473            # report only
 *   npx tsx scripts/provision-org-model-binding.ts --org 473 --apply
 */
import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { db } from "../server/database_service.js";
import { llmModels, llmProviders } from "../shared/schema/ai/llm-router.js";

const APPLY = process.argv.includes("--apply");
const FORCE = process.argv.includes("--force");
const orgArg = process.argv[process.argv.indexOf("--org") + 1];
const ORG_ID = Number(orgArg);

const PROVIDER = "google";
const MODEL_ID = process.env.CREW_DEFAULT_MODEL || "gemini-flash-latest";

async function main() {
    if (!Number.isInteger(ORG_ID) || ORG_ID <= 0) {
        console.error("Usage: --org <id> [--apply] [--force]");
        process.exit(1);
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error("GEMINI_API_KEY is not set; refusing to write a provider row with an empty key.");
        process.exit(1);
    }

    const existingDefault = await db
        .select({ id: llmModels.id, modelId: llmModels.modelId })
        .from(llmModels)
        .innerJoin(llmProviders, eq(llmModels.providerId, llmProviders.id))
        .where(and(
            eq(llmModels.organizationId, ORG_ID),
            eq(llmModels.isDefault, true),
            eq(llmModels.isActive, true),
            eq(llmProviders.isActive, true),
        ))
        .limit(1);

    if (existingDefault.length && !FORCE) {
        console.log(`Org ${ORG_ID} already resolves a default model (${existingDefault[0].modelId}). Use --force to re-bind to ${PROVIDER}/${MODEL_ID}.`);
        process.exit(0);
    }

    if (!APPLY) {
        console.log(`Org ${ORG_ID} will be re-bound to ${PROVIDER}/${MODEL_ID}. Re-run with --apply to apply.`);
        process.exit(0);
    }

    // Unset default on any other models for this org
    await db
        .update(llmModels)
        .set({ isDefault: false })
        .where(eq(llmModels.organizationId, ORG_ID));

    // Reuse the org's provider row if one already exists; only the binding may be missing.
    const [existingProvider] = await db
        .select({ id: llmProviders.id })
        .from(llmProviders)
        .where(and(eq(llmProviders.organizationId, ORG_ID), eq(llmProviders.name, PROVIDER)))
        .limit(1);

    let providerId = existingProvider?.id;
    if (!providerId) {
        const [created] = await db.insert(llmProviders).values({
            organizationId: ORG_ID,
            name: PROVIDER,
            displayName: "Google Gemini",
            apiKey,
            supportsStreaming: true,
            supportsVision: true,
            supportsFunctions: true,
            supportsJsonMode: true,
            isActive: true,
            priority: 10,
        }).returning({ id: llmProviders.id });
        providerId = created.id;
        console.log(`  created llm_providers row ${providerId} for org ${ORG_ID}`);
    } else {
        await db.update(llmProviders).set({ isActive: true }).where(eq(llmProviders.id, providerId));
        console.log(`  reusing existing llm_providers row ${providerId}`);
    }

    const [existingModel] = await db
        .select({ id: llmModels.id })
        .from(llmModels)
        .where(and(eq(llmModels.organizationId, ORG_ID), eq(llmModels.modelId, MODEL_ID)))
        .limit(1);

    if (existingModel) {
        await db
            .update(llmModels)
            .set({ isDefault: true, isActive: true, providerId })
            .where(eq(llmModels.id, existingModel.id));
        console.log(`  updated existing llm_models row ${existingModel.id} (${MODEL_ID}) to default`);
    } else {
        const [model] = await db.insert(llmModels).values({
            providerId,
            organizationId: ORG_ID,
            modelId: MODEL_ID,
            displayName: "Gemini Flash (latest)",
            contextWindow: 1000000,
            maxOutputTokens: 8192,
            supportsStreaming: true,
            supportsVision: true,
            supportsFunctions: true,
            supportsJsonMode: true,
            qualityScore: 85,
            speedScore: 95,
            costScore: 95,
            priority: 100,
            isActive: true,
            isDefault: true,
        }).returning({ id: llmModels.id });
        console.log(`  created llm_models row ${model.id} (${MODEL_ID}, default)`);
    }

    console.log(`Org ${ORG_ID} can now resolve a model for crew rounds.`);
    process.exit(0);
}

main().catch((err) => {
    console.error("Provisioning failed:", err);
    process.exit(1);
});
