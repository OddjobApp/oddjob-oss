import { Request, Response, NextFunction, Application } from "express";
import { createLogger } from "@server/utils/logger.js";
import { getPoolMetrics } from "../../../database_service.js";
import { getAllCircuitStatuses } from "../../admin/core/circuit-breaker.service.js";
import { getDLQStats } from "../../admin/core/dead-letter-queue.service.js";

const logger = createLogger("Metrics");

interface MetricValue {
    value: number;
    labels: Record<string, string>;
    timestamp: number;
}

interface Histogram {
    sum: number;
    count: number;
    buckets: Map<number, number>;
}

const counters = new Map<string, MetricValue[]>();
const gauges = new Map<string, number>();
const histograms = new Map<string, Map<string, Histogram>>();

const HISTOGRAM_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

export function incrementCounter(name: string, labels: Record<string, string> = {}, value: number = 1) {
    const key = `${name}${JSON.stringify(labels)}`;
    const existing = counters.get(name) || [];
    const existingIdx = existing.findIndex(m => JSON.stringify(m.labels) === JSON.stringify(labels));

    if (existingIdx >= 0) {
        existing[existingIdx].value += value;
    } else {
        existing.push({ value, labels, timestamp: Date.now() });
    }
    counters.set(name, existing);
}

export function setGauge(name: string, value: number) {
    gauges.set(name, value);
}

export function observeHistogram(name: string, value: number, labels: Record<string, string> = {}) {
    const labelsKey = JSON.stringify(labels);
    if (!histograms.has(name)) {
        histograms.set(name, new Map());
    }
    const metricHistograms = histograms.get(name)!;
    if (!metricHistograms.has(labelsKey)) {
        const buckets = new Map<number, number>();
        HISTOGRAM_BUCKETS.forEach(b => buckets.set(b, 0));
        buckets.set(Infinity, 0);
        metricHistograms.set(labelsKey, { sum: 0, count: 0, buckets });
    }
    const histogram = metricHistograms.get(labelsKey)!;
    histogram.sum += value;
    histogram.count += 1;
    for (const [bucket, count] of histogram.buckets) {
        if (value <= bucket) {
            histogram.buckets.set(bucket, count + 1);
        }
    }
}

export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
    const start = process.hrtime.bigint();
    res.on("finish", () => {
        const durationNs = Number(process.hrtime.bigint() - start);
        const durationSeconds = durationNs / 1e9;
        const labels = {
            method: req.method,
            path: normalizePathForMetrics(req.route?.path || req.path),
            status: String(res.statusCode),
        };
        incrementCounter("http_requests_total", labels);
        observeHistogram("http_request_duration_seconds", durationSeconds, {
            method: req.method,
            path: labels.path,
        });
    });
    next();
}

function normalizePathForMetrics(path: string): string {
    return path
        .replace(/\/\d+/g, "/:id")
        .replace(/\/[a-f0-9-]{36}/gi, "/:uuid");
}

