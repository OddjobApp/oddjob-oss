/**
 * JWT Token Utilities for External Gateway.
 * Migrated to Auth domain for consistent structure.
 */
import jwt from "jsonwebtoken";

export interface ExternalTokenPayload {
    executionId: string;
    formId?: number;
    requestId?: number;
    email: string;
    role: "external" | "internal";
    context?: any;
    iat?: number;
    exp?: number;
}

export const tokenService = {
    /**
     * Validate JWT token from external requests.
     */
    validateExternalToken(token: string): ExternalTokenPayload {
        if (!process.env.JWT_SECRET) {
            throw new Error("JWT_SECRET environment variable is not set");
        }

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET) as ExternalTokenPayload;
            if (!decoded.executionId || !decoded.email) {
                throw new Error("Invalid token payload structure");
            }
            return decoded;
        } catch (error: any) {
            if (error.name === "TokenExpiredError") throw new Error("Token has expired");
            if (error.name === "JsonWebTokenError") throw new Error("Invalid token signature");
            throw error;
        }
    },

    /**
     * Generate JWT token for external access.
     */
    generateExternalToken(payload: Omit<ExternalTokenPayload, "iat" | "exp">): string {
        if (!process.env.JWT_SECRET) {
            throw new Error("JWT_SECRET environment variable is not set");
        }
        return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "48h" });
    }
};


