
import { createHmac, timingSafeEqual } from "crypto";

export interface VerificationConfig {
    header: string;
    secret?: string;
    algorithm?: string; // sha256, sha1
}

export function verifyWebhookSignature(
    payload: string,
    headers: Record<string, string | string[] | undefined>,
    mode: string,
    config: VerificationConfig
): boolean {
    if (mode === "none") return true;

    if (mode === "header_token") {
        const headerValue = headers[config.header.toLowerCase()];
        if (!headerValue || !config.secret) return false;

        // Simple token comparison
        return headerValue === config.secret;
    }

    if (mode === "hmac") {
        const headerValue = headers[config.header.toLowerCase()];
        if (!headerValue || typeof headerValue !== 'string' || !config.secret) return false;

        const algorithm = config.algorithm || "sha256";
        const hmac = createHmac(algorithm, config.secret);
        const digest = hmac.update(payload).digest("hex");

        // Some providers send signature as "sha256=<digest>"
        const signature = headerValue.includes('=') ? headerValue.split('=')[1] : headerValue;

        // Timing safe compare
        const digestBuffer = Buffer.from(digest);
        const signatureBuffer = Buffer.from(signature);

        if (digestBuffer.length !== signatureBuffer.length) return false;
        return timingSafeEqual(digestBuffer, signatureBuffer);
    }

    return false;
}

