import { BadRequestError } from "./errors.js";

/**
 * Safely parses an ID parameter (usually from req.params.id).
 * Returns a valid positive number or throws a BadRequestError (which results in a 400).
 * Prevents "NaN" being passed into database queries.
 */
export function validateIdParam(id: any, paramName: string = 'ID'): number {
    if (id === undefined || id === null) {
        throw new BadRequestError(`${paramName} is required`);
    }

    const parsedId = typeof id === 'number' ? id : parseInt(String(id), 10);
    
    if (isNaN(parsedId)) {
        throw new BadRequestError(`Invalid ${paramName}: "${id}" (must be a number)`);
    }
    
    if (parsedId <= 0) {
        throw new BadRequestError(`Invalid ${paramName}: ${parsedId} (must be a positive integer)`);
    }

    return parsedId;
}

/**
 * Safely parses a numeric query parameter with a default value.
 */
export function parseNumericParam(value: any, defaultValue: number): number {
    if (value === undefined || value === null) return defaultValue;
    const parsed = parseInt(String(value), 10);
    return isNaN(parsed) ? defaultValue : parsed;
}
