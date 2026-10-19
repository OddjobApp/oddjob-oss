/**
 * Seed a real evo-devo lineage so the Flight Deck's Evo-Devo tab has something
 * to show.
 *
 * WHY THIS EXISTS
 *
 * The panel renders correctly and every evo_devo_* table in the dev database is
 * empty, because the whole feature was only ever exercised against oddjob_test
 * (scripts/smoke/evo-devo-db-smoke.ts, 25 checks). The panel is also read-only
 * by design, so there is no way to create a founder genome from the UI — which
 * left the tab permanently showing its empty states with no route out of them.
 *
 * This walks the full path in order, because each step depends on the last:
 *
 *   capabilities -> environment -> founder genome -> phenotype
 *                -> population -> membership -> evaluation -> lifecycle
 *
 * CAPABILITIES COME FIRST, AND THAT IS NOT INCIDENTAL. A genome names the
 * capabilities its steps use, and registerFounderGenome refuses any capability
 * the registry does not hold (see EvoDevoService.assertCapabilitiesRegistered).
 * That check fails OPEN when the registry is unreachable but CLOSED when it is
 * reachable and simply empty — which is exactly the state a fresh install is
 * in. So seeding the registry is a precondition, not a nicety, and this script
 * does it rather than weakening the check.
 *
 * Registering a capability requires an embedding. If the embedding provider is
 * unavailable — a Gemini project over its monthly spend cap returns 429
 * RESOURCE_EXHAUSTED, which is the state this was written in — the script stops
 * there and says so, instead of failing later with a confusing 422 about
 * unregistered capabilities.
 *
 * Idempotent: capability registration upserts by deterministic point id, and
 * every evo-devo step is skipped when its row already exists.
 *
 * Usage:  npx tsx server/scripts/seed-evo-devo-lineage.ts [orgId]
 */

import "dotenv/config";
import { eq, and } from "drizzle-orm";
import { db } from "../database_service.js";
import { orgs } from "@shared/schema/index.js";
import { evoDevoGenomes, evoDevoPhenotypes } from "@shared/schema/evo-devo.js";
import { createLogger } from "../utils/logger.js";
import type { CapabilityManifest } from "@shared/schema/capabilities/index.js";

const logger = createLogger("SeedEvoDevoLineage");

/** Keys are stable, so re-running updates rather than multiplying lineages. */
const ENVIRONMENT_KEY = "support-sandbox";
const GENOME_KEY = "support-triage-founder";
const POPULATION_KEY = "support-triage-gen0";
const SPECIES_ID = "support";

/**
 * The capabilities this genome's steps use.
 *
 * `capability_id` must satisfy the registry's own grammar (^[a-z0-9_]+) — the
 * same pattern EVO_DEVO_CAPABILITY_ID_PATTERN enforces on the genome side, so a
 * genome cannot name something the registry could never mint.
 */
function manifests(): CapabilityManifest[] {
    const make = (
        id: string,
        display: string,
        description: string,
        inputs: Record<string, string>,
        outputs: Record<string, string>,
    ): CapabilityManifest => ({
        schema_version: 1,
        capability_version: "1.0.0",
        capability_id: id,
        metadata: {
            display_name: display,
            // Must be one of the registry's declared categories.
            category: "Data Operations",
            description,
            owner: "platform",
        },
        technical_spec: { inputs, outputs },
        documentation_meta: {
            summary: description,
            business_use_cases: ["Inbound support triage"],
            guardrails: ["Read-only; proposes rather than acts"],
        },
        runtime_context: {
            risk_profile: "Low",
            execution_environment: "Host",
            dependencies: [],
        },
    });

    return [
        make("triage_ticket", "Triage Ticket",
            "Classify an inbound support ticket by urgency and topic.",
            { ticket_text: "str" }, { urgency: "str", topic: "str" }),
        make("draft_reply", "Draft Reply",
            "Draft a customer-facing reply from a triaged ticket.",
            { ticket_text: "str", topic: "str" }, { reply: "str" }),
        make("escalate_ticket", "Escalate Ticket",
            "Propose escalation of a ticket to a human owner.",
            { ticket_id: "str", urgency: "str" }, { proposal: "dict" }),
    ];
}

