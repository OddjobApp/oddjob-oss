import { createLogger } from "@server/utils/logger.js";
import { credentialsService } from "@domain/auth/core/credentials-service.js";
import { EgressFirewall } from "@server/utils/egress-firewall.js";

const logger = createLogger("HttpConnectorService");

export interface HttpQueryOptions {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  params?: Record<string, any>;
  body?: any;
  jsonPath?: string;
  credentialId?: number;
  cacheTtlSeconds?: number;
}

export interface HttpQueryResponse {
  success: boolean;
  status: number;
  data: any;
  cached?: boolean;
  error?: string;
}

interface CacheEntry {
  data: any;
  status: number;
  expiresAt: number;
}

const responseCache = new Map<string, CacheEntry>();
const MAX_CACHE_ENTRIES = 500;

export function extractJsonPath(data: any, path?: string): any {
  if (!path || data == null) return data;
  const clean = path.trim().replace(/^\$\.?/, "");
  if (!clean) return data;

  const parts = clean.split(/\.|\[|\]/).filter(Boolean);
  let current = data;
  for (const part of parts) {
    if (current == null) return null;
    current = current[part];
  }
  return current;
}

export class HttpConnectorService {
  /**
   * Cleans up expired cache items if capacity exceeded.
   */
  private pruneCache(): void {
    if (responseCache.size <= MAX_CACHE_ENTRIES) return;
    const now = Date.now();
    for (const [key, entry] of responseCache.entries()) {
      if (entry.expiresAt <= now) {
        responseCache.delete(key);
      }
    }
  }

  /**
   * Executes a governed, cached external HTTP query.
   */
  async executeQuery(
    options: HttpQueryOptions,
    orgId: number | null
  ): Promise<HttpQueryResponse> {
    const {
      url: rawUrl,
      method = "GET",
      headers = {},
      params = {},
      body,
      jsonPath,
      credentialId,
      cacheTtlSeconds = 60,
    } = options;

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      return { success: false, status: 400, data: null, error: `Invalid URL: "${rawUrl}"` };
    }

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return {
        success: false,
        status: 400,
        data: null,
        error: `Disallowed protocol "${parsedUrl.protocol}". Only HTTP and HTTPS are supported.`,
      };
    }

    // The egress firewall is the one host check — it also enforces
    // AGENT_EGRESS_WHITELIST, which this service used to bypass entirely.
    // Re-checked per redirect hop by EgressFirewall.fetch below.
    const preflight = EgressFirewall.validateUrl(rawUrl);
    if (!preflight.allowed) {
      logger.warn(`Blocked egress to ${parsedUrl.hostname}: ${preflight.reason}`);
      return {
        success: false,
        status: 403,
        data: null,
        error: `Request blocked by Egress Firewall: ${preflight.reason}`,
      };
    }

    // Merge query parameters
    if (params && typeof params === "object") {
      for (const [key, val] of Object.entries(params)) {
        if (val !== undefined && val !== null && val !== "") {
          parsedUrl.searchParams.set(key, String(val));
        }
      }
    }

    const finalUrl = parsedUrl.toString();
    const cacheKey = `${orgId ?? "public"}:${method}:${finalUrl}:${JSON.stringify(body ?? {})}`;
    const now = Date.now();

    // Check cache
    const cached = responseCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      const extracted = extractJsonPath(cached.data, jsonPath);
      return {
        success: true,
        status: cached.status,
        data: extracted,
        cached: true,
      };
    }

    const requestHeaders: Record<string, string> = {
      "User-Agent": "Oddjob-HttpConnector/1.0",
      Accept: "application/json, text/plain, */*",
      ...headers,
    };

    // Inject credentials if specified
    if (credentialId) {
      try {
        const cred = await credentialsService.getById(credentialId, orgId);
        if (cred) {
          const authKey = (cred as any).key || (cred as any).apiKey || (cred as any).token;
          if (authKey) {
            requestHeaders["Authorization"] = `Bearer ${authKey}`;
          }
        }
      } catch (err: any) {
        logger.warn(`Failed to resolve credential ${credentialId}: ${err.message}`);
      }
    }

    // Execute HTTP request
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const fetchOptions: RequestInit = {
        method,
        headers: requestHeaders,
        signal: controller.signal,
      };

      if (method === "POST" && body) {
        fetchOptions.body = typeof body === "string" ? body : JSON.stringify(body);
        if (!requestHeaders["Content-Type"]) {
          requestHeaders["Content-Type"] = "application/json";
        }
      }

      // Guarded fetch: every redirect hop is re-validated, so an allowed
      // public host cannot hand the request to a private one.
      const guarded = await EgressFirewall.fetch(finalUrl, fetchOptions);
      if (!guarded.allowed) {
        clearTimeout(timeout);
        logger.warn(`Blocked egress during request to ${finalUrl}: ${guarded.reason}`);
        return {
          success: false,
          status: 403,
          data: null,
          error: `Request blocked by Egress Firewall: ${guarded.reason}`,
        };
      }
      const res = guarded.response!;

      const contentType = res.headers.get("content-type") || "";
      let responseData: any;
      try {
        if (contentType.includes("application/json")) {
          responseData = await res.json();
        } else {
          responseData = await res.text();
        }
      } finally {
        // Cleared after the body, not after the headers: the abort signal is
        // the only bound on how long a remote host can dribble out a response.
        clearTimeout(timeout);
      }

      if (!res.ok) {
        return {
          success: false,
          status: res.status,
          data: responseData,
          error: `External request failed with HTTP ${res.status}: ${res.statusText}`,
        };
      }

      // Cache successful response if TTL > 0
      if (cacheTtlSeconds > 0) {
        this.pruneCache();
        responseCache.set(cacheKey, {
          data: responseData,
          status: res.status,
          expiresAt: now + cacheTtlSeconds * 1000,
        });
      }

      const extracted = extractJsonPath(responseData, jsonPath);
      return {
        success: true,
        status: res.status,
        data: extracted,
        cached: false,
      };
    } catch (err: any) {
      const isAbort = err.name === "AbortError";
      const message = isAbort ? "Request timed out after 10000ms" : err.message;
      logger.error(`HTTP query to ${finalUrl} failed: ${message}`);
      return {
        success: false,
        status: 504,
        data: null,
        error: message,
      };
    }
  }

  /**
   * Clears the cache (useful in tests).
   */
  clearCache(): void {
    responseCache.clear();
  }
}

export const httpConnectorService = new HttpConnectorService();
