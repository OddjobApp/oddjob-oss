import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import cors from 'cors';
import { randomBytes } from 'crypto';
import { passwordService } from "./password-service.js";
import { redis } from "@domain/core/infrastructure/redis/redis-client.js";

// Rate limiting configurations
export const authRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    message: 'UPDATED RATE LIMIT: Too many authentication attempts',
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
});

export const apiRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: process.env.NODE_ENV === 'production' ? 5000 : 100000,
    message: 'Too many requests, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: false,
});

export const seleniumRateLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 5,
    message: 'Too many Selenium automation requests, please wait.',
    standardHeaders: true,
    legacyHeaders: false,
});

// Authentication middleware
export async function populateUserContext(req: Request, res: Response, next: NextFunction) {
    const userId = (req.session as any)?.userId;

    if (userId && !(req as any).user) {
        try {
            const { userManager } = await import('./user-manager.js');
            const user = await userManager.getUserWithRoles(userId);
            (req as any).user = user;
        } catch (err) {
            console.error('[SECURITY] Failed to populate user context from session:', err);
        }
    }

    if (!(req as any).isAuthenticated) {
        (req as any).isAuthenticated = () => !!(req as any).user;
    }

    next();
}

// Whitelist of routes that should NOT require authentication
const PUBLIC_ROUTES = [
    '/api/login',
    '/api/auth/login',
    '/login',
    '/auth/login',
    '/api/register',
    '/api/csrf-token',
    '/api/auth/forgot-password',
    '/api/auth/reset-password',
    '/api/user', // GET returns unauthenticated user info
];

function isPublicAuthPath(req: Request): boolean {
    const path = req.path || "";
    const originalUrl = req.originalUrl || "";
    return (
        path === "/api/login" ||
        path === "/api/auth/login" ||
        path === "/login" ||
        path === "/auth/login" ||
        path === "/api/register" ||
        path === "/register" ||
        originalUrl.startsWith("/api/login") ||
        originalUrl.startsWith("/api/auth/login") ||
        originalUrl.startsWith("/api/register") ||
        originalUrl.startsWith("/api/csrf-token") ||
        originalUrl.startsWith("/api/auth/forgot-password") ||
        originalUrl.startsWith("/api/auth/reset-password")
    );
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
    // CRITICAL: /api/login must ALWAYS bypass auth - it's the entry point for authentication
    if (isPublicAuthPath(req)) {
        console.log(`[requireAuth] public auth path detected - BYPASSING AUTH (${req.method} ${req.originalUrl})`);
        return next();
    }

    if (req.method === 'POST' && req.path.includes('login')) {
        console.log(`[requireAuth] Login-related request: path=${req.path}, url=${req.originalUrl}`);
    }

    // Check if this is a public route that shouldn't require auth.
    //
    // Matched by whole path segment. A bare `startsWith('/api/user')` made every
    // GET under /api/users, /api/user/* and /api/user-anything public, which is
    // how GET /api/users served the platform's whole user directory, with
    // emails, to anonymous callers.
    const urlPath = (req.originalUrl || "").split("?")[0];
    const isPublicRoute = PUBLIC_ROUTES.some(route => {
        if (route === '/api/user') {
            // Only the exact path: it answers `{ authenticated: false }` itself.
            return req.method === 'GET' && urlPath === '/api/user';
        }
        return urlPath === route || urlPath.startsWith(route + '/');
    });

    if (isPublicRoute && !req.originalUrl.includes('admin')) {
        return next(); // Skip auth check for public routes
    }

    const internalToken = req.headers?.['x-internal-token'];
    const internalSecret = process.env.INTERNAL_API_SECRET || process.env.SESSION_SECRET;

    if (internalToken && internalToken === internalSecret) {
        if (!(req as any).user) {
            (req as any).user = {
                id: "1",
                username: "system",
                email: "admin@example.com",
                role: "super_admin",
                roles: ["super_admin"],
                adminRole: {
                    isSuperAdmin: true,
                    isOrgAdmin: true,
                    organizationId: req.query.orgId ? parseInt(req.query.orgId as string, 10) : undefined
                },
                defaultOrgId: req.query.orgId ? parseInt(req.query.orgId as string, 10) : undefined
            };
        }
        return next();
    }

    // API-key authenticated request (principal stashed by the global apiKeyAuth
    // middleware). Robust to req.user being cleared by session middleware.
    if ((req as any).apiKeyAuth) {
        return next();
    }

    const user = (req as any).user;

    if (!user) {
        console.warn(`[Auth] requireAuth DENIED: ${req.method} ${req.originalUrl} - No user context (SessionID: ${req.sessionID})`);
        return res.status(401).json({ message: 'Authentication required' });
    }

    console.log(`[Auth] requireAuth GRANTED: ${req.method} ${req.originalUrl} for userId: ${user.id} (SessionID: ${req.sessionID})`);
    next();
}

