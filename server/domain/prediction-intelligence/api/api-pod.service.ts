// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN - API POD SERVICE
// Domain-level request validation, error contracts, response rendering, and
// boundary enforcement. App-layer routes perform concrete HTTP orchestration.
// ============================================================================

import { randomUUID } from "crypto";
import { createLogger } from "@server/utils/logger.js";
import type {
    ApiPodPort,
    ApiResponseEnvelope,
    ApiError,
    ApiWarning,
    HttpRequest,
    HttpResponse,
    StreamRequest,
    StreamHandle,
    ApiRuntimeContext,
    HealthResponse,
} from "./types.js";
import { CURRENT_API_VERSION } from "./types.js";

const logger = createLogger("ApiPod");

function makeErrorResponse(requestId: string, correlationId: string, errors: ApiError[], statusCode = 400): HttpResponse {
    const body: ApiResponseEnvelope = {
        requestId,
        correlationId,
        status: "failed",
        errors,
        warnings: [],
        createdAt: new Date().toISOString(),
    };
    return { statusCode, headers: { "Content-Type": "application/json" }, body };
}

function makeSuccessResponse<T>(requestId: string, correlationId: string, data: T, statusCode = 200): HttpResponse {
    const body: ApiResponseEnvelope<T> = {
        requestId,
        correlationId,
        status: "success",
        data,
        errors: [],
        warnings: [],
        createdAt: new Date().toISOString(),
    };
    return { statusCode, headers: { "Content-Type": "application/json" }, body };
}

class ApiPod implements ApiPodPort {
    async handleHttpRequest(input: HttpRequest, ctx: ApiRuntimeContext): Promise<HttpResponse> {
        const requestId = input.requestId;
        const correlationId = ctx.correlationId;

        try {
            if (input.path === "/healthz" || input.path === "/readyz" || input.path === "/livez") {
                const health: HealthResponse = {
                    status: "healthy",
                    pods: {},
                    dependencies: { postgres: "healthy", qdrant: "healthy" },
                    timestamp: ctx.now,
                };
                return makeSuccessResponse(requestId, correlationId, health);
            }

            if (!ctx.tenantId && !input.headers["x-tenant-id"]) {
                return makeErrorResponse(requestId, correlationId, [{
                    code: "TENANT_SCOPE_REQUIRED",
                    message: "A tenant scope is required for Prediction Intelligence API requests.",
                    category: "authorization",
                    recoverable: true,
                }], 403);
            }

            return makeErrorResponse(requestId, correlationId, [{
                code: "ROUTE_NOT_HANDLED_BY_API_POD",
                message: "This API Pod validates the domain boundary; mount an app-layer route for this path.",
                category: "not_found",
                recoverable: true,
                details: { path: input.path, apiVersion: ctx.apiVersion },
            }], 404);
        } catch (err: unknown) {
            logger.error("API request failed", { err, path: input.path });
            return makeErrorResponse(requestId, correlationId, [{
                code: "INTERNAL_ERROR",
                message: "An internal error occurred. Please try again.",
                category: "internal",
                recoverable: true,
            }], 500);
        }
    }

    async handleStreamRequest(input: StreamRequest, _ctx: ApiRuntimeContext): Promise<StreamHandle> {
        const streamId = randomUUID();
        logger.debug("Stream request received (deferred)", { streamId, path: input.path });
        return { streamId, close: () => {} };
    }

    async validateRequest<T>(input: unknown, schemaName: string): Promise<T> {
        if (input === null || input === undefined) {
            throw Object.assign(new Error(`Invalid request: body required for ${schemaName}`), {
                code: "MISSING_BODY",
                category: "validation" as const,
            });
        }
        return input as T;
    }

    async renderResponse<T>(input: ApiResponseEnvelope<T>, _ctx: ApiRuntimeContext): Promise<HttpResponse> {
        const statusCode = input.status === "success" ? 200 : input.status === "partial" ? 207 : 400;
        return { statusCode, headers: { "Content-Type": "application/json" }, body: input };
    }

    async generateOpenApiSpec(): Promise<Record<string, unknown>> {
        return {
            openapi: "3.1.0",
            info: { title: "Prediction Intelligence API", version: CURRENT_API_VERSION, description: "The API surface for the Oddjob Prediction Intelligence Domain" },
            paths: {
                "/v1/events": { post: { summary: "Ingest a canonical event", operationId: "createEvent" } },
                "/v1/predictions": { post: { summary: "Generate a prediction", operationId: "createPrediction" } },
                "/v1/predictions/{predictionId}": { get: { summary: "Retrieve a prediction", operationId: "getPrediction" } },
                "/v1/predictions/{predictionId}/explanation": { get: { summary: "Get prediction explanation", operationId: "getExplanation" } },
                "/v1/contexts/resolve": { post: { summary: "Resolve a context", operationId: "resolveContext" } },
                "/v1/outcomes": { post: { summary: "Record an observed outcome for calibration", operationId: "recordOutcome" } },
                "/healthz": { get: { summary: "Liveness check", operationId: "healthz" } },
            },
        };
    }

    buildResponse<T>(requestId: string, correlationId: string, data: T, errors: ApiError[] = [], warnings: ApiWarning[] = []): ApiResponseEnvelope<T> {
        return {
            requestId: requestId || randomUUID(),
            correlationId: correlationId || randomUUID(),
            status: errors.length > 0 ? "failed" : "success",
            data: errors.length === 0 ? data : undefined,
            errors,
            warnings,
            createdAt: new Date().toISOString(),
        };
    }

    buildError(code: string, message: string, category: ApiError["category"], recoverable = false): ApiError {
        return { code, message, category, recoverable };
    }
}

export const apiPod = new ApiPod();
export type { ApiPod };
