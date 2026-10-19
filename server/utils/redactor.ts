
/**
 * Sensitive Data Redactor
 * 
 * Recursively scrubs sensitive keys from objects before logging.
 */

const SENSITIVE_KEYS = [
    /password/i,
    /secret/i,
    /token/i,
    /apiKey/i,
    /auth/i,
    /credential/i,
    /authorization/i,
    /cookie/i,
];

export function redact(obj: any): any {
    if (!obj) return obj;

    // Handle primitives
    if (typeof obj !== 'object') return obj;

    // Handle Arrays
    if (Array.isArray(obj)) {
        return obj.map(item => redact(item));
    }

    // Handle Objects
    const cleaned: Record<string, any> = {};
    for (const key of Object.keys(obj)) {
        const lowerKey = key.toLowerCase();

        // Check if key is sensitive
        const isSensitive = SENSITIVE_KEYS.some(regex => regex.test(key));

        if (isSensitive) {
            cleaned[key] = '***REDACTED***';
        } else {
            // Recurse
            cleaned[key] = redact(obj[key]);
        }
    }

    return cleaned;
}

