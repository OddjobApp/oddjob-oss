/**
 * App Deployment Token Service
 *
 * Handles minting, encrypting, and validating scoped tokens that allow
 * forged apps to call back into the Oddjob platform API.
 *
 * Security model:
 *  - Plaintext is returned ONCE at mint time and injected into the container
 *    as a server-side env var (ODDJOB_APP_TOKEN). It is never stored in the DB.
 *  - The DB stores: (a) a SHA-256 hash for O(1) validation lookup, and
 *    (b) an AES-256-GCM ciphertext so the plaintext can be recovered for
 *    new container starts without re-issuing the token.
 *  - The encryption key is read from APP_TOKEN_ENCRYPTION_KEY (env). If unset,
 *    the server refuses to mint or decrypt tokens rather than silently failing.
 */

import crypto from "node:crypto";
import { db } from "@server/database_service.js";
import { appDeployments } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import type { Request, Response, NextFunction } from "express";

const logger = createLogger("AppTokenService");

const TOKEN_PREFIX = "oddjob_app_";
const ALGO = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 12;

export type AppTokenCapability =
    | "datasets"
    | "missions"
    | "knowledge"
    | "hil"
    | "forms"
    | "documents"
    | "pipelines"
    | "schedules"
    | "integrations"
    | "telemetry";

export const ALL_CAPABILITIES: AppTokenCapability[] = [
    "datasets", "missions", "knowledge", "hil", "forms", "documents", "pipelines", "schedules", "integrations", "telemetry",
];

export interface AppTokenContext {
    deploymentId: number;
    appId: number;
    orgId: number;
    capabilities: AppTokenCapability[];
}

// ── Key derivation ────────────────────────────────────────────────────────────

function getEncryptionKey(): Buffer {
    const raw = process.env.APP_TOKEN_ENCRYPTION_KEY;
    if (!raw) {
        throw new Error(
            "APP_TOKEN_ENCRYPTION_KEY environment variable is not set. " +
            "Set it to a 32-byte hex string (openssl rand -hex 32)."
        );
    }
    // Accept raw hex or base64; normalise to 32-byte buffer
    const buf = Buffer.from(raw, raw.length === 64 ? "hex" : "base64");
    if (buf.length !== KEY_LEN) {
        throw new Error(`APP_TOKEN_ENCRYPTION_KEY must decode to exactly ${KEY_LEN} bytes.`);
    }
    return buf;
}

// ── Token generation ──────────────────────────────────────────────────────────

export function generateToken(): string {
    return TOKEN_PREFIX + crypto.randomBytes(32).toString("hex");
}

export function hashToken(plaintext: string): string {
    return crypto.createHash("sha256").update(plaintext).digest("hex");
}

export function encryptToken(plaintext: string): string {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LEN);
    const cipher = crypto.createCipheriv(ALGO, key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    // Format: iv.tag.ciphertext (all hex, dot-separated)
    return `${iv.toString("hex")}.${tag.toString("hex")}.${encrypted.toString("hex")}`;
}

export function decryptToken(stored: string): string {
    const key = getEncryptionKey();
    const parts = stored.split(".");
    if (parts.length !== 3) throw new Error("Invalid encrypted token format");
    const [ivHex, tagHex, ctHex] = parts;
    const iv = Buffer.from(ivHex, "hex");
    const tag = Buffer.from(tagHex, "hex");
    const ct = Buffer.from(ctHex, "hex");
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(ct).toString("utf8") + decipher.final("utf8");
}

// ── Minting ───────────────────────────────────────────────────────────────────

/**
 * Mint a new deployment token. Call after the deployment row is created.
 * Returns the plaintext token — store it nowhere; pass directly to the container.
 */
export async function mintDeploymentToken(
    deploymentId: number,
    capabilities: AppTokenCapability[] = ALL_CAPABILITIES,
): Promise<string> {
    const plaintext = generateToken();
    const hash = hashToken(plaintext);
    const encrypted = encryptToken(plaintext);

    await db.update(appDeployments)
        .set({
            appTokenHash: hash,
            appTokenEncrypted: encrypted,
            appTokenCapabilities: capabilities,
        })
        .where(eq(appDeployments.id, deploymentId));

    logger.info(`[AppToken] Minted token for deployment ${deploymentId} (${capabilities.join(",")})`);
    return plaintext;
}

/**
 * Decrypt the stored token for a deployment — used when re-provisioning a
 * container that already has a token (e.g. scaling, restart).
 */
export async function getPlaintextToken(deploymentId: number): Promise<string | null> {
    const [row] = await db
        .select({ enc: appDeployments.appTokenEncrypted })
        .from(appDeployments)
        .where(eq(appDeployments.id, deploymentId))
        .limit(1);

    if (!row?.enc) return null;
    return decryptToken(row.enc);
}

// ── Validation ────────────────────────────────────────────────────────────────

/**
 * Validate a bearer token from an incoming request.
 * Returns the app context if valid, null otherwise.
 */
export async function validateDeploymentToken(
    bearer: string,
): Promise<AppTokenContext | null> {
    if (!bearer.startsWith(TOKEN_PREFIX)) return null;

    const hash = hashToken(bearer);

    const [row] = await db
        .select({
            id: appDeployments.id,
            appId: appDeployments.appId,
            orgId: appDeployments.organizationId,
            capabilities: appDeployments.appTokenCapabilities,
        })
        .from(appDeployments)
        .where(eq(appDeployments.appTokenHash, hash))
        .limit(1);

    if (!row) return null;

    return {
        deploymentId: row.id,
        appId: row.appId,
        orgId: row.orgId,
        capabilities: (row.capabilities ?? []) as AppTokenCapability[],
    };
}

// ── Express middleware ────────────────────────────────────────────────────────

declare global {
    namespace Express {
        interface Request {
            appTokenContext?: AppTokenContext;
        }
    }
}

/**
 * Express middleware that validates an AppDeploymentToken from the
 * Authorization header and attaches the context to req.appTokenContext.
 * Rejects with 401 if missing/invalid, 403 if the required capability is absent.
 */
export function requireAppToken(capability?: AppTokenCapability) {
    return async (req: Request, res: Response, next: NextFunction) => {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith("Bearer ")) {
            return res.status(401).json({ error: "App deployment token required" });
        }

        const bearer = authHeader.slice(7);
        let context: AppTokenContext | null = null;
        try {
            context = await validateDeploymentToken(bearer);
        } catch (err: any) {
            logger.warn(`[AppToken] Validation error: ${err.message}`);
            return res.status(401).json({ error: "Invalid token" });
        }

        if (!context) {
            return res.status(401).json({ error: "Invalid or expired token" });
        }

        if (capability && !context.capabilities.includes(capability)) {
            return res.status(403).json({
                error: `Token does not grant '${capability}' capability`,
            });
        }

        req.appTokenContext = context;
        next();
    };
}
