import { SpanStatusCode, trace, context, propagation, Context, TextMapSetter, TextMapGetter, ROOT_CONTEXT } from "@opentelemetry/api";
import { TraceContext } from "@domain/core/infrastructure/tracing/trace-context.service.js";

const SERVICE_VERSION = process.env.npm_package_version || "1.0.0";

/**
 * Get the current tracer
 */
export function getTracer(name: string = "oddjob") {
    return trace.getTracer(name, SERVICE_VERSION);
}

/**
 * Create a span for an operation
 */
export function withSpan<T>(
    name: string,
    operation: () => T | Promise<T>,
    attributes?: Record<string, string | number | boolean>
): Promise<T> {
    const tracer = getTracer();

    return tracer.startActiveSpan(name, async (span) => {
        try {
            if (attributes) {
                span.setAttributes(attributes);
            }

            const result = await operation();
            span.setStatus({ code: SpanStatusCode.OK });
            return result;
        } catch (error: any) {
            span.recordException(error);
            span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
            throw error;
        } finally {
            span.end();
        }
    });
}

/**
 * Record a custom span event
 */
export function recordEvent(name: string, attributes?: Record<string, string | number | boolean>): void {
    const span = trace.getActiveSpan();
    if (span) {
        span.addEvent(name, attributes);
    }
}

/**
 * Set custom attributes on the current span
 */
export function setSpanAttributes(attributes: Record<string, string | number | boolean>): void {
    const span = trace.getActiveSpan();
    if (span) {
        span.setAttributes(attributes);
    }
}

/**
 * Capture current context and inject it into a carrier (e.g., job data)
 */
export function injectContext(carrier: any, setter?: TextMapSetter): void {
    propagation.inject(context.active(), carrier, setter);
}

/**
 * Extract context from a carrier (e.g., job data)
 */
export function extractContext(carrier: any, getter?: TextMapGetter): Context {
    return propagation.extract(context.active(), carrier, getter);
}

/**
 * Convert internal TraceContext to OTel Context
 */
export function contextFromTraceContext(tc: TraceContext): Context {
    if (!tc.traceId || !tc.spanId) return ROOT_CONTEXT;

    const spanContext = {
        traceId: tc.traceId,
        spanId: tc.spanId,
        traceFlags: tc.traceFlags === "01" ? 1 : 0,
        isRemote: true
    };

    return trace.setSpanContext(ROOT_CONTEXT, spanContext);
}

export { trace, context, propagation, SpanStatusCode };
