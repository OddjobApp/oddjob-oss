
/**
 * Security Utilities
 */

/**
 * Validate a URL to prevent SSRF (Server-Side Request Forgery)
 * Throws an error if the URL is invalid or points to a forbidden (local/private) address.
 */
export function validateUrlForSSRF(url: string): void {
    try {
        const parsedUrl = new URL(url);
        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
            throw new Error(`Invalid protocol: ${parsedUrl.protocol}`);
        }

        const hostname = parsedUrl.hostname;

        // Block localhost and common private IP ranges
        const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '0.0.0.0';
        const isPrivate = /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|169\.254\.)/.test(hostname);

        if (isLocal || isPrivate) {
            throw new Error(`Forbidden URL: Internal addresses are not allowed.`);
        }
    } catch (e: any) {
        throw new Error(`SSRF Validation Failed: ${e.message}`);
    }
}

