/**
 * Auth Service Routes
 * 
 * Handles all authentication endpoints:
 * - POST /login
 * - POST /logout
 * - POST /register
 * - GET /user
 * - GET /csrf-token
 * - POST /forgot-password
 * - POST /reset-password
 */

import type { Express, Request, Response } from "express";
import { randomBytes, createHash } from "crypto";
import { eq, or } from "drizzle-orm";

import { db, schema } from "@oddjob/shared-db";
import { asyncHandler, requireAuth, BadRequestError, UnauthorizedError, NotFoundError, ConflictError, AppError } from "./middleware";
import { hashPassword, verifyPassword, validatePassword, sanitizeInput, generateCsrfToken } from "./utils";

const { users, adminRoles, passwordResetTokens } = schema;

// Rate limiting state (in-memory, use Redis in production cluster)
const failedAttempts = new Map<string, { count: number; lastAttempt: number }>();
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes

function isAccountLocked(identifier: string): boolean {
    const attempts = failedAttempts.get(identifier);
    if (!attempts) return false;
    if (Date.now() - attempts.lastAttempt > LOCKOUT_DURATION) {
        failedAttempts.delete(identifier);
        return false;
    }
    return attempts.count >= LOCKOUT_THRESHOLD;
}

function recordFailedAttempt(identifier: string): void {
    const attempts = failedAttempts.get(identifier) || { count: 0, lastAttempt: 0 };
    attempts.count++;
    attempts.lastAttempt = Date.now();
    failedAttempts.set(identifier, attempts);
}

function clearFailedAttempts(identifier: string): void {
    failedAttempts.delete(identifier);
}

