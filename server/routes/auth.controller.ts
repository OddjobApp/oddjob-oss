import { type Request, type Response } from "express";
import { randomBytes } from "crypto";
import { authEngine, securityHooks, notifyHooks } from "../domain/auth/index.js";
import {
    authRateLimiter,
    requireAuth,
    generateCsrfToken
} from "../domain/auth/core/security.service.js";
import { logSecurityEvent } from "../utils/security-logger.js";
import { authService } from "../domain/auth/core/auth.service.js";
import { userManager } from "../domain/auth/index.js";
import { organizationInviteService } from "../domain/org/core/organization-invite.service.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { BadRequestError, AppError, ErrorCode, UnauthorizedError, NotFoundError } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";
import { assertOrgId } from "@server/utils/auth-context.js";

const logger = createLogger("AuthController");

export class AuthController {
    public static async login(req: Request, res: Response) {
        // Accept either username or email field for login (backend supports both)
        const { username, email, password } = req.body || {};
        const loginIdentifier = username || email;
        const ip = req.ip || req.socket.remoteAddress || 'unknown';

        logger.info("Login request received", {
            correlationId: req.correlationId,
            path: req.path,
            method: req.method,
            ip,
        });

        if (!loginIdentifier || !password) {
            throw new BadRequestError("Username (or email) and password are required");
        }

        try {
            const result = await authEngine.login(loginIdentifier, password);
            await securityHooks.onLoginSuccess(req, result.user);
            logger.info(`[Login] authEngine.login successful for user: ${result.user.username}`);

            if (!req.session) {
                logger.error("[Login] Session not available", new Error("Session uninitialized"), { correlationId: req.correlationId });
                throw new AppError("Session not available", 500, ErrorCode.INTERNAL_ERROR);
            }

            // Fetch full user details with roles to get the organization context
            const userWithRole = await userManager.getUserWithRoles(result.user.id);
            const defaultOrgId = userWithRole.defaultOrgId ?? userWithRole.adminRole?.organizationId ?? null;
            const isSuperAdmin = userWithRole.adminRole?.isSuperAdmin === true;

            (req.session as any).userId = result.user.id;
            (req.session as any).username = result.user.username;
            (req.session as any).defaultOrgId = defaultOrgId;
            (req.session as any).organizationId = defaultOrgId;
            (req.session as any).isSuperAdmin = isSuperAdmin;
            (req.session as any).csrfToken = randomBytes(32).toString('hex');

            logger.debug("Login session populated", {
                correlationId: req.correlationId,
                userId: result.user.id,
                organizationId: defaultOrgId,
                isSuperAdmin,
            });

            await new Promise<void>((resolve, reject) => {
            req.session.save((err) => {
                if (err) {
                    logger.error("[Login] Failed to save session:", err);
                    reject(err);
                } else {
                    logger.debug("Login session saved", { correlationId: req.correlationId });
                    resolve();
                }
            });
        });

        try {
            logger.info(`[Login] Login successful for user: ${result.user.username} | userId: ${result.user.id} | isAdmin: ${!!userWithRole.adminRole}`);
            logSecurityEvent(req, 'AUTH_SUCCESS', { userId: result.user.id, username: result.user.username });
            res.json(userWithRole);
        } catch (error: any) {
            logger.error("[Login] Failed to fetch user with role after success:", error);
            res.json(result.user);
        }
    } catch (authError: any) {
        logger.error("Login failed", authError, {
            correlationId: req.correlationId,
            status: authError.status,
        });
        throw authError;
    }
    }

