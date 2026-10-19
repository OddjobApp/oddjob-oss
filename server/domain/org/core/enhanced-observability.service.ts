import { EventEmitter } from "events";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("EnhancedObservabilityService");

/**
 * Metric data point
 */
export interface MetricDataPoint {
    timestamp: Date;
    value: number;
    tags?: Record<string, string>;
}

/**
 * Span for distributed tracing
 */
export interface Span {
    traceId: string;
    spanId: string;
    parentSpanId?: string;
    operation: string;
    startTime: Date;
    endTime?: Date;
    duration?: number;
    tags: Record<string, string>;
    logs: Array<{ timestamp: Date; message: string; level: string }>;
    status: "ok" | "error";
}

/**
 * User session recording
 */
export interface UserSession {
    sessionId: string;
    userId: string;
    workbench: string;
    startTime: Date;
    endTime?: Date;
    duration?: number;
    actions: Array<{
        timestamp: Date;
        action: string;
        resource: string;
        metadata?: any;
    }>;
    errors: Array<{
        timestamp: Date;
        error: string;
        stack?: string;
    }>;
}

/**
 * Performance metric
 */
export interface PerformanceMetric {
    name: string;
    value: number;
    unit: string;
    timestamp: Date;
    tags: Record<string, string>;
}

/**
 * Anomaly detection result
 */
export interface AnomalyDetection {
    metric: string;
    threshold: number;
    currentValue: number;
    severity: "info" | "warning" | "error" | "critical";
    message: string;
    timestamp: Date;
}

/**
 * Enhanced Observability Service
 * Deep insights into app health and user behavior
 */
export class EnhancedObservabilityService extends EventEmitter {
    private static instance: EnhancedObservabilityService;
    private metrics: Map<string, MetricDataPoint[]> = new Map(); // metricName -> data points
    private spans: Map<string, Span> = new Map(); // traceId -> spans
    private sessions: Map<string, UserSession> = new Map(); // sessionId -> session
    private anomalyThresholds: Map<string, number> = new Map(); // metricName -> threshold
    private maxDataPointsPerMetric = 10000;

    private constructor() {
        super();
        this.setMaxListeners(100);
        this.initializeAnomalyDetection();
    }

    static getInstance(): EnhancedObservabilityService {
        if (!EnhancedObservabilityService.instance) {
            EnhancedObservabilityService.instance = new EnhancedObservabilityService();
        }
        return EnhancedObservabilityService.instance;
    }

    /**
     * Initialize anomaly detection
     */
    private initializeAnomalyDetection(): void {
        // Set default thresholds
        this.anomalyThresholds.set("response_time_ms", 1000);
        this.anomalyThresholds.set("error_rate", 0.05);
        this.anomalyThresholds.set("cpu_usage", 0.8);
        this.anomalyThresholds.set("memory_usage", 0.85);
        this.anomalyThresholds.set("token_usage", 0.9);

        logger.info("[Observability] Anomaly detection initialized");
    }

    /**
     * Record metric
     */
    recordMetric(name: string, value: number, unit: string, tags?: Record<string, string>): void {
        const dataPoint: MetricDataPoint = {
            timestamp: new Date(),
            value,
            tags,
        };

        const metrics = this.metrics.get(name) || [];
        metrics.push(dataPoint);

        // Enforce max data points
        if (metrics.length > this.maxDataPointsPerMetric) {
            metrics.shift();
        }

        this.metrics.set(name, metrics);

        // Check for anomalies
        this.checkForAnomaly(name, value);

        this.emit("metric_recorded", { name, value, unit, tags });
    }

    /**
     * Get metric data
     */
    getMetricData(name: string, timeRange?: { start: Date; end: Date }): MetricDataPoint[] {
        const data = this.metrics.get(name) || [];

        if (!timeRange) {
            return data;
        }

        return data.filter(dp => 
            dp.timestamp >= timeRange.start && dp.timestamp <= timeRange.end
        );
    }

