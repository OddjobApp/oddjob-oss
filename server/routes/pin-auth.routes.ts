import { Router, type Request } from "express";
import { pinService } from "@domain/auth/core/pin-service.js";
import { requireAuth, authRateLimiter } from "@domain/auth/core/security.service.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("PinAuthRoutes");
const router = Router();

/**
 * The authenticated user, taken from the session and ONLY from the session.
 *
 * These handlers previously read `req.body.userId || req.session.userId`, with
 * the body winning. Because the router carried no auth middleware, any
 * unauthenticated caller could POST a userId of their choosing and overwrite
 * that account's PIN. A caller may never name the account they are acting on.
 */
function sessionUserId(req: Request): string | undefined {
    return (req.session as any)?.userId;
}

/**
 * POST /api/auth/pin/update
 * Sets or changes the security PIN for the *calling* user's account.
 *
 * Requires the account password: a PIN is a step-up credential, so a ride on an
 * existing session (XSS, a borrowed browser) must not be enough to replace it.
 */
router.post("/api/auth/pin/update", authRateLimiter, requireAuth, async (req, res) => {
    try {
        const userId = sessionUserId(req);
        const { pin, password } = req.body ?? {};

        if (!userId) {
            return res.status(401).json({ success: false, error: "Unauthorized: sign in first." });
        }
        if (!password) {
            return res.status(400).json({ success: false, error: "Account password is required to change your security PIN." });
        }

        const validation = pinService.validatePin(pin);
        if (!validation.valid) {
            return res.status(400).json({ success: false, error: validation.errors.join(", ") });
        }

        const userRow = await pinService.getUserAuthCredentials(userId);

        if (!userRow) {
            return res.status(404).json({ success: false, error: "User profile not found." });
        }

        const { passwordService } = await import("@domain/auth/core/password-service.js");
        const isPasswordValid = await passwordService.verifyPassword(password, userRow.password || "");
        if (!isPasswordValid) {
            logger.warn(`Rejected PIN update for user ${userId}: bad account password`);
            return res.status(401).json({ success: false, error: "Invalid account password." });
        }

        const pinHash = await pinService.hashPin(pin);

        await pinService.setUserPin(userId, pinHash);

        // A new PIN invalidates any consent the old one bought.
        if (req.session) {
            delete (req.session as any).accessConsent;
            delete (req.session as any).pinVerifiedAt;
        }
        pinService.clearFailedAttempts(userId);

        logger.info(`Updated PIN for user ${userId} (${userRow.username})`);
        return res.json({ success: true, message: "Security PIN updated successfully." });
    } catch (err: any) {
        logger.error("Failed to update PIN", err);
        return res.status(500).json({ success: false, error: "Internal server error" });
    }
});

/**
 * POST /api/auth/pin/verify
 * Verifies the calling user's PIN for step-up authorization.
 *
 * NOTE: the `accessConsent` flag written here is session state that nothing
 * currently reads — the Theory-of-Mind gate in tools/v1/capabilities/tom-tools.ts
 * reads consent from the user's DB row, not the session. It is kept (scoped to
 * the session user) so that wiring it up later is a deliberate act rather than
 * an accidental grant.
 */
router.post("/api/auth/pin/verify", authRateLimiter, requireAuth, async (req, res) => {
    try {
        const userId = sessionUserId(req);
        const { pin } = req.body ?? {};

        if (!userId) {
            return res.status(401).json({ success: false, error: "Unauthorized: sign in first." });
        }
        if (!pin) {
            return res.status(400).json({ success: false, error: "PIN is required." });
        }

        const lockout = pinService.getLockout(userId);
        if (lockout.lockedOut) {
            logger.warn(`PIN verification blocked for locked-out user ${userId}`);
            res.setHeader("Retry-After", String(lockout.retryAfterSeconds));
            return res.status(429).json({
                success: false,
                error: "Too many failed PIN attempts. Try again later.",
                retryAfterSeconds: lockout.retryAfterSeconds,
            });
        }

        const userRow = await pinService.getUserAuthCredentials(userId);

        if (!userRow || !userRow.pin) {
            return res.status(401).json({ success: false, error: "No security PIN configured for this account." });
        }

        const isValid = await pinService.verifyPin(pin, userRow.pin);
        if (!isValid) {
            const { lockedOut, attemptsRemaining } = pinService.registerFailedAttempt(userId);
            logger.warn(`Failed PIN verification attempt for user ${userId} (remaining: ${attemptsRemaining})`);
            return res.status(401).json({
                success: false,
                error: "Invalid security PIN.",
                ...(lockedOut ? { lockedOut: true } : { attemptsRemaining }),
            });
        }

        pinService.clearFailedAttempts(userId);

        // Session-scoped, and scoped to the session's own user.
        if (req.session) {
            (req.session as any).accessConsent = "granted";
            (req.session as any).pinVerifiedAt = new Date().toISOString();
        }

        logger.info(`PIN successfully verified for user ${userId} (${userRow.username})`);
        return res.json({ success: true, accessConsent: "granted", message: "PIN verified successfully." });
    } catch (err: any) {
        logger.error("Failed to verify PIN", err);
        return res.status(500).json({ success: false, error: "Internal server error" });
    }
});