/**
 * Global API-key authentication. If an `x-api-key` header is present, verifies it
 * (non-revoked and non-expired) and stashes the org-scoped principal on the request
 * so requireAuth and getUserOrgContext treat it as an authenticated org-admin for that
 * org. No header → no-op (falls through to session auth). A present-but-invalid key
 * → 401 so callers get a clear signal instead of a confusing downstream failure.
 *
 * Note: an org API key acts as an org-admin *within its own org only* (never
 * super-admin). Issue keys deliberately and scope per org.
 */
export async function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
    const raw = req.headers['x-api-key'];
    const rawKey = Array.isArray(raw) ? raw[0] : raw;
    if (!rawKey) return next();

    try {
        const { apiKeyService } = await import("./api-key.service.js");
        const apiKey = await apiKeyService.verifyKey(rawKey);
        if (!apiKey || (apiKey.expiresAt && new Date(apiKey.expiresAt).getTime() < Date.now())) {
            return res.status(401).json({ message: 'Invalid or expired API key' });
        }

        (req as any).apiKeyAuth = apiKey;
        if (!(req as any).user) {
            (req as any).user = {
                id: `apikey:${apiKey.id}`,
                username: `apikey:${apiKey.name}`,
                role: "org_admin",
                roles: ["org_admin"],
                adminRole: { isSuperAdmin: false, isOrgAdmin: true, organizationId: apiKey.organizationId },
                defaultOrgId: apiKey.organizationId,
            };
        }
        return next();
    } catch (err: any) {
        console.error(`[apiKeyAuth] verification error: ${err.message}`);
        return res.status(401).json({ message: 'API key verification failed' });
    }
}

/**
 * Middleware to require a specific role for access.
 * Supports single role or multiple roles (OR condition).
 */
export function requireRole(role: string | string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    // 1. Ensure authenticated
    requireAuth(req, res, () => {
      const user = (req as any).user;
      
      if (!user || !user.roles) {
        return res.status(403).json({ 
          message: 'Access denied: insufficient permissions',
          error: 'NO_ROLES_FOUND'
        });
      }

      const userRoles = user.roles.map((r: any) => 
        typeof r === 'string' ? r : r.name
      );

      const rolesToMatch = Array.isArray(role) ? role : [role];
      const hasRole = rolesToMatch.some(r => userRoles.includes(r));

      if (!hasRole) {
        return res.status(403).json({ 
          message: `Access denied: requires ${Array.isArray(role) ? role.join(' or ') : role} role`,
          error: 'INSUFFICIENT_ROLE'
        });
      }

      next();
    });
  };
}

