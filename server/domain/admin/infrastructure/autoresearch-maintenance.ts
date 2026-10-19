import { db } from "@server/database_service.js";
import { orgs } from "@shared/schema/auth.js";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("AutoresearchMaintenance");

const MIN_INTERVAL_MINUTES = 5;
const DEFAULT_INTERVAL_MINUTES = 60;
const configuredIntervalMinutes = Number(process.env.AUTORESEARCH_SYNC_INTERVAL_MINUTES);
const SYNC_INTERVAL_MINUTES = Number.isFinite(configuredIntervalMinutes)
    ? Math.max(MIN_INTERVAL_MINUTES, configuredIntervalMinutes)
    : DEFAULT_INTERVAL_MINUTES;
const SYNC_INTERVAL_MS = SYNC_INTERVAL_MINUTES * 60 * 1000;

let syncInterval: NodeJS.Timeout | null = null;
let syncInFlight = false;
let lastSyncAt: string | null = null;
let lastSyncSummary: AutoresearchMaintenanceSummary | null = null;

interface AutoresearchSyncResult {
    message: string;
    candidatesTriggered: number;
    candidatesFound?: number;
    blockedCandidates?: number;
    details?: Array<{
        skillId: string;
        status: string;
        reason?: string;
        runId?: number;
        reliabilityPct?: number;
        total?: number;
        success?: number;
        failure?: number;
        linkedRunCount?: number;
        unlinkedEventCount?: number;
    }>;
}

interface AutoresearchMaintenanceSummary {
    orgsScanned: number;
    candidatesFound: number;
    candidatesTriggered: number;
    blockedCandidates: number;
    assistantFindings: number;
    errors: number;
}

export function startAutoresearchMaintenance(): void {
    logger.info(`Starting autoresearch maintenance service (interval: ${SYNC_INTERVAL_MINUTES} minutes)`);

    setTimeout(() => {
        runAutoresearchSync().catch(err =>
            logger.error(`Initial startup autoresearch sync failed: ${err.message}`)
        );
    }, 15000);

    syncInterval = setInterval(() => {
        runAutoresearchSync().catch(err =>
            logger.error(`Scheduled autoresearch sync failed: ${err.message}`)
        );
    }, SYNC_INTERVAL_MS);

    logger.info(`Autoresearch scheduled - next run in ${SYNC_INTERVAL_MINUTES} minutes`);
}

export function stopAutoresearchMaintenance(): void {
    if (syncInterval) {
        clearInterval(syncInterval);
        syncInterval = null;
    }
    logger.info("Stopped autoresearch maintenance service");
}

export function getAutoresearchMaintenanceStatus() {
    return {
        enabled: Boolean(syncInterval),
        intervalMinutes: SYNC_INTERVAL_MINUTES,
        intervalMs: SYNC_INTERVAL_MS,
        intervalLabel: formatIntervalLabel(SYNC_INTERVAL_MINUTES),
        assistantFindingsEnabled: true,
        syncInFlight,
        lastSyncAt,
        lastSyncSummary,
        screenRole: "audit_control_cockpit",
        screenNecessary: true,
        screenRationale: "Assistant handles attention and approvals; this screen remains useful for evidence review, filters, run lineage, and manual governance."
    };
}

