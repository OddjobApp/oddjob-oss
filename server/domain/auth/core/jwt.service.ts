import { tokenService } from "../index.js";
export type { ExternalTokenPayload } from "../index.js";

/**
 * JWT Token Utilities for External Gateway
 * Re-exported from domain/auth/token-service for backward compatibility.
 */
export const validateExternalToken = tokenService.validateExternalToken;
export const generateExternalToken = tokenService.generateExternalToken;