    /**
     * Start span for distributed tracing
     */
    startSpan(traceId: string, spanId: string, operation: string, parentSpanId?: string): Span {
        const span: Span = {
            traceId,
            spanId,
            parentSpanId,
            operation,
            startTime: new Date(),
            tags: {},
            logs: [],
            status: "ok",
        };

        this.spans.set(spanId, span);

        logger.debug(`[Observability] Span started: ${operation} (${spanId})`);
        return span;
    }

    /**
     * Finish span
     */
    finishSpan(spanId: string, status: "ok" | "error" = "ok"): void {
        const span = this.spans.get(spanId);

        if (!span) {
            logger.warn(`[Observability] Span not found: ${spanId}`);
            return;
        }

        span.endTime = new Date();
        span.duration = span.endTime.getTime() - span.startTime.getTime();
        span.status = status;

        this.emit("span_finished", span);

        logger.debug(`[Observability] Span finished: ${span.operation} (${span.duration}ms)`);
    }

    /**
     * Add tag to span
     */
    addSpanTag(spanId: string, key: string, value: string): void {
        const span = this.spans.get(spanId);
        if (span) {
            span.tags[key] = value;
        }
    }

    /**
     * Add log to span
     */
    addSpanLog(spanId: string, message: string, level: string = "info"): void {
        const span = this.spans.get(spanId);
        if (span) {
            span.logs.push({
                timestamp: new Date(),
                message,
                level,
            });
        }
    }

    /**
     * Get trace
     */
    getTrace(traceId: string): Span[] {
        const spans: Span[] = [];

        for (const span of this.spans.values()) {
            if (span.traceId === traceId) {
                spans.push(span);
            }
        }

        // Sort by start time
        spans.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

        return spans;
    }

    /**
     * Start user session recording
     */
    startUserSession(sessionId: string, userId: string, workbench: string): UserSession {
        const session: UserSession = {
            sessionId,
            userId,
            workbench,
            startTime: new Date(),
            actions: [],
            errors: [],
        };

        this.sessions.set(sessionId, session);

        logger.info(`[Observability] User session started: ${userId} in ${workbench}`);
        return session;
    }

    /**
     * Record action in session
     */
    recordSessionAction(sessionId: string, action: string, resource: string, metadata?: any): void {
        const session = this.sessions.get(sessionId);

        if (session) {
            session.actions.push({
                timestamp: new Date(),
                action,
                resource,
                metadata,
            });
        }
    }

    /**
     * Record error in session
     */
    recordSessionError(sessionId: string, error: string, stack?: string): void {
        const session = this.sessions.get(sessionId);

        if (session) {
            session.errors.push({
                timestamp: new Date(),
                error,
                stack,
            });
        }
    }

    /**
     * End user session
     */
    endUserSession(sessionId: string): void {
        const session = this.sessions.get(sessionId);

        if (session) {
            session.endTime = new Date();
            session.duration = session.endTime.getTime() - session.startTime.getTime();

            this.emit("session_ended", session);

            logger.info(`[Observability] User session ended: ${session.userId} (${session.duration}ms)`);
        }
    }

    /**
     * Get user session
     */
    getUserSession(sessionId: string): UserSession | null {
        return this.sessions.get(sessionId) || null;
    }

    /**
     * Get user sessions for user
     */
    getUserSessions(userId: string): UserSession[] {
        const sessions: UserSession[] = [];

        for (const session of this.sessions.values()) {
            if (session.userId === userId) {
                sessions.push(session);
            }
        }

        return sessions.sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
    }

    /**
     * Check for anomaly
     */
    private checkForAnomaly(metricName: string, value: number): void {
        const threshold = this.anomalyThresholds.get(metricName);

        if (threshold === undefined) {
            return;
        }

        let severity: "info" | "warning" | "error" | "critical" = "info";
        let message = "";

        if (value > threshold * 1.5) {
            severity = "critical";
            message = `${metricName} critically exceeded threshold (${value} > ${threshold * 1.5})`;
        } else if (value > threshold * 1.2) {
            severity = "error";
            message = `${metricName} significantly exceeded threshold (${value} > ${threshold * 1.2})`;
        } else if (value > threshold) {
            severity = "warning";
            message = `${metricName} exceeded threshold (${value} > ${threshold})`;
        }

        if (severity !== "info") {
            const anomaly: AnomalyDetection = {
                metric: metricName,
                threshold,
                currentValue: value,
                severity,
                message,
                timestamp: new Date(),
            };

            this.emit("anomaly_detected", anomaly);
            logger.warn(`[Observability] Anomaly detected: ${message}`);
        }
    }

