import express, { type Express } from "express";
import { randomBytes } from "node:crypto";
import compression from "compression";
import { shouldCompress } from "./compression-filter.js";
import session from "express-session";
import pgSession from "connect-pg-simple";
import { setupSecurityHeaders, populateUserContext, apiRateLimiter } from "@domain/core/auth/security.service.js";
import { sessionIdleTimeout } from "./session-idle-timeout.js";
import { setupHardening } from "./hardening.js";
import { setupMetrics } from "../domain/core/infrastructure/metrics.service.js";
import { setupErrorBoundary } from "./error-boundary.js";
import { previewProxy } from "./preview-proxy.js";
import { createLogger } from "../utils/logger.js";
import { resolveOrganization } from "./tenant.js";
import { asyncHandler } from "./error-handler.js";
import { tracingMiddleware } from "./tracing.js";
import { withAiOrganization } from "@domain/ai/core/ai-org-context.js";
import { getUserOrgContext } from "../utils/auth-context.js";

import { pool } from "../database_service.js";

/**
 * Development-only session secret. Random per process: it keeps `npm run dev`
 * working without a .env entry, while guaranteeing the value is not a constant
 * that anyone reading this repository knows. Production never reaches this —
 * assertEnvironment() fails the boot first.
 */
function developmentOnlySessionSecret(): string {
    if (process.env.NODE_ENV === "production") {
        throw new Error("SESSION_SECRET must be set in production.");
    }
    return randomBytes(32).toString("hex");
}

const PostgresStore = pgSession(session);
const logger = createLogger("MiddlewareRegistry");

export { requireOrgAdminOrSuper, requireSuperAdmin } from "../utils/auth-context.js";
export { requireAuth } from "@domain/core/auth/security.service.js";
export { asyncHandler };

