
import fetch, { RequestInit } from 'node-fetch';
import { createLogger } from "../../../../utils/logger.js";
import { EgressFirewall } from "../../../../utils/egress-firewall.js";
import { BadRequestError } from "../../../../utils/errors.js";

const logger = createLogger('BaseGateway');

export interface GatewayRequest {
    action: string;
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    url: string;
    headers?: Record<string, string>;
    body?: any;
    organizationId?: number | null;
    /**
     * The request goes to one of our own services on the private network (the
     * Python sidecar). Everything else — a SaaS base URL, a webhook, any address
     * a user typed — goes through the egress firewall, which refuses private and
     * reserved addresses on every redirect hop.
     */
    internal?: boolean;
}

/** Headers whose values are secrets: kept out of the API log. */
const SECRET_HEADERS = /^(authorization|proxy-authorization|cookie|x-api-key|api-key|x-auth-token)$/i;
function redactHeaders(headers: Record<string, string>): Record<string, string> {
    return Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, SECRET_HEADERS.test(k) ? "[redacted]" : v]));
}

type GatewayFetchResponse = {
    status: number;
    headers: { get(name: string): string | null; forEach(cb: (value: string, key: string) => void): void };
    json(): Promise<any>;
    text(): Promise<string>;
};

export interface GatewayResponse {
    status: number;
    body: any;
    headers: Record<string, string>;
}

export abstract class BaseGateway {
    protected abstract readonly platform: string;
    /** True only for a gateway whose every request goes to our own private service. */
    protected readonly internalService: boolean = false;

    /**
     * Common request handler for all gateways
     */
    protected async request(req: GatewayRequest): Promise<GatewayResponse> {
        const start = Date.now();
        const { method, url, headers = {}, body, action, organizationId } = req;
        const internal = req.internal ?? this.internalService;

        logger.info(`[${this.platform}] Gateway Request: ${action}`, {
            method,
            url,
            organizationId
        });

        const fetchOptions: RequestInit = {
            method,
            headers: {
                'Content-Type': 'application/json',
                ...headers
            }
        };

        if (body) {
            if (body instanceof FormData) {
                // If it's FormData, don't set Content-Type, fetch will handle it with boundaries
                delete (fetchOptions.headers as any)['Content-Type'];
                fetchOptions.body = body as any;
            } else {
                fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
            }
        }

        try {
            let response: GatewayFetchResponse;
            if (internal) {
                response = await fetch(url, fetchOptions);
            } else {
                // A connector's base URL is whatever its owner typed, so without this
                // a "test connection" could read Qdrant, Redis or any internal address
                // and hand the body back in its error message.
                const guarded = await EgressFirewall.fetch(url, fetchOptions as any);
                if (!guarded.allowed || !guarded.response) {
                    throw new BadRequestError(`Outbound request refused: ${guarded.reason ?? "address not allowed"}`);
                }
                response = guarded.response;
            }
            const duration = Date.now() - start;

            let responseBody: any;
            const contentType = response.headers.get('content-type');
            
            if (contentType && contentType.includes('application/json')) {
                responseBody = await response.json();
            } else {
                responseBody = await response.text();
            }

            const resHeaders: Record<string, string> = {};
            response.headers.forEach((value, key) => {
                resHeaders[key] = value;
            });

            logger.info(`[${this.platform}] Gateway Response: ${action}`, {
                status: response.status,
                duration
            });

            // LOG TO AUDIT AGENT
            const { apiLogService } = await import("../api-log.service.js");
            apiLogService.log({
                platform: this.platform,
                action,
                method,
                url,
                requestHeaders: redactHeaders(headers),
                requestBody: body,
                responseStatus: response.status,
                responseHeaders: resHeaders,
                responseBody,
                durationMs: duration,
                organizationId
            }).catch(e => logger.warn("Async API logging failed", e));

            return {
                status: response.status,
                body: responseBody,
                headers: resHeaders
            };
        } catch (error: any) {
            const duration = Date.now() - start;
            logger.error(`[${this.platform}] Gateway Error: ${action}`, error, {
                duration,
                url
            });

            // LOG ERROR TO AUDIT AGENT
            const { apiLogService } = await import("../api-log.service.js");
            apiLogService.log({
                platform: this.platform,
                action,
                method,
                url,
                requestHeaders: redactHeaders(headers),
                requestBody: body,
                error: error.message,
                durationMs: duration,
                organizationId
            }).catch(e => logger.warn("Async API error logging failed", e));

            throw error;
        }
    }
}


