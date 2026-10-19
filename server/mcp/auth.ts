/**
 * MCP HTTP Authentication Middleware
 * 
 * Production-ready authentication with:
 * 1. Application-level kill switch (env var)
 * 2. Bearer token (API key) validation
 * 3. Organization-level toggle check
 * 4. Per-tool permission checks
 * 
 * All permissions default to OFF until explicitly enabled.
 */

import { Request, Response, NextFunction } from "express";
import { createHash } from "crypto";
import { db } from "@server/database_service.js";
import { mcpApiTokens, orgSettings, hasToolPermission, McpPermission, jobs } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";

// ============================================================================
// TYPES
// ============================================================================

export interface McpAuthorizationState {
    tokenId: number;
    userId: string;
    organizationId: number;
    permissions: McpPermission[];
    tokenName: string;
    resourceScoping?: Record<string, string[]>;
    allowedTopicIds?: number[];
    allowedDatasetIds?: number[];
    allowedPipelineIds?: string[];
}

// Extend Express Request to include auth context
declare global {
    namespace Express {
        interface Request {
            mcpAuth?: McpAuthorizationState;
        }
    }
}

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Check if MCP HTTP is globally enabled (application-level gate)
 */
export function isMcpHttpGloballyEnabled(): boolean {
    const enabled = process.env.MCP_HTTP_ENABLED;
    // Default to true for development, set to "false" to disable
    return enabled !== "false";
}

/**
 * Get the server secret for token signing (future use for JWT)
 */
export function getMcpSecret(): string {
    const secret = process.env.MCP_SECRET;
    if (!secret) {
        console.warn("[MCP Auth] MCP_SECRET not set, using default (insecure for production!)");
        return "insecure-dev-secret-change-me";
    }
    return secret;
}

// ============================================================================
// TOKEN UTILITIES
// ============================================================================

/**
 * Generate a new API token
 * Returns both the raw token (to show user once) and the hash (to store)
 */
export function generateApiToken(): { token: string; hash: string; prefix: string } {
    const randomBytes = createHash("sha256")
        .update(Math.random().toString() + Date.now().toString())
        .digest("hex");

    const token = `mcp_${randomBytes}`;
    const hash = hashToken(token);
    const prefix = token.substring(0, 12);

    return { token, hash, prefix };
}

/**
 * Hash a token for storage
 */
export function hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}

// ============================================================================
// DATABASE OPERATIONS
// ============================================================================

/**
 * Validate a token and return auth context
 */
export async function validateToken(rawToken: string): Promise<McpAuthorizationState | null> {
    const tokenHash = hashToken(rawToken);

    const [tokenRecord] = await db
        .select()
        .from(mcpApiTokens)
        .where(
            and(
                eq(mcpApiTokens.tokenHash, tokenHash),
                eq(mcpApiTokens.isActive, true)
            )
        )
        .limit(1);

    if (!tokenRecord) {
        return null;
    }

    // Check expiration
    if (tokenRecord.expiresAt && new Date(tokenRecord.expiresAt) < new Date()) {
        return null;
    }

    // Update last used timestamp (fire and forget)
    db.update(mcpApiTokens)
        .set({
            lastUsedAt: new Date(),
            usageCount: tokenRecord.usageCount + 1,
        })
        .where(eq(mcpApiTokens.id, tokenRecord.id))
        .execute()
        .catch(err => console.error("[MCP Auth] Failed to update token usage:", err));

    // Fetch Job config if this token is linked to a job (agent)
    let allowedTopicIds: number[] | undefined;
    let allowedDatasetIds: number[] | undefined;
    let allowedPipelineIds: string[] | undefined;

    // In this system, userId can sometimes be a job ID for agents
    const jobId = parseInt(tokenRecord.userId, 10);
    if (!isNaN(jobId)) {
        const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
        if (job && job.config) {
            const config = job.config as any;
            allowedTopicIds = config.topicIds;
            allowedDatasetIds = config.datasetIds;
            allowedPipelineIds = config.pipelineIds;
        }
    }

    return {
        tokenId: tokenRecord.id,
        userId: tokenRecord.userId.toString(),
        organizationId: tokenRecord.organizationId,
        permissions: (tokenRecord.permissions as McpPermission[]) || [],
        resourceScoping: (tokenRecord.resourceScoping as Record<string, string[]>) || {},
        tokenName: tokenRecord.name || "untitled",
        allowedTopicIds,
        allowedDatasetIds,
        allowedPipelineIds
    } as McpAuthorizationState;
}

