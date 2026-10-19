import { type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import crypto from "node:crypto";
import { db } from "@server/database_service.js";
import { appRecords, operationalCycles } from "@shared/schema/index.js";
import { BadRequestError, NotFoundError } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";
import { AppRecordsStore } from "@domain/finance/core/app-records-store.js";
import { reconcileWonLoss } from "@domain/sales/core/opportunity-window.service.js";
import {
    buildOnboardingPacket,
    provisioningStages,
    markHandedOff,
    type ProvisioningStage,
} from "./onboarding.logic.js";

const logger = createLogger("AppPlatformOnboardingController");

/**
 * Onboarding Scaffold (Act IV).
 *
 * POST /onboarding/provision { opportunity_id }
 *   Moving a card to CLOSED_WON hands the deal to Oddjob's onboarding factory:
 *     1. Close the opportunity WON (+ stage_history) if not already closed.
 *     2. Reconcile its window to WON — freeze the ceiling at 100% and backfill
 *        realized_outcome across the decay curve (feeds gate calibration).
 *     3. Assemble a grounded onboarding packet + provisioning stages.
 *     4. Record an onboarding_runs row (the tracked, real-time scaffold).
 *     5. Best-effort: launch the cycle's declared follow_up_cycle (Customer
 *        Onboarding). It carries requiresApproval, so it lands in
 *        `pending_approval` — invoked, never auto-executed. Fully guarded.
 *
 * Token-scoped by (appId, orgId); the follow-up launch reuses the org's own
 * installed cycle definition, so nothing is re-declared here.
 */

interface RawRecord {
    recordId: string;
    data: Record<string, any>;
}

async function loadCollection(appId: number, orgId: number, collection: string): Promise<RawRecord[]> {
    const rows = await db
        .select()
        .from(appRecords)
        .where(and(eq(appRecords.appId, appId), eq(appRecords.orgId, orgId), eq(appRecords.collection, collection)));
    return rows.map((r) => ({ recordId: r.recordId, data: (r.data as Record<string, any>) ?? {} }));
}

/** The org's installed sales cycle (if any), for its follow_up_cycle + owner. */
async function findSalesCycle(orgId: number): Promise<{ createdBy: string; followUp: any } | null> {
    const rows = await db
        .select({ createdBy: operationalCycles.createdBy, metadata: operationalCycles.metadata })
        .from(operationalCycles)
        .where(eq(operationalCycles.organizationId, orgId));
    for (const r of rows) {
        const followUp = (r.metadata as any)?.follow_up_cycle;
        if (followUp && Array.isArray(followUp.blueprints)) {
            return { createdBy: r.createdBy, followUp };
        }
    }
    return null;
}

export class OnboardingController {
    public static async provision(req: Request, res: Response) {
        const { appId, orgId } = req.appTokenContext!;
        const opportunityId = String(req.body?.opportunity_id ?? "").trim();
        if (!opportunityId) throw new BadRequestError("'opportunity_id' is required");

        const [opps, accounts, leads] = await Promise.all([
            loadCollection(appId, orgId, "opportunities"),
            loadCollection(appId, orgId, "accounts"),
            loadCollection(appId, orgId, "leads"),
        ]);
        const oppRec = opps.find((r) => r.data.opportunity_id === opportunityId);
        if (!oppRec) throw new NotFoundError(`Opportunity '${opportunityId}' not found`);

        const now = new Date();
        const store = new AppRecordsStore(appId, orgId);

        // 1. Close the opportunity WON if it isn't already, and log stage_history.
        let opp = oppRec.data;
        if (opp.stage !== "CLOSED_WON") {
            const fromStage = String(opp.stage ?? "");
            opp = { ...opp, stage: "CLOSED_WON", outcome: "won", closed_at: now.toISOString() };
            await store.upsert("opportunities", oppRec.recordId, opp);
            const entryId = `sh_${now.getTime()}_${crypto.randomBytes(4).toString("hex")}`;
            await store.upsert("stage_history", entryId, {
                entry_id: entryId,
                opportunity_id: opportunityId,
                from_stage: fromStage,
                to_stage: "CLOSED_WON",
                changed_at: now.toISOString(),
                changed_by: "onboarding-scaffold",
            });
        }

        // 2. Reconcile the window → WON (freeze + backfill realized_outcome).
        let windowReconciled = false;
        try {
            const res = await reconcileWonLoss(store, now);
            windowReconciled = res.won.length > 0 || res.backfilled > 0;
        } catch (err: any) {
            logger.warn(`[Onboarding] Window reconcile failed for ${opportunityId} (non-fatal): ${err.message}`);
        }

        // 3. Grounded packet + provisioning stages.
        const account = accounts.map((r) => r.data).find((a) => a.account_id === opp.account_id) ?? null;
        const lead = leads.map((r) => r.data).find((l) => l.lead_id === opp.lead_id) ?? null;
        const packet = buildOnboardingPacket(opp, account, lead);

        const salesCycle = await findSalesCycle(orgId);
        const blueprintNames: string[] = salesCycle?.followUp?.blueprints?.map((b: any) => String(b.name)).filter(Boolean) ?? [];
        let stages: ProvisioningStage[] = provisioningStages(blueprintNames);

        // 4 & 5. Best-effort hand-off to the onboarding cycle, then record the run.
        let childCycleId: number | null = null;
        let handoffLaunched = false;
        if (salesCycle?.followUp) {
            try {
                const { CycleManagerService } = await import("@domain/mission/core/cycle-manager.service.js");
                const followUp = {
                    ...salesCycle.followUp,
                    metadata: {
                        ...(salesCycle.followUp.metadata || {}),
                        source: "sales-onboarding-handoff",
                        won_opportunity_id: opportunityId,
                        onboarding_packet: packet,
                    },
                };
                const child = await CycleManagerService.launchCycle(followUp, salesCycle.createdBy, orgId);
                if (child?.id) {
                    childCycleId = child.id;
                    handoffLaunched = true;
                    stages = markHandedOff(stages);
                }
            } catch (err: any) {
                logger.warn(`[Onboarding] Follow-up cycle launch failed for ${opportunityId} (non-fatal): ${err.message}`);
            }
        }

        const runId = `onb_${now.getTime()}_${crypto.randomBytes(4).toString("hex")}`;
        const onboardingRun = {
            run_id: runId,
            opportunity_id: opportunityId,
            deal_name: packet.deal_name,
            account_name: packet.account.name,
            packet,
            stages,
            status: handoffLaunched ? "HANDED_OFF" : "PROVISIONING",
            child_cycle_id: childCycleId,
            created_at: now.toISOString(),
        };
        await store.upsert("onboarding_runs", runId, onboardingRun);

        // Nudge open surfaces to refetch (the won card leaves the board live).
        try {
            const { eventStream } = await import("@domain/core/infrastructure/event-stream.service.js");
            await eventStream.publish(
                "dataset.updated",
                { organizationId: orgId, source: "onboarding-scaffold", opportunity_id: opportunityId },
                { organizationId: orgId },
                "onboarding-scaffold",
            );
        } catch (err: any) {
            logger.warn(`[Onboarding] Event publish failed (non-fatal): ${err.message}`);
        }

        logger.info(`[Onboarding] Provisioned ${opportunityId}; reconciled=${windowReconciled} handoff=${handoffLaunched} child=${childCycleId ?? "none"}`);
        res.json({
            provisioned: true,
            window_reconciled: windowReconciled,
            handoff_launched: handoffLaunched,
            child_cycle_id: childCycleId,
            onboarding_run: onboardingRun,
        });
    }
}
