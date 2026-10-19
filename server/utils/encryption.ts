/**
 * Generic Encryption Utility
 * 
 * Provides AES-256-GCM encryption for sensitive data.
 * Uses the ENCRYPTION_KEY environment variable (falls back to APP_TOKEN_ENCRYPTION_KEY),
 * with ENCRYPTION_KEYS_PREVIOUS for rotation (see the keyring below).
 */

import crypto from "node:crypto";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("Encryption");

const ALGO = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 12;
const BOUND_PREFIX = "v2.";
const KEYED_PREFIX = "v3.";

/** The current key: the one every new ciphertext is sealed with. */
function getEncryptionKey(): Buffer {
    // Prefer generic ENCRYPTION_KEY, fallback to APP_TOKEN_ENCRYPTION_KEY for compatibility
    const raw = process.env.ENCRYPTION_KEY || process.env.APP_TOKEN_ENCRYPTION_KEY;
    if (!raw) {
        throw new Error(
            "ENCRYPTION_KEY (or APP_TOKEN_ENCRYPTION_KEY) environment variable is not set. " +
            "Set it to a 32-byte hex string (openssl rand -hex 32)."
        );
    }
    return decodeKey(raw, "ENCRYPTION_KEY");
}

/**
 * The keyring: the current key encrypts; previous keys only decrypt.
 *
 * One ENCRYPTION_KEY sealed every organization's AI keys and credential
 * secrets, with no way to change it short of losing them all. To rotate:
 *   1. set ENCRYPTION_KEY to the new key and ENCRYPTION_KEYS_PREVIOUS to the
 *      old one (comma-separated if several), and deploy;
 *   2. run `npm run encryption:rotate -- --apply`, which re-encrypts every
 *      stored ciphertext under the current key;
 *   3. once it reports nothing left on a previous key, remove
 *      ENCRYPTION_KEYS_PREVIOUS.
 * New ciphertext names its key (`v3.<kid>.`), so decryption picks the right
 * one directly; older formats are tried against each key in turn.
 */
interface KeyringEntry {
    kid: string;
    key: Buffer;
}

function decodeKey(raw: string, name: string): Buffer {
    const value = raw.trim();
    const buf = Buffer.from(value, value.length === 64 ? "hex" : "base64");
    if (buf.length !== KEY_LEN) {
        throw new Error(`${name} must decode to exactly ${KEY_LEN} bytes.`);
    }
    return buf;
}

export function keyId(key: Buffer): string {
    return crypto.createHash("sha256").update(key).digest("hex").slice(0, 8);
}

function keyring(): KeyringEntry[] {
    const current = getEncryptionKey();
    const previous = (process.env.ENCRYPTION_KEYS_PREVIOUS || "")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean)
        .map((v) => decodeKey(v, "Each ENCRYPTION_KEYS_PREVIOUS entry"));
    const seen = new Set<string>();
    const entries: KeyringEntry[] = [];
    for (const key of [current, ...previous]) {
        const kid = keyId(key);
        if (seen.has(kid)) continue;
        seen.add(kid);
        entries.push({ kid, key });
    }
    return entries;
}

function seal(key: Buffer, plaintext: string, aad?: string) {
    const iv = crypto.randomBytes(IV_LEN);
    const cipher = crypto.createCipheriv(ALGO, key, iv);
    if (aad !== undefined) cipher.setAAD(Buffer.from(aad, "utf8"));
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return `${iv.toString("hex")}.${cipher.getAuthTag().toString("hex")}.${encrypted.toString("hex")}`;
}

function open(key: Buffer, body: string, aad?: string): string {
    const parts = body.split(".");
    if (parts.length !== 3) throw new Error("Invalid encrypted format");
    const [ivHex, tagHex, ctHex] = parts;
    const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivHex, "hex"));
    if (aad !== undefined) decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return decipher.update(Buffer.from(ctHex, "hex")).toString("utf8") + decipher.final("utf8");
}

interface ParsedCiphertext {
    /** The key that sealed it, when the format records one. */
    kid: string | null;
    bound: boolean;
    body: string;
}