    public static async getUser(req: Request, res: Response) {
        const userId = (req.session as any)?.userId;
        if (!userId) {
            logger.info('[User] No userId in session');
            // Issue a CSRF token even for unauthenticated sessions so that pre-auth
            // routes (register, etc.) can include it in state-changing requests.
            if (!(req.session as any).csrfToken) {
                (req.session as any).csrfToken = generateCsrfToken();
                req.session.save(() => {});
            }
            return res.status(200).json({
                authenticated: false,
                message: "Not authenticated",
                csrfToken: (req.session as any).csrfToken,
            });
        }

        let user;
        try {
            user = await authService.getUser(userId);
        } catch (err: any) {
            if (err instanceof NotFoundError || err.message?.includes("not found")) {
                req.session?.destroy(() => { });
                logger.info('[User] No user found for userId in session');
                return res.status(200).json({ authenticated: false, message: "Session expired" });
            }
            throw err;
        }

        if (!(req.session as any)?.csrfToken) {
            (req.session as any).csrfToken = generateCsrfToken();
        }

        logger.debug("Returning authenticated user", {
            correlationId: req.correlationId,
            userId,
        });
        res.json({
            ...user,
            authenticated: true,
            csrfToken: (req.session as any).csrfToken,
        });
    }

    public static async getCsrfToken(req: Request, res: Response) {
        if (!req.session) {
            return res.status(500).json({ message: 'Session not available' });
        }
        // Issue a CSRF token to any session — authenticated or not.
        // Unauthenticated sessions need this to CSRF-protect pre-auth endpoints (e.g. register).
        if (!(req.session as any).csrfToken) {
            (req.session as any).csrfToken = generateCsrfToken();
            req.session.save(() => {});
        }
        const isAuthenticated = !!(req.session as any).userId;
        res.json({
            csrfToken: (req.session as any).csrfToken,
            authenticated: isAuthenticated,
        });
    }

    public static async getCurrentUser(req: Request, res: Response) {
        const userId = (req.session as any)?.userId;
        let user;
        try {
            user = await authService.getUser(userId);
        } catch (err: any) {
            if (err instanceof NotFoundError || err.message?.includes("not found")) {
                req.session?.destroy(() => { });
                throw new UnauthorizedError("Session expired - please login again");
            }
            throw err;
        }
        const { adminRole, ...basicUser } = user;
        res.json(basicUser);
    }

    public static async logout(req: Request, res: Response) {
        const userId = (req.session as any)?.userId;
        req.session?.destroy(async (err) => {
            if (err) logger.error("[Logout] Failed to destroy session:", err);
            await securityHooks.onLogout(req, userId);
            res.json({ message: "Logged out successfully" });
        });
    }

    public static async register(req: Request, res: Response) {
        const user = await authService.register(req.body);
        if (!req.session) throw new AppError("Session not available", 500, ErrorCode.INTERNAL_ERROR);

        (req.session as any).userId = user.id;
        (req.session as any).username = user.username;
        (req.session as any).organizationId = (user as any).defaultOrgId;
        // Rotate the CSRF token on privilege escalation (unauthenticated → authenticated)
        (req.session as any).csrfToken = randomBytes(32).toString('hex');

        await new Promise<void>((resolve, reject) => {
            req.session.save((err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        res.json({ ...user, authenticated: true, csrfToken: (req.session as any).csrfToken });
    }

    public static async acceptInvite(req: Request, res: Response) {
        const user = await organizationInviteService.acceptInvite(req.body);
        if (!req.session) throw new AppError("Session not available", 500, ErrorCode.INTERNAL_ERROR);

        (req.session as any).userId = user.id;
        (req.session as any).username = user.username;
        (req.session as any).organizationId = user.defaultOrgId;
        (req.session as any).csrfToken = randomBytes(32).toString('hex');

        await new Promise<void>((resolve, reject) => {
            req.session.save((err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        res.status(201).json({ ...user, authenticated: true, csrfToken: (req.session as any).csrfToken });
    }

    public static async forgotPassword(req: Request, res: Response) {
        const { email } = req.body;
        const result = await authEngine.requestPasswordReset(email);
        if (result) await notifyHooks.sendPasswordResetEmail(result.email!, result.token);
        res.json({ message: "If an account exists with that email, we have sent password reset instructions." });
    }

    public static async resetPassword(req: Request, res: Response) {
        const { token, newPassword } = req.body;
        const result = await authService.resetPassword(token, newPassword);
        await securityHooks.onPasswordResetSuccess(req, (result as any).userId);
        res.json({ message: "Password has been successfully reset" });
    }
}
