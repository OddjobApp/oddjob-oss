import { createLogger } from '@server/utils/logger.js';
import crypto from 'crypto';

const logger = createLogger('TraceExporterService');

export interface SpanContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  traceFlags: string;
}

export interface SpanData {
  name: string;
  context: SpanContext;
  startTime: string;
  endTime?: string;
  attributes: Record<string, any>;
  status: 'ok' | 'error';
}

export class TraceExporterService {
  /**
   * Generates a new W3C-compliant traceparent string (format: 00-traceId-spanId-flags).
   */
  generateW3CTraceparent(parentTraceId?: string): { traceparent: string; context: SpanContext } {
    const traceId = parentTraceId || crypto.randomBytes(16).toString('hex');
    const spanId = crypto.randomBytes(8).toString('hex');
    const traceFlags = '01'; // sampled

    const traceparent = `00-${traceId}-${spanId}-${traceFlags}`;

    return {
      traceparent,
      context: {
        traceId,
        spanId,
        traceFlags
      }
    };
  }

  /**
   * Parses a W3C traceparent header string into structured SpanContext.
   */
  parseW3CTraceparent(traceparent: string): SpanContext | null {
    if (!traceparent) return null;
    const parts = traceparent.split('-');
    if (parts.length < 4 || parts[0] !== '00') return null;

    return {
      traceId: parts[1],
      spanId: parts[2],
      traceFlags: parts[3]
    };
  }

  /**
   * Exports an OpenTelemetry span event.
   */
  exportSpan(span: SpanData): void {
    logger.info(`[OTelTraceExporter] Exporting span '${span.name}' [traceId: ${span.context.traceId}, spanId: ${span.context.spanId}] -> status: ${span.status}`);
  }
}

export const traceExporterService = new TraceExporterService();
