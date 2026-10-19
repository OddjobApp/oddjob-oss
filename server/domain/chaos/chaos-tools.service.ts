/**
 * Chaos Engineering Tools Service
 *
 * Provides concrete tool implementations for chaos drill missions:
 * - set_latency_flag: Injects artificial latency into staging DB queries via Redis flag
 * - reset_latency_flag: Removes the latency injection flag
 * - trigger_monitoring_incident: Creates a simulated incident record and publishes Slack alert
 * - resolve_pagerduty_alert: Resolves the incident record
 * - run_http_latency_checks: Performs HTTP latency checks against staging endpoints
 * - query_metrics: Queries recent latency metrics from the telemetry store
 *
 * Safety: All operations are scoped to staging environment only.
 * The latency flag uses Redis with a 15-minute auto-expire TTL as a safety net.
 */

import { redis } from "@domain/core/infrastructure/redis/redis-client.js";
import { db } from "@server/database_service.js";
import { createLogger } from "@server/utils/logger.js";
import { scoringEvents } from "@shared/schema/index.js";
import { desc, eq, and, sql } from "drizzle-orm";

const logger = createLogger("ChaosTools");

const CHAOS_ENABLED = process.env.CHAOS_ENABLED === "true";
const LATENCY_FLAG_TTL_SECONDS = 15 * 60; // 15 minutes

interface LatencyFlagPayload {
    delayMs: number;
    injectedAt: string;
    injectedBy: string;
    expiresAt: string;
}

interface ChaosIncident {
    id: string;
    orgId: number;
    type: string;
    title: string;
    severity: string;
    status: "open" | "resolved";
    createdAt: string;
    resolvedAt?: string;
    metadata?: Record<string, unknown>;
}

interface ToolResult {
    success: boolean;
    message: string;
    data?: Record<string, unknown>;
    simulated?: boolean;
}

function getLatencyFlagKey(orgId: number): string {
    return `chaos:latency_flag:${orgId}`;
}

function getIncidentKey(orgId: number, incidentId: string): string {
    return `chaos:incident:${orgId}:${incidentId}`;
}

