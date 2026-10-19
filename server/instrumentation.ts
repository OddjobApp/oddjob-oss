/**
 * OpenTelemetry Instrumentation
 * 
 * Provides distributed tracing for the application.
 * Configure with environment variables:
 * - OTEL_ENABLED: Enable/disable tracing
 * - OTEL_SERVICE_NAME: Service name in traces
 * - OTEL_EXPORTER_OTLP_ENDPOINT: OTLP endpoint (e.g., http://jaeger:4318)
 * 
 * IMPORTANT: Import this file FIRST in your entry point, before other imports.
 */

import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource, resourceFromAttributes } from "@opentelemetry/resources";
import {
    trace, context, propagation, SpanStatusCode,
    getTracer, withSpan, recordEvent, setSpanAttributes,
    injectContext, extractContext, contextFromTraceContext
} from "./utils/tracing.js";

// Configuration
const OTEL_ENABLED = process.env.OTEL_ENABLED === "true";
const SERVICE_NAME = process.env.OTEL_SERVICE_NAME || "oddjob-api";
const SERVICE_VERSION = process.env.npm_package_version || "1.0.0";
const OTLP_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://localhost:4318";

let sdk: NodeSDK | null = null;

/**
 * Initialize OpenTelemetry SDK
 */
export function initTracing(): void {
    if (!OTEL_ENABLED) {
        console.log("[Tracing] OpenTelemetry disabled (set OTEL_ENABLED=true to enable)");
        return;
    }

    try {
        sdk = new NodeSDK({
            resource: resourceFromAttributes({
                "service.name": SERVICE_NAME,
                "service.version": SERVICE_VERSION,
            }),
            traceExporter: new OTLPTraceExporter({
                url: `${OTLP_ENDPOINT}/v1/traces`,
            }),
            instrumentations: [
                getNodeAutoInstrumentations({
                    // Disable fs instrumentation (too noisy)
                    "@opentelemetry/instrumentation-fs": { enabled: false },
                    // Configure HTTP instrumentation
                    "@opentelemetry/instrumentation-http": {
                        ignoreIncomingPaths: ["/health", "/api/health"],
                    } as any,
                }),
            ],
        });

        sdk.start();
        console.log(`[Tracing] OpenTelemetry initialized (${SERVICE_NAME} → ${OTLP_ENDPOINT})`);

        // Graceful shutdown
        process.on("SIGTERM", () => {
            sdk?.shutdown().catch(console.error);
        });
    } catch (error) {
        console.error("[Tracing] Failed to initialize OpenTelemetry:", error);
    }
}

// Re-export OpenTelemetry API and utilities for direct usage
export {
    trace, context, propagation, SpanStatusCode,
    getTracer, withSpan, recordEvent, setSpanAttributes,
    injectContext, extractContext, contextFromTraceContext
};

