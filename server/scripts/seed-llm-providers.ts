/**
 * Seed the LLM router registry (llm_providers + llm_models).
 *
 * Why this exists: the intent router resolves each agent card's model binding
 * through these two tables (requirement 9.3 — "pass the resolved model provider
 * and model identifier to the existing LLM router infrastructure"). On a fresh
 * database both tables are empty, so ModelResolverService.resolveFromOrgDefault()
 * finds no org default and throws "No available model provider", which surfaces
 * as a 503 from POST /api/intent-router/classify and an error bubble in the
 * Agent Chat panel.
 *
 * Gemini-first per platform policy. The provider `name` is the key
 * llmRouterService and AIClientFactory.getClient() switch on, so it must be one
 * of the adapter names in SEEDABLE_PROVIDERS ("google", "muse").
 *
 * Scoping gotcha: llmRouterService.getSpecificModel() filters providers by
 * organization_id when an orgId is passed, and ModelResolverService requires
 * llm_models.organization_id = orgId for the org default. A NULL (global)
 * organization_id therefore would NOT resolve — both rows are seeded against a
 * concrete org.
 *
 * Idempotent: re-running updates the existing rows in place rather than
 * inserting duplicates.
 *
 * Usage: tsx server/scripts/seed-llm-providers.ts [orgId] [provider]
 *
 * provider defaults to "google"; "muse" registers Meta Model API
 * (api.meta.ai, OpenAI-compatible) with the muse-spark catalogue, keyed from
 * MODEL_API_KEY.
 */

import dotenv from "dotenv";
dotenv.config();

import { and, eq } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { llmProviders, llmModels } from "@shared/schema/ai/llm-router.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("SeedLlmProviders");

/**
 * Seedable providers. `name` must match the registered adapter key
 * (AIClientFactory's switch), `keyEnv` is the environment variable the API key
 * is read from, and `apiEndpoint` is stored on the llm_providers row for
 * OpenAI-compatible hosts.
 */
const SEEDABLE_PROVIDERS = {
    google: {
        name: "google",
        displayName: "Google Gemini",
        keyEnv: "GEMINI_API_KEY",
        apiEndpoint: undefined as string | undefined,
    },
    muse: {
        name: "muse",
        displayName: "Meta Muse Spark",
        keyEnv: "MODEL_API_KEY",
        apiEndpoint: "https://api.meta.ai/v1" as string | undefined,
    },
    anthropic: {
        name: "anthropic",
        displayName: "Anthropic Claude",
        keyEnv: "ANTHROPIC_API_KEY",
        apiEndpoint: undefined as string | undefined,
    },
} as const;

type SeedableProvider = keyof typeof SEEDABLE_PROVIDERS;

interface SeedModel {
    modelId: string;
    displayName: string;
    contextWindow: number;
    maxOutputTokens: number;
    qualityScore: number;
    speedScore: number;
    costScore: number;
    capabilities: string[];
    isDefault: boolean;
}

/**
 * Model catalogue. The default is taken from GEMINI_MODEL so the registry
 * agrees with what the rest of the platform already calls.
 */
function buildSeedModels(provider: SeedableProvider): SeedModel[] {
    if (provider === "muse") {
        // muse-spark shares one price card across checkpoints; costs resolve
        // from MODEL_PRICING by modelId, so no per-row price is seeded.
        return [
            {
                modelId: process.env.MUSE_MODEL?.trim() || "muse-spark-1.3",
                displayName: "Muse Spark 1.3",
                contextWindow: 1_048_576,
                maxOutputTokens: 16_384,
                qualityScore: 88,
                speedScore: 80,
                costScore: 80,
                capabilities: ["code", "reasoning", "analysis", "creative", "vision"],
                isDefault: true,
            },
        ];
    }

    if (provider === "anthropic") {
        // Costs resolve from MODEL_PRICING by modelId; ids match the
        // cost-registry claude-* entries.
        const claude = (modelId: string, displayName: string, maxOutputTokens: number,
            quality: number, speed: number, cost: number, isDefault = false): SeedModel => ({
            modelId, displayName,
            contextWindow: 200_000,
            maxOutputTokens,
            qualityScore: quality,
            speedScore: speed,
            costScore: cost,
            capabilities: ["code", "reasoning", "analysis", "creative", "vision"],
            isDefault,
        });
        // Claude Sonnet 5.5 is the primary model. ANTHROPIC_MODEL may override it,
        // and the row is then named for that model: a fixed "Claude Sonnet 4.5"
        // label once sat on an Opus 5.5 row and hid which model was the default.
        const primaryId = process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-5-5";
        const primaryName = primaryId === "claude-sonnet-5-5"
            ? "Claude Sonnet 5.5"
            : primaryId.replace(/^claude-/, "Claude ").replace(/-(\d+)-(\d+)$/, " $1.$2").replace(/-/g, " ").replace(/\b(\w)/g, (m) => m.toUpperCase());
        return [
            claude(primaryId, primaryName, 64_000, 95, 80, 60, true),
            ...(primaryId === "claude-opus-5-5" ? [] : [claude("claude-opus-5-5", "Claude Opus 5.5", 64_000, 99, 60, 25)]),
            claude("claude-haiku-4-5-20251001", "Claude Haiku 4.5", 64_000, 78, 95, 90),
            claude("claude-opus-4-7", "Claude Opus 4.7", 64_000, 98, 55, 25),
        ];
    }

    const defaultModelId = process.env.GEMINI_MODEL?.trim() || "gemini-flash-latest";

    return [
        {
            modelId: defaultModelId,
            displayName: "Gemini Flash (latest)",
            contextWindow: 1_000_000,
            maxOutputTokens: 8192,
            qualityScore: 85,
            speedScore: 95,
            costScore: 95,
            capabilities: ["code", "reasoning", "analysis", "creative"],
            isDefault: true,
        },
    ];
}

