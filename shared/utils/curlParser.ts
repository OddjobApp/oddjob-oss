/**
 * cURL Parser and Generator Utilities
 * Parse cURL commands into structured config and generate cURL from config
 */

export interface ParsedCurlCommand {
    url: string;
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    headers: Record<string, string>;
    body?: string;
    queryParams?: Record<string, string>;
    authType?: 'none' | 'bearer' | 'basic';
    authValue?: string;
}

export interface CurlGeneratorOptions {
    url: string;
    method: string;
    headers?: Record<string, string>;
    body?: string;
    queryParams?: Record<string, string>;
    credentialPlaceholder?: string;
}

/**
 * Parse a cURL command string into structured components
 */
export function parseCurlCommand(curlString: string): ParsedCurlCommand {
    const result: ParsedCurlCommand = {
        url: '',
        method: 'GET',
        headers: {},
    };

    // Normalize the string - remove line continuations and extra whitespace
    let normalized = curlString
        .replace(/\\\s*\n/g, ' ')  // Remove line continuations
        .replace(/\s+/g, ' ')       // Normalize whitespace
        .trim();

    // Remove 'curl' prefix if present
    if (normalized.toLowerCase().startsWith('curl')) {
        normalized = normalized.substring(4).trim();
    }

    // Tokenize respecting quotes
    const tokens: string[] = [];
    let current = '';
    let inQuote: string | null = null;
    let escape = false;

    for (const char of normalized) {
        if (escape) {
            current += char;
            escape = false;
            continue;
        }

        if (char === '\\') {
            escape = true;
            continue;
        }

        if (char === '"' || char === "'") {
            if (inQuote === char) {
                inQuote = null;
            } else if (!inQuote) {
                inQuote = char;
            } else {
                current += char;
            }
            continue;
        }

        if (char === ' ' && !inQuote) {
            if (current) {
                tokens.push(current);
                current = '';
            }
            continue;
        }

        current += char;
    }
    if (current) {
        tokens.push(current);
    }

    // Parse tokens
    let i = 0;
    while (i < tokens.length) {
        const token = tokens[i];

        // Method
        if (token === '-X' || token === '--request') {
            i++;
            if (i < tokens.length) {
                const method = tokens[i].toUpperCase();
                if (['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
                    result.method = method as ParsedCurlCommand['method'];
                }
            }
            i++;
            continue;
        }

        // Headers
        if (token === '-H' || token === '--header') {
            i++;
            if (i < tokens.length) {
                const headerValue = tokens[i];
                const colonIndex = headerValue.indexOf(':');
                if (colonIndex > 0) {
                    const key = headerValue.substring(0, colonIndex).trim();
                    const value = headerValue.substring(colonIndex + 1).trim();
                    result.headers[key] = value;

                    // Detect auth from Authorization header
                    if (key.toLowerCase() === 'authorization') {
                        const { authType, token: authToken } = detectAuthFromHeaders({ [key]: value });
                        if (authType !== 'none') {
                            result.authType = authType as 'bearer' | 'basic';
                            result.authValue = authToken;
                        }
                    }
                }
            }
            i++;
            continue;
        }

        // Data/Body
        if (token === '-d' || token === '--data' || token === '--data-raw' || token === '--data-binary') {
            i++;
            if (i < tokens.length) {
                result.body = tokens[i];
                // If body is present, default to POST unless explicitly set
                if (result.method === 'GET') {
                    result.method = 'POST';
                }
            }
            i++;
            continue;
        }

        // Basic auth
        if (token === '-u' || token === '--user') {
            i++;
            if (i < tokens.length) {
                result.authType = 'basic';
                result.authValue = tokens[i];
            }
            i++;
            continue;
        }

        // URL (anything that looks like a URL or doesn't start with -)
        if (!token.startsWith('-') && !result.url) {
            let url = token;

            // Extract query params from URL
            const queryIndex = url.indexOf('?');
            if (queryIndex > 0) {
                const queryString = url.substring(queryIndex + 1);
                url = url.substring(0, queryIndex);
                result.queryParams = parseQueryString(queryString);
            }

            result.url = url;
            i++;
            continue;
        }

        // Skip unknown flags
        i++;
    }

    return result;
}

/**
 * Parse a query string into key-value pairs
 */
export function parseQueryString(queryString: string): Record<string, string> {
    const params: Record<string, string> = {};
    const pairs = queryString.split('&');

    for (const pair of pairs) {
        const [key, value] = pair.split('=');
        if (key) {
            params[decodeURIComponent(key)] = value ? decodeURIComponent(value) : '';
        }
    }

    return params;
}

/**
 * Generate a cURL command string from config
 */
export function generateCurlCommand(options: CurlGeneratorOptions): string {
    const parts: string[] = ['curl'];

    // Method
    if (options.method && options.method !== 'GET') {
        parts.push(`-X ${options.method}`);
    }

    // Build full URL with query params
    let url = options.url;
    if (options.queryParams && Object.keys(options.queryParams).length > 0) {
        const queryString = Object.entries(options.queryParams)
            .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
            .join('&');
        url += (url.includes('?') ? '&' : '?') + queryString;
    }

    // Headers
    if (options.headers) {
        for (const [key, value] of Object.entries(options.headers)) {
            // Skip Authorization if we're adding a placeholder
            if (key.toLowerCase() === 'authorization' && options.credentialPlaceholder) {
                continue;
            }
            parts.push(`-H "${key}: ${escapeForShell(value)}"`);
        }
    }

    // Add credential placeholder if specified
    if (options.credentialPlaceholder) {
        parts.push(`-H "Authorization: ${options.credentialPlaceholder}"`);
    }

    // Body
    if (options.body) {
        const escapedBody = escapeForShell(options.body);
        parts.push(`-d '${escapedBody}'`);
    }

    // URL (quoted)
    parts.push(`"${url}"`);

    return parts.join(' \\\n  ');
}

/**
 * Escape a string for shell usage
 */
export function escapeForShell(str: string): string {
    return str.replace(/'/g, "'\\''");
}

/**
 * Detect auth type from headers
 */
export function detectAuthFromHeaders(headers: Record<string, string>): { authType: string; token?: string } {
    for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === 'authorization') {
            const lowerValue = value.toLowerCase();

            if (lowerValue.startsWith('bearer ')) {
                return { authType: 'bearer', token: value.substring(7) };
            }

            if (lowerValue.startsWith('basic ')) {
                return { authType: 'basic', token: value.substring(6) };
            }
        }
    }

    return { authType: 'none' };
}

