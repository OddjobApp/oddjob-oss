/**
 * seed-skill-integration-ontology.ts
 *
 * Registers the Skill Integration System objects into the Oddjob ontology:
 *
 *   Object Types (virtual):
 *     - Skill       — backed by the `skills` adapter
 *     - AgentCard   — backed by the `agent_cards` adapter
 *
 *   Ontology Actions (governed write operations):
 *     - AugmentAgentCard  — adds a skill capabilities to an existing agent card
 *     - AssignSkill        — creates a new job wrapping this skill capabilities
 *
 *   Link Types:
 *     - Skill --augments--> AgentCard  (many_to_many, materialized until Phase 3)
 *
 * Idempotent: every insert uses onConflictDoNothing.
 *
 * Usage:
 *   npx tsx server/scripts/seed-skill-integration-ontology.ts
 *   ORG_ID=473 npx tsx server/scripts/seed-skill-integration-ontology.ts
 */

import { db } from "../database_service.js";
import {
    ontologyObjectTypes,
    ontologyActions,
    ontologyLinkTypes,
    orgs,
} from "@shared/schema/index.js";
import { createLogger } from "../utils/logger.js";
import { eq } from "drizzle-orm";

const logger = createLogger("SeedSkillIntegrationOntology");

async function getTargetOrgs(): Promise<{ id: number; name: string }[]> {
    const envOrgId = process.env.ORG_ID ? Number(process.env.ORG_ID) : null;
    if (envOrgId) {
        const rows = await db
            .select({ id: orgs.id, name: orgs.name })
            .from(orgs)
            .where(eq(orgs.id, envOrgId))
            .limit(1);
        if (!rows.length) throw new Error(`ORG_ID=${envOrgId} not found in database`);
        return rows;
    }
    return db.select({ id: orgs.id, name: orgs.name }).from(orgs);
}

