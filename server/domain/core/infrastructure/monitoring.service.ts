
import { db } from "@server/database_service.js";
import {
    pipelineStepExecutions,
    jobs,
    alerts,
    pipelineExecutions,
    knowledgeNodes,
    agentRunSteps
} from "@shared/schema/index.js";
import { eq, desc, and, sql } from "drizzle-orm";
import { checkDatabaseConnection } from "../../../database_service.js";
import { NotFoundError, ForbiddenError } from "@server/utils/errors.js";
import { getOrgConditions } from "@server/utils/org-conditions.js";
import type { OrgContext } from "@server/utils/auth-context.js";
import { createLogger } from "@server/utils/logger.js";

/** Which table an execution id belongs to. */
export type ExecutionIdKind = "step" | "agent-step";

const logger = createLogger("MonitoringService");

export const monitoringService = {
    /**
     * Get System Health Status
     */
    async getSystemHealth() {
        // Check database connection
        const dbHealth = await checkDatabaseConnection();

        // Memory usage
        const memoryUsage = process.memoryUsage();

        // Uptime
        const uptime = process.uptime();

        return {
            status: dbHealth.connected ? 'healthy' : 'degraded',
            database: {
                connected: dbHealth.connected,
                error: dbHealth.error
            },
            system: {
                uptimeSeconds: uptime,
                memory: {
                    rss: Math.round(memoryUsage.rss / 1024 / 1024) + 'MB',
                    heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024) + 'MB',
                    heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024) + 'MB',
                }
            },
            timestamp: new Date().toISOString()
        };
    },

    /**
     * List Job Executions
     */
    async listExecutions(orgContext: OrgContext, limit: number = 100) {
        // getOrgConditions returns [] only for a super admin with no org selected.
        // The previous inline version skipped filtering for ANY isAdmin context with
        // a null org — including API-key auth, which is isAdmin:true/isSuperAdmin:false
        // — and so read across every tenant.
        const conditions = getOrgConditions(orgContext, jobs, false);

        return await db.select({
            executionId: pipelineStepExecutions.id,
            jobId: pipelineStepExecutions.jobId,
            status: pipelineStepExecutions.status,
            startTime: pipelineStepExecutions.executedAt,
            endTime: pipelineStepExecutions.completedAt,
            jobName: jobs.name,
            output: pipelineStepExecutions.output
        })
            .from(pipelineStepExecutions)
            .innerJoin(jobs, eq(pipelineStepExecutions.jobId, jobs.id))
            .where(conditions.length > 0 ? and(...conditions) : undefined)
            .orderBy(desc(pipelineStepExecutions.executedAt))
            .limit(limit);
    },

    /**
     * Get specific Execution details
     */
    /**
     * Resolve one execution record.
     *
     * `kind` disambiguates which table the id belongs to. Without it this falls back
     * to trying pipeline_step_executions and then agent_run_steps, which is wrong for
     * any id present in both — ids 35 and 48-51 currently are, and the pipeline row
     * wins silently, returning a different record rather than an error.
     */
    async getExecution(executionId: number, orgContext: OrgContext, kind?: ExecutionIdKind) {
        const result = kind === "agent-step" ? [] : await db.select({
            executionId: pipelineStepExecutions.id,
            jobId: pipelineStepExecutions.jobId,
            status: pipelineStepExecutions.status,
            startTime: pipelineStepExecutions.executedAt,
            endTime: pipelineStepExecutions.completedAt,
            jobName: jobs.name,
            output: pipelineStepExecutions.output,
            errorUri: pipelineStepExecutions.errorUri,
            organizationId: jobs.organizationId,
        })
            .from(pipelineStepExecutions)
            .innerJoin(jobs, eq(pipelineStepExecutions.jobId, jobs.id))
            .where(eq(pipelineStepExecutions.id, executionId))
            .limit(1);

        if (result.length === 0 && kind !== "step") {
            // Explicit agent-step lookup, or the legacy fallback when no kind was given.
            const agentResult = await db.select({
                executionId: agentRunSteps.id,
                jobId: sql<number | null>`NULL`,
                status: sql<string>`'success'`,
                startTime: agentRunSteps.createdAt,
                endTime: agentRunSteps.createdAt,
                jobName: sql<string>`COALESCE(${agentRunSteps.toolName}, 'Agent Thought')`,
                output: agentRunSteps.content,
                errorUri: sql<string>`NULL`,
                organizationId: agentRunSteps.organizationId,
            })
            .from(agentRunSteps)
            .where(eq(agentRunSteps.id, executionId))
            .limit(1);

            if (agentResult.length > 0) {
                result.push(agentResult[0] as any);
            }
        }

        if (result.length === 0) {
            throw new NotFoundError("Execution not found");
        }

        const execution = result[0];

        // Access Control. Keyed on isSuperAdmin: an org admin (isAdmin) must still be
        // confined to their own tenant, and previously was not checked at all.
        const unrestricted = orgContext.isSuperAdmin && orgContext.organizationId === null;
        if (!unrestricted) {
            const expectedOrgId = orgContext.organizationId;
            if (execution.organizationId !== expectedOrgId) throw new ForbiddenError("Access denied");
        }

        const { organizationId, ...executionResponse } = execution;
        return executionResponse;
    },

    /**
     * List Alerts
     */
    async listAlerts(orgContext: OrgContext) {
        const conditions = getOrgConditions(orgContext, alerts, false);

        const query = conditions.length > 0
            ? db.select().from(alerts).where(and(...conditions)).orderBy(desc(alerts.createdAt))
            : db.select().from(alerts).orderBy(desc(alerts.createdAt));

        return await query;
    },

    /**
     * Acknowledge Alert
     */
    async acknowledgeAlert(alertId: number, orgContext: OrgContext) {
        const [alert] = await db.select().from(alerts).where(eq(alerts.id, alertId)).limit(1);
        if (!alert) throw new NotFoundError("Alert not found");

        // This is a write, and it had two holes: any isAdmin context skipped the check
        // entirely, and a non-admin with a null org also skipped it because the guard
        // was gated on organizationId !== null. Both could acknowledge another
        // tenant's alert.
        const unrestricted = orgContext.isSuperAdmin && orgContext.organizationId === null;
        if (!unrestricted && alert.organizationId !== orgContext.organizationId) {
            throw new ForbiddenError("Access denied");
        }

        const result = await db.update(alerts)
            .set({ acknowledgedAt: new Date() })
            .where(eq(alerts.id, alertId))
            .returning();

        // Invalidate health triage brief cache
        try {
            const { redis } = await import("@domain/core/infrastructure/redis/redis-client.js");
            if (redis) {
                const orgId = orgContext.organizationId || 'global';
                await Promise.all([
                    redis.del(`health:triage-brief:${orgId}:admin`),
                    redis.del(`health:triage-brief:${orgId}:user`)
                ]);
            }
        } catch (err: any) {
            logger.warn(`[TriageBrief] Redis invalidation failed on acknowledge: ${err?.message}`);
        }

        return result[0];
    },

    /**
     * Clear Acknowledged Alerts
     */
    async clearAcknowledgedAlerts(orgContext: OrgContext) {
        // DELETE, so an unscoped fallback here erased acknowledged alerts for every
        // tenant. Same fix as the readers, and the blast radius is why it matters most.
        const orgConditions = getOrgConditions(orgContext, alerts, false);
        const conditions = and(
            sql`${alerts.acknowledgedAt} IS NOT NULL`,
            ...orgConditions,
        );

        const result = await db.delete(alerts)
            .where(conditions)
            .returning();

        // Invalidate health triage brief cache
        try {
            const { redis } = await import("@domain/core/infrastructure/redis/redis-client.js");
            if (redis) {
                const orgId = orgContext.organizationId || 'global';
                await Promise.all([
                    redis.del(`health:triage-brief:${orgId}:admin`),
                    redis.del(`health:triage-brief:${orgId}:user`)
                ]);
            }
        } catch (err: any) {
            logger.warn(`[TriageBrief] Redis invalidation failed on clear: ${err?.message}`);
        }

        return { count: result.length };
    },

    /**
     * Record Reranker Feedback
     */
    async recordFeedback(executionId: number, stepId: string, documentIndex: number, feedbackType: string) {
        logger.info(`[Reranker Feedback] Exec ${executionId}, Step ${stepId}, Doc ${documentIndex}: ${feedbackType}`, {
            executionId, stepId, documentIndex, feedbackType
        });

        const [stepExec] = await db.select()
            .from(pipelineStepExecutions)
            .where(eq(pipelineStepExecutions.pipelineExecutionId, executionId))
            .limit(1);

        if (stepExec && stepExec.output) {
            try {
                const docs = JSON.parse(stepExec.output as string);
                if (Array.isArray(docs) && docs[documentIndex]) {
                    const doc = docs[documentIndex];
                    if (feedbackType === 'positive' && doc.metadata?.assetId) {
                        const assetId = Number(doc.metadata.assetId);
                        if (!isNaN(assetId)) {
                            try {
                                await db.update(knowledgeNodes)
                                    .set({
                                        usageCount: sql`${knowledgeNodes.usageCount} + 1`,
                                        confidenceScore: sql`LEAST(COALESCE(${knowledgeNodes.confidenceScore}::numeric, 0.5) + 0.02, 1.00)`,
                                        lastReaffirmedAt: new Date(),
                                    })
                                    .where(eq(knowledgeNodes.id, assetId));
                                logger.info(`[Reranker Feedback] Incremented usageCount and confidenceScore for node ${assetId}`);
                            } catch (updateErr) {
                                logger.warn(`[Reranker Feedback] Failed to update node ${assetId}: ${updateErr}`);
                            }
                        }
                    }
                }
            } catch (e) {
                logger.warn(`[Reranker Feedback] Failed to parse output for exec ${executionId}`);
            }
        }

        return { success: true };
    },

    /**
     * Get Health Triage Brief
     */
    async getHealthTriageBrief(orgContext: OrgContext) {
        // Keyed on isSuperAdmin because that is what now decides scope. Keying on
        // isAdmin would let a super admin (who sees every tenant) and an org admin
        // with a null org (who sees only global rows) share one cache entry.
        const scopeKey = orgContext.isSuperAdmin && orgContext.organizationId === null ? "all" : "scoped";
        const cacheKey = `health:triage-brief:${orgContext.organizationId ?? 'global'}:${scopeKey}`;
        try {
            const { redis } = await import("@domain/core/infrastructure/redis/redis-client.js");
            if (redis) {
                const cached = await redis.get(cacheKey);
                if (cached) {
                    try {
                        return JSON.parse(cached);
                    } catch (parseErr) {
                        logger.warn(`[TriageBrief] Failed to parse cached brief: ${parseErr}`);
                    }
                }
            }
        } catch (redisErr: any) {
            logger.warn(`[TriageBrief] Redis cache read failed: ${redisErr?.message}`);
        }

        // 1. Fetch alerts
        const allAlerts = await this.listAlerts(orgContext);
        const activeAlerts = allAlerts.filter((a: any) => !a.acknowledgedAt);

        // 2. Fetch circuit breakers
        let circuitBreakers: any[] = [];
        try {
            const { getAllCircuitStatuses } = await import("../../admin/core/circuit-breaker.service.js");
            const statuses = getAllCircuitStatuses();
            circuitBreakers = Object.entries(statuses).map(([name, stats]) => ({ name, ...stats }));
        } catch (err: any) {
            logger.warn(`[TriageBrief] Failed to get circuit statuses: ${err?.message}`);
        }

        // 3. Fetch recent events (last 25)
        let recentEvents: any[] = [];
        try {
            const { eventStream } = await import("./event-stream.service.js");
            recentEvents = await eventStream.queryEvents({
                limit: 25,
                organizationId: orgContext.isSuperAdmin ? undefined : (orgContext.organizationId || undefined),
            });
        } catch (err: any) {
            logger.warn(`[TriageBrief] Failed to get recent events: ${err?.message}`);
        }

        // 4. Fetch system resource health
        let systemHealth: any = null;
        let cpuLoadPct = 0;
        let memPressurePct = 0;
        let heapUsedMb = 0;
        let heapLimitMb = 0;
        let heapUsedPct = 0;
        try {
            const { ResourceGovernor } = await import("@domain/governance/core/resource-governor.js");
            const v8 = await import("v8");
            systemHealth = ResourceGovernor.getSystemHealth();
            cpuLoadPct = Math.round(systemHealth.cpuLoad * 100);
            memPressurePct = Math.round(systemHealth.memPressure * 100);
            
            const heapUsed = process.memoryUsage().heapUsed;
            const heapLimit = v8.default.getHeapStatistics().heap_size_limit;
            heapUsedMb = Math.round(heapUsed / 1024 / 1024);
            heapLimitMb = Math.round(heapLimit / 1024 / 1024);
            heapUsedPct = Math.round((heapUsed / heapLimit) * 100);
        } catch (err: any) {
            logger.warn(`[TriageBrief] Failed to get system health: ${err?.message}`);
        }

        // 5. Check database connection
        let dbConnected = false;
        try {
            const dbCheck = await checkDatabaseConnection();
            dbConnected = dbCheck.connected;
        } catch (err: any) {
            logger.warn(`[TriageBrief] Database check failed: ${err?.message}`);
        }

        // Determine platform state and severity reason
        const hasOpenCircuit = circuitBreakers.some((c: any) => String(c.state || c.status || "").toLowerCase() === "open");
        const hasCriticalSignals = activeAlerts.length > 0 || hasOpenCircuit || !dbConnected || cpuLoadPct > 85;
        const platformState = hasCriticalSignals ? "Watch" : "Nominal";
        const severity = hasCriticalSignals ? "critical" : "nominal";
        
        let severityReason = "All core platform systems are within normal operational limits.";
        if (!dbConnected) {
            severityReason = "Critical database connection failure detected.";
        } else if (hasOpenCircuit) {
            severityReason = `Circuit breakers are OPEN indicating dependency failures.`;
        } else if (activeAlerts.length > 0) {
            severityReason = `There are ${activeAlerts.length} active unacknowledged alert(s) requiring attention.`;
        } else if (cpuLoadPct > 85) {
            severityReason = `High CPU load detected (${cpuLoadPct}%).`;
        }

        // Formulate recommended actions and approvals
        const recs: string[] = [];
        const approvals: any[] = [];

        if (!dbConnected) {
            recs.push("Verify database cluster health and network connectivity immediately.");
        }
        if (activeAlerts.length > 0) {
            recs.push(`Review and acknowledge active alerts (${activeAlerts.length} open).`);
        }
        
        const openCircuits = circuitBreakers.filter((c: any) => String(c.state || c.status || "").toLowerCase() === "open");
        if (openCircuits.length > 0) {
            openCircuits.forEach((c: any) => {
                recs.push(`Inspect backend logs for dependency '${c.name}' and reset the circuit breaker once resolved.`);
                approvals.push({ name: c.name, type: "RESET_CIRCUIT" });
            });
        }

        if (cpuLoadPct > 80 || memPressurePct > 80) {
            recs.push("Monitor resource usage and consider scaling backend containers if pressure persists.");
        }

        if (recs.length === 0) {
            recs.push("No immediate action required. Platform state is healthy.");
        }

        // Build markdown brief
        const lines: string[] = [];
        lines.push("## 🏥 Oddjob Health Triage Brief");
        lines.push(`_Generated ${new Date().toLocaleString()} · Live Diagnostics_`);
        lines.push("");
        lines.push("### 1. Current Severity and Why");
        lines.push(`- **Current State**: **${platformState}**`);
        lines.push(`- **Severity**: **${severity.toUpperCase()}**`);
        lines.push(`- **Details**: ${severityReason}`);
        lines.push("");
        lines.push("### 2. What Changed Recently");
        if (recentEvents.length > 0) {
            lines.push("- **Recent Events (Last 25)**:");
            recentEvents.slice(0, 10).forEach(e => {
                lines.push(`  - **${e.eventType || e.type}** from _${e.source || 'Unknown'}_ (${new Date(e.timestamp || e.createdAt).toLocaleTimeString()})`);
            });
        } else {
            lines.push("- **Recent Events (Last 25)**: No recent events recorded.");
        }
        if (activeAlerts.length > 0) {
            lines.push("- **Active Alerts**:");
            activeAlerts.forEach(alert => {
                lines.push(`  - ⚠️ **${(alert as any).title || alert.message}** (${alert.severity}) · Raised ${new Date(alert.createdAt).toLocaleTimeString()}`);
            });
        }
        lines.push("");
        lines.push("### 3. Likely Impacted Apps, Cycles, Runs, or Dependencies");
        lines.push("- **Circuit Breakers / Dependencies**:");
        if (circuitBreakers.length > 0) {
            circuitBreakers.forEach(c => {
                lines.push(`  - ${String(c.state || c.status || "").toLowerCase() === 'open' ? '🔴' : '🟢'} **${c.name}** (${c.state || c.status || 'CLOSED'}) · Failures: ${c.failures ?? c.failureCount ?? 0}`);
            });
        } else {
            lines.push("  - No circuit breakers registered.");
        }
        lines.push("- **System Resource Pressure**:");
        lines.push(`  - **CPU Load**: ${cpuLoadPct}%`);
        lines.push(`  - **Memory Pressure**: ${memPressurePct}%`);
        lines.push(`  - **Heap Usage**: ${heapUsedMb}MB / ${heapLimitMb}MB (${heapUsedPct}%)`);
        lines.push(`  - **Database Connection**: ${dbConnected ? 'Connected ✅' : 'Disconnected ❌'}`);
        lines.push("");
        lines.push("### 4. Recommended Next Actions");
        recs.forEach((r, i) => {
            lines.push(`${i + 1}. ${r}`);
        });
        lines.push("");
        lines.push("### 5. Actions Needing Approval");
        if (approvals.length > 0) {
            approvals.forEach(a => {
                lines.push(`- ⚠️ **Approval Required**: Reset circuit breaker \`${a.name}\` (Must be routed through Assistant approvals)`);
            });
        } else {
            lines.push("- No immediate actions requiring human-in-the-loop approvals.");
        }

        const briefResult = {
            status: severity,
            platformState,
            activeAlertsCount: activeAlerts.length,
            circuitBreakersCount: circuitBreakers.length,
            hasCriticalSignals,
            markdown: lines.join("\n"),
            generatedAt: new Date().toISOString()
        };

        try {
            const { redis } = await import("@domain/core/infrastructure/redis/redis-client.js");
            if (redis) {
                await redis.set(cacheKey, JSON.stringify(briefResult), "EX", 10); // Cache for 10s
            }
        } catch (redisErr: any) {
            logger.warn(`[TriageBrief] Redis cache write failed: ${redisErr?.message}`);
        }

        return briefResult;
    }
};




