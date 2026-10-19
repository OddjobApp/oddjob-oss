/**
 * CURL Job Debugger Utilities
 * Analyzes failed CURL job test results and provides fix suggestions
 */

export type ErrorCategory =
    | 'auth'
    | 'not_found'
    | 'deprecated'
    | 'bad_request'
    | 'server_error'
    | 'network'
    | 'schema'
    | 'unknown';

export type ErrorSeverity = 'error' | 'warning' | 'info';

export interface DebugSuggestion {
    action: string;
    description: string;
    priority: number;  // 1 = highest
    autoFix?: {
        field: 'url' | 'method' | 'headers' | 'body' | 'queryParams' | 'authType' | 'credentialId';
        value: any;
    };
}

export interface ApiContext {
    provider: 'jira' | 'slack' | 'github' | 'generic';
    knownFixes?: Record<string, any>;
}

export interface DebugAnalysis {
    category: ErrorCategory;
    severity: ErrorSeverity;
    summary: string;
    details: string;
    suggestions: DebugSuggestion[];
    apiContext?: ApiContext;
}

export interface TestResultForDebug {
    success: boolean;
    output?: any;
    error?: string;
    metadata?: {
        status?: number;
        url?: string;
        statusText?: string;
    };
}

export interface CurlConfigForDebug {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    queryParams?: Record<string, any>;
    credentialId?: number;
    authType?: string;
}

// Known API fixes database
const JIRA_KNOWN_FIXES: Record<string, { status: number; fix: Partial<CurlConfigForDebug>; explanation: string }> = {
    '/rest/api/3/search': {
        status: 410,
        fix: { url: '/rest/api/3/search/jql', method: 'POST' },
        explanation: 'JIRA deprecated GET /rest/api/3/search. Use POST /rest/api/3/search/jql with JQL in the request body instead of query parameters.'
    },
    '/rest/api/2/search': {
        status: 410,
        fix: { url: '/rest/api/3/search/jql', method: 'POST' },
        explanation: 'JIRA v2 API is deprecated. Migrate to v3 using POST /rest/api/3/search/jql with JQL in the request body.'
    },
};

/**
 * Detect API provider from URL or credential type
 */
export function detectApiProvider(url: string, credentialType?: string): ApiContext {
    const lowerUrl = url.toLowerCase();

    if (lowerUrl.includes('atlassian.net') || lowerUrl.includes('jira') || credentialType === 'jira') {
        return { provider: 'jira', knownFixes: JIRA_KNOWN_FIXES };
    }

    if (lowerUrl.includes('slack.com') || lowerUrl.includes('api.slack')) {
        return { provider: 'slack' };
    }

    if (lowerUrl.includes('github.com') || lowerUrl.includes('api.github')) {
        return { provider: 'github' };
    }

    return { provider: 'generic' };
}

/**
 * Check if a known fix exists for this URL + status combination
 */
function findKnownFix(url: string, status: number, apiContext: ApiContext): { fix: Partial<CurlConfigForDebug>; explanation: string } | null {
    if (!apiContext.knownFixes) return null;

    for (const [pattern, entry] of Object.entries(apiContext.knownFixes)) {
        if (url.includes(pattern) && entry.status === status) {
            return { fix: entry.fix, explanation: entry.explanation };
        }
    }

    return null;
}

/**
 * Analyze HTTP status code to determine error category
 */
function categorizeByStatus(status: number): { category: ErrorCategory; severity: ErrorSeverity } {
    if (status === 401 || status === 403) {
        return { category: 'auth', severity: 'error' };
    }
    if (status === 404) {
        return { category: 'not_found', severity: 'error' };
    }
    if (status === 410) {
        return { category: 'deprecated', severity: 'error' };
    }
    if (status === 400 || status === 422) {
        return { category: 'bad_request', severity: 'error' };
    }
    if (status >= 500) {
        return { category: 'server_error', severity: 'warning' };
    }
    if (status === 0 || !status) {
        return { category: 'network', severity: 'error' };
    }
    return { category: 'unknown', severity: 'info' };
}

/**
 * Generate suggestions based on error category
 */
