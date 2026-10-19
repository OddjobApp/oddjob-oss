
import { db } from "@server/database_service.js";
import { eq, and, sql } from "drizzle-orm";
import { orgSettings } from "@shared/schema/auth.js";
import { messagingService } from "../integrations/messaging-service.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("FinancialAlertService");

export class FinancialAlertService {
    /**
     * Scans all organizations for budget threshold breaches (80%, 100%)
     * and sends notifications if not already sent for the current month.
     */
    async checkAllThresholds() {
        try {
            const now = new Date();
            const currentMonth = now.getMonth();
            const currentYear = now.getFullYear();

            const allOrgs = await db.select().from(orgSettings);

            for (const settings of allOrgs) {
                const budget = parseFloat(settings.monthlyBudgetUsd || "0");
                const spend = parseFloat(settings.currentMonthSpendUsd || "0");
                
                if (budget <= 0) continue;

                const percent = (spend / budget) * 100;
                let targetThreshold = 0;

                if (percent >= 100) {
                    targetThreshold = 100;
                } else if (percent >= 80) {
                    targetThreshold = 80;
                }

                if (targetThreshold > 0) {
                    // Check if we already alerted for this threshold this month
                    const lastAlertAt = settings.lastAlertAt ? new Date(settings.lastAlertAt) : null;
                    const alreadyAlertedThisMonth = lastAlertAt && 
                                                 lastAlertAt.getMonth() === currentMonth && 
                                                 lastAlertAt.getFullYear() === currentYear;
                    
                    const alreadyAlertedThisThreshold = alreadyAlertedThisMonth && 
                                                      (settings.lastAlertThreshold || 0) >= targetThreshold;

                    if (!alreadyAlertedThisThreshold) {
                        await this.sendThresholdAlert(settings.organizationId, targetThreshold, spend, budget);
                        
                        // Update alert state
                        await db.update(orgSettings)
                            .set({
                                lastAlertThreshold: targetThreshold,
                                lastAlertAt: now
                            })
                            .where(eq(orgSettings.organizationId, settings.organizationId));
                    }
                }
            }
        } catch (err: any) {
            logger.error(`[Financial Alert] Threshold scan failed: ${err.message}`);
        }
    }

    /**
     * Sends a notification for a budget threshold breach.
     */
    async sendThresholdAlert(orgId: number, threshold: number, spend: number, budget: number) {
        const severity = threshold >= 100 ? 'critical' : 'warning';
        const title = threshold >= 100 
            ? "🚨 Budget Exceeded" 
            : "⚠️ Budget Warning";
        
        const body = threshold >= 100
            ? `Organization ${orgId} has reached 100% of its monthly budget ($${spend.toFixed(2)} / $${budget.toFixed(2)}). All autonomous missions have been paused.`
            : `Organization ${orgId} has reached ${threshold}% of its monthly budget ($${spend.toFixed(2)} / $${budget.toFixed(2)}).`;

        await messagingService.notify({
            title,
            body,
            severity,
            fields: [
                { label: "Organization ID", value: orgId.toString(), short: true },
                { label: "Current Spend", value: `$${spend.toFixed(2)}`, short: true },
                { label: "Monthly Budget", value: `$${budget.toFixed(2)}`, short: true },
                { label: "Utilization", value: `${((spend / budget) * 100).toFixed(1)}%`, short: true }
            ],
            actions: [
                { label: "View Cost Dashboard", url: `${process.env.APP_URL || 'http://localhost:5000'}/insights/costs`, style: 'primary' }
            ]
        }, orgId);
        
        logger.info(`[Financial Alert] Sent ${threshold}% threshold alert for Org ${orgId}`);
    }

    /**
     * Sends an immediate alert when a mission is killed due to budget constraints.
     */
    async sendKillSwitchAlert(orgId: number, missionId: string, spend: number, budget: number) {
        await messagingService.notify({
            title: "🛑 Mission Aborted (Budget)",
            body: `Mission ${missionId} was automatically terminated because the organization budget limit ($${budget.toFixed(2)}) has been reached.`,
            severity: 'critical',
            fields: [
                { label: "Mission ID", value: missionId, short: true },
                { label: "Organization ID", value: orgId.toString(), short: true },
                { label: "Final Spend State", value: `$${spend.toFixed(2)} / $${budget.toFixed(2)}`, short: false }
            ],
            actions: [
                { label: "Manage Budget", url: `${process.env.APP_URL || 'http://localhost:5000'}/admin/settings`, style: 'danger' }
            ]
        }, orgId);
        
        logger.info(`[Financial Alert] Sent kill-switch alert for Mission ${missionId} (Org ${orgId})`);
    }
}

export const financialAlertService = new FinancialAlertService();
