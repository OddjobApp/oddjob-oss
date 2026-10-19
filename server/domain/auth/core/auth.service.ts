import { authEngine, userManager } from "../index.js";
import {
    isAccountLocked,
    recordFailedAttempt,
    clearFailedAttempts,
    sanitizeInput
} from "./security.service.js";
import { AppError, ErrorCode } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("AuthServiceFacade");

/**
 * Facade for Authentication Service.
 * Delegates to domain/auth for core logic.
 */
export const authService = {
    /**
     * Authenticate a user
     */
    async login(username: string, password: string, ip: string) {
        username = sanitizeInput(username || '').toLowerCase();
        const lockoutIdentifier = `${ip || 'unknown'}:${username}`;

        if (await isAccountLocked(lockoutIdentifier)) {
            throw new AppError("Account temporarily locked due to too many failed login attempts. Please try again later.", 423, ErrorCode.RATE_LIMITED);
        }

        try {
            const result = await authEngine.login(username, password);
            await clearFailedAttempts(lockoutIdentifier);
            return result;
        } catch (error: any) {
            await recordFailedAttempt(lockoutIdentifier);

            // Re-check lockout after record
            if (await isAccountLocked(lockoutIdentifier)) {
                throw new AppError("Account temporarily locked due to too many failed login attempts. Please try again later.", 423, ErrorCode.RATE_LIMITED);
            }
            throw error;
        }
    },

    /**
     * Register a new user
     */
    async register(input: any) {
        return authEngine.register(input);
    },

    /**
     * Get user details with admin roles
     */
    async getUser(userId: string | number) {
        return userManager.getUserWithRoles(userId);
    },

    /**
     * Request Password Reset
     */
    async requestPasswordReset(email: string) {
        return authEngine.requestPasswordReset(email);
    },

    /**
     * Reset Password
     */
    async resetPassword(token: string, newPassword: string) {
        return authEngine.resetPassword(token, newPassword);
    }
};


