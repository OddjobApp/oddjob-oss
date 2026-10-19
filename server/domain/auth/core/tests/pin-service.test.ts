import { describe, it, expect } from "vitest";
import { pinService } from "../pin-service.js";

describe("pinService", () => {
    describe("validatePin", () => {
        it("should accept valid 6-digit numeric PINs", () => {
            const result = pinService.validatePin("123456");
            expect(result.valid).toBe(true);
            expect(result.errors).toEqual([]);
        });

        it("should accept valid PINs with more than 6 digits", () => {
            const result = pinService.validatePin("987654321");
            expect(result.valid).toBe(true);
        });

        it("should reject PINs shorter than 6 digits", () => {
            const result = pinService.validatePin("12345");
            expect(result.valid).toBe(false);
            expect(result.errors).toContain("PIN must be at least 6 digits long");
        });

        it("should reject non-numeric PINs", () => {
            const result = pinService.validatePin("12345a");
            expect(result.valid).toBe(false);
            expect(result.errors).toContain("PIN must contain only numeric digits");
        });
    });

    describe("hashPin & verifyPin", () => {
        it("should correctly hash and verify a valid PIN", async () => {
            const pin = "123456";
            const hash = await pinService.hashPin(pin);
            expect(hash).toContain(".");
            
            const isMatch = await pinService.verifyPin(pin, hash);
            expect(isMatch).toBe(true);
        });

        it("should reject incorrect PIN during verification", async () => {
            const hash = await pinService.hashPin("123456");
            const isMatch = await pinService.verifyPin("654321", hash);
            expect(isMatch).toBe(false);
        });

        it("should throw an error when attempting to hash an invalid PIN", async () => {
            await expect(pinService.hashPin("1234")).rejects.toThrow("Invalid PIN");
        });
    });
});
