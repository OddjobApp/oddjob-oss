import crypto from "node:crypto";

/** AgentMail (Svix) rejects deliveries older or newer than this; so do we, against replay. */
export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

/**
 * Verifies an AgentMail webhook delivery against one webhook's signing secret.
 *
 * AgentMail delivers through Svix: the signature is base64 HMAC-SHA256, keyed by the
 * base64 part of the `whsec_` secret, over `${svix-id}.${svix-timestamp}.${raw body}`.
 * `svix-signature` is a space-separated list of `v1,<signature>` (several during a
 * secret rotation); one match is enough. The timestamp must be within tolerance, so
 * a captured delivery cannot be replayed later.
 */
export function verifyAgentMailWebhook(
    secret: string,
    rawBody: Buffer,
    headers: { id?: string; timestamp?: string; signature?: string },
    nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
    const { id, timestamp, signature } = headers;
    if (!secret.startsWith("whsec_") || !id || !timestamp || !signature || !rawBody.length) return false;
    if (!/^\d{1,12}$/.test(timestamp)) return false;
    if (Math.abs(nowSeconds - Number(timestamp)) > WEBHOOK_TOLERANCE_SECONDS) return false;

    const key = Buffer.from(secret.slice("whsec_".length), "base64");
    if (!key.length) return false;
    const expected = crypto.createHmac("sha256", key).update(`${id}.${timestamp}.`).update(rawBody).digest();

    return signature.split(" ").some((entry) => {
        const [version, value] = entry.split(",", 2);
        if (version !== "v1" || !value) return false;
        const candidate = Buffer.from(value, "base64");
        return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
    });
}

/** Test and tooling helper: the header a delivery signed with `secret` would carry. */
export function signAgentMailWebhook(secret: string, id: string, timestamp: string, rawBody: Buffer): string {
    const key = Buffer.from(secret.slice("whsec_".length), "base64");
    const value = crypto.createHmac("sha256", key).update(`${id}.${timestamp}.`).update(rawBody).digest("base64");
    return `v1,${value}`;
}