/** A three-step genome: triage, then draft, then decide whether to escalate. */
function founderGenome() {
    return {
        schemaVersion: "1.0.0",
        id: GENOME_KEY,
        speciesId: SPECIES_ID,
        steps: [
            {
                id: "triage", kind: "agent", capability: "triage_ticket",
                dependsOn: [], config: { model: "flash" }, permissions: ["read"],
            },
            {
                id: "draft", kind: "agent", capability: "draft_reply",
                dependsOn: ["triage"], config: { tone: "concise" }, permissions: ["read"],
            },
            {
                id: "escalate", kind: "agent", capability: "escalate_ticket",
                dependsOn: ["triage"], config: {}, permissions: ["read"],
            },
        ],
        developmentalRules: [],
        protectedLoci: ["triage"],
        metadata: { seededBy: "seed-evo-devo-lineage" },
    };
}

function environment() {
    return {
        schemaVersion: "1.0.0",
        id: ENVIRONMENT_KEY,
        capabilities: ["triage_ticket", "draft_reply", "escalate_ticket"],
        allowedPermissions: ["read"],
        signals: {},
        maxSteps: 8,
    };
}

async function main(): Promise<void> {
    const orgId = parseInt(process.argv[2] || "", 10);
    if (!Number.isInteger(orgId) || orgId <= 0) {
        logger.error("Usage: npx tsx server/scripts/seed-evo-devo-lineage.ts <orgId>");
        process.exit(1);
    }

    const [org] = await db.select({ id: orgs.id, name: orgs.name })
        .from(orgs).where(eq(orgs.id, orgId)).limit(1);
    if (!org) {
        logger.error(`No organization ${orgId}.`);
        process.exit(1);
    }
    logger.info(`Seeding an evo-devo lineage for org ${org.id} ("${org.name}").`);

    const { capabilityRegistry } = await import(
        "@domain/capabilities/core/capability-registry.service.js"
    );
    const { evoDevoService } = await import("@domain/evolution/core/evo-devo.service.js");
    const { evolutionPopulationService } = await import(
        "@domain/evolution/core/evolution-population.service.js"
    );
    const { evolutionLifecycleService } = await import(
        "@domain/evolution/core/evolution-lifecycle.service.js"
    );

    // ── 1. Capabilities ──────────────────────────────────────────────────
    // Everything downstream is refused without these, so a failure here is
    // reported as the blocker it is rather than surfacing later as a 422.
    const wanted = manifests();
    const missingBefore = await capabilityRegistry.findUnregistered(
        orgId, wanted.map((m) => m.capability_id),
    );
    if (missingBefore.length > 0) {
        logger.info(`Registering ${missingBefore.length} capability manifest(s)...`);
        for (const manifest of wanted) {
            if (!missingBefore.includes(manifest.capability_id)) continue;
            try {
                await capabilityRegistry.register(orgId, manifest);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                logger.error(
                    `Could not register "${manifest.capability_id}": ${message}\n\n` +
                        `Capability registration needs an embedding. If the provider is returning ` +
                        `429 RESOURCE_EXHAUSTED, the Gemini project is over its monthly spending ` +
                        `cap — lift it at https://ai.studio/spend and re-run. Nothing has been ` +
                        `written, so re-running is safe.`,
                );
                process.exit(1);
            }
        }
        const stillMissing = await capabilityRegistry.findUnregistered(
            orgId, wanted.map((m) => m.capability_id),
        );
        if (stillMissing.length > 0) {
            logger.error(`Registered without error but still absent: ${stillMissing.join(", ")}`);
            process.exit(1);
        }
    }
    logger.info(`  [ok] ${wanted.length} capabilities registered`);

    // ── 2. Environment + founder genome ──────────────────────────────────
    const [existingGenome] = await db.select({ id: evoDevoGenomes.id })
        .from(evoDevoGenomes)
        .where(and(
            eq(evoDevoGenomes.organizationId, orgId),
            eq(evoDevoGenomes.genomeKey, GENOME_KEY),
        ))
        .limit(1);

    if (!existingGenome) {
        await evoDevoService.registerEnvironment(orgId, environment());
        logger.info(`  [ok] environment "${ENVIRONMENT_KEY}"`);
        await evoDevoService.registerFounderGenome(orgId, founderGenome());
        logger.info(`  [ok] founder genome "${GENOME_KEY}" (3 steps)`);
    } else {
        logger.info(`  [skip] genome "${GENOME_KEY}" already registered`);
    }

    // ── 3. A child, so the panel shows a lineage rather than a single node ─
    const childKey = `${GENOME_KEY}-warmer-tone`;
    const [existingChild] = await db.select({ id: evoDevoGenomes.id })
        .from(evoDevoGenomes)
        .where(and(
            eq(evoDevoGenomes.organizationId, orgId),
            eq(evoDevoGenomes.genomeKey, childKey),
        ))
        .limit(1);
    if (!existingChild) {
        await evoDevoService.createChild(orgId, GENOME_KEY, childKey, {
            type: "replace_step_config",
            stepId: "draft",
            config: { tone: "warm" },
        });
        logger.info(`  [ok] descendant genome "${childKey}"`);
    } else {
        logger.info(`  [skip] descendant already exists`);
    }

    // ── 4. Development ───────────────────────────────────────────────────
    // Seeds are distinct developmental paths; the replay unique index refuses a
    // repeat of (genome, environment, compiler, seed), so this is skipped when
    // the phenotype is already there.
    const developed: string[] = [];
    for (const [genomeKey, seed] of [[GENOME_KEY, 1], [childKey, 1]] as const) {
        const existing = await db.select({ id: evoDevoPhenotypes.id })
            .from(evoDevoPhenotypes)
            .where(and(
                eq(evoDevoPhenotypes.organizationId, orgId),
                eq(evoDevoPhenotypes.seed, seed),
            ));
        try {
            const phenotype = await evoDevoService.develop(orgId, genomeKey, ENVIRONMENT_KEY, seed);
            developed.push(phenotype.id);
            logger.info(`  [ok] phenotype from "${genomeKey}" (seed ${seed})`);
        } catch (err) {
            if (existing.length > 0) {
                developed.push(existing[0].id);
                logger.info(`  [skip] phenotype for "${genomeKey}" already developed`);
            } else {
                throw err;
            }
        }
    }

    // ── 5. Population, membership, evaluation ────────────────────────────
    try {
        await evolutionPopulationService.createPopulation(orgId, {
            populationKey: POPULATION_KEY,
            speciesId: SPECIES_ID,
            constraints: { minimumSafety: 0.6, minimumReliability: 0.6, minimumSampleSize: 5 },
        });
        logger.info(`  [ok] population "${POPULATION_KEY}"`);
    } catch {
        logger.info(`  [skip] population "${POPULATION_KEY}" already exists`);
    }

    for (const [index, phenotypeId] of developed.entries()) {
        try {
            await evolutionPopulationService.addMember(orgId, POPULATION_KEY, phenotypeId, index);
        } catch {
            // Already a member.
        }
        try {
            await evolutionPopulationService.recordEvaluation(orgId, phenotypeId, {
                evaluatorKey: "seed-baseline",
                evaluatorVersion: "1.0.0",
                fitness: {
                    // Plainly synthetic starting values, not measurements. The
                    // second phenotype scores slightly better so selection has
                    // something to order.
                    outcome: 0.72 + index * 0.06,
                    reliability: 0.81 + index * 0.03,
                    safety: 0.93,
                    humanExperience: 0.7 + index * 0.05,
                    costUsd: 0.018,
                    latencyMs: 1400 - index * 120,
                    sampleSize: 12,
                },
                eligible: true,
                ineligibilityReasons: [],
                evidence: { source: "seed-evo-devo-lineage", synthetic: true },
            });
        } catch (err) {
            logger.warn(`  evaluation for ${phenotypeId} skipped: ${
                err instanceof Error ? err.message : String(err)
            }`);
        }
    }
    logger.info(`  [ok] ${developed.length} phenotype(s) admitted and evaluated`);

    // ── 6. Lifecycle ─────────────────────────────────────────────────────
    // Without this the Stage History panel has nothing to show, because a stage
    // event log is only written once a phenotype enters the lifecycle.
    for (const phenotypeId of developed) {
        try {
            await evolutionLifecycleService.initialize(orgId, phenotypeId, "seed-script");
        } catch {
            // Already initialised — the event log is append-only and immutable.
        }
    }
    logger.info(`  [ok] lifecycle initialised`);

    logger.info(
        `\nDone. The Evo-Devo tab at /platform-maintenance/evolution should now show ` +
            `1 population, 2 genomes and their phenotypes for org ${org.id}.`,
    );
    // The app's pool is a singleton with no close, so the process would idle
    // forever after the work is finished — the same hang seed-blueprints has.
    process.exit(0);
}

void main().catch((err) => {
    logger.error(`Seeding failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    process.exit(1);
});
