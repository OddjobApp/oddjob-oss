import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { decrypt, encrypt, isOnCurrentKey, isOwnerBound, keyId } from "./encryption.js";
import { rotateCiphertext } from "./encryption-rotation.js";

const OLD = "11".repeat(32);
const NEW = "22".repeat(32);

/** A legacy (pre-v3) ciphertext, as rows written before the keyring hold. */
function legacySeal(hexKey: string, plaintext: string, aad?: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(hexKey, "hex"), iv);
    if (aad) cipher.setAAD(Buffer.from(aad, "utf8"));
    const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const body = `${iv.toString("hex")}.${cipher.getAuthTag().toString("hex")}.${ct.toString("hex")}`;
    return aad ? `v2.${body}` : body;
}

describe("encryption keyring", () => {
    beforeEach(() => { vi.stubEnv("ENCRYPTION_KEY", OLD); vi.stubEnv("ENCRYPTION_KEYS_PREVIOUS", ""); });
    afterEach(() => { vi.unstubAllEnvs(); });

    it("names the key in new ciphertext", () => {
        const sealed = encrypt("secret");
        expect(sealed.startsWith(`v3.${keyId(Buffer.from(OLD, "hex"))}.u.`)).toBe(true);
        expect(isOnCurrentKey(sealed)).toBe(true);
    });

    it("keeps reading secrets sealed with a previous key after rotation", () => {
        const underOld = encrypt("secret", "credential:7:11");
        vi.stubEnv("ENCRYPTION_KEY", NEW);
        vi.stubEnv("ENCRYPTION_KEYS_PREVIOUS", OLD);
        expect(decrypt(underOld, "credential:7:11")).toBe("secret");
        expect(isOnCurrentKey(underOld)).toBe(false);
    });

    it("refuses a ciphertext whose key is no longer configured", () => {
        const underOld = encrypt("secret");
        vi.stubEnv("ENCRYPTION_KEY", NEW);
        expect(() => decrypt(underOld)).toThrow();
    });

    it("still reads legacy and v2 ciphertext under either key", () => {
        const legacy = legacySeal(OLD, "plain");
        const bound = legacySeal(OLD, "bound", "organization_ai:7:gemini");
        vi.stubEnv("ENCRYPTION_KEY", NEW);
        vi.stubEnv("ENCRYPTION_KEYS_PREVIOUS", OLD);
        expect(decrypt(legacy)).toBe("plain");
        expect(decrypt(bound, "organization_ai:7:gemini")).toBe("bound");
        expect(isOwnerBound(bound)).toBe(true);
        expect(isOwnerBound(legacy)).toBe(false);
    });

    it("rotates onto the current key, keeping the owner binding", () => {
        const bound = encrypt("secret", "credential:7:11");
        const unbound = legacySeal(OLD, "plain");
        vi.stubEnv("ENCRYPTION_KEY", NEW);
        vi.stubEnv("ENCRYPTION_KEYS_PREVIOUS", OLD);

        const rotated = rotateCiphertext(bound, "credential:7:11")!;
        expect(isOnCurrentKey(rotated)).toBe(true);
        expect(isOwnerBound(rotated)).toBe(true);
        expect(rotateCiphertext(rotated, "credential:7:11")).toBeNull();

        const rotatedPlain = rotateCiphertext(unbound, null)!;
        expect(isOwnerBound(rotatedPlain)).toBe(false);

        // Once the old key is gone, rotated secrets are all that is readable.
        vi.stubEnv("ENCRYPTION_KEYS_PREVIOUS", "");
        expect(decrypt(rotated, "credential:7:11")).toBe("secret");
        expect(decrypt(rotatedPlain)).toBe("plain");
        expect(() => decrypt(bound, "credential:7:11")).toThrow();
    });

    it("will not rotate a bound ciphertext without knowing its owner", () => {
        const bound = encrypt("secret", "credential:7:11");
        vi.stubEnv("ENCRYPTION_KEY", NEW);
        vi.stubEnv("ENCRYPTION_KEYS_PREVIOUS", OLD);
        expect(() => rotateCiphertext(bound, null)).toThrow(/owner/);
        expect(() => rotateCiphertext(bound, "credential:8:11")).toThrow();
    });
});
