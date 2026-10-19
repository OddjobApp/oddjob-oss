/**
 * URL → concept/topic resolution for a tracked property.
 *
 * WHY THIS EXISTS: the embed derives themes client-side on every page view from
 * `<meta name="keywords">` plus four hardcoded path substrings (pricing,
 * enterprise, docs, case-study). That is one derivation per EVENT, it cannot
 * see the knowledge graph, and it cannot improve.
 *
 * Concept resolution is properly a per-URL cost, not a per-event one. A
 * property has hundreds of distinct URLs and potentially millions of events, so
 * resolving once per URL and caching turns O(events) into O(distinct URLs).
 * That ratio — not batching — is where the call reduction comes from.
 *
 * Resolution happens server-side at ingest. The embed is deployed on customer
 * sites and cannot be force-updated, so nothing here requires an embed change;
 * the event already carries `url`, and the embed's `themes` remain a fallback
 * for URLs not yet in the vocabulary.
 */

import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("ConceptResolver");

export interface ResolvedConcepts {
    /** Concept names attributed to this URL. */
    concepts: string[];
    /** Topic names, resolved from concepts via the knowledge graph. */
    topics: string[];
    /** Where the answer came from — `fallback` means the vocabulary had no entry. */
    source: "cache" | "vocabulary" | "fallback";
    /** Normalized cache key the lookup used. */
    key: string;
}

export interface ResolveOptions {
    organizationId: number;
    /** NULL = organization-wide vocabulary; set = Project Space scoped. */
    projectId?: number | null;
    url: string;
    /** Client-derived themes, used only when the vocabulary has no entry. */
    fallbackThemes?: string[];
}

/**
 * Query parameters that never change page meaning. Stripping them is what
 * makes the cache effective: the same article arriving with a hundred
 * different campaign tags must resolve to one key, not a hundred.
 */
const TRACKING_PARAMS = [
    /^utm_/i, /^gclid$/i, /^fbclid$/i, /^msclkid$/i, /^mc_(cid|eid)$/i,
    /^ref$/i, /^referrer$/i, /^source$/i, /^campaign$/i,
    /^oj_uid$/i, /^oj_email$/i, /^_hs(enc|mi)$/i, /^igshid$/i, /^vero_/i,
];

/**
 * Normalize a URL into a stable vocabulary key.
 *
 * Drops the fragment entirely (client-side routing anchors are not distinct
 * pages for concept purposes), drops tracking parameters, sorts the survivors
 * so parameter order cannot fragment the key, lowercases the host but NOT the
 * path (many sites are path-case-sensitive), and removes a trailing slash.
 *
 * Returns the input unchanged if it cannot be parsed — a malformed URL is
 * still a usable cache key, just a poor one.
 */
export function normalizeUrl(rawUrl: string): string {
    if (!rawUrl) return "";
    let parsed: URL;
    try {
        parsed = new URL(rawUrl);
    } catch {
        return rawUrl.trim();
    }

    parsed.hash = "";
    parsed.host = parsed.host.toLowerCase();
    parsed.protocol = parsed.protocol.toLowerCase();

    // Default ports carry no meaning.
    if ((parsed.protocol === "http:" && parsed.port === "80") ||
        (parsed.protocol === "https:" && parsed.port === "443")) {
        parsed.port = "";
    }

    const keep: Array<[string, string]> = [];
    for (const [k, v] of parsed.searchParams.entries()) {
        if (TRACKING_PARAMS.some(rx => rx.test(k))) continue;
        keep.push([k, v]);
    }
    keep.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

    parsed.search = "";
    for (const [k, v] of keep) parsed.searchParams.append(k, v);

    let out = parsed.toString();
    // Trailing slash on a non-root path is not a distinct page.
    out = out.replace(/\/(\?|$)/, (m, tail) => (parsed.pathname === "/" ? m : tail));
    return out;
}

/** Cache key namespaced by tenant AND project, so vocabularies cannot bleed. */
export function cacheKey(organizationId: number, projectId: number | null | undefined, url: string): string {
    return `${organizationId}:${projectId ?? "org"}:${normalizeUrl(url)}`;
}

/** Only the resolved vocabulary is cached; `source` and `key` are per-call. */
interface CachedVocabulary {
    concepts: string[];
    topics: string[];
}

interface CacheEntry {
    value: CachedVocabulary;
    expiresAt: number;
}

const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_MAX_ENTRIES = 5000;
const cache = new Map<string, CacheEntry>();

function cacheGet(key: string): CachedVocabulary | undefined {
    const hit = cache.get(key);
    if (!hit) return undefined;
    if (Date.now() > hit.expiresAt) {
        cache.delete(key);
        return undefined;
    }
    // Refresh recency for the simple LRU eviction below.
    cache.delete(key);
    cache.set(key, hit);
    return hit.value;
}

function cacheSet(key: string, value: CachedVocabulary): void {
    if (cache.size >= CACHE_MAX_ENTRIES) {
        // Map preserves insertion order, so the first key is the least recently used.
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** Exposed for tests and for invalidation after a vocabulary rebuild. */
export function clearConceptCache(): void {
    cache.clear();
}

export function conceptCacheSize(): number {
    return cache.size;
}

/**
 * Vocabulary lookup. Injectable so the resolver can be tested without a
 * database, and so the backing store can change (table today, embedding
 * search later) without touching callers.
 */
export type VocabularyLookup = (
    organizationId: number,
    projectId: number | null | undefined,
    normalizedUrl: string,
) => Promise<{ concepts: string[]; topics: string[] } | null>;

export async function resolveConcepts(
    options: ResolveOptions,
    lookup?: VocabularyLookup,
): Promise<ResolvedConcepts> {
    const { organizationId, projectId, url, fallbackThemes = [] } = options;
    const key = cacheKey(organizationId, projectId, url);

    const cached = cacheGet(key);
    if (cached) return { ...cached, source: "cache", key };

    if (lookup) {
        try {
            const found = await lookup(organizationId, projectId, normalizeUrl(url));
            if (found && (found.concepts.length > 0 || found.topics.length > 0)) {
                const value = { concepts: dedupe(found.concepts), topics: dedupe(found.topics) };
                cacheSet(key, value);
                return { ...value, source: "vocabulary", key };
            }
        } catch (err: any) {
            // A vocabulary outage must not drop the event; fall through to the
            // client-derived themes rather than failing ingest.
            logger.warn(`Vocabulary lookup failed for ${key}: ${err?.message ?? err}`);
        }
    }

    // Cold URL. Use whatever the embed derived, but DO NOT cache it — caching a
    // fallback would prevent the real vocabulary from ever taking effect for
    // this URL once it is populated.
    return { concepts: dedupe(fallbackThemes), topics: [], source: "fallback", key };
}

function dedupe(values: string[]): string[] {
    return [...new Set(values.filter(v => typeof v === "string" && v.trim().length > 0).map(v => v.trim()))];
}
