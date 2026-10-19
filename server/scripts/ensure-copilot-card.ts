/**
 * Create the Copilot agent card for organizations that predate it.
 *
 * The app does this itself on POST /api/agent-cards/sync, which the Crew Room
 * calls on mount — but the server runs under tsx with no hot reload, so a
 * running dev server keeps executing the code it started with. This script is
 * the way to apply it without a restart, and the way to backfill an environment
 * deliberately.
 *
 * Calls the same service the route does rather than inserting SQL, so there is
 * one definition of what the card is. Idempotent: an org that already has a
 * Copilot is left alone.
 *
 * Usage: tsx server/scripts/ensure-copilot-card.ts [orgId]
 *        (no orgId → every organization that has agent cards)
 */

import dotenv from "dotenv";
dotenv.config();

import { db } from "@server/database_service.js";
import { agentCards } from "@shared/schema/agent-cards.js";
import { seedProvisioningService } from "@domain/agent-cards/core/seed-provisioning.service.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("EnsureCopilotCard");

async function main(): Promise<void> {
    const arg = process.argv[2];
    const explicitOrgId = arg ? Number(arg) : null;

    if (arg && Number.isNaN(explicitOrgId)) {
        logger.error(`Invalid orgId: "${arg}"`);
        process.exit(1);
    }

    let orgIds: number[];
    if (explicitOrgId !== null) {
        orgIds = [explicitOrgId];
    } else {
        const rows = await db
            .selectDistinct({ orgId: agentCards.organizationId })
            .from(agentCards);
        orgIds = rows.map((r) => r.orgId).sort((a, b) => a - b);
    }

    if (orgIds.length === 0) {
        logger.info("No organizations with agent cards — nothing to do.");
        process.exit(0);
    }

    let created = 0;
    for (const orgId of orgIds) {
        const cards = await seedProvisioningService.ensureDefaultCards(orgId);
        if (cards.length > 0) {
            created += cards.length;
            logger.info(`org ${orgId}: created ${cards.map((c) => `${c.name} (id=${c.id})`).join(", ")}`);
        } else {
            logger.info(`org ${orgId}: already has a Copilot — unchanged`);
        }
    }

    logger.info(`Done: ${created} card(s) created across ${orgIds.length} organization(s).`);
    process.exit(0);
}

main().catch((err) => {
    logger.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
});
