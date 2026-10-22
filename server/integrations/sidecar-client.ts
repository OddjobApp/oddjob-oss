/**
 * The one way the Node API talks to the Python sidecar (backend/).
 *
 * The sidecar is a private service. Every call carries the shared service token
 * (`X-Service-Token`, from SIDECAR_SERVICE_TOKEN) and, for tenant data, the
 * organization this API verified for its caller (`X-Organization-Id`). The
 * sidecar never takes an organization from a URL or body (backend/core/service_auth.py).
 *
 * One address, PYTHON_SERVICE_URL (default http://localhost:8002, where the
 * sidecar listens). Callers used to default to :8000, :8001 or :8002 depending on
 * the file, so most of them reached nothing.
 */

const DEFAULT_URL = "http://localhost:8002";

/** The sidecar's root URL, without a trailing slash or /api suffix. */
export function sidecarBaseUrl(): string {
    const raw = process.env.PYTHON_SERVICE_URL || process.env.PYTHON_SIDECAR_URL || DEFAULT_URL;
    return raw.replace(/\/+$/, "").replace(/\/api(\/v\d+)?$/, "");
}

/**
 * Whether the sidecar is configured. In production it must be named and
 * authenticated explicitly; nothing is assumed to be listening on localhost.
 */
export function sidecarConfigured(): boolean {
    if (process.env.NODE_ENV !== "production") return true;
    return !!process.env.PYTHON_SERVICE_URL && !!process.env.SIDECAR_SERVICE_TOKEN;
}

export class SidecarUnavailableError extends Error {
    constructor(message = "The Python sidecar is not configured") {
        super(message);
        this.name = "SidecarUnavailableError";
    }
}

/** Headers for one call: the service token, and the caller's organization when there is one. */
export function sidecarHeaders(organizationId?: number | null): Record<string, string> {
    const headers: Record<string, string> = {};
    const token = process.env.SIDECAR_SERVICE_TOKEN;
    if (token) headers["X-Service-Token"] = token;
    if (organizationId !== undefined && organizationId !== null) {
        if (!Number.isSafeInteger(organizationId) || organizationId <= 0) {
            throw new Error("A valid organization is required for a sidecar call");
        }
        headers["X-Organization-Id"] = String(organizationId);
    }
    return headers;
}

export interface SidecarRequest {
    method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
    /** Tenant-scoped calls must pass it; platform calls (predictive) may omit it. */
    organizationId?: number | null;
    body?: unknown;
    timeoutMs?: number;
}

/** Call the sidecar. `path` starts with "/", e.g. "/api/saas/connectors". */
export async function sidecarFetch(path: string, request: SidecarRequest = {}): Promise<Response> {
    if (!sidecarConfigured()) throw new SidecarUnavailableError();
    if (!path.startsWith("/")) throw new Error("Sidecar paths start with '/'");
    const headers: Record<string, string> = sidecarHeaders(request.organizationId);
    let body: string | undefined;
    if (request.body !== undefined) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(request.body);
    }
    return fetch(`${sidecarBaseUrl()}${path}`, {
        method: request.method ?? (body ? "POST" : "GET"),
        headers,
        body,
        signal: AbortSignal.timeout(request.timeoutMs ?? 30_000),
    });
}
