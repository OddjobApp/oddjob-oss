import { scrypt, randomBytes, createHash, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { db } from "@server/database_service.js";
import { pinResetTokens, users } from "@shared/schema/index.js";
import { and, eq, or } from "drizzle-orm";

const scryptAsync = promisify(scrypt);

/**
 * Failed-verification tracking.
 *
 * A 6-digit PIN has a 10^6 keyspace, which is trivially exhaustible over HTTP
 * without a per-account lockout. The IP-level `authRateLimiter` on the route is
 * not sufficient on its own: it is per-IP and generous by design, so a
 * distributed or slow attacker walks straight through it.
 *
 * Deliberately in-process rather than Redis-backed: the Redis limiter in
 * server/middleware/rate-limiter.ts fails OPEN on a Redis outage, which is the
 * right trade for throughput limiting and the wrong one for a credential gate.
 * The cost is that the counter is per-process and resets on restart — see
 * MAX_FAILED_ATTEMPTS below for why that is acceptable here.
 */
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const failedAttempts = new Map<string, { count: number; firstFailureAt: number; lockedUntil: number }>();

/** Bound the map so a userId-spraying attacker cannot grow it without limit. */
const MAX_TRACKED_ACCOUNTS = 10_000;

function pruneExpiredAttempts(now: number): void {
    for (const [key, entry] of failedAttempts.entries()) {
        if (entry.lockedUntil <= now && now - entry.firstFailureAt > LOCKOUT_MS) {
            failedAttempts.delete(key);
        }
    }
}

/**
 * Service for PIN validation, hashing, verification, and email reset token management.
 */
export const pinService = {
    /**
     * Validate PIN format requirements (must be at least 6 numeric digits).
     */
    validatePin(pin: string): { valid: boolean; errors: string[] } {
        const errors: string[] = [];
        if (!pin || typeof pin !== "string") {
            errors.push("PIN is required");
            return { valid: false, errors };
        }
        if (pin.length < 6) {
            errors.push("PIN must be at least 6 digits long");
        }
        if (!/^\d+$/.test(pin)) {
            errors.push("PIN must contain only numeric digits");
        }
        return { valid: errors.length === 0, errors };
    },

    /**
     * Hash a plaintext PIN using scrypt with a random 16-byte salt.
     */
    async hashPin(pin: string): Promise<string> {
        const validation = this.validatePin(pin);
        if (!validation.valid) {
            throw new Error(`Invalid PIN: ${validation.errors.join(", ")}`);
        }
        const salt = randomBytes(16).toString("hex");
        const buf = (await scryptAsync(pin, salt, 64)) as Buffer;
        return `${buf.toString("hex")}.${salt}`;
    },

    /**
     * Verify a plaintext PIN against a stored scrypt hash.
     */
    async verifyPin(pin: string, hash: string): Promise<boolean> {
        if (!pin || !hash) return false;
        const [hashedPin, salt] = hash.split(".");
        if (!hashedPin || !salt) return false;

        try {
            const buf = (await scryptAsync(pin, salt, 64)) as Buffer;
            const expected = Buffer.from(hashedPin, "hex");
            // Length check first: timingSafeEqual throws on a length mismatch.
            if (expected.length !== buf.length) return false;
            return timingSafeEqual(buf, expected);
        } catch {
            return false;
        }
    },

    /**
     * Whether this account is currently locked out of PIN verification.
     */
    getLockout(userId: string): { lockedOut: boolean; retryAfterSeconds: number } {
        const entry = failedAttempts.get(userId);
        if (!entry) return { lockedOut: false, retryAfterSeconds: 0 };

        const now = Date.now();
        if (entry.lockedUntil > now) {
            return { lockedOut: true, retryAfterSeconds: Math.ceil((entry.lockedUntil - now) / 1000) };
        }

        // Lockout expired — the account gets a clean slate rather than staying
        // one failure away from being locked out again forever.
        if (entry.lockedUntil !== 0) failedAttempts.delete(userId);
        return { lockedOut: false, retryAfterSeconds: 0 };
    },

    /**
     * Record a failed verification, locking the account after MAX_FAILED_ATTEMPTS.
     */
    registerFailedAttempt(userId: string): { lockedOut: boolean; attemptsRemaining: number } {
        const now = Date.now();
        pruneExpiredAttempts(now);
        if (failedAttempts.size >= MAX_TRACKED_ACCOUNTS && !failedAttempts.has(userId)) {
            // Evict the oldest tracked account rather than refusing to track this
            // one: never let map pressure turn into an unmetered PIN oracle.
            const oldest = [...failedAttempts.entries()].sort((a, b) => a[1].firstFailureAt - b[1].firstFailureAt)[0];
            if (oldest) failedAttempts.delete(oldest[0]);
        }

        const entry = failedAttempts.get(userId) ?? { count: 0, firstFailureAt: now, lockedUntil: 0 };
        entry.count += 1;
        if (entry.count >= MAX_FAILED_ATTEMPTS) {
            entry.lockedUntil = now + LOCKOUT_MS;
        }
        failedAttempts.set(userId, entry);

        return {
            lockedOut: entry.lockedUntil > now,
            attemptsRemaining: Math.max(0, MAX_FAILED_ATTEMPTS - entry.count),
        };
    },

    /** Clear the failure counter after a successful verification. */
    clearFailedAttempts(userId: string): void {
        failedAttempts.delete(userId);
    },

    /** Test seam: drop all lockout state. */
    _resetAttemptTracking(): void {
        failedAttempts.clear();
    },

    /**
     * Create a secure single-use PIN reset token for email recovery requests.
     */
    async createPinResetToken(userId: string): Promise<{ rawToken: string; expiresAt: Date }> {
        const rawToken = randomBytes(32).toString("hex");
        const tokenHash = createHash("sha256").update(rawToken).digest("hex");
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minute expiration

        await db.insert(pinResetTokens).values({
            userId,
            tokenHash,
            expiresAt,
        });

        return { rawToken, expiresAt };
    },

    /**
     * Validate a PIN reset token WITHOUT consuming it.
     *
     * Lets a caller resolve the token's owner before checking the other factors
     * it demands, so a wrong password does not burn a single-use token.
     */
    async peekPinResetToken(rawToken: string): Promise<{ valid: boolean; userId?: string; reason?: string }> {
        if (!rawToken) return { valid: false, reason: "Token required" };
        const tokenHash = createHash("sha256").update(rawToken).digest("hex");

        const [resetToken] = await db
            .select()
            .from(pinResetTokens)
            .where(eq(pinResetTokens.tokenHash, tokenHash))
            .limit(1);

        if (!resetToken) return { valid: false, reason: "Invalid PIN reset token" };
        if (resetToken.used) return { valid: false, reason: "PIN reset token already used" };
        if (new Date() > resetToken.expiresAt) return { valid: false, reason: "PIN reset token expired" };

        return { valid: true, userId: resetToken.userId };
    },

    /**
     * Consume and validate a single-use PIN reset token.
     *
     * The `used` flip is conditional on the row still being unused, so two
     * concurrent redemptions cannot both succeed.
     */
    async consumePinResetToken(rawToken: string): Promise<{ valid: boolean; userId?: string; reason?: string }> {
        const peek = await this.peekPinResetToken(rawToken);
        if (!peek.valid) return peek;

        const tokenHash = createHash("sha256").update(rawToken).digest("hex");
        const claimed = await db
            .update(pinResetTokens)
            .set({ used: true })
            .where(and(eq(pinResetTokens.tokenHash, tokenHash), eq(pinResetTokens.used, false)))
            .returning({ userId: pinResetTokens.userId });

        if (claimed.length === 0) {
            return { valid: false, reason: "PIN reset token already used" };
        }

        return { valid: true, userId: claimed[0].userId };
    },

    /**
     * Retrieve user authentication credentials needed for PIN verification.
     */
    async getUserAuthCredentials(userId: string): Promise<{ id: string; username: string; password?: string | null; pin?: string | null } | null> {
        const [userRow] = await db
            .select({ id: users.id, username: users.username, password: users.password, pin: users.pin })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);
        return userRow ?? null;
    },

    /**
     * Look up user by username or email for PIN reset requests.
     */
    async findUserByIdentifier(identifier: string): Promise<{ id: string; username: string; email?: string | null; password?: string | null } | null> {
        const [userRow] = await db
            .select({ id: users.id, username: users.username, email: users.email, password: users.password })
            .from(users)
            .where(or(eq(users.username, identifier), eq(users.email, identifier)))
            .limit(1);
        return userRow ?? null;
    },

    /**
     * Update user's hashed security PIN.
     */
    async setUserPin(userId: string, pinHash: string): Promise<void> {
        await db.update(users).set({ pin: pinHash }).where(eq(users.id, userId));
    },
};
