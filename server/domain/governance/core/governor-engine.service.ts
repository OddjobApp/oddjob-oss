import { db } from "@server/database_service.js";
import { integrationLogs, preventionRules, failureClusters } from "@shared/schema/index.js";
import { sql, desc, and, eq, gte } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { systemAiService } from "@domain/ai/core/system-ai.service.js";
import { assertOrgId } from "@server/utils/auth-context.js";

const logger = createLogger("GovernorEngine");

export interface PlatformHealthReport {
    timestamp: string;
    status: 'healthy' | 'degraded' | 'critical' | 'unknown';
    metrics: {
        errorRate: number;
        latencyAvg: number;
        activeCircuitBreakers: number;
    };
    incidents: {
        severity: 'info' | 'warning' | 'critical';
        component: string;
        message: string;
    }[];
}

export class GovernorEngineService {
    /**
     * Evaluates the overall health of the platform by scanning telemetry and logs.
     * Generates persistent prevention rules if failure patterns are detected.
     */
    async evaluatePlatformHealth(organizationId?: number): Promise<PlatformHealthReport> {
        logger.info(`[Governor] Evaluating platform health ${organizationId ? `for org ${organizationId}` : '(Global)'}...`);

        const report: PlatformHealthReport = {
            timestamp: new Date().toISOString(),
            status: 'healthy',
            metrics: {
                errorRate: 0,
                latencyAvg: 0,
                activeCircuitBreakers: 0
            },
            incidents: []
        };

        try {
            // 0. Check System Resources
            const { ResourceGovernor } = await import("./resource-governor.js");
            const sysHealth = ResourceGovernor.getSystemHealth();
            if (sysHealth.status !== 'healthy') {
                report.status = sysHealth.status === 'throttled' ? 'degraded' : sysHealth.status;
                report.incidents.push({
                    severity: sysHealth.status === 'critical' ? 'critical' : 'warning',
                    component: 'HostSystem',
                    message: `System pressure detected: CPU ${Math.round(sysHealth.cpuLoad * 100)}%, MEM ${Math.round(sysHealth.memPressure * 100)}%`
                });
            }

            const { count } = await import("drizzle-orm");
            const FIVE_MINUTES_AGO = new Date(Date.now() - 300000);

            // 1. Scan for recent 429 (Rate Limit) or 5xx (Server Error) patterns
            const conditions: any[] = [
                gte(integrationLogs.createdAt, FIVE_MINUTES_AGO),
                sql`${integrationLogs.responseStatus} >= 429`
            ];

            if (organizationId) {
                conditions.push(eq(integrationLogs.organizationId, organizationId));
            }

            const recentFailures = await db.select({
                platform: integrationLogs.platform,
                status: integrationLogs.responseStatus,
                count: count(integrationLogs.id)
            })
            .from(integrationLogs)
            .where(and(...conditions))
            .groupBy(integrationLogs.platform, integrationLogs.responseStatus);

            if (recentFailures.length > 0) {
                report.status = 'degraded';
                for (const failure of recentFailures) {
                    const msg = `Detected pattern: ${failure.count} failures (${failure.status}) for ${failure.platform}`;
                    report.incidents.push({
                        severity: failure.count > 10 ? 'critical' : 'warning',
                        component: failure.platform,
                        message: msg
                    });

                    // Autonomous Remediation: Diagnose and generate rule
                    await this.diagnoseAndApplyRule(assertOrgId(organizationId), failure.platform, failure.status || 429, failure);
                }
            }

            // 2. Count active circuit breakers
            const ruleConditions = [eq(preventionRules.isActive, true)];
            if (organizationId) ruleConditions.push(eq(preventionRules.organizationId, organizationId));

            const [activeRules] = await db.select({ value: count() })
                .from(preventionRules)
                .where(and(...ruleConditions));
            
            report.metrics.activeCircuitBreakers = Number(activeRules?.value || 0);
            if (report.metrics.activeCircuitBreakers > 0 && report.status === 'healthy') {
                report.status = 'degraded';
            }

        } catch (err: any) {
            logger.error(`[Governor] Health evaluation failed: ${err.message}`);
            report.status = 'unknown';
        }

        return report;
    }

