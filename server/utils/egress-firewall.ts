import { URL } from "node:url";
import { lookup as dnsLookup } from "node:dns/promises";

/**
 * The one egress check.
 *
 * Every server-side fetch of a caller-supplied URL goes through here. A second
 * implementation grew in http-connector.service.ts and was weaker in both
 * directions — it dropped AGENT_EGRESS_WHITELIST entirely, and its IPv6
 * branches could never fire because `URL.hostname` keeps the brackets, so
 * `startsWith("fd00:")` never matched `[fd00::1]`. Rival copies of a security
 * boundary are how a gate ends up reading green while half of it is dead code;
 * `org-conditions.ts` carries the same note for the same reason.
 *
 * Two things callers must not do by hand:
 *  - parse the host themselves. Use `validateUrl`.
 *  - pass `redirect: "follow"`. A public URL is allowed to redirect to a
 *    private one, and the guard only ever sees the first hop. Use `fetch`
 *    below, which re-validates every hop.
 */

const BLOCKED_HOSTNAMES = new Set([
    "localhost",
    "metadata",
    "metadata.google.internal",
    "instance-data",
]);

/** Suffixes that only ever resolve inside a network we are not allowed to reach. */
const BLOCKED_SUFFIXES = [".local", ".internal", ".localhost", ".home.arpa"];

/**
 * Reserved IPv4 space. Parsed as four octets rather than matched as a string
 * prefix: the previous `startsWith("172.2")` blocked public 172.2xx.x.x while
 * `startsWith("172.16")` alone missed most of 172.16.0.0/12.
 */
function isReservedIpv4(a: number, b: number, c: number): boolean {
    if (a === 0) return true;                          // 0.0.0.0/8      this host
    if (a === 10) return true;                         // 10.0.0.0/8     private
    if (a === 127) return true;                        // 127.0.0.0/8    loopback
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10  CGNAT
    if (a === 169 && b === 254) return true;           // 169.254.0.0/16 link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16.0.0/12  private
    if (a === 192 && b === 168) return true;           // 192.168.0.0/16 private
    if (a === 192 && b === 0 && c === 0) return true;  // 192.0.0.0/24   IETF protocol assignments
    if (a === 198 && b >= 18 && b <= 19) return true;  // 198.18.0.0/15  benchmarking
    if (a >= 224) return true;                         // 224.0.0.0/4 multicast, 240.0.0.0/4 reserved
    return false;
}

/**
 * Returns the dotted-quad an IPv6 address maps onto, for the forms that reach
 * IPv4 destinations: `::ffff:127.0.0.1` and its normalized hex twin
 * `::ffff:7f00:1`, which is what `new URL()` actually hands back.
 */
function mappedIpv4(host: string): string | null {
    const m = /^::ffff:(.+)$/i.exec(host);
    if (!m) return null;
    const rest = m[1];
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(rest)) return rest;
    const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(rest);
    if (hex) {
        const hi = parseInt(hex[1], 16);
        const lo = parseInt(hex[2], 16);
        return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    }
    return null;
}

function isReservedIpv6(host: string): boolean {
    // Anything in ::/96 — loopback ::1, the unspecified address, and the
    // deprecated IPv4-compatible form (::127.0.0.1, which URL normalizes to
    // ::7f00:1). No public address begins with "::", and the one useful
    // exception, ::ffff:<public v4>, is unwrapped to the IPv4 rules before
    // this runs.
    if (host.startsWith("::")) return true;

    const group = /^([0-9a-f]{1,4}):/i.exec(host)?.[1];
    if (!group) return false;
    const first = parseInt(group, 16);
    if (Number.isNaN(first)) return false;
    // fe80::/10 link-local (fe80–febf) and fc00::/7 unique-local (fc00–fdff).
    // Matched as ranges, not as the literal strings "fe80:" and "fd00:".
    if (first >= 0xfe80 && first <= 0xfebf) return true;
    if (first >= 0xfc00 && first <= 0xfdff) return true;
    return false;
}

/**
 * Judges one literal address — the same rules for a hostname that is already
 * an IP and for an address DNS resolved a name to. `false` means "nothing
 * here says this is private", not "verified public".
 */
