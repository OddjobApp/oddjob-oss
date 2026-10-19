import { randomBytes } from 'crypto';

export interface TraceContext {
    traceId: string;
    spanId: string;
    parentSpanId?: string;
    traceFlags: string;
    traceState?: string;
    depth: number;
}

export function generateTraceId(): string {
    return randomBytes(16).toString('hex');
}

export function generateSpanId(): string {
    return randomBytes(8).toString('hex');
}

export function generateTraceparent(ctx: TraceContext): string {
    return `00-${ctx.traceId}-${ctx.spanId}-${ctx.traceFlags}`;
}

export function parseTraceparent(header: string): TraceContext | null {
    const parts = header.split('-');
    if (parts.length < 4) return null;
    const [version, traceId, parentSpanId, flags] = parts;
    if (version !== '00') return null;
    if (traceId.length !== 32 || parentSpanId.length !== 16 || flags.length !== 2) {
        return null;
    }
    const depth = extractDepthFromTraceState(undefined);
    return {
        traceId,
        spanId: parentSpanId,
        traceFlags: flags,
        depth
    };
}

function extractDepthFromTraceState(traceState?: string): number {
    if (!traceState) return 0;
    const match = traceState.match(/oddjob_depth=(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
}

function encodeDepthToTraceState(depth: number, existingState?: string): string {
    const keyVal = `oddjob_depth=${depth}`;
    if (!existingState) return keyVal;
    if (existingState.includes('oddjob_depth=')) {
        return existingState.replace(/oddjob_depth=\d+/, keyVal);
    }
    return `${keyVal},${existingState}`;
}

export function createRootTrace(sampled = true): TraceContext {
    return {
        traceId: generateTraceId(),
        spanId: generateSpanId(),
        traceFlags: sampled ? '01' : '00',
        depth: 0
    };
}

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

export function injectTraceHeaders(headers: Record<string, string>, context: TraceContext): void {
    headers['traceparent'] = generateTraceparent(context);
    if (context.traceState) {
        headers['tracestate'] = context.traceState;
    }
}

export function extractTraceContext(headers: Record<string, string | string[] | undefined>): TraceContext | null {
    const headerKey = Object.keys(headers).find(k => k.toLowerCase() === 'traceparent');
    if (!headerKey) return null;
    let headerValue = headers[headerKey];
    if (Array.isArray(headerValue)) headerValue = headerValue[0];
    if (!headerValue) return null;
    const context = parseTraceparent(headerValue);
    if (!context) return null;
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




