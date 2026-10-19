import { scrypt, randomBytes, createHash, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { db } from "@server/database_service.js";
import { passwordResetTokens } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

const scryptAsync = promisify(scrypt);

/**
 * Service for password hashing, verification, and reset token management.
 */
export const passwordService = {
    /**
     * Hash a plaintext password.
     */
    async hashPassword(password: string): Promise<string> {
        const salt = randomBytes(16).toString("hex");
        const buf = (await scryptAsync(password, salt, 64)) as Buffer;
        return `${buf.toString("hex")}.${salt}`;
    },

    /**
     * Verify a plaintext password against a stored hash.
     */
    async verifyPassword(password: string, hash: string): Promise<boolean> {
        if (!hash) return false;
        const [hashedPassword, salt] = hash.split(".");
        if (!hashedPassword || !salt) return false;

        try {
            const buf = (await scryptAsync(password, salt, 64)) as Buffer;
            const expected = Buffer.from(hashedPassword, "hex");
            // Length check first: timingSafeEqual throws on a length mismatch.
            if (expected.length !== buf.length) return false;
            return timingSafeEqual(buf, expected);
        } catch {
            return false;
        }
    },

    /**
     * Validate password strength requirements.
     */
    validatePassword(password: string): { valid: boolean; errors: string[] } {
        const errors: string[] = [];
        if (password.length < 8) {
            errors.push('Password must be at least 8 characters long');
        }
        // Additional rules can be added here
        return { valid: errors.length === 0, errors };
    },

    /**
     * Generate a new password reset token for a user.
     */
    async createResetToken(userId: string) {
        const rawToken = randomBytes(32).toString("hex");
        const tokenHash = createHash("sha256").update(rawToken).digest("hex");
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins

        await db.insert(passwordResetTokens).values({
            userId,
            tokenHash,
            expiresAt,
        });

        return { rawToken, expiresAt };
    },

    /**
     * Consume a password reset token if valid and not expired.
     */
    async consumeResetToken(token: string) {
        const tokenHash = createHash("sha256").update(token).digest("hex");

        const [resetToken] = await db
            .select()
            .from(passwordResetTokens)
            .where(eq(passwordResetTokens.tokenHash, tokenHash))
            .limit(1);

        if (!resetToken) return { valid: false, reason: "Invalid token" };
        if (resetToken.used) return { valid: false, reason: "Token already used" };
        if (new Date() > resetToken.expiresAt) return { valid: false, reason: "Token expired" };

        // Mark as used
        await db
            .update(passwordResetTokens)
            .set({ used: true })
            .where(eq(passwordResetTokens.id, resetToken.id));

        return { valid: true, userId: resetToken.userId };
    }
};

export const hashPassword = passwordService.hashPassword;
export const verifyPassword = passwordService.verifyPassword;
export const validatePassword = passwordService.validatePassword;


