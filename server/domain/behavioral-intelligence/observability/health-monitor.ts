/**
 * Behavioral Intelligence Engine — Health Monitor
 *
 * Provides operational metrics, health status, and alerting for the BI engine.
 *
 * Metrics tracked:
 * - Ingestion rate (events/sec)
 * - Scoring latency (p50, p95, p99)
 * - Threshold fire rate
 * - Action success/failure rate
 * - Consumer group lag
 * - Redis memory usage
 */
import { createLogger } from "@server/utils/logger.js";
import { biRedisStreams } from "../infrastructure/redis-streams.js";
import { getActiveIndexOrgIds } from "../infrastructure/rule-index.js";
import { biIngestionService } from "../core/ingestion.service.js";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";

const logger = createLogger("BIHealthMonitor");

// ─── Metrics Accumulator ─────────────────────────────────────────────────────

interface Metrics {
  events_ingested: number;
  events_scored: number;
  rules_evaluated: number;
  thresholds_crossed: number;
  actions_dispatched: number;
  actions_failed: number;
  scoring_latencies_ms: number[]; // Rolling window for percentile calculation
  last_reset: number;
}

const metrics: Metrics = {
  events_ingested: 0,
  events_scored: 0,
  rules_evaluated: 0,
  thresholds_crossed: 0,
  actions_dispatched: 0,
  actions_failed: 0,
  scoring_latencies_ms: [],
  last_reset: Date.now(),
};

const MAX_LATENCY_SAMPLES = 1000;

// ─── Metric Recording ────────────────────────────────────────────────────────

function recordIngestion(): void { metrics.events_ingested++; }
function recordScoring(latencyMs: number): void {
  metrics.events_scored++;
  metrics.scoring_latencies_ms.push(latencyMs);
  if (metrics.scoring_latencies_ms.length > MAX_LATENCY_SAMPLES) {
    metrics.scoring_latencies_ms.shift();
  }
}
function recordRuleEvaluation(count: number): void { metrics.rules_evaluated += count; }
function recordThresholdCrossing(): void { metrics.thresholds_crossed++; }
function recordActionDispatched(): void { metrics.actions_dispatched++; }
function recordActionFailed(): void { metrics.actions_failed++; }

// ─── Percentile Calculation ──────────────────────────────────────────────────

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

// ─── Health Status ───────────────────────────────────────────────────────────

type HealthStatus = "healthy" | "degraded" | "critical";

async function getHealth(): Promise<{
  status: HealthStatus;
  metrics: {
    events_ingested: number;
    events_scored: number;
    rules_evaluated: number;
    thresholds_crossed: number;
    actions_dispatched: number;
    actions_failed: number;
    scoring_latency_p50_ms: number;
    scoring_latency_p95_ms: number;
    scoring_latency_p99_ms: number;
    uptime_seconds: number;
  };
  orgs_active: number;
  consumer_lags: Record<number, number>;
  alerts: string[];
}> {
  const activeOrgs = getActiveIndexOrgIds();
  const alerts: string[] = [];

  // Check consumer lags
  const consumerLags: Record<number, number> = {};
  for (const orgId of activeOrgs) {
    const lag = await biRedisStreams.getConsumerLag(orgId);
    consumerLags[orgId] = lag;
    if (lag > 10000) {
      alerts.push(`CRITICAL: Org ${orgId} consumer lag is ${lag} (>10,000 events behind)`);
    } else if (lag > 1000) {
      alerts.push(`WARNING: Org ${orgId} consumer lag is ${lag}`);
    }
  }

  // Determine overall status
  let status: HealthStatus = "healthy";
  if (alerts.some(a => a.startsWith("CRITICAL"))) status = "critical";
  else if (alerts.some(a => a.startsWith("WARNING"))) status = "degraded";

  // Check action failure rate
  const totalActions = metrics.actions_dispatched + metrics.actions_failed;
  if (totalActions > 10 && metrics.actions_failed / totalActions > 0.2) {
    alerts.push(`WARNING: Action failure rate is ${Math.round((metrics.actions_failed / totalActions) * 100)}%`);
    if (status === "healthy") status = "degraded";
  }

  return {
    status,
    metrics: {
      events_ingested: metrics.events_ingested,
      events_scored: metrics.events_scored,
      rules_evaluated: metrics.rules_evaluated,
      thresholds_crossed: metrics.thresholds_crossed,
      actions_dispatched: metrics.actions_dispatched,
      actions_failed: metrics.actions_failed,
      scoring_latency_p50_ms: percentile(metrics.scoring_latencies_ms, 50),
      scoring_latency_p95_ms: percentile(metrics.scoring_latencies_ms, 95),
      scoring_latency_p99_ms: percentile(metrics.scoring_latencies_ms, 99),
      uptime_seconds: Math.floor((Date.now() - metrics.last_reset) / 1000),
    },
    orgs_active: activeOrgs.length,
    consumer_lags: consumerLags,
    alerts,
  };
}

/**
 * Reset metrics (for testing or periodic reset).
 */
function resetMetrics(): void {
  metrics.events_ingested = 0;
  metrics.events_scored = 0;
  metrics.rules_evaluated = 0;
  metrics.thresholds_crossed = 0;
  metrics.actions_dispatched = 0;
  metrics.actions_failed = 0;
  metrics.scoring_latencies_ms = [];
  metrics.last_reset = Date.now();
}

// ─── Periodic Health Check ───────────────────────────────────────────────────

let healthCheckInterval: ReturnType<typeof setInterval> | null = null;

function startHealthChecks(intervalMs = 60_000): void {
  if (healthCheckInterval) return;
  healthCheckInterval = setInterval(async () => {
    const health = await getHealth();
    if (health.status !== "healthy") {
      logger.warn(`[HealthMonitor] Status: ${health.status}, Alerts: ${health.alerts.join("; ")}`);
      eventStream.publish("bi.health_alert", { status: health.status, alerts: health.alerts }, {}, "behavioral-intelligence").catch(() => {});
    }
  }, intervalMs);
}

function stopHealthChecks(): void {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export const biHealthMonitor = {
  // Recording
  recordIngestion,
  recordScoring,
  recordRuleEvaluation,
  recordThresholdCrossing,
  recordActionDispatched,
  recordActionFailed,

  // Querying
  getHealth,
  resetMetrics,

  // Lifecycle
  startHealthChecks,
  stopHealthChecks,
};
