/**
 * trace-context.ts tests — W3C traceparent and trace utilities
 */
import { describe, it, expect } from 'vitest';
import {
    generateTraceId,
    generateSpanId,
    generateTraceparent,
    parseTraceparent,
    createRootTrace,
    createChildSpan,
    injectTraceHeaders,
    extractTraceContext,
} from "@domain/core/infrastructure/tracing/trace-context.service.js";

describe('trace-context', () => {
    describe('generateTraceId', () => {
        it('returns 32 hex characters', () => {
            const id = generateTraceId();
            expect(id).toMatch(/^[a-f0-9]{32}$/);
        });

        it('returns unique values', () => {
            const ids = new Set([...Array(10)].map(() => generateTraceId()));
            expect(ids.size).toBe(10);
        });
    });

    describe('generateSpanId', () => {
        it('returns 16 hex characters', () => {
            const id = generateSpanId();
            expect(id).toMatch(/^[a-f0-9]{16}$/);
        });
    });

    describe('generateTraceparent', () => {
        it('produces W3C traceparent format', () => {
            const ctx = { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), traceFlags: '01', depth: 0 };
            const header = generateTraceparent(ctx);
            expect(header).toBe('00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01');
        });
    });

    describe('parseTraceparent', () => {
        it('parses valid traceparent header', () => {
            const header = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
            const ctx = parseTraceparent(header);
            expect(ctx).not.toBeNull();
            expect(ctx!.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
            expect(ctx!.spanId).toBe('00f067aa0ba902b7');
            expect(ctx!.traceFlags).toBe('01');
        });

        it('returns null for invalid version', () => {
            expect(parseTraceparent('01-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01')).toBeNull();
        });

        it('returns null for too few parts', () => {
            expect(parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7')).toBeNull();
        });

        it('returns null for wrong traceId length', () => {
            expect(parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e473-00f067aa0ba902b7-01')).toBeNull();
        });

        it('returns null for wrong spanId length', () => {
            expect(parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b-01')).toBeNull();
        });
    });

    describe('createRootTrace', () => {
        it('creates trace with sampled flag when sampled=true', () => {
            const ctx = createRootTrace(true);
            expect(ctx.traceId).toMatch(/^[a-f0-9]{32}$/);
            expect(ctx.spanId).toMatch(/^[a-f0-9]{16}$/);
            expect(ctx.traceFlags).toBe('01');
            expect(ctx.depth).toBe(0);
        });

        it('creates trace with unsampled flag when sampled=false', () => {
            const ctx = createRootTrace(false);
            expect(ctx.traceFlags).toBe('00');
        });
    });

    describe('createChildSpan', () => {
        it('creates child with incremented depth and same traceId', () => {
            const parent = createRootTrace(true);
            const child = createChildSpan(parent);
            expect(child.traceId).toBe(parent.traceId);
            expect(child.parentSpanId).toBe(parent.spanId);
            expect(child.spanId).not.toBe(parent.spanId);
            expect(child.depth).toBe(1);
            expect(child.traceState).toContain('oddjob_depth=1');
        });

        it('increments depth for nested children', () => {
            const root = createRootTrace(true);
            const child1 = createChildSpan(root);
            const child2 = createChildSpan(child1);
            expect(child2.depth).toBe(2);
            expect(child2.traceState).toContain('oddjob_depth=2');
        });
    });

    describe('injectTraceHeaders', () => {
        it('adds traceparent header to object', () => {
            const ctx = { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), traceFlags: '01', depth: 0 };
            const headers: Record<string, string> = {};
            injectTraceHeaders(headers, ctx);
            expect(headers['traceparent']).toBe('00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01');
        });

        it('adds tracestate when present in context', () => {
            const ctx = { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), traceFlags: '01', depth: 0, traceState: 'oddjob_depth=1' };
            const headers: Record<string, string> = {};
            injectTraceHeaders(headers, ctx);
            expect(headers['tracestate']).toBe('oddjob_depth=1');
        });
    });

    describe('extractTraceContext', () => {
        it('returns null when no traceparent header', () => {
            expect(extractTraceContext({})).toBeNull();
            expect(extractTraceContext({ 'content-type': 'application/json' })).toBeNull();
        });

        it('parses traceparent from headers (case-insensitive)', () => {
            const ctx = extractTraceContext({
                Traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
            });
            expect(ctx).not.toBeNull();
            expect(ctx!.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
            expect(ctx!.spanId).toBe('00f067aa0ba902b7');
        });

        it('extracts depth from tracestate when present', () => {
            const ctx = extractTraceContext({
                traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
                tracestate: 'oddjob_depth=5,vendor=value',
            });
            expect(ctx).not.toBeNull();
            expect(ctx!.depth).toBe(5);
            expect(ctx!.traceState).toBe('oddjob_depth=5,vendor=value');
        });

        it('handles array header values', () => {
            const ctx = extractTraceContext({
                traceparent: ['00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'],
            });
            expect(ctx).not.toBeNull();
            expect(ctx!.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
        });
    });
});
