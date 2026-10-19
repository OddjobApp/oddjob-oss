import { Request } from "express";
import { logSecurityEvent } from "../../../utils/security-logger.js";

/**
 * Hooks for security-related auditing and tracking.
 */
export const securityHooks = {
    /**
     * Triggered on successful login.
     */
    async onLoginSuccess(req: Request, user: any) {
        await logSecurityEvent(req, 'AUTH_SUCCESS', {
            userId: user.id,
            username: user.username
        });
    },

    /**
     * Triggered on logout.
     */
    async onLogout(req: Request, userId: string) {
        await logSecurityEvent(req, 'AUTH_LOGOUT', {
            userId,
            success: true
        });
    },

    /**
     * Triggered on password reset success.
     */
    async onPasswordResetSuccess(req: Request, userId: string) {
        await logSecurityEvent(req, 'AUTH_SUCCESS', {
            reason: 'Password Reset',
            userId
        });
    }
};


