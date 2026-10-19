
import { db } from "@server/database_service.js";
import { eq, and, sql } from "drizzle-orm";
import { orgSettings } from "@shared/schema/auth.js";
import { monthlySpendHistory } from "@shared/schema/billing.js";

import { createLogger } from "@server/utils/logger.js";
import { financialAlertService } from "./financial-alert.service.js";


const logger = createLogger("FinancialMaintenanceService");

/**
 * When the organization's current budget period began.
 *
 * An org resetting on day D is in the period that started on the most recent
 * occurrence of day D — this month if that day has already passed, otherwise
 * last month. Comparing `lastBudgetResetAt` against this is what lets a reset
 * catch up after a missed day instead of waiting a further month.
 *
 * D is clamped to the length of the month, so a reset day of 31 still fires in
 * February rather than being skipped for the short months.
 */
export function budgetPeriodStart(now: Date, resetDay: number): Date {
    const day = Math.min(Math.max(Math.trunc(resetDay) || 1, 1), 31);
    const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();

    let year = now.getFullYear();
    let month = now.getMonth();
    if (now.getDate() < Math.min(day, daysInMonth(year, month))) {
        // This month's reset day has not arrived yet — the period began last month.
        month -= 1;
        if (month < 0) {
            month = 11;
            year -= 1;
        }
    }
    return new Date(year, month, Math.min(day, daysInMonth(year, month)), 0, 0, 0, 0);
}

/**
 * FinancialMaintenanceService
 * Handles recurring financial tasks like monthly budget resets.
 */
export class FinancialMaintenanceService {
    private isRunning = false;
    private interval: NodeJS.Timeout | null = null;

    /**
     * Start the financial maintenance loop.
     */
    start(intervalMs: number = 3600000) { // Default: check every hour
        if (this.isRunning) return;
        this.isRunning = true;
        logger.info(`[Financial Maintenance] Starting recurring financial tasks loop (Interval: ${intervalMs}ms)`);
        
        this.interval = setInterval(() => this.processResets(), intervalMs);
        // Run once immediately
        this.processResets();
    }

    /**
     * Stop the loop.
     */
    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
        this.isRunning = false;
        logger.info("[Financial Maintenance] Stopped.");
    }

    /**
     * Core maintenance logic.
     */
    async processResets() {
        try {
            // 1. Process Monthly Resets
            await this.handleMonthlyResets();
            
            // 2. Check Spend Thresholds for Alerts
            await financialAlertService.checkAllThresholds();
            
        } catch (err: any) {
            logger.error(`[Financial Maintenance] Loop error: ${err.message}`);
        }
    }

    private async handleMonthlyResets() {
        const now = new Date();

        // EVERY org is a candidate, and whether it is due is decided per org
        // from when its period actually started.
        //
        // This used to select `budgetResetDay === today`, which made a missed
        // day a missed MONTH: the job had to run on that exact calendar day or
        // the org kept last month's counter until the same day came round again.
        // Org 291 was carrying a June figure into August for precisely that
        // reason. Since the counter is also what admission control compares
        // against the monthly limit, a counter that only ever grows will
        // eventually refuse all work for an org that has spent nothing this
        // month — so this is a lockout waiting to happen, not just a stale
        // number on a dashboard.
        const candidates = await db.select().from(orgSettings);

        if (candidates.length === 0) return;

        // Logged at debug because this now runs against every org each hour;
        // the interesting line is the per-org reset below, which is rare.
        logger.debug(
            `[Financial Maintenance] Checking ${candidates.length} organization(s) for a due budget reset.`,
        );

        for (const settings of candidates) {
            const lastReset = settings.lastBudgetResetAt ? new Date(settings.lastBudgetResetAt) : null;
            const periodStart = budgetPeriodStart(now, settings.budgetResetDay ?? 1);

            // Due when the current period began after the last reset — true both
            // on the reset day itself and on every day after it that the job was
            // missed, so a late run still catches up exactly once.
            const alreadyReset = lastReset !== null && lastReset >= periodStart;

            if (!alreadyReset) {
                logger.info(
                    `[Financial Maintenance] Archiving and resetting budget for Organization ` +
                        `${settings.organizationId} (period began ${periodStart.toISOString().slice(0, 10)}, ` +
                        `last reset ${lastReset ? lastReset.toISOString().slice(0, 10) : "never"}).`,
                );

                // The period being archived is the one that ENDED at periodStart,
                // so it is named by the month before it — not by today's month,
                // which is wrong whenever this runs late.
                const archived = new Date(periodStart);
                archived.setMonth(archived.getMonth() - 1);

                await db.insert(monthlySpendHistory).values({
                    organizationId: settings.organizationId,
                    month: archived.getMonth(),
                    year: archived.getFullYear(),
                    totalSpendUsd: settings.currentMonthSpendUsd || "0.00",
                    budgetLimitUsd: settings.monthlyBudgetUsd || "100.00",
                });

                await db.update(orgSettings)

                    .set({
                        currentMonthSpendUsd: "0.00",
                        lastBudgetResetAt: now,
                        lastAlertThreshold: 0, // Reset alerts too
                        lastAlertAt: null,
                        updatedAt: now
                    })
                    .where(eq(orgSettings.organizationId, settings.organizationId));
                
                logger.info(`[Financial Maintenance] Organization ${settings.organizationId} budget reset successful.`);
            } else {
                logger.debug(`[Financial Maintenance] Organization ${settings.organizationId} already reset this month.`);
            }
        }
    }
}


export const financialMaintenanceService = new FinancialMaintenanceService();
