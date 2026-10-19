
import { CurlConfig, JiraMetadata } from "@shared/schema/index.js";
import { TraceContext, injectTraceHeaders } from "@domain/core/infrastructure/tracing/trace-context.service.js";
import { credentialsService } from "@domain/auth/core/credentials-service.js";
import { resolveCredentialSecret } from "@domain/auth/core/credential-secret-store.js";

export async function executeCurlJob(config: CurlConfig, traceContext?: TraceContext, organizationId?: number | null): Promise<string> {
    const headers: Record<string, string> = { ...config.headers };

    // Inject Trace Context
    if (traceContext) {
        injectTraceHeaders(headers, traceContext);
    }
    let resolvedUrl = config.url;

    if (config.credentialId) {
        const credential = await credentialsService.getById(config.credentialId, organizationId ?? null);
        if (credential) {
            const key = (await resolveCredentialSecret(credential));
            if (key) {
                if (credential.type === "jira") {
                    const metadata = credential.metadata as JiraMetadata;
                    const auth = Buffer.from(`${metadata.account}:${key}`).toString('base64');
                    headers['Authorization'] = `Basic ${auth}`;
                    if (resolvedUrl.startsWith('/')) {
                        resolvedUrl = metadata.endpoint.replace(/\/$/, '') + resolvedUrl;
                    }
                } else if (config.authType === "basic") {
                    // Basic auth: key is expected to be "username:password"
                    const auth = Buffer.from(key).toString('base64');
                    headers['Authorization'] = `Basic ${auth}`;
                } else {
                    // Default to Bearer token
                    headers['Authorization'] = `Bearer ${key}`;
                }
            }
        }
    }

    if (config.queryParams && Object.keys(config.queryParams).length > 0) {
        try {
            const urlObj = new URL(resolvedUrl);
            Object.entries(config.queryParams).forEach(([key, value]) => {
                urlObj.searchParams.append(key, String(value));
            });
            resolvedUrl = urlObj.toString();
        } catch (e) {
            // If resolvedUrl is not a full URL (e.g. just path), URL constructor might fail.
            // But executeCurlJob usually expects full URL unless JIRA relative path logic handled it.
            // If it fails, we assume it's already constructed or handle gracefully.
            console.warn(`[executeCurlJob] Failed to append query params to URL ${resolvedUrl}:`, e);
        }
    }

    const res = await fetch(resolvedUrl, {
        method: config.method || "GET",
        headers,
        body: config.body ? (typeof config.body === 'string' ? config.body : JSON.stringify(config.body)) : undefined
    });

    if (!res.ok) {
        let errText = await res.text();
        try { const json = JSON.parse(errText); errText = JSON.stringify(json, null, 2); } catch { }
        throw new Error(`Request failed: ${res.status} ${res.statusText} - ${errText}`);
    }
    return await res.text();
}




