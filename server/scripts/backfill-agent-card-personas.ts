/**
 * Backfill agent card personas and model bindings.
 *
 * Two things every synced agent card is missing, both of which break the crew
 * discussion in different ways:
 *
 * 1. Model binding. AgentSyncService only sets a provider when one is already
 *    active, and leaves modelBindingModelId null unconditionally — so every card
 *    falls through ModelResolverService to the org default. Binding them
 *    explicitly makes routing decisions legible and lets cards diverge onto
 *    different models later.
 *
 * 2. Persona. Cards are created with the flat 0.5 OCEAN default, which makes
 *    SoulService.generateSoulPrompt() emit nothing at all — every agent in a
 *    crew would speak in the same neutral voice. CrewPersonaService derives a
 *    polarised, differentiated profile per card.
 *
 * Idempotent and non-destructive: only fills what is unset. A card whose traits
 * have been deliberately tuned away from the flat default is left alone.
 *
 * Usage: tsx server/scripts/backfill-agent-card-personas.ts [orgId]
 */

import dotenv from "dotenv";
dotenv.config();

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { agentCards } from "@shared/schema/agent-cards.js";
import { llmModels, llmProviders } from "@shared/schema/ai/llm-router.js";
import { crewPersonaService } from "@domain/crew/core/crew-persona.service.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("BackfillAgentCardPersonas");

interface DefaultBinding {
    providerId: number;
    modelId: number;
}

/** Resolves the org's default model the same way ModelResolverService does. */
async function getDefaultBinding(orgId: number): Promise<DefaultBinding | null> {
    const [row] = await db
        .select({ modelId: llmModels.id, providerId: llmModels.providerId })
        .from(llmModels)
        .innerJoin(llmProviders, eq(llmModels.providerId, llmProviders.id))
        .where(
            and(
                eq(llmModels.organizationId, orgId),
                eq(llmModels.isDefault, true),
                eq(llmModels.isActive, true),
                eq(llmProviders.isActive, true),
            ),
        )
        .limit(1);

    return row ? { providerId: row.providerId, modelId: row.modelId } : null;
}

function isFlatDefault(traits: { o: number; c: number; e: number; a: number; n: number } | null): boolean {
    if (!traits) return true;
    return traits.o === 0.5 && traits.c === 0.5 && traits.e === 0.5 && traits.a === 0.5 && traits.n === 0.5;
}

async function main() {
    const orgId = Number(process.argv[2] ?? 1);
    if (!Number.isInteger(orgId) || orgId <= 0) {
        throw new Error(`Invalid orgId: ${process.argv[2]}`);
    }

    const binding = await getDefaultBinding(orgId);
    if (!binding) {
        logger.warn(
            `No default llm_model for org ${orgId} — run 'tsx server/scripts/seed-llm-providers.ts ${orgId}' first. ` +
                `Personas will still be backfilled, but bindings will be left null.`,
        );
    }

    const cards = await db.select().from(agentCards).where(eq(agentCards.organizationId, orgId));
    if (cards.length === 0) {
        logger.info(`No agent cards for org ${orgId}; nothing to backfill.`);
        process.exit(0);
    }

    let personasSet = 0;
    let bindingsSet = 0;
    const byArchetype = new Map<string, number>();

    for (const card of cards) {
        const update: Record<string, unknown> = {};

        if (isFlatDefault(card.oceanTraits) || !card.soulArchetype || !card.legend) {
            const persona = crewPersonaService.derivePersona(card);
            if (isFlatDefault(card.oceanTraits)) update.oceanTraits = persona.traits;
            if (!card.soulArchetype) update.soulArchetype = persona.archetype;
            if (!card.legend) update.legend = persona.legend;
            byArchetype.set(persona.archetype, (byArchetype.get(persona.archetype) ?? 0) + 1);
            personasSet++;
        }

        if (binding && (card.modelBindingProviderId === null || card.modelBindingModelId === null)) {
            update.modelBindingProviderId = binding.providerId;
            update.modelBindingModelId = binding.modelId;
            bindingsSet++;
        }

        if (Object.keys(update).length === 0) continue;

        update.updatedAt = new Date();
        await db.update(agentCards).set(update).where(eq(agentCards.id, card.id));
    }

    logger.info(
        `Backfill complete for org ${orgId}: ${cards.length} card(s) — ` +
            `${personasSet} persona(s) derived, ${bindingsSet} binding(s) set.`,
    );
    logger.info(
        `Archetype spread: ${[...byArchetype.entries()].map(([a, n]) => `${a}=${n}`).join(", ") || "(none)"}`,
    );
    process.exit(0);
}

main().catch((err) => {
    logger.error(`Backfill failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
});