function generateSuggestions(
    category: ErrorCategory,
    result: TestResultForDebug,
    config: CurlConfigForDebug,
    apiContext: ApiContext
): DebugSuggestion[] {
    const suggestions: DebugSuggestion[] = [];
    const status = result.metadata?.status;
    const url = config.url || '';

    // Check for known fixes first
    if (status) {
        const knownFix = findKnownFix(url, status, apiContext);
        if (knownFix) {
            const fixSuggestions: DebugSuggestion[] = [];

            if (knownFix.fix.url) {
                fixSuggestions.push({
                    action: 'Update endpoint URL',
                    description: `Change URL to ${knownFix.fix.url}`,
                    priority: 1,
                    autoFix: { field: 'url', value: knownFix.fix.url },
                });
            }

            if (knownFix.fix.method) {
                fixSuggestions.push({
                    action: 'Change HTTP method',
                    description: `Use ${knownFix.fix.method} instead of ${config.method || 'GET'}`,
                    priority: 2,
                    autoFix: { field: 'method', value: knownFix.fix.method },
                });
            }

            return fixSuggestions;
        }
    }

    // Category-specific suggestions
    switch (category) {
        case 'auth':
            suggestions.push({
                action: 'Verify credentials',
                description: 'Check that the API token/key is valid and not expired',
                priority: 1,
            });
            if (!config.credentialId) {
                suggestions.push({
                    action: 'Add credentials',
                    description: 'This endpoint may require authentication. Select a credential.',
                    priority: 2,
                });
            }
            if (apiContext.provider === 'jira') {
                suggestions.push({
                    action: 'Check JIRA email',
                    description: 'Ensure the email in credential metadata matches your Atlassian account',
                    priority: 3,
                });
            }
            break;

        case 'not_found':
            suggestions.push({
                action: 'Verify endpoint URL',
                description: 'Check the API documentation for the correct endpoint path',
                priority: 1,
            });
            if (url.includes('{') || url.includes('{{')) {
                suggestions.push({
                    action: 'Check path parameters',
                    description: 'Ensure all path parameters (e.g., {id}) are replaced with actual values',
                    priority: 2,
                });
            }
            break;

        case 'deprecated':
            suggestions.push({
                action: 'Check API documentation',
                description: 'This endpoint may have been deprecated. Look for the updated version.',
                priority: 1,
            });
            break;

        case 'bad_request':
            if (config.body) {
                suggestions.push({
                    action: 'Validate request body',
                    description: 'Check that the request body matches the expected schema',
                    priority: 1,
                });
            }
            suggestions.push({
                action: 'Check required fields',
                description: 'Ensure all required parameters and headers are provided',
                priority: 2,
            });
            if (!config.headers?.['Content-Type'] && config.method !== 'GET') {
                suggestions.push({
                    action: 'Add Content-Type header',
                    description: 'Add Content-Type: application/json header',
                    priority: 3,
                    autoFix: {
                        field: 'headers',
                        value: { ...config.headers, 'Content-Type': 'application/json' }
                    },
                });
            }
            break;

        case 'server_error':
            suggestions.push({
                action: 'Retry the request',
                description: 'This may be a temporary server issue. Try again in a few moments.',
                priority: 1,
            });
            suggestions.push({
                action: 'Check service status',
                description: 'Verify the external service is operational',
                priority: 2,
            });
            break;

        case 'network':
            suggestions.push({
                action: 'Check URL accessibility',
                description: 'Verify the host is reachable and the URL is correct',
                priority: 1,
            });
            suggestions.push({
                action: 'Check firewall/proxy',
                description: 'Ensure network access is allowed to the target host',
                priority: 2,
            });
            break;

        default:
            suggestions.push({
                action: 'Review API documentation',
                description: 'Check the API documentation for correct usage',
                priority: 1,
            });
    }

    return suggestions;
}

/**
 * Generate human-readable summary for error category
 */
function generateSummary(category: ErrorCategory, status?: number): string {
    switch (category) {
        case 'auth':
            return status === 401 ? 'Authentication Failed' : 'Access Forbidden';
        case 'not_found':
            return 'Endpoint Not Found';
        case 'deprecated':
            return 'Deprecated Endpoint';
        case 'bad_request':
            return 'Invalid Request';
        case 'server_error':
            return 'Server Error';
        case 'network':
            return 'Network Error';
        case 'schema':
            return 'Unexpected Response';
        default:
            return 'Request Failed';
    }
}

/**
 * Generate detailed error description
 */
function generateDetails(
    category: ErrorCategory,
    result: TestResultForDebug,
    apiContext: ApiContext
): string {
    const status = result.metadata?.status;
    const url = result.metadata?.url || 'the endpoint';
    const statusText = result.metadata?.statusText || '';

    // Try to extract error message from response
    let errorMsg = '';
    if (result.output && typeof result.output === 'object') {
        errorMsg = result.output.message
            || result.output.errorMessages?.[0]
            || result.output.error?.message
            || result.output.error
            || '';
    } else if (result.error) {
        errorMsg = result.error;
    }

    const providerName = apiContext.provider === 'generic' ? 'API' : apiContext.provider.toUpperCase();

    switch (category) {
        case 'auth':
            return `The ${providerName} returned ${status} ${statusText}. ${errorMsg ? `Error: ${errorMsg}` : 'Authentication credentials may be invalid or expired.'}`;
        case 'not_found':
            return `The endpoint ${url} returned 404 Not Found. ${errorMsg ? `Error: ${errorMsg}` : 'The resource may not exist or the URL may be incorrect.'}`;
        case 'deprecated':
            return `The endpoint ${url} returned 410 Gone. This endpoint has been deprecated and is no longer available.`;
        case 'bad_request':
            return `The ${providerName} rejected the request with ${status} ${statusText}. ${errorMsg ? `Error: ${errorMsg}` : 'The request format may be incorrect.'}`;
        case 'server_error':
            return `The ${providerName} returned ${status} ${statusText}. This is a server-side error that may be temporary.`;
        case 'network':
            return `Could not connect to ${url}. The host may be unreachable or there may be a network issue.`;
        default:
            return `The request to ${url} failed with status ${status}. ${errorMsg || ''}`;
    }
}

/**
 * Main analysis function
 */
export function analyzeError(
    result: TestResultForDebug,
    config: CurlConfigForDebug,
    credentialType?: string
): DebugAnalysis {
    const url = config.url || result.metadata?.url || '';
    const apiContext = detectApiProvider(url, credentialType);

    const status = result.metadata?.status || 0;
    const { category, severity } = categorizeByStatus(status);

    const summary = generateSummary(category, status);
    const details = generateDetails(category, result, apiContext);
    const suggestions = generateSuggestions(category, result, config, apiContext);

    return {
        category,
        severity,
        summary,
        details,
        suggestions: suggestions.sort((a, b) => a.priority - b.priority),
        apiContext,
    };
}
