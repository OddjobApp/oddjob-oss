/**
 * Embed Profile Service
 * Fetches customer/session profile from external APIs for embedded agent personalization.
 * Used when parent passes accessToken + sessionToken; config from deployment embedConfig.
 * Supports optional cache (keyed by sessionId) to reduce API calls.
 */

import { getCachedProfile, setCachedProfile } from "./embed-profile-cache.js";
import { isOpen, recordSuccess, recordFailure } from "./embed-profile-circuit-breaker.js";
import { isUrlAllowed } from "./embed-profile-validator.js";

const PROFILE_MAX_BYTES = 4 * 1024; // 4KB limit per spec
const DEFAULT_TIMEOUT_MS = 5000;

export interface ProfileApiConfig {
    profileApiUrl: string;
    profileApiMethod?: string;
    profileApiTimeoutMs?: number;
    profileApiHeaders?: Record<string, string>;
    profileCacheTtlSeconds?: number;
    profileApiDomainAllowlist?: string[] | null;
}

export interface FetchProfileResult {
    profile: object | null;
    profileErrorCode?: string;
    profileError?: string;
}

export const PROFILE_ERROR_CIRCUIT_OPEN = 'profile_circuit_open';
export const PROFILE_ERROR_DOMAIN_NOT_ALLOWED = 'domain_not_allowed';

/**
 * Fetch profile from external API using accessToken and sessionToken.
 * When sessionId and profileCacheTtlSeconds are provided, checks cache first and caches on success.
 * Returns null on any failure; never throws.
 */
export async function fetchEmbedProfile(
    accessToken: string,
    sessionToken: string,
    config: ProfileApiConfig,
    options?: { sessionId?: string; deploymentId?: number }
): Promise<FetchProfileResult> {
    const cacheTtl = config.profileCacheTtlSeconds;
    const sessionId = options?.sessionId;
    const deploymentId = options?.deploymentId;

    // Circuit breaker: skip fetch if open
    if (deploymentId != null && isOpen(deploymentId)) {
        return { profile: null, profileErrorCode: PROFILE_ERROR_CIRCUIT_OPEN, profileError: 'circuit_open' };
    }

    // Domain allowlist: validate URL before fetch
    const allowlist = config.profileApiDomainAllowlist;
    if (allowlist && allowlist.length > 0) {
        let urlToCheck = config.profileApiUrl;
        if (sessionToken) {
            urlToCheck = urlToCheck.replace(/\{\{sessionToken\}\}/g, sessionToken);
        }
        if (!isUrlAllowed(urlToCheck, allowlist)) {
            return { profile: null, profileErrorCode: PROFILE_ERROR_DOMAIN_NOT_ALLOWED, profileError: 'domain_not_allowed' };
        }
    }

    // Check cache first when sessionId and cache enabled
    if (sessionId && cacheTtl != null && cacheTtl > 0) {
        const cached = getCachedProfile(sessionId);
        if (cached) return { profile: cached };
    }

    let url = config.profileApiUrl;
    if (!url || typeof url !== 'string') {
        return { profile: null, profileErrorCode: 'profile_fetch_error', profileError: 'invalid_response' };
    }

    // Require http/https
    if (!url.startsWith('http')) {
        return { profile: null, profileErrorCode: 'profile_fetch_error', profileError: 'invalid_response' };
    }

    // Replace {{sessionToken}} in URL if present
    url = url.replace(/\{\{sessionToken\}\}/g, encodeURIComponent(sessionToken));

    const method = (config.profileApiMethod || 'GET').toUpperCase();
    const timeoutMs = config.profileApiTimeoutMs ?? DEFAULT_TIMEOUT_MS;

    // Build headers: replace {{accessToken}} and {{sessionToken}} placeholders
    const rawHeaders = config.profileApiHeaders || {};
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...Object.fromEntries(
            Object.entries(rawHeaders).map(([k, v]) => [
                k,
                String(v)
                    .replace(/\{\{accessToken\}\}/g, accessToken)
                    .replace(/\{\{sessionToken\}\}/g, sessionToken),
            ])
        ),
    };

    // Default Authorization if not set
    if (!headers['Authorization'] && !headers['authorization']) {
        headers['Authorization'] = `Bearer ${accessToken}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await fetch(url, {
            method,
            headers,
            body: method !== 'GET' ? JSON.stringify({ sessionToken }) : undefined,
            signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (!res.ok) {
            if (deploymentId != null) recordFailure(deploymentId);
            return {
                profile: null,
                profileErrorCode: 'profile_fetch_failed',
                profileError: 'http_error',
            };
        }

        const text = await res.text();
        let parsed: unknown;
        try {
            parsed = JSON.parse(text);
        } catch {
            if (deploymentId != null) recordFailure(deploymentId);
            return {
                profile: null,
                profileErrorCode: 'profile_fetch_error',
                profileError: 'parse_error',
            };
        }

        if (parsed === null || typeof parsed !== 'object') {
            if (deploymentId != null) recordFailure(deploymentId);
            return {
                profile: null,
                profileErrorCode: 'profile_fetch_error',
                profileError: 'invalid_response',
            };
        }

        // Truncate to 4KB if needed
        let profile = parsed as object;
        const profileStr = JSON.stringify(parsed);
        if (profileStr.length > PROFILE_MAX_BYTES) {
            // Build truncated object: take top-level keys until we hit size limit
            const obj = parsed as Record<string, unknown>;
            const truncated: Record<string, unknown> = {};
            let len = 2; // {}
            for (const [k, v] of Object.entries(obj)) {
                const entry = `"${k}":${JSON.stringify(v)}`;
                if (len + entry.length + 1 > PROFILE_MAX_BYTES) break;
                truncated[k] = v;
                len += entry.length + 1;
            }
            profile = truncated;
        }

        // Cache on success when sessionId and cache enabled
        if (sessionId && cacheTtl != null && cacheTtl > 0) {
            setCachedProfile(sessionId, profile, cacheTtl);
        }

        if (deploymentId != null) recordSuccess(deploymentId);
        return { profile };
    } catch (e: any) {
        clearTimeout(timeoutId);
        if (e?.name === 'AbortError') {
            if (deploymentId != null) recordFailure(deploymentId);
            return {
                profile: null,
                profileErrorCode: 'profile_fetch_timeout',
                profileError: 'timeout',
            };
        }
        if (deploymentId != null) recordFailure(deploymentId);
        return {
            profile: null,
            profileErrorCode: 'profile_fetch_error',
            profileError: 'network_error',
        };
    }
}


