
import { z } from "zod";
import type { ToolDefinition } from "./types.js";
import { createLogger } from "@server/utils/logger.js";
import { classifyOpenReviewStatus } from "@shared/openreview-status.js";

const logger = createLogger("WebTools");

// Bare "proceedings" is deliberately absent: it matches legal and court searches.
const SCHOLARLY_MARKERS = String.raw`arxiv|openreview|preprints?|academic papers?|research papers?|scientific papers?|conference papers?|peer[- ]reviewed|scholarly articles?`;

export function isAcademicSearch(query: string): boolean {
    return new RegExp(`\\b(?:${SCHOLARLY_MARKERS})\\b`, "i").test(query);
}

/**
 * Direct arXiv API search, tried first for scholarly queries. Reliable real research source over plain HTTPS (works
 * even when the headless-browser web search is blocked). Returns formatted paper
 * results, or null if arXiv is unreachable / has no matches.
 */
export async function fetchArxiv(query: string): Promise<string | null> {
    try {
        // Sanitize: arXiv's `all:` ANDs terms and chokes on punctuation (colons, parens,
        // semicolons from joined source titles). Strip to alphanumeric keywords and cap
        // the length so derived multi-title topics still return matches.
        const clean = query.replace(/[^a-zA-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 12).join(" ");
        const url = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent("all:" + (clean || query))}&start=0&max_results=8`;
        const res = await fetch(url, { headers: { "User-Agent": "Oddjob-Research/1.0" }, signal: AbortSignal.timeout(15000) });
        if (!res.ok) return null;
        const xml = await res.text();
        const entries = xml.split(/<entry>/).slice(1);
        if (entries.length === 0) return null;
        const items = entries.map((e, i) => {
            const tag = (t: string) => {
                const m = e.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`));
                return m ? m[1].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim() : "";
            };
            const idm = e.match(/<id>([\s\S]*?)<\/id>/);
            const link = idm ? idm[1].trim() : "";
            const authors = (e.match(/<name>([\s\S]*?)<\/name>/g) || [])
                .map(a => a.replace(/<\/?name>/g, "").trim()).slice(0, 5).join(", ");
            return `[${i + 1}] ${tag("title")}\n   Authors: ${authors}\n   URL: ${link}\n   Abstract: ${tag("summary").slice(0, 500)}`;
        });
        logger.info(`[google_search] arXiv fallback returned ${items.length} papers for: ${query}`);
        return `arXiv results for "${query}" (${items.length} papers):\n\n` + items.join("\n\n");
    } catch (e: any) {
        logger.info(`[google_search] arXiv fallback failed: ${e.message}`);
        return null;
    }
}

/**
 * The words that mark a query as scholarly ("research papers about X") are not
 * part of the topic, and a paper index ranks on them literally — OpenReview's
 * top hit for "research papers about graph neural networks" is a paper about
 * scholarly papers. Strip them, keeping the original if nothing would remain.
 */
// Request phrasing around the topic, stripped only from the ends. Each word
// must be followed by whitespace, so "on-device learning" keeps its "on".
const LEADING_FILLER = /^(?:(?:find|search|look|looking|show|me|list|get|recent|latest|new|top|papers?|articles?|submissions?|publications?|about|on|for|regarding|into|of|the|some|any)\s+)+/i;
const TRAILING_FILLER = /(?:\s+(?:papers?|articles?|submissions?|publications?))+$/i;