export function setupMiddleware(app: Express): void {
    logger.info("Configuring global middleware...");

    // 1. Error Boundary (Must be first)
    setupErrorBoundary();

    // 1.5 Distributed Tracing
    app.use(tracingMiddleware("oddjob-api"));

    // 2. Compression (before body parsing so large responses are gzip'd)
    app.use(compression({
        filter: shouldCompress,
        threshold: 1024,
        level: 6,
        chunkSize: 16 * 1024,
    }));

    // 3a. Proxies & Security
    app.set('trust proxy', 1);
    setupSecurityHeaders(app);

    // 3b. Session and request context. Keep this before the preview proxy so
    // /app/* access checks can see authenticated users, but keep body parsing
    // after the proxy so forwarded app POST bodies remain streamable.
    const sessionMiddleware = session({
        store: new PostgresStore({
            pool,
            tableName: "session",
            createTableIfMissing: false,
            pruneSessionInterval: 60,
        }),
        // No literal fallback. A committed constant here signs every session
        // cookie, and server/utils/auth-context.ts accepts the same value as
        // INTERNAL_API_SECRET — which lets a caller name any organizationId.
        // In production server/config/env.ts refuses to boot without this; the
        // dev fallback is generated per-process, so it is never a shared secret
        // (it does mean sessions do not survive a dev restart, which is the
        // correct trade).
        secret: process.env.SESSION_SECRET || developmentOnlySessionSecret(),
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: process.env.NODE_ENV === "production",
            maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
            sameSite: 'lax',
        },
        name: 'oddjob.sid'
    });

    /**
     * Connection-level failures — the socket died, not the query.
     *
     * These are the ones worth a second attempt: the pool discards the client
     * that errored, so a retry is served by a fresh connection. A query that is
     * genuinely wrong fails the same way twice and must not be retried.
     */
    const RETRYABLE_DB_ERROR_CODES = new Set([
        "ECONNRESET",
        "EPIPE",
        "ETIMEDOUT",
        "ENOTFOUND",
        "ECONNREFUSED",
        "57P01", // admin_shutdown — Postgres terminated the backend
    ]);

    const isRetryableDbError = (err: unknown): boolean => {
        if (!err) return false;
        const code = (err as { code?: string }).code;
        const msg = String((err as { message?: string }).message || "");
        if (
            msg.includes("Connection terminated unexpectedly") ||
            msg.includes("ECONNRESET") ||
            msg.includes("connection closed") ||
            msg.includes("terminating connection")
        ) {
            return true;
        }
        return typeof code === "string" && RETRYABLE_DB_ERROR_CODES.has(code);
    };

    app.use((req, res, next) => {
        const p = req.path;
        // Static assets skip the session lookup. /api/ routes never do, even when the path
        // ends in .js: the desktop viewer serves noVNC's files from behind requireAuth, and
        // without a session every one of them was refused.
        if (p.startsWith("/@") || p.startsWith("/src/") || p.startsWith("/node_modules/") || (!p.startsWith("/api/") && p.match(/\.(js|css|map|svg|png|jpg|ico|woff2?|ttf)$/i))) {
            return next();
        }

        /*
          The session store shares the main pg pool, so it sits in front of every
          route — including the HTML ones. A dead pooled socket previously propagated
          errors as 500s. We retry once on a fresh connection; if that fails or on any
          session store connection drop, we log a warning and proceed with a fresh session.
        */
        sessionMiddleware(req, res, (err?: unknown) => {
            if (!err) return next();

            // A non-connection error is a real failure and is reported as one.
            if (!isRetryableDbError(err)) return next(err as never);

            const errMessage = (err as { message?: string })?.message || String(err);
            logger.warn(
                `Session store connection error on ${req.method} ${p} (${errMessage}); retrying on a fresh connection`,
            );

            sessionMiddleware(req, res, (secondErr?: unknown) => {
                /*
                  If the retry also fails, surface it.

                  It is tempting to degrade instead — assign `req.session = {}`
                  and carry on so pages still render. That does more harm than a
                  500: a bare object is not an express-session Session, so it has
                  no save/regenerate/destroy, and the first thing that touches
                  them is the login flow. The user would get a page that loads and
                  a sign-in that silently never persists, which is far harder to
                  diagnose than an outage that says so.
                */
                if (secondErr) return next(secondErr as never);
                next();
            });
        });
    });

    // Must sit between the session middleware and populateUserContext: it
    // expires the session BEFORE req.user is derived from it, so an expired
    // request proceeds as unauthenticated rather than as its old user.
    app.use(sessionIdleTimeout);

    app.use(asyncHandler(populateUserContext));
    app.use(resolveOrganization);
    app.use(previewProxy);

    // 4. Body Parsing
    const captureRawBody = (req: any, res: any, buf: Buffer) => {
        req.rawBody = buf;
    };
    app.use(express.json({ limit: '50mb', verify: captureRawBody }));
    app.use(express.urlencoded({ extended: false, limit: '50mb', verify: captureRawBody }));
    app.use(resolveOrganization);
    app.use((req, _res, next) => withAiOrganization(
        async () => (await getUserOrgContext(req)).organizationId, next,
    ));

    // 5. Hardening & Metrics
    setupHardening(app);
    setupMetrics(app);

    /*
      5b. API rate limiting.

      `apiRateLimiter` has existed in security.service.ts since rate limiting was
      added, but it was never mounted on anything — only `authRateLimiter` was,
      on the login and password-reset routes. Every other endpoint was unlimited.

      Mounted on /api only, so the preview proxy (/app/*) and the Vite dev assets
      are untouched. Two exemptions:

        - internal RPC, which is pod-to-pod traffic authenticated by a shared key
          and bursts far above any human rate,
        - the health endpoints, which orchestrators poll on a fixed interval and
          which must not start failing because the rest of the API is busy.

      The limit itself is deliberately generous (5000 / 15 min in production);
      this is a backstop against runaway clients, not a quota.
    */
    app.use("/api", (req, res, next) => {
        if (req.headers["x-internal-rpc-key"]) return next();
        if (req.path === "/health" || req.path.startsWith("/health/")) return next();
        return apiRateLimiter(req, res, next);
    });

    // 6. Security Guards
    if (process.env.NODE_ENV === 'production') {
        validateProductionSecrets();
    }

    // 7. Development Overrides
    if (process.env.NODE_ENV === "development") {
        setupDevelopmentCspOverride(app);
    }
}

function validateProductionSecrets(): void {
    const insecureDefaults: Record<string, string> = {
        SESSION_SECRET: "oddjob-secret-v3",
        INTERNAL_RPC_KEY: "oddjob-internal-secret",
        JWT_SECRET: "dev-secret-key-change-in-production",
    };
    for (const [key, insecureDefault] of Object.entries(insecureDefaults)) {
        const val = process.env[key];
        if (!val || val === insecureDefault) {
            throw new Error(`[Security] ${key} must be set to a secure value in production.`);
        }
    }
}

function setupDevelopmentCspOverride(app: Express): void {
    app.use((req, res, next) => {
        const originalSetHeader = res.setHeader.bind(res);
        const originalWriteHead = res.writeHead.bind(res);
        
        res.setHeader = (name: string, value: any) => {
            if (name.toLowerCase() === 'content-security-policy') {
                let csp = String(value);
                if (csp.includes("frame-src 'none'")) {
                    csp = csp.replace(/frame-src\s+'none'/, "frame-src 'self' http://localhost:5000");
                }
                return originalSetHeader(name, csp);
            }
            return originalSetHeader(name, value);
        };
        
        res.writeHead = (statusCode: number, headers?: any) => {
            if (headers && headers['content-security-policy']) {
                let csp = String(headers['content-security-policy']);
                if (csp.includes("frame-src 'none'")) {
                    headers['content-security-policy'] = csp.replace(/frame-src\s+'none'/, "frame-src 'self' http://localhost:5000");
                }
            }
            return originalWriteHead(statusCode, headers);
        };
        
        next();
    });
}
