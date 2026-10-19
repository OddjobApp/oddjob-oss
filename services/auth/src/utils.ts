/**
 * Auth Utilities
 * 
 * Password hashing, validation, and security helpers.
 */

import { randomBytes, scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scrypt);

/**
 * Hash a password using scrypt
 */
export async function hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16).toString("hex");
    const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
    return `${salt}:${derivedKey.toString("hex")}`;
}

/**
 * Verify a password against a hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
    const [salt, key] = hash.split(":");
    if (!salt || !key) return false;

    const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
    const keyBuffer = Buffer.from(key, "hex");

    return timingSafeEqual(derivedKey, keyBuffer);
}

/**
 * Validate password strength
 */
export function validatePassword(password: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (password.length < 8) {
        errors.push("Password must be at least 8 characters");
    }
    if (!/[A-Z]/.test(password)) {
        errors.push("Password must contain at least one uppercase letter");
    }
    if (!/[a-z]/.test(password)) {
        errors.push("Password must contain at least one lowercase letter");
    }
    if (!/[0-9]/.test(password)) {
        errors.push("Password must contain at least one number");
    }

    return {
        valid: errors.length === 0,
        errors,
    };
}

/**
 * Sanitize user input
 */
export function sanitizeInput(input: string): string {
    if (typeof input !== "string") return "";
    return input
        .trim()
        .replace(/[<>]/g, "") // Remove potential HTML
        .slice(0, 1000); // Limit length
}

/**
 * Generate CSRF token
 */
export function generateCsrfToken(): string {
    return randomBytes(32).toString("hex");
}