export function scholarlyTopic(query: string): string {
    const topic = query
        .replace(new RegExp(`\\b(?:${SCHOLARLY_MARKERS})\\b`, "gi"), " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(LEADING_FILLER, "")
        .replace(TRAILING_FILLER, "")
        .trim();
    return topic || query.trim();
}

/**
 * OpenReview (API v2) search, for conference and workshop submissions. Each
 * result carries its review outcome — search returns rejected and withdrawn
 * submissions too, and their venue string ("Submitted to ICLR 2025") would
 * otherwise read like a citation. Returns null when unreachable or empty.
 */
export async function fetchOpenReview(query: string): Promise<string | null> {
    try {
        const params = new URLSearchParams({ term: query, type: "terms", content: "all", source: "forum", limit: "8" });
        const res = await fetch(`https://api2.openreview.net/notes/search?${params.toString()}`, {
            headers: { "User-Agent": "Oddjob-Research/1.0", "Accept": "application/json" },
            signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) return null;
        const data: any = await res.json();
        const notes: any[] = Array.isArray(data?.notes) ? data.notes : [];
        const items = notes
            .filter(n => n?.content?.title?.value && n?.content?.abstract?.value)
            .map((n, i) => {
                const flat = (s: string) => String(s).replace(/\s+/g, " ").trim();
                const status = classifyOpenReviewStatus(n.content.venueid?.value, n.content.venue?.value);
                const venue = n.content.venue?.value ? `${n.content.venue.value} — ${status.replace("_", " ")}` : status.replace("_", " ");
                const authors = (n.content.authors?.value ?? []).slice(0, 5).join(", ");
                return `[${i + 1}] ${flat(n.content.title.value)}\n   Venue: ${venue}\n   Authors: ${authors}\n   URL: https://openreview.net/forum?id=${n.forum || n.id}\n   Abstract: ${flat(n.content.abstract.value).slice(0, 500)}`;
            });
        if (items.length === 0) return null;
        logger.info(`[google_search] OpenReview returned ${items.length} papers for: ${query}`);
        return `OpenReview results for "${query}" (${items.length} papers; each venue is labelled with its review outcome — "preprint" is an unreviewed arXiv paper, "indexed" is a record imported from DBLP or ORCID that OpenReview did not review):\n\n` + items.join("\n\n");
    } catch (e: any) {
        logger.info(`[google_search] OpenReview search failed: ${e.message}`);
        return null;
    }
}

/** arXiv preprints and OpenReview proceedings in parallel; null if both are empty. */
export async function fetchScholarly(query: string): Promise<string | null> {
    const topic = scholarlyTopic(query);
    const [arxiv, openReview] = await Promise.all([fetchArxiv(topic), fetchOpenReview(topic)]);
    const sections = [arxiv, openReview].filter((s): s is string => Boolean(s));
    return sections.length ? sections.join("\n\n---\n\n") : null;
}

export async function fetchDdgFallback(query: string): Promise<string> {
    try {
        logger.info(`[google_search] Attempting direct fetch fallback to DuckDuckGo for: ${query}`);
        const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        const response = await fetch(ddgUrl, {
            signal: AbortSignal.timeout(15000),
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
            }
        });
        if (!response.ok) {
            throw new Error(`HTTP status ${response.status}`);
        }
        const html = await response.text();
        const resultBlocks = html.split(/<div class="[^"]*web-result/);
        const results: Array<{title: string, url: string, snippet: string}> = [];
        for (let i = 1; i < resultBlocks.length; i++) {
            const block = resultBlocks[i].split(/<div class="clear"><\/div>/)[0];
            const aMatch = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
            const snippetMatch = block.match(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
            if (aMatch) {
                const rawUrl = aMatch[1];
                let resultUrl = rawUrl;
                if (rawUrl.includes("uddg=")) {
                    const match = rawUrl.match(/uddg=([^&]+)/);
                    if (match) resultUrl = decodeURIComponent(match[1]);
                }
                const title = aMatch[2].replace(/<[^>]*>/g, '').trim();
                const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]*>/g, '').trim() : "";
                
                const decodeHtml = (str: string) => {
                    return str
                        .replace(/&amp;/g, '&')
                        .replace(/&lt;/g, '<')
                        .replace(/&gt;/g, '>')
                        .replace(/&quot;/g, '"')
                        .replace(/&#x27;/g, "'")
                        .replace(/&#x2F;/g, '/')
                        .replace(/&nbsp;/g, ' ');
                };

                results.push({
                    title: decodeHtml(title),
                    url: decodeHtml(resultUrl),
                    snippet: decodeHtml(snippet)
                });
            }
        }
        if (results.length === 0) {
            // A challenge or changed HTML is not evidence of zero matches.
            // Let the caller try a general-web provider, not unrelated papers.
            return `Direct DuckDuckGo fetch fallback also failed: no usable search results were retrieved.`;
        }
        return `Search Results for "${query}" (Direct Fallback):\n\n` + 
            results.map((r, idx) => `[${idx + 1}] Title: ${r.title}\nURL: ${r.url}\nSnippet: ${r.snippet}`).join('\n\n');
    } catch (fetchErr: any) {
        return `Direct DuckDuckGo fetch fallback also failed: ${fetchErr.message}`;
    }
}

export const WEB_TOOLS: Record<string, ToolDefinition> = {
    browse_web: {
        name: "browse_web",

        idempotency: "read-safe",
        label: "Browse Web",
        group: "Web & Browser",
        riskLevel: "medium",
        guardrails: [
            "The requested URL is validated by EgressFirewall, which refuses non-HTTP(S) schemes and loopback, private, link-local, CGNAT and reserved addresses in both IPv4 and IPv6 form.",
            "When AGENT_EGRESS_WHITELIST is configured, only the listed domains are reachable.",
            "The fetch fallback re-validates every redirect hop. The Selenium path does not: the browser follows redirects itself, so only its entry URL is checked.",
            "Page text is truncated before it reaches the agent — 10,000 characters from the browser path, 5,000 from the fetch fallback.",
        ],
        description: "Visit a URL and extract its text content. Useful for reading documentation, news, or articles. Returns the page title and a text summary.",
        parameters: z.object({
            url: z.string().url().describe("The URL to visit"),
            mode: z.enum(["local", "firecrawl", "scrapegraph"]).default("local").describe("The scraping engine to use. Use 'firecrawl' for documentation/markdown and 'scrapegraph' for complex structured extraction."),
        }),
        execute: async ({ url, mode }, context) => {
            try {
                // Egress Firewall Guard
                const { EgressFirewall } = await import("@server/utils/egress-firewall.js");
                const validation = EgressFirewall.validateUrl(url);
                if (!validation.allowed) {
                    return `Error: Request blocked by Egress Firewall: ${validation.reason}`;
                }

                const { SeleniumRunner } = await import("@domain/mission/selenium/runner.js");
                const seleniumRunner = new SeleniumRunner();
                
                // Auto-resolve proxy if any provider is configured
                const proxyProvider = process.env.SCRAPINGBEE_API_KEY ? "scrapingbee" : 
                                      process.env.ZENROWS_API_KEY ? "zenrows" : "none";

                // Create a temporary Selenium config with STEALTH enabled
                const config: any = {
                    mode: mode || "local",
                    browserType: "chromium",
                    headless: true,
                    stealth: true, // Use stealth scripts and evasions
                    proxy: { provider: proxyProvider },
                    blockResources: ['image', 'media', 'font'], // Faster scraping
                    steps: [
                        { action: "goto", value: url, timeout: 30000 },
                        { action: "wait", waitMs: Math.floor(Math.random() * 2000) + 1000 }, // Brief human-like pause
                        { action: "extract", value: "body", extractAs: "content", format: "text" },
                        { action: "extract", value: "title", extractAs: "title", format: "text" },
                    ],
                    timeout: 60000,
                };

                const result = await seleniumRunner.execute(config, context as any || {});

                if (!result.success) {
                    // FALLBACK: If Selenium fails (likely blocked or technical error), try simple fetch
                    logger.info(`[browse_web] Selenium failed: ${result.error}. Falling back to fetch.`);
                    try {
                        // Guarded: the plain fetch this replaced followed
                        // redirects, so an allowed public URL could hand the
                        // request to a private one after the check had passed.
                        const guarded = await EgressFirewall.fetch(url, {
                            signal: AbortSignal.timeout(15000),
                            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36' }
                        });
                        if (!guarded.allowed) return `Error: Request blocked by Egress Firewall: ${guarded.reason}`;
                        const response = guarded.response!;
                        if (!response.ok) return `Error: Could not read ${url}: HTTP ${response.status}. No page content was verified.`;
                        const text = await response.text();
                        return `[FETCH FALLBACK] Content from ${url}:\n\n${text.slice(0, 5000)}...`;
                    } catch (fetchErr) {
                        return `Error: Failed to browse ${url}: ${result.error} (Fetch fallback also failed: ${String(fetchErr)})`;
                    }
                }

                const content = String(result.extracted?.content || '').trim();
                if (!content) return `Error: No readable content was retrieved from ${url}.`;
                return `Content from ${url} (${result.extracted?.title || 'page'}):\n\n${content.slice(0, 10000)}`;
            } catch (error) {
                return `Error browsing ${url}: ${String(error)}`;
            }
        }
    },
    google_search: {
        name: "google_search",

        idempotency: "read-safe",
        label: "Google Search",
        group: "Web & Browser",
        description: "Search the web for a query and return snippets or full page summaries of the top results. Uses multiple search backends for reliability.",
        parameters: z.object({
            query: z.string().describe("The search query"),
        }),
        fallbackTool: "browse_web",
        execute: async ({ query }, context) => {
            if (!query || typeof query !== 'string' || !query.trim()) {
                return `Search Results for "":\n\nPlease provide a search query.`;
            }
            const cleanQuery = query.trim();

            // Strategy: Try lightweight HTTP-based search FIRST (fast, reliable),
            // then fall back to Selenium-based scraping only if HTTP methods fail.

            // ── Phase 1: arXiv + OpenReview, for explicitly scholarly queries only ──
            // Runs before DuckDuckGo: a general engine almost always returns
            // *something* for "research papers about X", so when arXiv came
            // second it was effectively never reached.
            if (isAcademicSearch(cleanQuery)) {
                try {
                    const papers = await fetchScholarly(cleanQuery);
                    if (papers) {
                        logger.info(`[google_search] Scholarly sources returned papers for: ${cleanQuery}`);
                        return papers;
                    }
                } catch (scholarlyErr: any) {
                    logger.info(`[google_search] Scholarly search failed: ${scholarlyErr.message}`);
                }
            }

            // ── Phase 2: Direct DuckDuckGo HTML fetch (no browser needed) ──
            try {
                const ddgResult = await fetchDdgFallback(cleanQuery);
                // Check if the result contains actual search results (not just error messages)
                if (ddgResult &&
                    !ddgResult.includes("fallback also failed") &&
                    !ddgResult.includes("[Fetch Fallback Raw]") &&
                    !ddgResult.startsWith("Direct DuckDuckGo fetch fallback also failed")) {
                    logger.info(`[google_search] Direct DDG fetch succeeded for: ${cleanQuery}`);
                    return ddgResult;
                }
            } catch (ddgErr: any) {
                logger.info(`[google_search] Direct DDG fetch failed: ${ddgErr.message}`);
            }

            // ── Phase 3: Selenium-based Google search (expensive, often blocked) ──
            try {
                const { SeleniumRunner } = await import("@domain/mission/selenium/runner.js");
                const seleniumRunner = new SeleniumRunner();
                
                const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(cleanQuery)}`;
                const proxyProvider = process.env.SCRAPINGBEE_API_KEY ? "scrapingbee" : 
                                      process.env.ZENROWS_API_KEY ? "zenrows" : "none";

                const config: any = {
                    mode: "local",
                    browserType: "chromium",
                    headless: true,
                    stealth: true,
                    proxy: { provider: proxyProvider },
                    blockResources: ['image', 'media', 'font'],
                    steps: [
                        { action: "goto", value: searchUrl, timeout: 30000 },
                        { action: "wait", waitMs: Math.floor(Math.random() * 3000) + 2000 },
                        { action: "extract", value: "body", extractAs: "raw_body", format: "text" }
                    ],
                    timeout: 60000,
                };

                const result = await seleniumRunner.execute(config, context as any || {});
                
                if (result.success) {
                    const text = result.extracted?.raw_body || "";
                    // Check for CAPTCHA
                    if (!text.includes("unusual traffic from your computer network") &&
                        !text.includes("captcha-form") &&
                        !text.includes("enable javascript") &&
                        text.length > 100) {
                        return `Search Results for "${cleanQuery}":\n\n${text.slice(0, 10000)}`;
                    }
                }

                logger.info(`[google_search] Selenium Google failed or CAPTCHA'd. No more fallbacks.`);
            } catch (seleniumErr: any) {
                logger.info(`[google_search] Selenium unavailable: ${seleniumErr.message}`);
            }

            // ── All phases exhausted ──
            return `Error: Web search is unavailable for "${cleanQuery}". No usable results were retrieved from the search services. This does not establish that matching sources or records do not exist.`;
        },
    },
    http_query: {
        name: "http_query",
        idempotency: "read-safe",
        label: "HTTP Query",
        // "Web & Browser", not "Web and Browser": the group doubles as the
        // manifest category (CAPABILITY_CATEGORIES), and an unrecognized string
        // silently falls back to "System Utilities" — which is why this tool's
        // capability page filed a live HTTP fetcher under system utilities.
        group: "Web & Browser",
        riskLevel: "medium",
        guardrails: [
            "Only HTTP and HTTPS URLs are accepted; every other scheme is refused.",
            "The URL and every redirect hop are validated by EgressFirewall, which refuses loopback, private, link-local, CGNAT and reserved addresses in both IPv4 and IPv6 form, including IPv4-mapped IPv6.",
            "A hostname is also refused when DNS resolves it to a private or reserved address. This does not close DNS rebinding, where the address changes between the check and the connection.",
            "When AGENT_EGRESS_WHITELIST is configured, only the listed domains are reachable.",
            "Responses are cached per organization for the requested TTL, so a query may be answered from a previous caller's result within that window.",
        ],
        description: "Query a live external HTTP/HTTPS REST API endpoint with SSRF protections, caching, parameter merging, and optional JSON path extraction. Ideal for real-time weather, currency exchange, public data feeds, and market prices.",
        parameters: z.object({
            url: z.string().url().describe("The HTTP or HTTPS API endpoint URL to query"),
            method: z.enum(["GET", "POST"]).default("GET").describe("HTTP method (default GET)"),
            params: z.record(z.any()).optional().describe("Query parameters to append to the URL"),
            jsonPath: z.string().optional().describe("Optional dot-notated JSON path to extract specific nested data (e.g. 'current.temperature_2m' or 'rates.EUR')"),
            cacheTtlSeconds: z.number().int().min(0).max(3600).default(60).describe("Response cache TTL in seconds (default 60s)"),
        }),
        execute: async ({ url, method, params, jsonPath, cacheTtlSeconds }, context) => {
            try {
                const { httpConnectorService } = await import("@domain/integrations/http-connector.service.js");
                const orgId = (context as any)?.organizationId ?? null;
                const result = await httpConnectorService.executeQuery(
                    {
                        url,
                        method,
                        params,
                        jsonPath,
                        cacheTtlSeconds,
                    },
                    orgId
                );

                if (!result.success) {
                    return `Error: HTTP query to ${url} failed: ${result.error}`;
                }

                if (typeof result.data === "string") {
                    return result.data;
                }
                return JSON.stringify(result.data, null, 2);
            } catch (error: any) {
                return `Error: HTTP query failed: ${error?.message || String(error)}`;
            }
        },
    },
};
