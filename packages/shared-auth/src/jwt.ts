/**
 * JWT Utilities
 * 
 * Token generation and validation for:
 * - User authentication
 * - Service-to-service communication
 * - External form access
 */

import jwt from "jsonwebtoken";
import type { 
    JWTPayload, 
    UserContext, 
    AuthResult, 
    ServiceTokenPayload,
    ExternalTokenPayload,
    ServiceAuthResult 
} from "./types.js";

// Environment configuration
const JWT_SECRET = process.env.JWT_SECRET || process.env.SESSION_SECRET || "insecure-dev-secret";
const JWT_ISSUER = process.env.JWT_ISSUER || "oddjob";
const JWT_EXPIRY = process.env.JWT_EXPIRY || "24h";

if (process.env.NODE_ENV === "production" && JWT_SECRET === "insecure-dev-secret") {
    throw new Error("JWT_SECRET or SESSION_SECRET must be set in production");
}

// ============================================================================
// User Token Functions
// ============================================================================

/**
 * Generate a JWT token for a user
 */
export function generateToken(user: UserContext): string {
    const payload: JWTPayload = {
        sub: user.userId,
        org: user.organizationId,
        role: user.role,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + parseExpiry(JWT_EXPIRY),
    };

    return jwt.sign(payload, JWT_SECRET, {
        issuer: JWT_ISSUER,
    });
}

/**
 * Verify and decode a JWT token
 */
export function verifyToken(token: string): AuthResult {
    try {
        const decoded = jwt.verify(token, JWT_SECRET, {
            issuer: JWT_ISSUER,
        }) as JWTPayload;

        return {
            success: true,
            user: {
                userId: decoded.sub,
                username: "", // Would need DB lookup
                email: "",    // Would need DB lookup
                organizationId: decoded.org,
                role: decoded.role as UserContext['role'],
            },
        };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Invalid token";
        return {
            success: false,
            error: message,
        };
    }
}

/**
 * Decode a token without verification (for debugging)
 */
export function decodeToken(token: string): JWTPayload | null {
    try {
        return jwt.decode(token) as JWTPayload;
    } catch {
        return null;
    }
}

// ============================================================================
// Service Token Functions
// ============================================================================

/**
 * Generate a service-to-service token
 * Used for internal API calls between microservices
 */
export function generateServiceToken(serviceName: string): string {
    const payload: ServiceTokenPayload = {
        sub: `service:${serviceName}`,
        type: "service",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300, // 5 minutes
    };

    return jwt.sign(payload, JWT_SECRET, {
        issuer: JWT_ISSUER,
    });
}

/**
 * Verify a service-to-service token
 */
export function verifyServiceToken(token: string): ServiceAuthResult {
    try {
        const decoded = jwt.verify(token, JWT_SECRET, {
            issuer: JWT_ISSUER,
        }) as ServiceTokenPayload;

        if (decoded.type !== "service") {
            return { valid: false, error: "Not a service token" };
        }

        return {
            valid: true,
            service: decoded.sub.replace("service:", ""),
        };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Invalid token";
        return { valid: false, error: message };
    }
}

// ============================================================================
// External Token Functions (for form access)
// ============================================================================

/**
 * Generate JWT token for external access
 * Used for external form submissions and approvals
 */
export function generateExternalToken(
    payload: Omit<ExternalTokenPayload, "iat" | "exp">,
    expiresIn: string = "48h"
): string {
    if (!process.env.JWT_SECRET) {
        throw new Error("JWT_SECRET environment variable is not set");
    }

    return jwt.sign(payload, JWT_SECRET, {
        expiresIn: expiresIn as jwt.SignOptions['expiresIn'],
    });
}

/**
 * Validate JWT token from external requests
 * Returns decoded payload if valid, throws error if invalid
 */
export function validateExternalToken(token: string): ExternalTokenPayload {
    if (!process.env.JWT_SECRET) {
        throw new Error("JWT_SECRET environment variable is not set");
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET) as ExternalTokenPayload;

        // Validate required fields
        if (!decoded.executionId || !decoded.formId || !decoded.email || 
            !['external', 'internal'].includes(decoded.role)) {
            throw new Error("Invalid token payload structure");
        }

        return decoded;
    } catch (error: unknown) {
        if (error instanceof Error) {
            if (error.name === "TokenExpiredError") {
                throw new Error("Token has expired");
            }
            if (error.name === "JsonWebTokenError") {
                throw new Error("Invalid token signature");
            }
        }
        throw error;
    }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Parse expiry string to seconds
 */
function parseExpiry(expiry: string): number {
    const match = expiry.match(/^(\d+)([smhd])$/);
    if (!match) return 86400; // Default 24h

    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
        case "s": return value;
        case "m": return value * 60;
        case "h": return value * 3600;
        case "d": return value * 86400;
        default: return 86400;
    }
}

/**
 * Check if a token is expired
 */
export function isTokenExpired(token: string): boolean {
    const decoded = decodeToken(token);
    if (!decoded || !decoded.exp) return true;
    return decoded.exp < Math.floor(Date.now() / 1000);
}

/**
 * Get token expiry time
 */
export function getTokenExpiry(token: string): Date | null {
    const decoded = decodeToken(token);
    if (!decoded || !decoded.exp) return null;
    return new Date(decoded.exp * 1000);
}

