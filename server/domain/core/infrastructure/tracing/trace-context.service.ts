import { randomBytes } from 'crypto';
import { trace, context as otelContext, propagation } from '@opentelemetry/api';

export interface TraceContext {
    traceId: string;      // 32 hex chars (128-bit)
    spanId: string;       // 16 hex chars (64-bit)
    parentSpanId?: string;
    traceFlags: string;   // 2 hex chars (8-bit) - "01" means sampled
    traceState?: string;  // Optional vendor-specific data
    depth: number;        // Recursion depth (extracted from traceState or default 0)
}

/**
 * Generates a new random 16-byte (32 hex char) Trace ID
 */
export function generateTraceId(): string {
    return randomBytes(16).toString('hex');
}

/**
 * Generates a new random 8-byte (16 hex char) Span ID
 */
export function generateSpanId(): string {
    return randomBytes(8).toString('hex');
}

/**
 * Generates a W3C traceparent header string: 00-{traceId}-{spanId}-{flags}
 */
export function generateTraceparent(ctx: TraceContext): string {
    return `00-${ctx.traceId}-${ctx.spanId}-${ctx.traceFlags}`;
}

/**
 * Parses a W3C traceparent header string.
 * Format: version-traceId-parentSpanId-traceFlags
 * Example: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
 */
export function parseTraceparent(header: string): TraceContext | null {
    const parts = header.split('-');
    if (parts.length < 4) return null;

    const [version, traceId, parentSpanId, flags] = parts;

    // We only support version 00 for now
    if (version !== '00') return null;

    // Basic validation
    if (traceId.length !== 32 || parentSpanId.length !== 16 || flags.length !== 2) {
        return null;
    }

    const depth = extractDepthFromTraceState(undefined); // Header parsing doesn't give us tracestate, that's a separate header.

    return {
        traceId,
        spanId: parentSpanId,
        traceFlags: flags,
        depth
    };
}

/**
 * Helper to extract depth from tracestate string
 * Format: oddjob_depth=5,...
 */
function extractDepthFromTraceState(traceState?: string): number {
    if (!traceState) return 0;
    const match = traceState.match(/oddjob_depth=(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
}

/**
 * Helper to encode depth into tracestate
 */
function encodeDepthToTraceState(depth: number, existingState?: string): string {
    const keyVal = `oddjob_depth=${depth}`;
    if (!existingState) return keyVal;

    // Replace existing if present
    if (existingState.includes('oddjob_depth=')) {
        return existingState.replace(/oddjob_depth=\d+/, keyVal);
    }
    // Append (W3C allows limits, but effectively prepend is better for priority)
    return `${keyVal},${existingState}`;
}

/**
 * Creates a new root trace context
 */
export function createRootTrace(sampled = true): TraceContext {
    return {
        traceId: generateTraceId(),
        spanId: generateSpanId(),
        traceFlags: sampled ? '01' : '00',
        depth: 0
    };
}

/**
 * Creates a child span context from a parent context
 */
export function createChildSpan(parent: TraceContext): TraceContext {
    return {
        traceId: parent.traceId,
        spanId: generateSpanId(),
        parentSpanId: parent.spanId,
        traceFlags: parent.traceFlags,
        traceState: encodeDepthToTraceState(parent.depth + 1, parent.traceState),
        depth: parent.depth + 1
    };
}

/**
 * Injects traceparent header into an existing headers object
 */
export function injectTraceHeaders(headers: Record<string, string>, context: TraceContext): void {
    headers['traceparent'] = generateTraceparent(context);
    if (context.traceState) {
        headers['tracestate'] = context.traceState;
    }
}

/**
 * Extracts trace context from request headers
 */
export function extractTraceContext(headers: Record<string, string | string[] | undefined>): TraceContext | null {
    // Handle different casing and array possibility
    const headerKey = Object.keys(headers).find(k => k.toLowerCase() === 'traceparent');
    if (!headerKey) return null;

    let headerValue = headers[headerKey];
    if (Array.isArray(headerValue)) headerValue = headerValue[0];
    if (!headerValue) return null;

    const context = parseTraceparent(headerValue);
    if (!context) return null;

    // Extract tracestate if present
    const stateKey = Object.keys(headers).find(k => k.toLowerCase() === 'tracestate');
    if (stateKey) {
        let stateValue = headers[stateKey];
        if (Array.isArray(stateValue)) stateValue = stateValue[0];
        if (stateValue) {
            context.traceState = stateValue;
            context.depth = extractDepthFromTraceState(stateValue);
        }
    }

    return context;
}

export class TraceContextService {
    static fromHeaders(headers: Record<string, string>): Partial<TraceContext> {
        const carrier = propagation.extract(otelContext.active(), headers);
        const span = trace.getSpan(carrier);
        const spanContext = span ? span.spanContext() : undefined;
        
        if (!spanContext) return {};

        return {
            traceId: spanContext.traceId,
            spanId: spanContext.spanId,
            traceFlags: spanContext.traceFlags ? '01' : '00',
        };
    }
    
    static toHeaders(traceContext: TraceContext): Record<string, string> {
        const headers: Record<string, string> = {};
        propagation.inject(otelContext.active(), headers);
        
        // Ensure legacy format is also available for compatibility
        injectTraceHeaders(headers, traceContext);
        return headers;
    }
}