function isReservedAddress(address: string): boolean {
    const host = address.toLowerCase().replace(/^\[|\]$/g, "");
    // An IPv6 address that maps onto IPv4 is judged by the IPv4 rules:
    // ::ffff:127.0.0.1 reaches the same loopback as 127.0.0.1.
    const candidate = mappedIpv4(host) ?? host;

    const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(candidate);
    if (ipv4) {
        const octets = ipv4.slice(1, 5).map(Number);
        if (octets.some((o) => o > 255)) return true; // malformed — refuse it
        return isReservedIpv4(octets[0], octets[1], octets[2]);
    }
    if (candidate.includes(":")) return isReservedIpv6(candidate);
    return false;
}

/**
 * Drop the headers that only describe a request body, for a redirect that
 * turns a POST into a bodyless GET. `fetch` does the same on a 303: leaving
 * `Content-Type: application/json` and a stale `Content-Length` on a GET with
 * no body is what a strict server rejects.
 *
 * Accepts the shapes callers actually pass — a plain object, a Headers, or
 * entry tuples — and always returns a plain object.
 */
const BODY_HEADERS = new Set([
    "content-type",
    "content-length",
    "content-encoding",
    "content-language",
    "content-location",
]);

function stripBodyHeaders(headers: HeadersInit | undefined): Record<string, string> | undefined {
    if (!headers) return undefined;
    const entries =
        typeof (headers as Headers).forEach === "function" && !Array.isArray(headers)
            ? Array.from(headers as Headers)
            : Array.isArray(headers)
                ? (headers as string[][])
                : Object.entries(headers as Record<string, string>);

    return Object.fromEntries(
        entries.filter(([key]) => !BODY_HEADERS.has(String(key).toLowerCase())),
    );
}

/** Whether a hostname is already an address, so DNS has nothing to add. */
function isIpLiteral(hostname: string): boolean {
    const host = hostname.replace(/^\[|\]$/g, "");
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
}

export interface EgressDecision {
    allowed: boolean;
    reason?: string;
}

/**
 * How a hostname is resolved. Injectable so tests can describe a split-horizon
 * or attacker-controlled record without depending on live DNS — a test pinned
 * to a real domain's A record stops proving anything the day it changes hands.
 */
export type EgressLookup = (hostname: string) => Promise<Array<{ address: string }>>;

