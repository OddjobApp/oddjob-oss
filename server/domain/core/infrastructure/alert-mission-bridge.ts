/**
 * Alert-to-Mission Bridge
 * 
 * Automatically triggers rescue missions for critical system alerts,
 * enabling self-healing capabilities and proactive incident response.
 * 
 * Quick Win: Transform critical alerts into actionable rescue missions
 */

import { db } from "@server/database_service.js";
import { alerts, rescueSessions, type InsertRescueSession } from "@shared/schema/index.js";
import { eq, and, desc, sql } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { rescueService } from "../../rescue/core/rescue-service.js";
import { assertOrgId } from "@server/utils/auth-context.js";

const logger = createLogger("AlertMissionBridge");

export interface AlertMissionConfig {
    // Which alert categories trigger auto-rescue
    autoRescueCategories: string[];
    // Minimum severity to trigger
    minSeverity: 'error' | 'critical';
    // Cooldown between auto-rescue for same category (ms)
    cooldownMs: number;
    // Maximum auto-rescue missions per hour
    maxPerHour: number;
    // Whether to auto-approve the rescue (vs just create and notify)
    autoApprove: boolean;
}

const DEFAULT_CONFIG: AlertMissionConfig = {
    autoRescueCategories: [
        'system_error',
        'pipeline_failure',
        'mission_stalled',
        'performance_degradation',
        'integration_failure',
        'database_error',
    ],
    minSeverity: 'error',
    cooldownMs: 5 * 60 * 1000, // 5 minutes
    maxPerHour: 10,
    autoApprove: false, // Default to human approval for safety
};

