
/**
 * JSON Repair Utility
 * 
 * Specifically designed to handle malformed JSON returned by LLMs,
 * such as unescaped control characters in string literals.
 */

/**
 * Sanitizes a string that is intended to be parsed as JSON.
 * Replaces raw control characters (0x00-0x1F) inside double-quoted string literals
 * with their properly escaped JSON equivalents (\n, \t, etc.).
 */
export function sanitizeJson(str: string): string {
    if (!str) return str;

    // Regex to find double-quoted string literals, accounting for escaped quotes.
    // Match: " ... " where interior can have escaped characters like \" or \\
    return str.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/g, (match, contents) => {
        // Replace raw control characters within the matched string literal
        return '"' + contents.replace(/[\x00-\x1F]/g, (char: string) => {
            switch (char) {
                case '\n': return '\\n';
                case '\r': return '\\r';
                case '\t': return '\\t';
                case '\b': return '\\b';
                case '\f': return '\\f';
                default:
                    const hex = char.charCodeAt(0).toString(16).padStart(4, '0');
                    return '\\u' + hex;
            }
        }) + '"';
    });
}

/**
 * Attempts to parse a JSON string, applying sanitization if the initial parse fails.
 */
export function safeJsonParse<T = any>(str: string): T {
    try {
        return JSON.parse(str);
    } catch (e) {
        try {
            let sanitized = sanitizeJson(str);
            // Fix 1: Bad escaped character (e.g. \A in C:\Apps)
            // Match a backslash followed by NOT one of the valid json escape chars
            sanitized = sanitized.replace(/\\([^"\\\/bfnrtu])/g, '\\\\$1');
            
            // Fix 2: Bad unicode escape (e.g. \u in C:\users)
            sanitized = sanitized.replace(/\\u(?![0-9a-fA-F]{4})/g, '\\\\u');
            
            return JSON.parse(sanitized);
        } catch (innerError) {
            // Re-throw the original error if sanitization didn't help
            throw e;
        }
    }
}