/**
 * Check if a token has the "local" runner scope.
 * Used for local mission runner endpoints.
 */
export async function checkLocalRunnerScope(tokenId: number): Promise<boolean> {
    const [t] = await db.select({ metadata: mcpApiTokens.metadata })
        .from(mcpApiTokens)
        .where(eq(mcpApiTokens.id, tokenId))
        .limit(1);

    return (t?.metadata as { runnerScope?: string })?.runnerScope === "local";
}

/**
 * Check if MCP HTTP is enabled for an organization
 */
export async function isOrgMcpEnabled(orgId: number): Promise<boolean> {
    const [settings] = await db
        .select({ mcpHttpEnabled: orgSettings.mcpHttpEnabled })
        .from(orgSettings)
        .where(eq(orgSettings.organizationId, orgId))
        .limit(1);

    // Default to false if no settings exist
    return settings?.mcpHttpEnabled ?? false;
}

// ============================================================================
// MIDDLEWARE
// ============================================================================

/**
 * Application-level gate middleware
 * Checks if MCP HTTP is globally enabled via environment variable
 */
export function mcpGlobalGate(req: Request, res: Response, next: NextFunction) {
    if (!isMcpHttpGloballyEnabled()) {
        res.status(503).json({
            error: "Service Unavailable",
            message: "MCP HTTP endpoint is disabled at the application level",
            code: "MCP_GLOBALLY_DISABLED",
        });
        return;
    }
    next();
}

/**
 * Authentication middleware
 * Validates Bearer token and populates req.mcpAuth
 */
export async function mcpAuthMiddleware(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        res.status(401).json({
            error: "Unauthorized",
            message: "Missing or invalid Authorization header. Use: Authorization: Bearer <token>",
            code: "MISSING_AUTH",
        });
        return;
    }

    const token = authHeader.substring(7); // Remove "Bearer "

    try {
        const authContext = await validateToken(token);

        if (!authContext) {
            res.status(401).json({
                error: "Unauthorized",
                message: "Invalid or expired token",
                code: "INVALID_TOKEN",
            });
            return;
        }

        req.mcpAuth = authContext;
        next();
    } catch (error) {
        console.error("[MCP Auth] Token validation error:", error);
        res.status(500).json({
            error: "Internal Server Error",
            message: "Authentication failed",
            code: "AUTH_ERROR",
        });
    }
}

/**
 * Organization-level gate middleware
 * Checks if MCP HTTP is enabled for the authenticated user's org
 */
export async function mcpOrgGate(req: Request, res: Response, next: NextFunction) {
    if (!req.mcpAuth) {
        res.status(401).json({
            error: "Unauthorized",
            message: "Authentication required",
            code: "AUTH_REQUIRED",
        });
        return;
    }

    try {
        const enabled = await isOrgMcpEnabled(req.mcpAuth.organizationId);

        if (!enabled) {
            res.status(403).json({
                error: "Forbidden",
                message: "MCP HTTP access is not enabled for your organization. Contact your administrator.",
                code: "ORG_MCP_DISABLED",
            });
            return;
        }

        next();
    } catch (error) {
        console.error("[MCP Auth] Org check error:", error);
        res.status(500).json({
            error: "Internal Server Error",
            message: "Organization check failed",
            code: "ORG_CHECK_ERROR",
        });
    }
}

/**
 * Check if user has permission for a specific tool
 */
export function checkToolPermission(toolName: string, permissions: McpPermission[]): boolean {
    return hasToolPermission(permissions, toolName);
}

/**
 * Combined auth middleware - applies all checks in sequence
 */
export const mcpFullAuthMiddleware = [
    mcpGlobalGate,
    mcpAuthMiddleware,
    mcpOrgGate,
];

// ============================================================================
// PERMISSION UTILITIES FOR HANDLERS
// ============================================================================

/**
 * Create a permission-checking wrapper for tool handlers
 * Returns an error response if permission denied
 */
export function requireToolPermission(
    toolName: string,
    permissions: McpPermission[]
): { allowed: true } | { allowed: false; error: string } {
    if (hasToolPermission(permissions, toolName)) {
        return { allowed: true };
    }

    return {
        allowed: false,
        error: `Permission denied for tool "${toolName}". Required permissions not granted.`,
    };
}