async function seedForOrg(orgId: number, orgName: string) {
    logger.info(`[org=${orgId} "${orgName}"] Seeding Skill Integration ontology...`);

    // Fetch any object types already present for this org so we can resolve
    // ids for FK references without depending on the insert return value
    // (onConflictDoNothing returns [] on a conflict).
    const existingTypes = await db
        .select({ id: ontologyObjectTypes.id, name: ontologyObjectTypes.name })
        .from(ontologyObjectTypes)
        .where(eq(ontologyObjectTypes.organizationId, orgId));

    const resolveTypeId = (name: string) =>
        existingTypes.find((r) => r.name === name)?.id;

    // 1. Object Type: Skill
    const [skillType] = await db
        .insert(ontologyObjectTypes)
        .values({
            organizationId: orgId,
            name: "Skill",
            description:
                "An imported or provisioned AI skill — a capability bundle that can be " +
                "assigned to a new agent job or used to augment an existing Agent Card.",
            titleProperty: "name",
            icon: "Zap",
            backing: "virtual",
            sourceAdapter: "skills",
            isActive: true,
            propertiesSchema: {
                id:             { type: "integer" },
                name:           { type: "string" },
                description:    { type: "string" },
                language:       { type: "string" },
                isInstalled:    { type: "boolean" },
                isPublic:       { type: "boolean" },
                organizationId: { type: "integer" },
                createdAt:      { type: "string" },
                updatedAt:      { type: "string" },
            },
            createdBy: "system",
        })
        .onConflictDoNothing()
        .returning();

    const skillTypeId = skillType?.id ?? resolveTypeId("Skill");
    logger.info(`  [OK] Object Type "Skill" id=${skillTypeId ?? "(pre-existing)"}`);

    // 2. Object Type: AgentCard
    const [agentCardType] = await db
        .insert(ontologyObjectTypes)
        .values({
            organizationId: orgId,
            name: "AgentCard",
            description:
                "A persona-based agent card — a named, capability-declared agent identity " +
                "used by the intent router and CREW system. Skills can augment an Agent Card " +
                "to expand its capabilities, tools, and routing affinities.",
            titleProperty: "name",
            icon: "Bot",
            backing: "virtual",
            sourceAdapter: "agent_cards",
            isActive: true,
            propertiesSchema: {
                id:            { type: "integer" },
                name:          { type: "string" },
                description:   { type: "string" },
                personaType:   { type: "string" },
                enabled:       { type: "boolean" },
                isDefault:     { type: "boolean" },
                soulArchetype: { type: "string" },
                createdAt:     { type: "string" },
                updatedAt:     { type: "string" },
            },
            createdBy: "system",
        })
        .onConflictDoNothing()
        .returning();

    const agentCardTypeId = agentCardType?.id ?? resolveTypeId("AgentCard");
    logger.info(`  [OK] Object Type "AgentCard" id=${agentCardTypeId ?? "(pre-existing)"}`);

    // 3. Action: AugmentAgentCard
    // Governed write — requires approval because it reshapes routing org-wide.
    // Handler: SkillAugmentationService.augmentAgentCard (Phase 3).
    if (skillTypeId) {
        await db
            .insert(ontologyActions)
            .values({
                organizationId: orgId,
                name: "AugmentAgentCard",
                description:
                    "Merges the capabilities and tools from an imported Skill into an " +
                    "existing Agent Card. Records the augmentation in skill_augmentations for " +
                    "audit and rollback. Requires approval because it changes the agent routing " +
                    "affinities org-wide.",
                objectTypeId: skillTypeId,
                parametersSchema: {
                    skillId:     { type: "integer", description: "ID of the Skill to merge from" },
                    agentCardId: { type: "integer", description: "ID of the AgentCard to augment" },
                    dryRun:      { type: "boolean", description: "Preview the diff without committing" },
                    reason:      { type: "string",  description: "Human-readable rationale" },
                },
                effect: "write",
                handlerKind: "builtin",
                handlerRef: "skillAugmentationService.augmentAgentCard",
                requiresApproval: true,
                riskLevel: "high",
                isActive: true,
                createdBy: "system",
            })
            .onConflictDoNothing();
        logger.info(`  [OK] Action "AugmentAgentCard" seeded`);
    }

    // 4. Action: AssignSkill
    // Lower-risk write — provisions a draft job, no approval required.
    // Handler: skillService.provisionAgentFromSkill (already exists on server/routes/skills.ts).
    if (skillTypeId) {
        await db
            .insert(ontologyActions)
            .values({
                organizationId: orgId,
                name: "AssignSkill",
                description:
                    "Creates a new Agent Job that wraps this Skill extracted tools and " +
                    "capabilities. The job is created in an inactive draft state — it must be " +
                    "explicitly activated before the intent router can route to it.",
                objectTypeId: skillTypeId,
                parametersSchema: {
                    skillId:     { type: "integer", description: "ID of the Skill to provision a job from" },
                    jobName:     { type: "string",  description: "Display name for the new agent job" },
                    description: { type: "string",  description: "Description override for the new job" },
                },
                effect: "write",
                handlerKind: "builtin",
                handlerRef: "skillService.provisionAgentFromSkill",
                requiresApproval: false,
                riskLevel: "low",
                isActive: true,
                createdBy: "system",
            })
            .onConflictDoNothing();
        logger.info(`  [OK] Action "AssignSkill" seeded`);
    }

    // 5. Link Type: Skill --augments--> AgentCard
    // Declared as "materialized" now so X-Ray can render the edge class before
    // Phase 3 creates skill_augmentations. The backing field will be updated to
    // "derived" (sourceProperty: skill_id) in the Phase 3 migration.
    if (skillTypeId && agentCardTypeId) {
        await db
            .insert(ontologyLinkTypes)
            .values({
                organizationId: orgId,
                name: "augments",
                inverseName: "augmented_by",
                description:
                    "A Skill augments an Agent Card: the skill capabilities and tools " +
                    "have been merged into that card. Read in reverse: an Agent Card is " +
                    "augmented_by zero or more Skills.",
                sourceTypeId: skillTypeId,
                targetTypeId: agentCardTypeId,
                cardinality: "many_to_many",
                backing: "materialized",
                isActive: true,
                createdBy: "system",
            })
            .onConflictDoNothing();
        logger.info(`  [OK] Link Type "Skill --augments--> AgentCard" seeded`);
    }

    logger.info(`[org=${orgId}] Done.`);
}

async function main() {
    const targetOrgs = await getTargetOrgs();
    if (!targetOrgs.length) {
        logger.warn("No orgs found in database — nothing to seed.");
        return;
    }
    logger.info(
        `Seeding ${targetOrgs.length} org(s): ` +
        targetOrgs.map((o) => `${o.id}(${o.name})`).join(", ")
    );
    for (const org of targetOrgs) {
        await seedForOrg(org.id, org.name);
    }
    logger.info("Skill Integration ontology seeding complete.");
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        logger.error(`Seed failed: ${err.message}`);
        process.exit(1);
    });
