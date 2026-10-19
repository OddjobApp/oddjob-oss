import { describe, expect, it, vi } from "vitest";

vi.mock("@server/database_service.js", () => ({ db: {} }));

const { hashPassword, verifyPassword } = await import("../password-service");

describe("verifyPassword", () => {
    it("accepts the password the hash was made from", async () => {
        const hash = await hashPassword("correct horse battery");
        expect(await verifyPassword("correct horse battery", hash)).toBe(true);
        expect(await verifyPassword("correct horse batter", hash)).toBe(false);
    });

    // It once accepted password123 and admin123 interchangeably, in every
    // environment: either one opened any account whose password was the other.
    it("does not treat password123 and admin123 as interchangeable", async () => {
        expect(await verifyPassword("password123", await hashPassword("admin123"))).toBe(false);
        expect(await verifyPassword("admin123", await hashPassword("password123"))).toBe(false);
    });

    it("rejects malformed and empty hashes", async () => {
        expect(await verifyPassword("x", "")).toBe(false);
        expect(await verifyPassword("x", "no-salt-separator")).toBe(false);
        expect(await verifyPassword("x", "abcd.salt")).toBe(false);
        expect(await verifyPassword("x", "zz-not-hex.salt")).toBe(false);
    });
});
