/**
 * Embed Profile URL Validator
 * Validates profileApiUrl against org-level domain allowlist.
 */

/**
 * Check if a URL is allowed by the allowlist.
 * Allowlist entries:
 * - Exact: "https://api.customer.com" - must match exactly
 * - Wildcard: "*.customer.com" - matches any subdomain of customer.com
 * - Prefix: "https://api.customer.com" - scheme + host must match
 */
export function isUrlAllowed(url: string, allowlist: string[] | null | undefined): boolean {
    if (!allowlist || allowlist.length === 0) return true;

    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return false;
    }

    const host = parsed.hostname.toLowerCase();
    const origin = `${parsed.protocol}//${parsed.host}`.toLowerCase();

    for (const entry of allowlist) {
        const e = entry.trim();
        if (!e) continue;

        // Wildcard: *.domain.com
        if (e.startsWith('*.')) {
            const domain = e.slice(2).toLowerCase();
            if (host === domain || host.endsWith('.' + domain)) return true;
            continue;
        }

        // Exact URL or origin
        try {
            const entryUrl = new URL(e.startsWith('http') ? e : `https://${e}`);
            const entryHost = entryUrl.hostname.toLowerCase();
            const entryOrigin = `${entryUrl.protocol}//${entryUrl.host}`.toLowerCase();
            if (host === entryHost || origin === entryOrigin) return true;
        } catch {
            // Plain domain: "api.customer.com"
            if (host === e.toLowerCase() || host.endsWith('.' + e.toLowerCase())) return true;
        }
    }

    return false;
}


