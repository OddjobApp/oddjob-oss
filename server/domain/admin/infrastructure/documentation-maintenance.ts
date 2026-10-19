import { db } from "@server/database_service.js";
import { orgs } from "@shared/schema/auth.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("DocumentationMaintenance");

const REGEN_INTERVAL_MS = 24 * 60 * 60 * 1000; // Daily

let regenInterval: NodeJS.Timeout | null = null;
let lastRunAt: Date | null = null;

export function getDocumentationMaintenanceStatus(): { running: boolean; lastRunAt: string | null } {
    return { running: regenInterval !== null, lastRunAt: lastRunAt ? lastRunAt.toISOString() : null };
}

export function startDocumentationMaintenance(): void {
    logger.info("Starting documentation maintenance service (interval: 24 hours)");

    // Execute on startup after a delay to prevent blocking port binding/Vite initialization
    setTimeout(() => {
        runDocumentationRegeneration().catch(err =>
            logger.error(`Initial startup documentation regeneration failed: ${err.message}`)
        );
    }, 20000); // 20s delay

    regenInterval = setInterval(() => {
        runDocumentationRegeneration().catch(err =>
            logger.error(`Scheduled documentation regeneration failed: ${err.message}`)
        );
    }, REGEN_INTERVAL_MS);

    logger.info("Documentation regeneration scheduled — next run in 24 hours");
}

export function stopDocumentationMaintenance(): void {
    if (regenInterval) {
        clearInterval(regenInterval);
        regenInterval = null;
    }
    logger.info("Stopped documentation maintenance service");
}

const BATCH_SIZE = 10;

async function runDocumentationRegeneration(): Promise<void> {
    logger.info("[DocumentationMaintenance] Starting scheduled documentation regeneration");

    const { documentationService } = await import("../documentation.service.js");
    const allOrgs = await db.select({ id: orgs.id }).from(orgs);

    for (let i = 0; i < allOrgs.length; i += BATCH_SIZE) {
        const batch = allOrgs.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (org) => {
            try {
                const result = await documentationService.generateAll(org.id);
                logger.info(`[DocumentationMaintenance] Org ${org.id}: regenerated docs for ${result.scheduled} feature(s)`);
            } catch (err: any) {
                logger.error(`[DocumentationMaintenance] Regeneration failed for org ${org.id}: ${err.message}`);
            }
        }));
    }

    lastRunAt = new Date();
    logger.info("[DocumentationMaintenance] Scheduled documentation regeneration complete");
}
