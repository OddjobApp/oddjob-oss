import { createHmac, timingSafeEqual } from "crypto";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("PreviewShareToken");

export interface PreviewSharePayload {
    appId: number;
    deploymentId?: number;
    organizationId?: number;
    exp: number; // Unix timestamp in milliseconds
}

export interface ShareVerificationResult {
    valid: boolean;
    payload?: PreviewSharePayload;
    reason?: string;
}

function getSecret(): string {
    return process.env.APP_SECRET || process.env.SESSION_SECRET || "oddjob-preview-share-fallback-secret";
}

/**
 * Generate an HMAC-signed share token for external app preview.
 * Default expiration is 48 hours.
 */
export function generatePreviewShareToken(params: {
    appId: number;
    deploymentId?: number;
    organizationId?: number;
    expiresInHours?: number;
}): string {
    const expiresInHours = params.expiresInHours ?? 48;
    const exp = Date.now() + expiresInHours * 60 * 60 * 1000;

    const payload: PreviewSharePayload = {
        appId: params.appId,
        deploymentId: params.deploymentId,
        organizationId: params.organizationId,
        exp,
    };

    const payloadJson = JSON.stringify(payload);
    const payloadB64 = Buffer.from(payloadJson, "utf8").toString("base64url");
    const signature = createHmac("sha256", getSecret()).update(payloadB64).digest("base64url");

    return `${payloadB64}.${signature}`;
}

/**
 * Verify a preview share token against the requested app ID.
 */
export function verifyPreviewShareToken(token: string | undefined, expectedAppId: number): ShareVerificationResult {
    if (!token || typeof token !== "string") {
        return { valid: false, reason: "missing_token" };
    }

    const parts = token.split(".");
    if (parts.length !== 2) {
        return { valid: false, reason: "malformed_token" };
    }

    const [payloadB64, providedSig] = parts;
    if (!payloadB64 || !providedSig) {
        return { valid: false, reason: "malformed_token" };
    }

    const expectedSig = createHmac("sha256", getSecret()).update(payloadB64).digest("base64url");

    try {
        const sigBuf = Buffer.from(providedSig);
        const expBuf = Buffer.from(expectedSig);
        if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
            return { valid: false, reason: "invalid_signature" };
        }
    } catch {
        return { valid: false, reason: "signature_check_failed" };
    }

    let payload: PreviewSharePayload;
    try {
        const rawJson = Buffer.from(payloadB64, "base64url").toString("utf8");
        payload = JSON.parse(rawJson);
    } catch {
        return { valid: false, reason: "invalid_payload_encoding" };
    }

    if (payload.appId !== expectedAppId) {
        return { valid: false, reason: "app_id_mismatch", payload };
    }

    if (payload.exp && Date.now() > payload.exp) {
        return { valid: false, reason: "token_expired", payload };
    }

    return { valid: true, payload };
}
