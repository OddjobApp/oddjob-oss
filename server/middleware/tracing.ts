/**
 * Tracing Middleware
 * 
 * Express middleware for adding tracing context to requests.
 */

import type { Request, Response, NextFunction } from "express";
import { trace, context, propagation, SpanStatusCode } from "@opentelemetry/api";

/**
 * Express middleware that adds tracing to all requests
 */
export function tracingMiddleware(serviceName: string = "api") {
    const tracer = trace.getTracer(serviceName);

    return (req: Request, res: Response, next: NextFunction) => {
        // Extract context from incoming headers (for propagation)
        const parentContext = propagation.extract(context.active(), req.headers);

        const span = tracer.startSpan(
            `${req.method} ${req.route?.path || req.path}`,
            {
                attributes: {
                    "http.method": req.method,
                    "http.url": req.originalUrl,
                    "http.target": req.path,
                    "http.user_agent": req.headers["user-agent"] || "",
                    "http.client_ip": req.ip || "",
                },
            },
            parentContext
        );

        // Add trace ID to request for logging
        const traceId = span.spanContext().traceId;
        (req as any).traceId = traceId;

        // Store span in request for later use
        (req as any).span = span;

        // Add trace headers to response
        res.setHeader("X-Trace-Id", traceId);

        // Capture response status
        const originalEnd = res.end.bind(res);
        res.end = function (chunk?: any, encoding?: any, callback?: any) {
            span.setAttributes({
                "http.status_code": res.statusCode,
                "http.response_content_length": res.get("Content-Length") || 0,
            });

            if (res.statusCode >= 400) {
                span.setStatus({
                    code: SpanStatusCode.ERROR,
                    message: `HTTP ${res.statusCode}`,
                });
            } else {
                span.setStatus({ code: SpanStatusCode.OK });
            }

            span.end();
            return originalEnd(chunk, encoding, callback);
        };

        next();
    };
}

/**
 * Add custom span for an operation within a request
 */
export function createChildSpan(
    req: Request,
    name: string,
    attributes?: Record<string, string | number | boolean>
) {
    const parentSpan = (req as any).span;
    if (!parentSpan) {
        return null;
    }

    const tracer = trace.getTracer("api");
    return tracer.startSpan(name, { attributes }, trace.setSpan(context.active(), parentSpan));
}