function parse(stored: string): ParsedCiphertext {
    if (stored.startsWith(KEYED_PREFIX)) {
        const [kid, flag, ...rest] = stored.slice(KEYED_PREFIX.length).split(".");
        if (!kid || (flag !== "b" && flag !== "u") || rest.length !== 3) throw new Error("Invalid encrypted format");
        return { kid, bound: flag === "b", body: rest.join(".") };
    }
    if (stored.startsWith(BOUND_PREFIX)) return { kid: null, bound: true, body: stored.slice(BOUND_PREFIX.length) };
    return { kid: null, bound: false, body: stored };
}

/**
 * Encrypt a plaintext string using AES-256-GCM, under the current key.
 * Format: v3.<kid>.<b|u>.iv.tag.ciphertext (hex, dot-separated).
 *
 * With `aad`, the ciphertext is bound to that owner string (e.g. the org and
 * credential slot). A bound ciphertext copied into another owner's row fails
 * authentication instead of decrypting there.
 */
export function encrypt(plaintext: string, aad?: string): string {
    try {
        const key = getEncryptionKey();
        return `${KEYED_PREFIX}${keyId(key)}.${aad !== undefined ? "b" : "u"}.${seal(key, plaintext, aad)}`;
    } catch (err: any) {
        logger.error("Encryption failed:", err.message);
        throw new Error("Failed to encrypt data");
    }
}

/**
 * Decrypt a ciphertext from any format this module has written: v3 (names its
 * key), v2 (owner-bound) or legacy (unprefixed). A bound ciphertext only
 * decrypts with the same `aad` it was sealed with; an unbound one ignores it.
 */
export function decrypt(stored: string, aad?: string): string {
    try {
        const parsed = parse(stored);
        if (parsed.bound && aad === undefined) throw new Error("Owner-bound ciphertext requires its owner");
        const binding = parsed.bound ? aad : undefined;
        const ring = keyring();
        if (parsed.kid) {
            const entry = ring.find((e) => e.kid === parsed.kid);
            if (!entry) throw new Error(`Encrypted with key ${parsed.kid}, which is not configured (ENCRYPTION_KEY / ENCRYPTION_KEYS_PREVIOUS)`);
            return open(entry.key, parsed.body, binding);
        }
        let lastError: unknown;
        for (const entry of ring) {
            try {
                return open(entry.key, parsed.body, binding);
            } catch (err) {
                lastError = err;
            }
        }
        throw lastError ?? new Error("No encryption key configured");
    } catch (err: any) {
        logger.error("Decryption failed:", err.message);
        throw new Error("Failed to decrypt data");
    }
}

/** True when `stored` was sealed to an owner with `encrypt(plaintext, aad)`. */
export function isOwnerBound(stored: string): boolean {
    try {
        return parse(stored).bound;
    } catch {
        return false;
    }
}

/** True when `stored` is already under the current key — nothing to rotate. */
export function isOnCurrentKey(stored: string): boolean {
    try {
        const { kid } = parse(stored);
        return kid !== null && kid === keyId(getEncryptionKey());
    } catch {
        return false;
    }
}

/**
 * Check if encryption is configured and available
 */
export function isEncryptionAvailable(): boolean {
    try {
        getEncryptionKey();
        return true;
    } catch {
        return false;
    }
}

/**
 * Encrypt an object (converts to JSON first)
 */
export function encryptObject(obj: Record<string, any>): string {
    return encrypt(JSON.stringify(obj));
}

/**
 * Decrypt to an object (parses JSON)
 */
export function decryptObject(stored: string): Record<string, any> {
    const decrypted = decrypt(stored);
    return JSON.parse(decrypted);
}

/**
 * Hash a string using SHA-256 (for one-way hashing like password verification)
 */
export function hash(plaintext: string): string {
    return crypto.createHash("sha256").update(plaintext).digest("hex");
}

/**
 * Generate a cryptographically secure random token
 */
export function generateToken(length: number = 32): string {
    return crypto.randomBytes(length).toString("hex");
}

/**
 * Constant-time comparison of two strings (prevents timing attacks)
 */
export function secureCompare(a: string, b: string): boolean {
    try {
        return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
    } catch {
        return false;
    }
}