async function seedProvider(orgId: number, provider: SeedableProvider): Promise<number> {
    const cfg = SEEDABLE_PROVIDERS[provider];
    const apiKey = process.env[cfg.keyEnv]?.trim();
    if (!apiKey) {
        throw new Error(
            `${cfg.keyEnv} is not set — cannot seed the ${provider} provider (llm_providers.api_key is NOT NULL).`,
        );
    }

    const [existing] = await db
        .select({ id: llmProviders.id })
        .from(llmProviders)
        .where(and(eq(llmProviders.name, cfg.name), eq(llmProviders.organizationId, orgId)))
        .limit(1);

    if (existing) {
        // Refresh the key/flags in place so a rotated key propagates on re-run.
        await db
            .update(llmProviders)
            .set({
                apiKey,
                displayName: cfg.displayName,
                apiEndpoint: cfg.apiEndpoint ?? null,
                isActive: true,
                supportsStreaming: true,
                supportsVision: true,
                supportsFunctions: true,
                supportsJsonMode: true,
                priority: 10,
                updatedAt: new Date(),
            })
            .where(eq(llmProviders.id, existing.id));

        logger.info(`Updated existing provider "${cfg.name}" (id=${existing.id}) for org ${orgId}`);
        return existing.id;
    }

    const [created] = await db
        .insert(llmProviders)
        .values({
            organizationId: orgId,
            name: cfg.name,
            displayName: cfg.displayName,
            apiKey,
            apiEndpoint: cfg.apiEndpoint ?? null,
            isActive: true,
            supportsStreaming: true,
            supportsVision: true,
            supportsFunctions: true,
            supportsJsonMode: true,
            priority: 10,
        })
        .returning({ id: llmProviders.id });

    logger.info(`Created provider "${cfg.name}" (id=${created.id}) for org ${orgId}`);
    return created.id;
}

async function seedModels(providerId: number, orgId: number, provider: SeedableProvider): Promise<void> {
    for (const m of buildSeedModels(provider)) {
        const [existing] = await db
            .select({ id: llmModels.id })
            .from(llmModels)
            .where(
                and(
                    eq(llmModels.providerId, providerId),
                    eq(llmModels.modelId, m.modelId),
                    eq(llmModels.organizationId, orgId),
                ),
            )
            .limit(1);

        const values = {
            providerId,
            organizationId: orgId,
            modelId: m.modelId,
            displayName: m.displayName,
            contextWindow: m.contextWindow,
            maxOutputTokens: m.maxOutputTokens,
            supportsStreaming: true,
            supportsVision: true,
            supportsFunctions: true,
            supportsJsonMode: true,
            qualityScore: m.qualityScore,
            speedScore: m.speedScore,
            costScore: m.costScore,
            isActive: true,
            isDefault: m.isDefault,
            capabilities: m.capabilities,
        };

        if (existing) {
            await db
                .update(llmModels)
                .set({ ...values, updatedAt: new Date() })
                .where(eq(llmModels.id, existing.id));
            logger.info(`Updated model "${m.modelId}" (id=${existing.id})`);
        } else {
            const [created] = await db
                .insert(llmModels)
                .values(values)
                .returning({ id: llmModels.id });
            logger.info(`Created model "${m.modelId}" (id=${created.id})`);
        }
    }
}

async function main() {
    const orgId = Number(process.argv[2] ?? 1);
    if (!Number.isInteger(orgId) || orgId <= 0) {
        throw new Error(`Invalid orgId: ${process.argv[2]}`);
    }

    const provider = (process.argv[3] ?? "google") as SeedableProvider;
    if (!(provider in SEEDABLE_PROVIDERS)) {
        throw new Error(`Invalid provider: ${process.argv[3]} — expected one of ${Object.keys(SEEDABLE_PROVIDERS).join(", ")}`);
    }

    const providerId = await seedProvider(orgId, provider);
    await seedModels(providerId, orgId, provider);

    const rows = await db
        .select({
            modelRowId: llmModels.id,
            modelId: llmModels.modelId,
            isDefault: llmModels.isDefault,
        })
        .from(llmModels)
        .where(eq(llmModels.providerId, providerId));

    logger.info(
        `Seed complete for org ${orgId}: provider ${providerId}, ${rows.length} model(s) — ` +
            rows.map((r) => `${r.modelId}${r.isDefault ? " (default)" : ""}`).join(", "),
    );
    process.exit(0);
}

main().catch((err) => {
    logger.error(`Seed failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
});