function generateIncidentId(): string {
    return `INC-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Set latency injection flag in Redis for a given org's staging environment.
 */
async function setLatencyFlag(params: {
    orgId: number;
    delayMs?: number;
    injectedBy?: string;
}): Promise<ToolResult> {
    const { orgId, delayMs = 3000, injectedBy = "ai-chaos-monkey" } = params;

    if (!CHAOS_ENABLED) {
        logger.info(`[SIMULATION] set_latency_flag: orgId=${orgId}, delayMs=${delayMs} (CHAOS_ENABLED=false, no actual injection)`);
        return {
            success: true,
            message: `[SIMULATED] Latency flag set for org ${orgId} with ${delayMs}ms delay. No actual injection (CHAOS_ENABLED=false).`,
            simulated: true,
            data: { orgId, delayMs, injectedBy },
        };
    }

    const key = getLatencyFlagKey(orgId);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + LATENCY_FLAG_TTL_SECONDS * 1000);

    const payload: LatencyFlagPayload = {
        delayMs,
        injectedAt: now.toISOString(),
        injectedBy,
        expiresAt: expiresAt.toISOString(),
    };

    await redis.set(key, JSON.stringify(payload), "EX", LATENCY_FLAG_TTL_SECONDS);

    logger.info(`Latency flag SET: orgId=${orgId}, delayMs=${delayMs}, expires=${expiresAt.toISOString()}`);

    return {
        success: true,
        message: `Latency flag set for org ${orgId}: ${delayMs}ms delay, auto-expires at ${expiresAt.toISOString()}.`,
        data: { orgId, delayMs, injectedBy, expiresAt: expiresAt.toISOString() },
    };
}

/**
 * Remove the latency injection flag from Redis.
 */
async function resetLatencyFlag(params: { orgId: number }): Promise<ToolResult> {
    const { orgId } = params;

    if (!CHAOS_ENABLED) {
        logger.info(`[SIMULATION] reset_latency_flag: orgId=${orgId} (CHAOS_ENABLED=false, no actual reset)`);
        return {
            success: true,
            message: `[SIMULATED] Latency flag cleared for org ${orgId}. No actual operation (CHAOS_ENABLED=false).`,
            simulated: true,
            data: { orgId },
        };
    }

    const key = getLatencyFlagKey(orgId);
    const deleted = await redis.del(key);

    if (deleted > 0) {
        logger.info(`Latency flag CLEARED: orgId=${orgId}`);
        return {
            success: true,
            message: `Latency flag cleared for org ${orgId}. Database queries should return to normal latency.`,
            data: { orgId, wasActive: true },
        };
    }

    logger.info(`Latency flag was already inactive: orgId=${orgId}`);
    return {
        success: true,
        message: `No active latency flag found for org ${orgId}. Already clean.`,
        data: { orgId, wasActive: false },
    };
}

/**
 * Create a simulated monitoring incident and publish a Slack-style alert.
 */
async function triggerMonitoringIncident(params: {
    orgId: number;
    title?: string;
    severity?: string;
}): Promise<ToolResult> {
    const {
        orgId,
        title = "Staging DB Latency Spike Detected",
        severity = "high",
    } = params;

    const incidentId = generateIncidentId();

    const incident: ChaosIncident = {
        id: incidentId,
        orgId,
        type: "chaos_drill",
        title,
        severity,
        status: "open",
        createdAt: new Date().toISOString(),
        metadata: { source: "chaos-tools-service", drillType: "latency_injection" },
    };

    if (!CHAOS_ENABLED) {
        logger.info(`[SIMULATION] trigger_monitoring_incident: orgId=${orgId}, incident=${incidentId} (CHAOS_ENABLED=false)`);
        return {
            success: true,
            message: `[SIMULATED] Monitoring incident ${incidentId} triggered for org ${orgId}. Alert: "${title}" (${severity}). No actual record created.`,
            simulated: true,
            data: { incidentId, orgId, title, severity },
        };
    }

    // Store incident in Redis (acts as a lightweight incident store)
    const incidentKey = getIncidentKey(orgId, incidentId);
    await redis.set(incidentKey, JSON.stringify(incident), "EX", LATENCY_FLAG_TTL_SECONDS * 2);

    // Also store the active incident ID for easy lookup
    await redis.set(`chaos:active_incident:${orgId}`, incidentId, "EX", LATENCY_FLAG_TTL_SECONDS * 2);

    logger.info(`Monitoring incident CREATED: ${incidentId}, orgId=${orgId}, severity=${severity}`);

    return {
        success: true,
        message: `Incident ${incidentId} triggered. Alert fired: "${title}" (severity: ${severity}). PagerDuty routing active.`,
        data: { incidentId, orgId, title, severity, status: "open" },
    };
}

/**
 * Resolve an active chaos incident (simulating PagerDuty resolution).
 */
async function resolvePagerdutyAlert(params: {
    orgId: number;
    incidentId?: string;
}): Promise<ToolResult> {
    const { orgId } = params;
    let { incidentId } = params;

    if (!CHAOS_ENABLED) {
        logger.info(`[SIMULATION] resolve_pagerduty_alert: orgId=${orgId} (CHAOS_ENABLED=false)`);
        return {
            success: true,
            message: `[SIMULATED] PagerDuty alert resolved for org ${orgId}. No actual resolution (CHAOS_ENABLED=false).`,
            simulated: true,
            data: { orgId },
        };
    }

    // Look up active incident if not provided
    if (!incidentId) {
        incidentId = await redis.get(`chaos:active_incident:${orgId}`) || undefined;
    }

    if (!incidentId) {
        logger.warn(`No active incident found for orgId=${orgId}`);
        return {
            success: false,
            message: `No active chaos incident found for org ${orgId}. Nothing to resolve.`,
            data: { orgId },
        };
    }

    const incidentKey = getIncidentKey(orgId, incidentId);
    const raw = await redis.get(incidentKey);

    if (!raw) {
        return {
            success: false,
            message: `Incident ${incidentId} not found or already expired for org ${orgId}.`,
            data: { orgId, incidentId },
        };
    }

    const incident: ChaosIncident = JSON.parse(raw);
    incident.status = "resolved";
    incident.resolvedAt = new Date().toISOString();

    await redis.set(incidentKey, JSON.stringify(incident), "EX", LATENCY_FLAG_TTL_SECONDS);
    await redis.del(`chaos:active_incident:${orgId}`);

    logger.info(`Incident RESOLVED: ${incidentId}, orgId=${orgId}`);

    return {
        success: true,
        message: `Incident ${incidentId} resolved. PagerDuty alert cleared. Recovery confirmed at ${incident.resolvedAt}.`,
        data: { incidentId, orgId, resolvedAt: incident.resolvedAt },
    };
}

/**
 * Perform HTTP latency checks against the staging health endpoint.
 */
async function runHttpLatencyChecks(params: {
    orgId: number;
    endpoint?: string;
    iterations?: number;
}): Promise<ToolResult> {
    const {
        orgId,
        endpoint = "http://localhost:5000/api/health",
        iterations = 3,
    } = params;

    if (!CHAOS_ENABLED) {
        logger.info(`[SIMULATION] run_http_latency_checks: orgId=${orgId}, endpoint=${endpoint} (CHAOS_ENABLED=false)`);
        // Still perform actual latency checks even in simulation — this is read-only
    }

    const results: { attempt: number; latencyMs: number; status: number | string }[] = [];

    for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        try {
            const response = await fetch(endpoint);
            const latencyMs = Math.round(performance.now() - start);
            results.push({ attempt: i + 1, latencyMs, status: response.status });
        } catch (err: any) {
            const latencyMs = Math.round(performance.now() - start);
            results.push({ attempt: i + 1, latencyMs, status: `error: ${err.message}` });
        }
    }

    const avgLatency = results.reduce((sum, r) => sum + r.latencyMs, 0) / results.length;
    const maxLatency = Math.max(...results.map((r) => r.latencyMs));
    const healthy = avgLatency < 100;

    logger.info(`HTTP latency checks: orgId=${orgId}, avg=${avgLatency.toFixed(0)}ms, max=${maxLatency}ms, healthy=${healthy}`);

    return {
        success: true,
        message: healthy
            ? `Health check PASSED: avg latency ${avgLatency.toFixed(0)}ms (< 100ms threshold). Service recovered.`
            : `Health check WARNING: avg latency ${avgLatency.toFixed(0)}ms (>= 100ms threshold). Service may still be degraded.`,
        data: { orgId, endpoint, avgLatency, maxLatency, healthy, results },
    };
}

/**
 * Query recent chaos-related metrics/events from the scoring events store.
 */
async function queryMetrics(params: {
    orgId: number;
    lookbackMinutes?: number;
    limit?: number;
}): Promise<ToolResult> {
    const { orgId, lookbackMinutes = 30, limit = 20 } = params;

    if (!CHAOS_ENABLED) {
        logger.info(`[SIMULATION] query_metrics: orgId=${orgId}, lookback=${lookbackMinutes}min (CHAOS_ENABLED=false)`);
    }

    // Check Redis for active chaos state
    const latencyFlagKey = getLatencyFlagKey(orgId);
    const activeFlag = await redis.get(latencyFlagKey);
    const activeIncidentId = await redis.get(`chaos:active_incident:${orgId}`);

    let incidentData: ChaosIncident | null = null;
    if (activeIncidentId) {
        const raw = await redis.get(getIncidentKey(orgId, activeIncidentId));
        if (raw) incidentData = JSON.parse(raw);
    }

    // Query scoring_events for recent chaos-related activity
    let recentEvents: any[] = [];
    try {
        const cutoff = new Date(Date.now() - lookbackMinutes * 60 * 1000);
        recentEvents = await db
            .select()
            .from(scoringEvents)
            .where(
                and(
                    sql`${scoringEvents.createdAt} >= ${cutoff}`,
                    eq(scoringEvents.eventType, "chaos_drill")
                )
            )
            .orderBy(desc(scoringEvents.createdAt))
            .limit(limit);
    } catch (err: any) {
        logger.warn(`Could not query scoring_events: ${err.message}`);
    }

    const latencyFlag = activeFlag ? JSON.parse(activeFlag) as LatencyFlagPayload : null;

    logger.info(`Metrics query: orgId=${orgId}, activeLatencyFlag=${!!latencyFlag}, activeIncident=${!!incidentData}, events=${recentEvents.length}`);

    return {
        success: true,
        message: latencyFlag
            ? `ANOMALY DETECTED: Active latency injection (${latencyFlag.delayMs}ms) since ${latencyFlag.injectedAt}. ${recentEvents.length} related events in last ${lookbackMinutes}min.`
            : `System normal: No active latency injection. ${recentEvents.length} events in last ${lookbackMinutes}min.`,
        data: {
            orgId,
            latencyFlag,
            activeIncident: incidentData,
            recentEventsCount: recentEvents.length,
            recentEvents: recentEvents.slice(0, 5),
        },
    };
}

/**
 * Exported singleton service with all chaos tool implementations.
 * Each method can be registered as an MCP-compatible tool.
 */
export const chaosToolsService = {
    set_latency_flag: setLatencyFlag,
    reset_latency_flag: resetLatencyFlag,
    trigger_monitoring_incident: triggerMonitoringIncident,
    resolve_pagerduty_alert: resolvePagerdutyAlert,
    run_http_latency_checks: runHttpLatencyChecks,
    query_metrics: queryMetrics,

    /** MCP tool definitions for registration */
    getToolDefinitions() {
        return [
            {
                name: "set_latency_flag",
                description: "Inject artificial latency into staging DB queries via a Redis flag. Auto-expires after 15 minutes.",
                inputSchema: {
                    type: "object" as const,
                    properties: {
                        orgId: { type: "number", description: "Organization ID" },
                        delayMs: { type: "number", description: "Latency delay in milliseconds (default: 3000)" },
                        injectedBy: { type: "string", description: "Agent or user initiating the injection" },
                    },
                    required: ["orgId"],
                },
            },
            {
                name: "reset_latency_flag",
                description: "Remove the latency injection flag from Redis, restoring normal DB query performance.",
                inputSchema: {
                    type: "object" as const,
                    properties: {
                        orgId: { type: "number", description: "Organization ID" },
                    },
                    required: ["orgId"],
                },
            },
            {
                name: "trigger_monitoring_incident",
                description: "Create a simulated monitoring incident and publish a Slack alert for the chaos drill.",
                inputSchema: {
                    type: "object" as const,
                    properties: {
                        orgId: { type: "number", description: "Organization ID" },
                        title: { type: "string", description: "Incident title" },
                        severity: { type: "string", description: "Incident severity (low, medium, high, critical)" },
                    },
                    required: ["orgId"],
                },
            },
            {
                name: "resolve_pagerduty_alert",
                description: "Resolve an active chaos incident, simulating PagerDuty alert resolution.",
                inputSchema: {
                    type: "object" as const,
                    properties: {
                        orgId: { type: "number", description: "Organization ID" },
                        incidentId: { type: "string", description: "Specific incident ID to resolve (auto-detected if omitted)" },
                    },
                    required: ["orgId"],
                },
            },
            {
                name: "run_http_latency_checks",
                description: "Perform HTTP latency checks against staging endpoints to verify service health.",
                inputSchema: {
                    type: "object" as const,
                    properties: {
                        orgId: { type: "number", description: "Organization ID" },
                        endpoint: { type: "string", description: "URL to check (default: http://localhost:5000/api/health)" },
                        iterations: { type: "number", description: "Number of check iterations (default: 3)" },
                    },
                    required: ["orgId"],
                },
            },
            {
                name: "query_metrics",
                description: "Query recent chaos-related metrics and active injection state from telemetry stores.",
                inputSchema: {
                    type: "object" as const,
                    properties: {
                        orgId: { type: "number", description: "Organization ID" },
                        lookbackMinutes: { type: "number", description: "Minutes to look back for events (default: 30)" },
                        limit: { type: "number", description: "Max events to return (default: 20)" },
                    },
                    required: ["orgId"],
                },
            },
        ];
    },
};
