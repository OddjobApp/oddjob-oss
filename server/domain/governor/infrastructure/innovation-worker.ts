import { Job } from 'bullmq';
import { createLogger } from "@server/utils/logger.js";
import { BaseWorker } from "@server/workers/base-worker.js";
import { db } from "@server/database_service.js";
import { orgs, orgSettings } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { innovationLabService } from "../core/innovation-lab.service.js";

const logger = createLogger("InnovationWorker");
const QUEUE_NAME = 'governor-innovation';

/**
 * InnovationWorker - Processes the 12-hour evolutionary scan cycle.
 */
export class InnovationWorker extends BaseWorker<void> {
    constructor() {
        super(QUEUE_NAME, {
            concurrency: 1, // Only one global scan at a time to manage API load
        });
    }

    protected async execute(job: Job): Promise<any> {
        this.logger.info(`Starting scheduled Innovation Lab cycle: ${job.id}`);

        // 1. Get all organizations with trustgraph enabled
        const activeOrgs = await db.select({ id: orgs.id })
            .from(orgs)
            .innerJoin(orgSettings, eq(orgs.id, orgSettings.organizationId))
            .where(eq(orgSettings.trustgraphEnabled, true));

        this.logger.info(`Found ${activeOrgs.length} organizations to scan.`);

        // 2. Deterministic rotation seed based on 12-hour window
        // Math matches the 12-hour cron cycle (0, 12)
        const rotationSeed = Math.floor(Date.now() / (12 * 3600 * 1000));

        const results = [];
        for (const org of activeOrgs) {
            try {
                this.logger.debug(`Scanning organization ${org.id} for evolution...`);
                const pitches = await innovationLabService.scanForEvolutionOpportunities(org.id, rotationSeed);
                results.push({ orgId: org.id, pitchesCount: pitches.length });
            } catch (err: any) {
                this.logger.error(`Evolution scan failed for org ${org.id}: ${err.message}`);
                results.push({ orgId: org.id, error: err.message });
            }
        }

        return {
            cycle: rotationSeed,
            organizationsScanned: activeOrgs.length,
            details: results
        };
    }
}

let workerInstance: InnovationWorker | null = null;

/**
 * Starts the Innovation Worker singleton.
 */
export function startInnovationWorker() {
    if (!workerInstance) {
        workerInstance = new InnovationWorker();
        logger.info("[Governor] Innovation Worker started.");
    }
    return workerInstance;
}