/**
 * POST /api/auth/pin/request-reset
 * Initiates email recovery for a forgotten PIN. Unauthenticated by design —
 * the account password is the credential that authorises it.
 */
router.post("/api/auth/pin/request-reset", authRateLimiter, async (req, res) => {
    // Identical response on every path. Distinguishing "no such user" from
    // "wrong password" (as this handler used to) is a username oracle.
    const genericResponse = {
        success: true,
        message: "If those credentials are valid, a secure single-use PIN reset link has been sent to the account's email address.",
    };

    try {
        const { identifier, password } = req.body ?? {}; // email or username + password
        if (!identifier || !password) {
            return res.status(400).json({ success: false, error: "Username/email and account password are required." });
        }

        const { passwordService } = await import("@domain/auth/core/password-service.js");

        const userRow = await pinService.findUserByIdentifier(identifier);

        if (!userRow) {
            return res.json(genericResponse);
        }

        const isPasswordValid = await passwordService.verifyPassword(password, userRow.password || "");
        if (!isPasswordValid) {
            return res.json(genericResponse);
        }

        const { rawToken, expiresAt } = await pinService.createPinResetToken(userRow.id);

        logger.info(`PIN reset token generated for user ${userRow.username} (expires: ${expiresAt.toISOString()})`);

        // The raw token is a bearer credential and belongs in the dispatched
        // email, never in the HTTP response. Returned only outside production,
        // where there is no mail transport and E2E needs to complete the flow.
        const exposeToken = process.env.NODE_ENV !== "production";
        if (exposeToken) {
            return res.json({ ...genericResponse, resetToken: rawToken });
        }
        return res.json(genericResponse);
    } catch (err: any) {
        logger.error("Failed to request PIN reset", err);
        return res.status(500).json({ success: false, error: "Internal server error" });
    }
});

/**
 * POST /api/auth/pin/reset
 * Resets the PIN using a single-use recovery token plus the account password.
 */
router.post("/api/auth/pin/reset", authRateLimiter, async (req, res) => {
    try {
        const { token, password, newPin } = req.body ?? {};
        if (!token || !password || !newPin) {
            return res.status(400).json({ success: false, error: "Reset token, account password, and new PIN are required." });
        }

        const validation = pinService.validatePin(newPin);
        if (!validation.valid) {
            return res.status(400).json({ success: false, error: validation.errors.join(", ") });
        }

        // Peek before consuming. The old ordering burned the single-use token on
        // a wrong password, so one typo forced the whole recovery flow again.
        const peek = await pinService.peekPinResetToken(token);
        if (!peek.valid || !peek.userId) {
            return res.status(400).json({ success: false, error: peek.reason ?? "Invalid or expired token" });
        }

        const userRow = await pinService.getUserAuthCredentials(peek.userId);

        if (!userRow) {
            return res.status(404).json({ success: false, error: "User not found." });
        }

        const { passwordService } = await import("@domain/auth/core/password-service.js");
        const isPasswordValid = await passwordService.verifyPassword(password, userRow.password || "");
        if (!isPasswordValid) {
            return res.status(401).json({ success: false, error: "Invalid account password." });
        }

        const consumed = await pinService.consumePinResetToken(token);
        if (!consumed.valid || !consumed.userId) {
            // Lost a race against a concurrent redemption.
            return res.status(400).json({ success: false, error: consumed.reason ?? "Invalid or expired token" });
        }

        const pinHash = await pinService.hashPin(newPin);

        await pinService.setUserPin(consumed.userId, pinHash);
        pinService.clearFailedAttempts(consumed.userId);

        logger.info(`PIN successfully reset via email token for user ID ${consumed.userId}`);
        return res.json({ success: true, message: "Security PIN has been reset successfully." });
    } catch (err: any) {
        logger.error("Failed to reset PIN", err);
        return res.status(500).json({ success: false, error: "Internal server error" });
    }
});

export default router;
