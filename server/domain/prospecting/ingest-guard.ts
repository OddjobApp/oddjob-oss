/**
 * Ingestion guard for the public prospecting endpoints (/events, /identify,
 * /copilot/chat). Browser-embedded tracking can't carry a real secret (it's in
 * page source), so the realistic defenses are:
 *   1. Property must exist.
 *   2. Per-property Origin allowlist — the request Origin/Referer host must match
 *      the property's configured `domain` (and subdomains). The Origin header is
 *      set by the browser and not forgeable by page JS, so this stops other sites
 *      from POSTing events under your propertyUid. (No domain configured → allow,
 *      preserving the "All Domains" default.)
 *   3. Per-property rate limit to blunt floods (scoring/enrichment are queue-backed).
 *
 * Fail-open on transient infra errors (DB/Redis) so legitimate traffic isn't
 * dropped; fail-closed only on definitive "unknown property" / origin mismatch.
 */
import type { Request, Response, NextFunction } from "express";
import { db } from "@server/database_service.js";
import { prospectProperties } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("ProspectIngestGuard");

interface CachedProperty { found: boolean; domain: string | null; organizationId: number | null; }
const cache = new Map<string, { value: CachedProperty; expires: number }>();
const CACHE_TTL_MS = 60_000;

export function invalidatePropertyCache(uid: string) { cache.delete(uid); }

async function getPropertyForIngest(uid: string): Promise<CachedProperty> {
    const hit = cache.get(uid);
    if (hit && hit.expires > Date.now()) return hit.value;
    try {
        const [p] = await db.select({ organizationId: prospectProperties.organizationId, domain: prospectProperties.domain })
            .from(prospectProperties).where(eq(prospectProperties.uid, uid)).limit(1);
        const value: CachedProperty = p
            ? { found: true, domain: p.domain, organizationId: p.organizationId }
            : { found: false, domain: null, organizationId: null };
        cache.set(uid, { value, expires: Date.now() + CACHE_TTL_MS });
        return value;
    } catch (e: any) {
        logger.warn(`Property lookup failed for ${uid} (failing open): ${e.message}`);
        return { found: true, domain: null, organizationId: null }; // transient — don't cache, don't block
    }
}

function hostFrom(value: string): string | null {
    if (!value) return null;
    try {
        const withProto = /^https?:\/\//i.test(value) ? value : `https://${value}`;
        return new URL(withProto).hostname.toLowerCase();
    } catch { return null; }
}

/** True if the request origin host equals or is a subdomain of any configured domain. */
function originMatchesDomain(originOrReferer: string, domainConfig: string): boolean {
    const reqHost = hostFrom(originOrReferer);
    if (!reqHost) return false;
    const allowed = domainConfig.split(",").map(d => hostFrom(d.trim())).filter((h): h is string => !!h);
    if (allowed.length === 0) return true; // misconfigured domain string → don't block
    return allowed.some(a => reqHost === a || reqHost.endsWith("." + a));
}

async function withinRateLimit(uid: string, perMinute: number): Promise<boolean> {
    try {
        const { redis } = await import("@domain/core/infrastructure/redis/redis-client.js");
        const minute = Math.floor(Date.now() / 60_000);
        const key = `prospect_ingest_rate:${uid}:${minute}`;
        const count = await redis.incr(key);
        if (count === 1) await redis.expire(key, 70);
        return count <= perMinute;
    } catch {
        return true; // Redis down → don't block ingestion
    }
}

function extractPropertyUid(body: any): string | undefined {
    if (!body) return undefined;
    if (typeof body.propertyUid === "string") return body.propertyUid;
    if (Array.isArray(body) && body[0] && typeof body[0].propertyUid === "string") return body[0].propertyUid;
    return undefined;
}

export function propertyIngestGuard(opts: { perMinute?: number } = {}) {
    const perMinute = opts.perMinute ?? 600;
    return async (req: Request, res: Response, next: NextFunction) => {
        const uid = extractPropertyUid(req.body);
        if (!uid) return res.status(400).json({ error: "Missing propertyUid" });

        const property = await getPropertyForIngest(uid);
        if (!property.found) return res.status(403).json({ error: "Unknown property" });

        if (property.domain) {
            const originHeader = (req.headers.origin as string) || (req.headers.referer as string) || "";
            if (!originMatchesDomain(originHeader, property.domain)) {
                logger.warn(`Rejected ingest for property ${uid}: origin "${originHeader}" not allowed (domain="${property.domain}")`);
                return res.status(403).json({ error: "Origin not allowed for this property" });
            }
        }

        if (!(await withinRateLimit(uid, perMinute))) {
            return res.status(429).json({ error: "Rate limit exceeded" });
        }

        (req as any).prospectProperty = property;
        next();
    };
}