    /**
     * Performs a deep analysis of integration logs to identify subtle failure patterns.
     */
    async analyzeIntegrationLogs(options: { lookbackMinutes?: number, organizationId?: number } = {}) {
        const lookbackMinutes = options.lookbackMinutes || 60;
        logger.info(`[Governor] Analyzing integration logs (lookback: ${lookbackMinutes}m)...`);

        const lookback = new Date(Date.now() - lookbackMinutes * 60000);
        const conditions = [gte(integrationLogs.createdAt, lookback)];
        
        if (options.organizationId) {
            conditions.push(eq(integrationLogs.organizationId, options.organizationId));
        }

        const summary = await db.select({
            platform: integrationLogs.platform,
            status: integrationLogs.responseStatus,
            avgDuration: sql<number>`AVG(${integrationLogs.durationMs})`,
            errorCount: sql<number>`COUNT(*)`
        })
        .from(integrationLogs)
        .where(and(...conditions))
        .groupBy(integrationLogs.platform, integrationLogs.responseStatus)
        .orderBy(desc(sql`COUNT(*)`));

        return summary;
    }

    /**
     * Uses AI to diagnose the root cause and generate a prevention rule.
     */
    private async diagnoseAndApplyRule(organizationId: number, platform: string, status: number, stats: any) {
        logger.info(`[Governor] Diagnosing failures for ${platform} (${status})...`);

        const ruleName = `Auto-CB-${platform}-${status}`;
        
        // Check if an active rule already exists
        const existingRule = await db.query.preventionRules.findFirst({
            where: and(
                eq(preventionRules.organizationId, organizationId),
                eq(preventionRules.isActive, true),
                sql`${preventionRules.name} = ${ruleName}`
            )
        });

        if (existingRule && (Date.now() - existingRule.createdAt.getTime() < 3600000)) {
            return;
        }

        const prompt = `You are the Oddjob Autonomous Governor.
Identify the root cause and generate a prevention rule for an integration failure.

SERVICE: ${platform}
HTTP STATUS: ${status}
FAILURE COUNT: ${stats.count}

TASK:
1. Determine if this is a Quota/Rate Limit issue, a Service Outage, or a specific Bug.
2. Recommend a Prevention Rule Type: 'circuit-breaker' (stop all calls), 'throttling' (add delays), or 'fallback'.
3. Provide a JSON configuration for the rule.

Return ONLY a JSON object:
{
    "diagnosis": "Root cause explanation",
    "ruleType": "circuit-breaker" | "throttling",
    "ruleDescription": "What the rule does",
    "actionConfig": {
        "cooldownMinutes": 15,
        "throttleMs": 5000,
        "matchingPattern": "${platform}"
    }
}`;

        try {
            const diagnosis = await systemAiService.generateJson(prompt);
            
            if (diagnosis && diagnosis.ruleType) {
                logger.warn(`[Governor] AUTONOMOUS ACTION: Applying ${diagnosis.ruleType} for ${platform}`);
                
                await db.insert(preventionRules).values({
                    organizationId,
                    name: ruleName,
                    description: diagnosis.ruleDescription,
                    ruleType: diagnosis.ruleType, // Match enum in schema
                    matchesPattern: platform,
                    actionConfig: diagnosis.actionConfig, // Correct column name
                    isActive: true,
                    isAutoGenerated: true,
                    createdBy: "governor-engine",
                } as any);

                // Also track as failure cluster
                await db.insert(failureClusters).values({
                    organizationId,
                    name: `Integration Failure: ${platform}`,
                    domain: "api-integration",
                    clusterSignature: `int_fail_${platform}_${status}`,
                    likelyRootCause: diagnosis.diagnosis,
                    incidentCount: Number(stats.count),
                    status: "active",
                    severity: status === 429 ? "medium" : "high",
                });
            }
        } catch (err) {
            logger.error(`[Governor] Failed to diagnose/apply rule for ${platform}:`, err as Error);
        }
    }
}

export const governorEngineService = new GovernorEngineService();
export default governorEngineService;