/**
 * Build full URL with query params
 */
export function buildFullUrl(baseUrl: string, queryParams?: Record<string, string>): string {
    if (!queryParams || Object.keys(queryParams).length === 0) {
        return baseUrl;
    }

    const queryString = Object.entries(queryParams)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&');

    return baseUrl + (baseUrl.includes('?') ? '&' : '?') + queryString;
}

/**
 * Convert key-value pairs to object
 */
export function keyValuePairsToObject(pairs: { key: string; value: string; enabled?: boolean }[]): Record<string, string> {
    const result: Record<string, string> = {};
    for (const pair of pairs) {
        if (pair.key && (pair.enabled !== false)) {
            result[pair.key] = pair.value;
        }
    }
    return result;
}

/**
 * Convert object to key-value pairs
 */
export function objectToKeyValuePairs(obj: Record<string, string> | undefined): { key: string; value: string; enabled: boolean }[] {
    if (!obj) return [];
    return Object.entries(obj).map(([key, value]) => ({ key, value, enabled: true }));
}

/**
 * Common auth presets
 */
export const AUTH_PRESETS = {
    jira: {
        name: 'JIRA Cloud',
        authType: 'basic' as const,
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
        },
        description: 'Uses email + API token for Basic authentication',
    },
    github: {
        name: 'GitHub',
        authType: 'bearer' as const,
        headers: {
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
        },
        description: 'Uses Personal Access Token for Bearer authentication',
    },
    slack: {
        name: 'Slack',
        authType: 'bearer' as const,
        headers: {
            'Content-Type': 'application/json',
        },
        description: 'Uses Bot Token for Bearer authentication',
    },
    openai: {
        name: 'OpenAI',
        authType: 'bearer' as const,
        headers: {
            'Content-Type': 'application/json',
        },
        description: 'Uses API Key for Bearer authentication',
    },
    anthropic: {
        name: 'Anthropic',
        authType: 'bearer' as const,
        headers: {
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01',
        },
        description: 'Uses API Key with x-api-key header',
    },
};

export type AuthPresetKey = keyof typeof AUTH_PRESETS;