export const alertMissionBridge = {
    config: DEFAULT_CONFIG,

    /**
     * Initialize with custom config.
     */
    initialize(config: Partial<AlertMissionConfig>): void {
        this.config = { ...DEFAULT_CONFIG, ...config };
        logger.info(`[AlertMissionBridge] Initialized with ${this.config.autoRescueCategories.length} auto-rescue categories`);
    },

    /**
     * Process a new alert and potentially trigger a rescue mission.
     * Called automatically when critical alerts are created.
     */
    async onAlert(alertId: number): Promise<{ 
        triggered: boolean; 
        missionId?: number; 
        rescueSessionId?: number;
        reason?: string;
    }> {
        try {
            // 1. Fetch the alert
            const [alert] = await db
                .select()
                .from(alerts)
                .where(eq(alerts.id, alertId))
                .limit(1);

            if (!alert) {
                return { triggered: false, reason: "Alert not found" };
            }

            // 2. Check if alert qualifies for auto-rescue
            const qualification = this.qualifiesForAutoRescue(alert);
            if (!qualification.qualifies) {
                return { triggered: false, reason: qualification.reason };
            }

            // 3. Check cooldown (avoid spam)
            const cooldownCheck = await this.checkCooldown(alert.category, alert.organizationId);
            if (!cooldownCheck.passed) {
                return { triggered: false, reason: `Cooldown active: ${cooldownCheck.remainingMs}ms remaining` };
            }

            // 4. Check rate limit
            const rateLimit = await this.checkRateLimit(alert.organizationId);
            if (!rateLimit.passed) {
                return { triggered: false, reason: `Rate limit exceeded: ${rateLimit.count} missions in last hour` };
            }

            // 5. Create rescue mission
            const rescueResult = await this.createRescueMission(alert);

            if (rescueResult.success) {
                logger.info(`[AlertMissionBridge] Auto-created rescue mission ${rescueResult.rescueSessionId} for alert ${alertId}`);
                
                // 6. If auto-approve is enabled, immediately approve
                if (this.config.autoApprove && rescueResult.rescueSessionId) {
                    await this.autoApproveRescue(rescueResult.rescueSessionId, alert);
                }

                return {
                    triggered: true,
                    missionId: rescueResult.missionId,
                    rescueSessionId: rescueResult.rescueSessionId,
                    reason: "Auto-rescue mission created",
                };
            } else {
                return { triggered: false, reason: rescueResult.error };
            }

        } catch (err: any) {
            logger.error(`[AlertMissionBridge] Failed to process alert ${alertId}: ${err.message}`);
            return { triggered: false, reason: err.message };
        }
    },

    /**
     * Determine if an alert qualifies for automatic rescue mission creation.
     */
    qualifiesForAutoRescue(alert: typeof alerts.$inferSelect): { qualifies: boolean; reason?: string } {
        // Check severity
        const severityRank = { info: 1, warning: 2, error: 3, critical: 4 };
        const minRank = severityRank[this.config.minSeverity];
        const alertRank = severityRank[alert.severity as keyof typeof severityRank] || 1;

        if (alertRank < minRank) {
            return { qualifies: false, reason: `Severity ${alert.severity} below threshold ${this.config.minSeverity}` };
        }

        // Check category
        if (!this.config.autoRescueCategories.includes(alert.category)) {
            return { qualifies: false, reason: `Category '${alert.category}' not in auto-rescue list` };
        }

        // Check if alert already has an active rescue
        if ((alert.details as any)?.rescueSessionId) {
            return { qualifies: false, reason: "Alert already has linked rescue session" };
        }

        return { qualifies: true };
    },

    /**
     * Check cooldown period for the same category.
     */
    async checkCooldown(category: string, organizationId: number | null): Promise<{ passed: boolean; remainingMs: number }> {
        const [lastRescue] = await db
            .select({ createdAt: rescueSessions.createdAt })
            .from(rescueSessions)
            .where(
                and(
                    eq(rescueSessions.organizationId, assertOrgId(organizationId)),
                    sql`${rescueSessions.serviceType} ILIKE ${'%' + category + '%'}`,
                    eq(rescueSessions.status, 'COMPLETED')
                )
            )
            .orderBy(desc(rescueSessions.createdAt))
            .limit(1);

        if (!lastRescue) {
            return { passed: true, remainingMs: 0 };
        }

        const elapsed = Date.now() - new Date(lastRescue.createdAt).getTime();
        const remaining = Math.max(0, this.config.cooldownMs - elapsed);

        return { passed: remaining === 0, remainingMs: remaining };
    },

    /**
     * Check rate limit for auto-rescue missions.
     */
    async checkRateLimit(organizationId: number | null): Promise<{ passed: boolean; count: number }> {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

        const recentRescues = await db
            .select({ count: sql<number>`count(*)` })
            .from(rescueSessions)
            .where(
                and(
                    eq(rescueSessions.organizationId, assertOrgId(organizationId)),
                    sql`${rescueSessions.createdAt} > ${oneHourAgo}`,
                    sql`${rescueSessions.source} = 'alert_auto_rescue'`
                )
            );

        const count = recentRescues[0]?.count || 0;
        return { passed: count < this.config.maxPerHour, count };
    },

    /**
     * Create a rescue mission from an alert.
     */
    async createRescueMission(alert: typeof alerts.$inferSelect): Promise<{ 
        success: boolean; 
        rescueSessionId?: number; 
        missionId?: number;
        error?: string;
    }> {
        try {
            // 1. Build triage summary from alert details
            const triageSummary = this.buildTriageSummary(alert);

            // 2. Determine service type from category
            const serviceType = this.categorizeServiceType(alert.category);

            // 4. Use rescue service to initiate rescue
            const session = await rescueService.initiateRescue({
                orgId: assertOrgId(alert.organizationId),
                serviceType: alert.category,
                failureContext: alert.message,
                triageSummary,
                status: 'ACCEPTED', // 'ACCEPTED' is a valid status, 'ACTIVE' is not
                severity: alert.severity === 'critical' ? 'P1' : alert.severity === 'error' ? 'P2' : 'P3',
                source: 'alert_auto_rescue',
                metadata: {
                    alertId: alert.id,
                    alertCategory: alert.category,
                    alertDetails: alert.details,
                    jobRunId: alert.jobRunId,
                    pipelineRunId: alert.pipelineRunId,
                    scheduledJobId: alert.scheduledJobId,
                    autoCreated: true,
                    createdAt: new Date().toISOString(),
                },
            });


            // 5. Link alert to rescue session
            await db.update(alerts)
                .set({
                    details: {
                        ...(alert.details as any),
                        rescueSessionId: session.id,
                        autoRescueCreated: true,
                    },
                })
                .where(eq(alerts.id, alert.id));

            return {
                success: true,
                rescueSessionId: session.id,
                missionId: session.missionId || undefined,
            };

        } catch (err: any) {
            logger.error(`[AlertMissionBridge] Failed to create rescue mission: ${err.message}`);
            return { success: false, error: err.message };
        }
    },

    /**
     * Build a triage summary from alert details.
     */
    buildTriageSummary(alert: typeof alerts.$inferSelect): string {
        const parts: string[] = [
            `Alert: ${alert.category} (${alert.severity})`,
            `Message: ${alert.message}`,
        ];

        if (alert.details) {
            const details = alert.details as any;
            if (details.error) parts.push(`Error: ${details.error}`);
            if (details.stack) parts.push(`Stack: ${details.stack.split('\n')[0]}`);
            if (details.component) parts.push(`Component: ${details.component}`);
        }

        if (alert.jobRunId) parts.push(`Job Run: ${alert.jobRunId}`);
        if (alert.pipelineRunId) parts.push(`Pipeline Run: ${alert.pipelineRunId}`);

        return parts.join('\n');
    },

    /**
     * Map alert category to service type for rescue routing.
     */
    categorizeServiceType(category: string): string {
        const categoryMap: Record<string, string> = {
            'system_error': 'system',
            'pipeline_failure': 'pipeline',
            'mission_stalled': 'mission',
            'performance_degradation': 'performance',
            'integration_failure': 'integration',
            'database_error': 'database',
        };

        return categoryMap[category] || 'general';
    },

    /**
     * Auto-approve a rescue mission (when config.autoApprove is true).
     */
    async autoApproveRescue(rescueSessionId: number, alert: typeof alerts.$inferSelect): Promise<void> {
        try {
            await rescueService.updateStatus(
                rescueSessionId,
                'ARRIVED' // Use a valid status
            );

            await rescueService.logRescueEvent({
                sessionId: rescueSessionId,
                eventType: 'AUTO_APPROVED',
                newStatus: 'ARRIVED',
                actorType: 'system',
                details: { alertId: alert.id, reason: `Auto-approved for alert ${alert.id} (${alert.category})` }
            });


            logger.info(`[AlertMissionBridge] Auto-approved rescue ${rescueSessionId}`);

        } catch (err: any) {
            logger.error(`[AlertMissionBridge] Failed to auto-approve rescue ${rescueSessionId}: ${err.message}`);
        }
    },

    /**
     * Get statistics on alert-to-mission conversions.
     */
    async getStats(organizationId?: number): Promise<{
        totalAutoRescues: number;
        successfulRescues: number;
        avgResolutionTime: number;
        topCategories: Array<{ category: string; count: number }>;
    }> {
        const conditions = [
            sql`${rescueSessions.source} = 'alert_auto_rescue'`,
        ];

        if (organizationId) {
            conditions.push(eq(rescueSessions.organizationId, organizationId));
        }

        const sessions = await db
            .select()
            .from(rescueSessions)
            .where(and(...conditions));

        const total = sessions.length;
        const successful = sessions.filter(s => s.status === 'COMPLETED').length;

        // Calculate average resolution time for completed rescues
        const completedRescues = sessions.filter(s => 
            s.status === 'COMPLETED' && s.completedAt
        );

        const avgResolutionTime = completedRescues.length > 0
            ? completedRescues.reduce((sum, s) => {
                const duration = s.completedAt 
                    ? new Date(s.completedAt).getTime() - new Date(s.createdAt).getTime()
                    : 0;
                return sum + duration;
            }, 0) / completedRescues.length
            : 0;

        // Count by category
        const categoryCounts: Record<string, number> = {};
        sessions.forEach(s => {
            const cat = s.serviceType || 'unknown';
            categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
        });

        const topCategories = Object.entries(categoryCounts)
            .map(([category, count]) => ({ category, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);

        return {
            totalAutoRescues: total,
            successfulRescues: successful,
            avgResolutionTime: Math.round(avgResolutionTime / 1000), // seconds
            topCategories,
        };
    },

    /**
     * Manually trigger a rescue mission for an alert (admin override).
     */
    async manualTrigger(alertId: number, userId: string): Promise<{
        success: boolean;
        rescueSessionId?: number;
        error?: string;
    }> {
        try {
            const [alert] = await db
                .select()
                .from(alerts)
                .where(eq(alerts.id, alertId))
                .limit(1);

            if (!alert) {
                return { success: false, error: "Alert not found" };
            }

            // Skip qualification checks for manual trigger
            const result = await this.createRescueMission(alert);

            if (result.success) {
                logger.info(`[AlertMissionBridge] Manually triggered rescue ${result.rescueSessionId} for alert ${alertId} by user ${userId}`);
            }

            return result;

        } catch (err: any) {
            return { success: false, error: err.message };
        }
    },
};

export default alertMissionBridge;
