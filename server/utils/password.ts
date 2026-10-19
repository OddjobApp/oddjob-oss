import { passwordService } from "../domain/auth/index.js";

/**
 * @deprecated Use passwordService from domain/auth instead.
 */
export const hashPassword = passwordService.hashPassword;
export const verifyPassword = passwordService.verifyPassword;
export const validatePassword = passwordService.validatePassword;