export async function getMetricsText(): Promise<string> {
    const lines: string[] = [];
    const memUsage = process.memoryUsage();
    lines.push(`# HELP nodejs_heap_size_bytes Node.js heap size`);
    lines.push(`# TYPE nodejs_heap_size_bytes gauge`);
    lines.push(`nodejs_heap_size_bytes{type="used"} ${memUsage.heapUsed}`);
    lines.push(`nodejs_heap_size_bytes{type="total"} ${memUsage.heapTotal}`);
    lines.push(`# HELP nodejs_external_memory_bytes Node.js external memory`);
    lines.push(`# TYPE nodejs_external_memory_bytes gauge`);
    lines.push(`nodejs_external_memory_bytes ${memUsage.external}`);
    lines.push(`# HELP process_uptime_seconds Process uptime`);
    lines.push(`# TYPE process_uptime_seconds gauge`);
    lines.push(`process_uptime_seconds ${process.uptime()}`);

    try {
        const poolMetrics = getPoolMetrics();
        lines.push(`# HELP db_pool_total Database pool total connections`);
        lines.push(`# TYPE db_pool_total gauge`);
        lines.push(`db_pool_total ${poolMetrics.totalCount}`);
        lines.push(`# HELP db_pool_active Database pool active connections`);
        lines.push(`# TYPE db_pool_active gauge`);
        lines.push(`db_pool_active ${poolMetrics.activeCount}`);
        lines.push(`# HELP db_pool_idle Database pool idle connections`);
        lines.push(`# TYPE db_pool_idle gauge`);
        lines.push(`db_pool_idle ${poolMetrics.idleCount}`);
        lines.push(`# HELP db_pool_waiting Database pool waiting queries`);
        lines.push(`# TYPE db_pool_waiting gauge`);
        lines.push(`db_pool_waiting ${poolMetrics.waitingCount}`);
    } catch (e) { }

    try {
        const circuits = getAllCircuitStatuses();
        lines.push(`# HELP circuit_breaker_state Circuit breaker state (0=closed, 1=open, 2=half_open)`);
        lines.push(`# TYPE circuit_breaker_state gauge`);
        for (const [name, stats] of Object.entries(circuits)) {
            const stateValue = stats.state === "CLOSED" ? 0 : stats.state === "OPEN" ? 1 : 2;
            lines.push(`circuit_breaker_state{name="${name}"} ${stateValue}`);
        }
        lines.push(`# HELP circuit_breaker_failures Circuit breaker failure count`);
        lines.push(`# TYPE circuit_breaker_failures gauge`);
        for (const [name, stats] of Object.entries(circuits)) {
            lines.push(`circuit_breaker_failures{name="${name}"} ${stats.failures}`);
        }
    } catch (e) { }

    try {
        const dlqStats = await getDLQStats();
        lines.push(`# HELP dlq_jobs_total Dead Letter Queue job count`);
        lines.push(`# TYPE dlq_jobs_total gauge`);
        lines.push(`dlq_jobs_total ${dlqStats.total}`);
    } catch (e) { }

    // --- Fleet Queue Metrics ---
    try {
        const { extractionQueue } = await import("../../knowledge/knowledge-queue.js");
        const counts = await extractionQueue.getJobCounts();
        lines.push(`# HELP queue_depth_knowledge_waiting Pending knowledge extraction jobs`);
        lines.push(`# TYPE queue_depth_knowledge_waiting gauge`);
        lines.push(`queue_depth_knowledge_waiting ${counts.waiting}`);
    } catch (e) { }

    lines.push(`# HELP http_requests_total Total HTTP requests`);
    lines.push(`# TYPE http_requests_total counter`);
    const httpRequests = counters.get("http_requests_total") || [];
    for (const metric of httpRequests) {
        const labelStr = Object.entries(metric.labels).map(([k, v]) => `${k}="${v}"`).join(",");
        lines.push(`http_requests_total{${labelStr}} ${metric.value}`);
    }

    const latencyHistograms = histograms.get("http_request_duration_seconds");
    if (latencyHistograms && latencyHistograms.size > 0) {
        lines.push(`# HELP http_request_duration_seconds HTTP request latency`);
        lines.push(`# TYPE http_request_duration_seconds histogram`);
        for (const [labelsKey, histogram] of latencyHistograms) {
            const labels = JSON.parse(labelsKey);
            const labelStr = Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(",");
            for (const [bucket, count] of histogram.buckets) {
                const le = bucket === Infinity ? "+Inf" : bucket;
                lines.push(`http_request_duration_seconds_bucket{${labelStr},le="${le}"} ${count}`);
            }
            lines.push(`http_request_duration_seconds_sum{${labelStr}} ${histogram.sum}`);
            lines.push(`http_request_duration_seconds_count{${labelStr}} ${histogram.count}`);
        }
    }

    for (const [name, value] of gauges) {
        lines.push(`${name} ${value}`);
    }
    return lines.join("\n");
}

export function metricsHandler(req: Request, res: Response) {
    getMetricsText()
        .then(text => {
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            res.send(text);
        })
        .catch(error => {
            res.status(500).json({ error: "Failed to generate metrics" });
        });
}

export function setupMetrics(app: Application) {
    app.use(metricsMiddleware);
    app.get("/metrics", metricsHandler);
    logger.info("Prometheus metrics endpoint registered at /metrics");
}




