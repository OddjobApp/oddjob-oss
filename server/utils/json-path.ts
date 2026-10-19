
import jp from "jsonpath";

/**
 * safely execute a JSONPath query and return an array of results.
 * Returns empty array if no match or error.
 */
export function query(obj: any, path: string): any[] {
    if (!obj || !path) return [];

    if (!path.startsWith("$")) {
        // If path is not a JSONPath, treat it as a direct property key check?
        // Or just return empty?
        // For consistency with typical usage where we might pass a direct string as a fallback:
        return [];
    }

    try {
        return jp.query(obj, path);
    } catch (err) {
        // console.warn(`Invalid JSONPath: ${path}`, err); // Optional logging
        return [];
    }
}

/**
 * Safely execute a JSONPath query and return the first result or null.
 */
export function queryOne(obj: any, path: string): any | null {
    const results = query(obj, path);
    return results.length > 0 ? results[0] : null;
}