export async function routeAutoresearchFindingsToAssistant(
    orgId: number,
    result: AutoresearchSyncResult,
    source: "scheduled" | "manual" = "scheduled"
): Promise<number> {
    const findings: Array<{
        id: string;
        title: string;
        description: string;
        priority: "low" | "medium" | "high" | "critical";
        actionLabel: string;
        aiPrompt: string;
        context: Record<string, unknown>;
    }> = [];

    if (result.candidatesTriggered > 0) {
        findings.push({
            id: `autoresearch-launched-${orgId}-${Date.now()}`,
            title: "Autoresearch launched shadow experiments",
            description: `${result.candidatesTriggered} reliability candidate${result.candidatesTriggered === 1 ? "" : "s"} started Autoresearch. Review experiment lineage and any follow-up proposals.`,
            priority: "medium",
            actionLabel: "Review findings",
            aiPrompt: "Summarize the latest Autoresearch launches, explain why they were triggered, and identify any decisions or approvals needed.",
            context: { orgId, source, result }
        });
    }

    const blocked = result.blockedCandidates ?? 0;
    if (blocked > 0) {
        findings.push({
            id: `autoresearch-blocked-${orgId}-${Date.now()}`,
            title: "Autoresearch candidates need mission context",
            description: `${blocked} candidate${blocked === 1 ? "" : "s"} could not launch because telemetry is not linked to a mission run.`,
            priority: "high",
            actionLabel: "Resolve with Assistant",
            aiPrompt: "Help resolve blocked Autoresearch candidates by identifying missing mission-run context and the safest next steps.",
            context: { orgId, source, result }
        });
    }

    for (const finding of findings) {
        await eventStream.publish("intervention.triggered", {
            interventionId: finding.id,
            title: finding.title,
            description: finding.description,
            priority: finding.priority,
            actionLabel: finding.actionLabel,
            aiPrompt: finding.aiPrompt,
            vector: "C",
            confidence: 0.92,
            context: finding.context
        }, {
            organizationId: orgId,
            source: "autoresearch-maintenance"
        });
    }

    return findings.length;
}

const BATCH_SIZE = 10;

async function runAutoresearchSync(): Promise<void> {
    if (syncInFlight) {
        logger.info("[AutoresearchMaintenance] Sync already in flight; skipping overlapping run");
        return;
    }

    syncInFlight = true;
    logger.info("[AutoresearchMaintenance] Starting scheduled neural core sync");

    const summary: AutoresearchMaintenanceSummary = {
        orgsScanned: 0,
        candidatesFound: 0,
        candidatesTriggered: 0,
        blockedCandidates: 0,
        assistantFindings: 0,
        errors: 0
    };

    try {
        const { adminService } = await import("../admin.service.js");
        const allOrgs = await db.select({ id: orgs.id }).from(orgs);

        for (let i = 0; i < allOrgs.length; i += BATCH_SIZE) {
            const batch = allOrgs.slice(i, i + BATCH_SIZE);
            await Promise.all(batch.map(async (org) => {
                try {
                    const result = await adminService.syncNeuralCore(org.id);
                    const assistantFindings = await routeAutoresearchFindingsToAssistant(org.id, result, "scheduled");
                    summary.orgsScanned++;
                    summary.candidatesFound += result.candidatesFound ?? 0;
                    summary.candidatesTriggered += result.candidatesTriggered;
                    summary.blockedCandidates += result.blockedCandidates ?? 0;
                    summary.assistantFindings += assistantFindings;
                    logger.info(`[AutoresearchMaintenance] Org ${org.id}: ${result.message}`, {
                        triggered: result.candidatesTriggered,
                        blocked: result.blockedCandidates ?? 0,
                        assistantFindings,
                    });
                } catch (err: any) {
                    summary.errors++;
                    logger.error(`[AutoresearchMaintenance] Sync failed for org ${org.id}: ${err.message}`);
                }
            }));
        }

        const { skillPromotionService } = await import("../../mission/core/skill-promotion.service.js");
        await skillPromotionService.checkForRegressions();

        lastSyncAt = new Date().toISOString();
        lastSyncSummary = summary;
        logger.info("[AutoresearchMaintenance] Scheduled neural core sync complete", summary);
    } catch (err: any) {
        summary.errors++;
        logger.error(`[AutoresearchMaintenance] Scheduled sync failed: ${err.message}`);
    } finally {
        syncInFlight = false;
    }
}

function formatIntervalLabel(minutes: number): string {
    if (minutes % 60 === 0) {
        const hours = minutes / 60;
        return `${hours} hour${hours === 1 ? "" : "s"}`;
    }
    return `${minutes} minutes`;
}