const systemLookup: EgressLookup = (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

export interface GuardedFetchResult {
    allowed: boolean;
    /** Why the request was refused. Set only when `allowed` is false. */
    reason?: string;
    response?: Response;
    /** The URL that actually answered, after any redirects. */
    finalUrl?: string;
}

export class EgressFirewall {
    /**
     * Validates one URL against the egress rules. This is a single-hop
     * decision — it says nothing about where the response may redirect.
     */
    static validateUrl(urlString: string): EgressDecision {
        if (!urlString) {
            return { allowed: false, reason: "Empty URL provided." };
        }

        let url: URL;
        try {
            url = new URL(urlString);
        } catch {
            return { allowed: false, reason: "Invalid or malformed URL format." };
        }

        if (url.protocol !== "http:" && url.protocol !== "https:") {
            return {
                allowed: false,
                reason: `Disallowed protocol "${url.protocol}". Only HTTP and HTTPS are supported.`,
            };
        }

        // `hostname` keeps the brackets on an IPv6 literal, so strip them before
        // any comparison. Every IPv6 rule below depends on this line.
        const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");

        if (BLOCKED_HOSTNAMES.has(hostname) || BLOCKED_SUFFIXES.some((s) => hostname.endsWith(s))) {
            return {
                allowed: false,
                reason: "Access to local network and metadata interfaces is blocked.",
            };
        }

        if (isReservedAddress(hostname)) {
            return { allowed: false, reason: "Access to private or reserved IP ranges is blocked." };
        }

        // Enforce domain whitelist if AGENT_EGRESS_WHITELIST is configured in env
        // Example: AGENT_EGRESS_WHITELIST=atlassian.com,github.com,slack.com
        const whitelistStr = process.env.AGENT_EGRESS_WHITELIST;
        if (whitelistStr) {
            const whitelist = whitelistStr.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
            if (whitelist.length > 0) {
                const isWhitelisted = whitelist.some(
                    (domain) => hostname === domain || hostname.endsWith("." + domain)
                );
                if (!isWhitelisted) {
                    return { allowed: false, reason: `Domain '${hostname}' is not in the egress whitelist.` };
                }
            }
        }

        return { allowed: true };
    }

    /**
     * Checks where a hostname actually points.
     *
     * The name rules above are blind to `http://localtest.me/`, a public name
     * whose A record is 127.0.0.1 — and to any domain an attacker controls and
     * points at a private address. Resolving closes that, which is why it runs
     * on every hop of `fetch`.
     *
     * A name we cannot resolve is allowed through: `fetch` uses the same
     * resolver and will fail on its own, and treating a lookup failure as a
     * block would turn every offline test into a firewall error.
     *
     * This does not close DNS rebinding — the address can change between this
     * lookup and the connection. Closing that needs the socket pinned to the
     * address we checked, via a custom undici dispatcher.
     */
    static async validateResolvedHost(
        hostname: string,
        lookup: EgressLookup = systemLookup
    ): Promise<EgressDecision> {
        const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
        if (!host || isIpLiteral(host)) return { allowed: true };

        let records: Array<{ address: string }>;
        try {
            records = await lookup(host);
        } catch {
            return { allowed: true };
        }

        for (const record of records) {
            if (isReservedAddress(record.address)) {
                return {
                    allowed: false,
                    reason: `'${host}' resolves to a private or reserved address (${record.address}).`,
                };
            }
        }
        return { allowed: true };
    }

    /**
     * Fetches a caller-supplied URL with the firewall applied to every hop.
     *
     * Redirects are followed by hand because `redirect: "follow"` validates
     * only the URL the caller passed: an allowed public host answering `302
     * Location: http://169.254.169.254/latest/meta-data/` hands back cloud
     * credentials, and the guard never sees that address. Verified behaviour,
     * not a hypothetical — undici follows cross-host redirects by default.
     *
     * Never throws for a blocked URL; it returns `allowed: false` so callers
     * can report the reason. Transport failures still throw, as `fetch` does.
     */
    static async fetch(
        urlString: string,
        init: RequestInit = {},
        options: { maxRedirects?: number; lookup?: EgressLookup } = {}
    ): Promise<GuardedFetchResult> {
        const maxRedirects = options.maxRedirects ?? 5;
        const lookup = options.lookup ?? systemLookup;
        let url = urlString;
        let request: RequestInit = init;

        for (let hop = 0; hop <= maxRedirects; hop++) {
            const refuse = (reason?: string): GuardedFetchResult => ({
                allowed: false,
                reason: hop === 0 ? reason : `${reason} (via a redirect from ${urlString})`,
            });

            const validation = EgressFirewall.validateUrl(url);
            if (!validation.allowed) return refuse(validation.reason);

            const resolved = await EgressFirewall.validateResolvedHost(new URL(url).hostname, lookup);
            if (!resolved.allowed) return refuse(resolved.reason);

            const response = await fetch(url, { ...request, redirect: "manual" });

            const location = response.status >= 300 && response.status < 400
                ? response.headers.get("location")
                : null;
            if (!location) {
                return { allowed: true, response, finalUrl: url };
            }

            // Drain the redirect body so the socket is released, then resolve
            // the next hop against the URL that issued it. Best effort by
            // design: a redirect may carry no body, and a Response-like object
            // may not implement arrayBuffer at all. Failing to release a socket
            // must never turn into a failure to enforce the next hop's check.
            try {
                await response.arrayBuffer?.();
            } catch {
                // Nothing to drain, or already consumed.
            }
            try {
                url = new URL(location, url).toString();
            } catch {
                return { allowed: false, reason: "Redirect target is not a valid URL." };
            }

            // Match what `redirect: "follow"` would have done, so moving a
            // caller onto this helper does not change its semantics: 301, 302
            // and 303 become a bodyless GET, while 307 and 308 keep the method
            // and body. Replaying a POST body to every hop would double-submit.
            if (response.status !== 307 && response.status !== 308) {
                const { body: _body, ...rest } = request;
                request = { ...rest, method: "GET", headers: stripBodyHeaders(rest.headers) };
            }
        }

        return { allowed: false, reason: `Too many redirects (limit ${maxRedirects}).` };
    }
}