// Security headers middleware
export function setupSecurityHeaders(app: any) {
    const isProduction = process.env.NODE_ENV === 'production';

    app.use(helmet({
        contentSecurityPolicy: {
            directives: isProduction ? {
                defaultSrc: ["'self'"],
                // 'unsafe-inline' on styleSrc is required by the CSS-in-JS runtime;
                // scriptSrc deliberately keeps neither 'unsafe-inline' nor a wildcard.
                // Mapbox GL needs 'unsafe-eval' + worker-src blob: and nothing more.
                styleSrc: ["'self'", "https://fonts.googleapis.com", "'unsafe-inline'"],
                scriptSrc: ["'self'", "'unsafe-eval'", "blob:"],
                imgSrc: ["'self'", "data:", "https:", "blob:"],
                connectSrc: ["'self'", "https://api.mapbox.com", "https://*.tiles.mapbox.com", "https://events.mapbox.com", "https://nominatim.openstreetmap.org", "https://server.arcgisonline.com", "wss:"],
                fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
                objectSrc: ["'none'"],
                mediaSrc: ["'self'"],
                frameSrc: ["'self'"],
                workerSrc: ["'self'", "blob:"],
                childSrc: ["'self'", "blob:"],
                baseUri: ["'self'"],
                formAction: ["'self'"],
            } : {
                defaultSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
                scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "blob:"],
                imgSrc: ["'self'", "data:", "https:", "blob:"],
                connectSrc: ["'self'", "http://localhost:*", "ws://localhost:*", "wss://localhost:*", "http://127.0.0.1:*", "ws://127.0.0.1:*", "https://api.mapbox.com", "https://*.tiles.mapbox.com", "https://events.mapbox.com", "https://nominatim.openstreetmap.org", "https:"],
                fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
                objectSrc: ["'none'"],
                mediaSrc: ["'self'"],
                frameSrc: ["'self'", "http://localhost:5000"],
                workerSrc: ["'self'", "blob:"],
                childSrc: ["'self'", "blob:"],
            },
        },
        crossOriginEmbedderPolicy: false,
        hsts: isProduction ? {
            maxAge: 31536000,
            includeSubDomains: true,
            preload: true,
        } : false,
    }));

    const allowedOriginsEnv = process.env.ALLOWED_ORIGINS?.split(',').map(o => o.trim()) || [];

    app.use(cors({
        origin: (origin, callback) => {
            // Allow requests with no origin (server-to-server, mobile apps, curl)
            if (!origin) return callback(null, true);

            const localhostOrigins = [
                'http://localhost:5000',
                'http://localhost:5173',
                'http://127.0.0.1:5000',
                'http://127.0.0.1:5173',
            ];

            const isLocalhost = localhostOrigins.includes(origin);
            const isTrycloudflare = /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(origin);
            const isAllowedOrigin = allowedOriginsEnv.includes(origin);

            if (isLocalhost || isTrycloudflare || isAllowedOrigin) {
                return callback(null, true);
            }

            // In production, reject unlisted origins
            if (process.env.NODE_ENV === 'production') {
                return callback(new Error(`CORS: origin '${origin}' not allowed`));
            }

            // In development, allow all origins with a warning
            console.warn(`[CORS] Permitting unlisted dev origin: ${origin}`);
            return callback(null, true);
        },
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'x-csrf-token', 'x-organization-id'],
    }));

    app.use((req: Request, res: Response, next: NextFunction) => {
        // Same-origin framing, for the two pages Oddjob embeds in its own UI.
        // The desktop viewer is noVNC, shown inside Computer Use Studio; under DENY
        // the studio's frame failed to load while the same URL opened fine in a tab.
        // CSP still pins frame-ancestors to 'self', so nobody else can embed either.
        const framedByOddjob = req.path.startsWith('/database-designer')
            || req.path.startsWith('/api/integrations/trycua/desktop/viewer');
        if (framedByOddjob) {
            res.setHeader('X-Frame-Options', 'SAMEORIGIN');
        } else {
            res.setHeader('X-Frame-Options', 'DENY');
        }
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-XSS-Protection', '1; mode=block');
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        // geolocation=(self): the LocationPicker's "Locate Me" button calls
        // navigator.geolocation. With an empty allowlist the browser refuses it
        // outright ("disabled in this document by permissions policy") before
        // the user is ever prompted, so the button could only ever fail.
        res.setHeader('Permissions-Policy', 'geolocation=(self), microphone=(), camera=()');
        next();
    });
}

export function validatePassword(password: string): { valid: boolean; errors: string[] } {
    return passwordService.validatePassword(password);
}

export function sanitizeInput(input: string): string {
    if (typeof input !== 'string') return '';
    return input.replace(/\0/g, '').trim().substring(0, 10000);
}

// Account lockout tracking (Redis backed with local Map fallback)
const accountLockouts = new Map<string, { attempts: number; lockedUntil: number }>();

export async function isAccountLocked(identifier: string): Promise<boolean> {
    const keyLocked = `lockout:locked:${identifier}`;
    try {
        if (redis && redis.status === "ready") {
            const isLocked = await redis.get(keyLocked);
            if (isLocked === "1") return true;
        }
    } catch (err) {
        console.warn('[SECURITY] Redis lockout check error, falling back to local memory:', err);
    }

    const lockout = accountLockouts.get(identifier);
    if (!lockout) return false;
    if (Date.now() < lockout.lockedUntil) return true;
    accountLockouts.delete(identifier);
    return false;
}

