
import fetch, { RequestInit, Response } from 'node-fetch';
import { createLogger } from "../../../../utils/logger.js";

const logger = createLogger('BaseGateway');

export interface GatewayRequest {
    action: string;
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    url: string;
    headers?: Record<string, string>;
    body?: any;
    organizationId?: number | null;
}

export interface GatewayResponse {
    status: number;
    body: any;
    headers: Record<string, string>;
}

export abstract class BaseGateway {
    protected abstract readonly platform: string;

    /**
     * Common request handler for all gateways
     */
    protected async request(req: GatewayRequest): Promise<GatewayResponse> {
        const start = Date.now();
        const { method, url, headers = {}, body, action, organizationId } = req;

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
            const response = await fetch(url, fetchOptions);
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
                requestHeaders: headers,
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
                requestHeaders: headers,
                requestBody: body,
                error: error.message,
                durationMs: duration,
                organizationId
            }).catch(e => logger.warn("Async API error logging failed", e));

            throw error;
        }
    }
}


