/**
 * Auth Types
 * 
 * Shared type definitions for authentication across services.
 */

export interface UserContext {
    userId: string;
    username: string;
    email: string;
    organizationId: number;
    role: 'user' | 'admin' | 'super_admin';
    permissions?: string[];
}

export interface SessionData {
    userId: string;
    organizationId: number;
    role: string;
    createdAt: number;
    expiresAt: number;
}

export interface JWTPayload {
    sub: string;  // userId
    org: number;  // organizationId
    role: string;
    iat: number;
    exp: number;
}

export interface ServiceTokenPayload {
    sub: string;  // service:serviceName
    type: 'service';
    iat: number;
    exp: number;
}

export interface ExternalTokenPayload {
    executionId: string;
    formId: number;
    email: string;
    role: 'external' | 'internal';
    iat?: number;
    exp?: number;
}

export interface AuthResult {
    success: boolean;
    user?: UserContext;
    error?: string;
}

export interface ServiceAuthResult {
    valid: boolean;
    service?: string;
    error?: string;
}