export async function recordFailedAttempt(identifier: string): Promise<void> {
    const keyAttempts = `lockout:attempts:${identifier}`;
    const keyLocked = `lockout:locked:${identifier}`;
    const LOCKOUT_DURATION_SEC = 15 * 60; // 15 minutes

    try {
        if (redis && redis.status === "ready") {
            const attempts = await redis.incr(keyAttempts);
            if (attempts === 1) {
                await redis.expire(keyAttempts, LOCKOUT_DURATION_SEC);
            }
            if (attempts >= 5) {
                await redis.set(keyLocked, "1", "EX", LOCKOUT_DURATION_SEC);
            }
        }
    } catch (err) {
        console.warn('[SECURITY] Redis recordFailedAttempt error, falling back to local memory:', err);
    }

    const lockout = accountLockouts.get(identifier) || { attempts: 0, lockedUntil: 0 };
    lockout.attempts += 1;
    if (lockout.attempts >= 5) {
        lockout.lockedUntil = Date.now() + LOCKOUT_DURATION_SEC * 1000;
    }
    accountLockouts.set(identifier, lockout);
}

export async function clearFailedAttempts(identifier: string): Promise<void> {
    const keyAttempts = `lockout:attempts:${identifier}`;
    const keyLocked = `lockout:locked:${identifier}`;
    try {
        if (redis && redis.status === "ready") {
            await redis.del(keyAttempts, keyLocked);
        }
    } catch (err) {
        console.warn('[SECURITY] Redis clearFailedAttempts error:', err);
    }
    accountLockouts.delete(identifier);
}

export function generateCsrfToken(): string {
    return randomBytes(32).toString('hex');
}

export function validateCsrfToken(req: Request, token: string): boolean {
    const sessionToken = (req.session as any)?.csrfToken;
    if (!sessionToken) return false;
    return sessionToken === token;
}

export function csrfProtection(req: Request, res: Response, next: NextFunction) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const internalToken = req.headers?.['x-internal-token'];
    const internalSecret = process.env.INTERNAL_API_SECRET || process.env.SESSION_SECRET;
    if (internalToken && internalToken === internalSecret) {
        return next();
    }
    if (!req.session) return res.status(500).json({ message: 'Session not available' });
    if (!(req.session as any)?.csrfToken) (req.session as any).csrfToken = generateCsrfToken();
    const token = req.headers['x-csrf-token'] as string || req.body?._csrf;
    if (!token || !validateCsrfToken(req, token)) return res.status(403).json({ message: 'Invalid CSRF token' });
    next();
}

/**
 * Validates input against a simple schema object.
 * @deprecated Consider using Zod schemas for complex validation.
 */
export function validateInput(input: any, schema: { required?: boolean; type?: 'string' | 'number' | 'boolean'; minLength?: number; maxLength?: number; pattern?: RegExp; enum?: any[] }): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    if (schema.required && (input === undefined || input === null || input === '')) {
        errors.push('Field is required');
        return { valid: false, errors };
    }
    if (input === undefined || input === null) {
        return { valid: errors.length === 0, errors };
    }
    
    const inputType = typeof input;
    if (schema.type && inputType !== schema.type) {
        errors.push(`Expected type ${schema.type}, got ${inputType}`);
    }

    if (inputType === 'string') {
        const str = input as string;
        if (schema.minLength != null && str.length < schema.minLength) {
            errors.push(`Minimum length is ${schema.minLength}`);
        }
        if (schema.maxLength != null && str.length > schema.maxLength) {
            errors.push(`Maximum length is ${schema.maxLength}`);
        }
        if (schema.pattern && !schema.pattern.test(str)) {
            errors.push('Invalid format');
        }
        if (schema.enum && !schema.enum.includes(str)) {
            errors.push(`Must be one of: ${schema.enum.join(', ')}`);
        }
    }
    return { valid: errors.length === 0, errors };
}

export function validateUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        return ['http:', 'https:'].includes(parsed.protocol);
    } catch (e) {
        return false;
    }
}