export function registerAuthRoutes(app: Express): void {

    // Login
    app.post("/login", asyncHandler(async (req: Request, res: Response) => {
        let { username, password } = req.body;

        username = sanitizeInput(username || "").toLowerCase();

        if (!username || !password) {
            throw new BadRequestError("Username and password are required");
        }

        const lockoutId = `${req.ip || "unknown"}:${username}`;
        if (isAccountLocked(lockoutId)) {
            throw new AppError("Account temporarily locked. Please try again later.", 423, "ACCOUNT_LOCKED");
        }

        const [user] = await db
            .select()
            .from(users)
            .where(or(eq(users.username, username), eq(users.email, username)))
            .limit(1);

        if (!user) {
            recordFailedAttempt(lockoutId);
            throw new UnauthorizedError("Invalid credentials");
        }

        const isValid = await verifyPassword(password, user.password);
        if (!isValid) {
            recordFailedAttempt(lockoutId);
            throw new UnauthorizedError("Invalid credentials");
        }

        clearFailedAttempts(lockoutId);

        // Set session
        (req.session as any).userId = user.id;
        (req.session as any).username = user.username;
        (req.session as any).csrfToken = randomBytes(32).toString("hex");

        const { password: _, ...userWithoutPassword } = user;
        res.json(userWithoutPassword);
    }));

    // Get current user
    app.get("/user", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const userId = String((req.session as any).userId);

        const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
        if (!user) {
            throw new NotFoundError("User not found");
        }

        const { password: _, ...userWithoutPassword } = user;

        // Get admin role
        let adminRole = null;
        try {
            const [role] = await db.select().from(adminRoles).where(eq(adminRoles.userId, userId)).limit(1);
            adminRole = role;
        } catch { /* ignore */ }

        const adminRoleResponse = adminRole ? {
            isSuperAdmin: adminRole.role === "super_admin",
            isOrgAdmin: adminRole.role === "org_admin",
            organizationId: adminRole.organizationId,
        } : {
            isSuperAdmin: false,
            isOrgAdmin: false,
            organizationId: null,
        };

        // Generate CSRF if missing
        if (!(req.session as any).csrfToken) {
            (req.session as any).csrfToken = generateCsrfToken();
        }

        res.json({
            ...userWithoutPassword,
            csrfToken: (req.session as any).csrfToken,
            adminRole: adminRoleResponse,
        });
    }));

    // Get CSRF token
    app.get("/csrf-token", requireAuth, (req: Request, res: Response) => {
        if (!(req.session as any).csrfToken) {
            (req.session as any).csrfToken = generateCsrfToken();
        }
        res.json({ csrfToken: (req.session as any).csrfToken });
    });

    // Logout
    app.post("/logout", requireAuth, (req: Request, res: Response) => {
        req.session?.destroy((err) => {
            if (err) {
                return res.status(500).json({ message: "Failed to logout" });
            }
            res.json({ message: "Logged out successfully" });
        });
    });

    // Register
    app.post("/register", asyncHandler(async (req: Request, res: Response) => {
        let { username, password, email, firstName, lastName } = req.body;

        username = sanitizeInput(username || "");
        email = email ? sanitizeInput(email) : undefined;
        firstName = firstName ? sanitizeInput(firstName) : undefined;
        lastName = lastName ? sanitizeInput(lastName) : undefined;

        if (!username || !password) {
            throw new BadRequestError("Username and password are required");
        }

        const passwordValidation = validatePassword(password);
        if (!passwordValidation.valid) {
            throw new BadRequestError("Password does not meet requirements");
        }

        const [existing] = await db
            .select()
            .from(users)
            .where(or(eq(users.username, username), eq(users.email, email || "")))
            .limit(1);

        if (existing) {
            throw new ConflictError("Username or email already exists");
        }

        const hashedPassword = await hashPassword(password);

        const [newUser] = await db
            .insert(users)
            .values({ username, password: hashedPassword, email, firstName, lastName })
            .returning();

        (req.session as any).userId = newUser.id;
        (req.session as any).username = newUser.username;

        const { password: _, ...userWithoutPassword } = newUser;
        res.json(userWithoutPassword);
    }));

    // Forgot password
    app.post("/forgot-password", asyncHandler(async (req: Request, res: Response) => {
        let { email } = req.body;

        if (!email) {
            throw new BadRequestError("Email is required");
        }

        email = email.toLowerCase().trim();

        const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

        if (user) {
            const rawToken = randomBytes(32).toString("hex");
            const tokenHash = createHash("sha256").update(rawToken).digest("hex");
            const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

            await db.insert(passwordResetTokens).values({
                userId: user.id,
                tokenHash,
                expiresAt,
            });

            // TODO: Send email with reset link using rawToken. Never log password reset tokens.
            if (process.env.NODE_ENV !== "production") {
                console.log(`[auth-service] Password reset token generated for ${email}`);
            }
        }

        // Always return success to prevent enumeration
        res.json({ message: "If an account exists, we have sent password reset instructions." });
    }));

    // Reset password
    app.post("/reset-password", asyncHandler(async (req: Request, res: Response) => {
        const { token, newPassword } = req.body;

        if (!token || !newPassword) {
            throw new BadRequestError("Token and new password are required");
        }

        const passwordValidation = validatePassword(newPassword);
        if (!passwordValidation.valid) {
            throw new BadRequestError("Password does not meet requirements");
        }

        const tokenHash = createHash("sha256").update(token).digest("hex");

        const [resetToken] = await db
            .select()
            .from(passwordResetTokens)
            .where(eq(passwordResetTokens.tokenHash, tokenHash))
            .limit(1);

        if (!resetToken || resetToken.used || new Date() > resetToken.expiresAt) {
            throw new BadRequestError("Invalid or expired token");
        }

        const hashedPassword = await hashPassword(newPassword);

        await db.update(users).set({ password: hashedPassword }).where(eq(users.id, resetToken.userId));
        await db.update(passwordResetTokens).set({ used: true }).where(eq(passwordResetTokens.id, resetToken.id));

        res.json({ message: "Password has been successfully reset" });
    }));
}