    /**
     * Set anomaly threshold
     */
    setAnomalyThreshold(metricName: string, threshold: number): void {
        this.anomalyThresholds.set(metricName, threshold);
        logger.info(`[Observability] Anomaly threshold set for ${metricName}: ${threshold}`);
    }

    /**
     * Get anomaly threshold
     */
    getAnomalyThreshold(metricName: string): number | undefined {
        return this.anomalyThresholds.get(metricName);
    }

    /**
     * Get all anomaly thresholds
     */
    getAllAnomalyThresholds(): Record<string, number> {
        return Object.fromEntries(this.anomalyThresholds);
    }

    /**
     * Generate performance report
     */
    generatePerformanceReport(timeRange: { start: Date; end: Date }): {
        metrics: Record<string, { avg: number; min: number; max: number; count: number }>;
        spans: { total: number; avgDuration: number; errorRate: number };
        sessions: { total: number; avgDuration: number; errorRate: number };
    } {
        const metrics: Record<string, { avg: number; min: number; max: number; count: number }> = {};

        for (const [metricName, dataPoints] of this.metrics.entries()) {
            const filtered = dataPoints.filter(dp =>
                dp.timestamp >= timeRange.start && dp.timestamp <= timeRange.end
            );

            if (filtered.length === 0) continue;

            const values = filtered.map(dp => dp.value);
            metrics[metricName] = {
                avg: values.reduce((a, b) => a + b, 0) / values.length,
                min: Math.min(...values),
                max: Math.max(...values),
                count: values.length,
            };
        }

        const allSpans = Array.from(this.spans.values()).filter(span =>
            span.startTime >= timeRange.start && span.startTime <= timeRange.end
        );

        const spans = {
            total: allSpans.length,
            avgDuration: allSpans.length > 0 
                ? allSpans.reduce((sum, span) => sum + (span.duration || 0), 0) / allSpans.length 
                : 0,
            errorRate: allSpans.length > 0 
                ? allSpans.filter(s => s.status === "error").length / allSpans.length 
                : 0,
        };

        const allSessions = Array.from(this.sessions.values()).filter(session =>
            session.startTime >= timeRange.start && session.startTime <= timeRange.end
        );

        const sessions = {
            total: allSessions.length,
            avgDuration: allSessions.length > 0 
                ? allSessions.reduce((sum, session) => sum + (session.duration || 0), 0) / allSessions.length 
                : 0,
            errorRate: allSessions.length > 0 
                ? allSessions.filter(s => s.errors.length > 0).length / allSessions.length 
                : 0,
        };

        return { metrics, spans, sessions };
    }

    /**
     * Clear all observability data
     */
    clearAll(): void {
        this.metrics.clear();
        this.spans.clear();
        this.sessions.clear();
        logger.info("[Observability] All observability data cleared");
    }

    /**
     * Clear metrics for a specific metric
     */
    clearMetric(name: string): void {
        this.metrics.delete(name);
        logger.info(`[Observability] Metric ${name} cleared`);
    }

    /**
     * Clear old data
     */
    clearOldData(retentionDays: number = 30): void {
        const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

        for (const [metricName, dataPoints] of this.metrics.entries()) {
            const filtered = dataPoints.filter(dp => dp.timestamp >= cutoffDate);
            this.metrics.set(metricName, filtered);
        }

        for (const [sessionId, session] of this.sessions.entries()) {
            if (session.startTime < cutoffDate) {
                this.sessions.delete(sessionId);
            }
        }

        logger.info(`[Observability] Cleared data older than ${retentionDays} days`);
    }
}

export const enhancedObservabilityService = EnhancedObservabilityService.getInstance();
