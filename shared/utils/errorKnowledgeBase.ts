/**
 * Error Knowledge Base
 * Centralized error pattern database for diagnosis and fix suggestions
 */

export type ErrorCategory =
    | 'auth'
    | 'not_found'
    | 'deprecated'
    | 'bad_request'
    | 'rate_limit'
    | 'server_error'
    | 'network'
    | 'timeout'
    | 'configuration'
    | 'data_format'
    | 'permission'
    | 'unknown';

export interface ErrorPattern {
    id: string;
    category: ErrorCategory;
    name: string;
    triggers: ErrorPatternTrigger[];
    diagnosis: {
        summary: string;
        explanation: string;
        rootCause?: string;
    };
    fixes: ErrorFix[];
    isBuiltin: boolean;
    organizationId?: number;
    successCount?: number;
    failureCount?: number;
}

export interface ErrorPatternTrigger {
    type: 'regex' | 'status' | 'error_code' | 'job_type' | 'output_contains' | 'url_contains';
    value: string | number;
    weight?: number;  // For scoring matches (default 1.0)
}

export interface ErrorFix {
    id: string;
    description: string;
    action: FixAction;
    confidence: number;  // 0-1
    successRate?: number;
}

export type FixAction =
    | { type: 'update_config'; field: string; value: any; merge?: boolean }
    | { type: 'add_retry'; maxRetries: number; backoffMs: number }
    | { type: 'switch_credential'; reason: string }
    | { type: 'update_url'; newUrl: string }
    | { type: 'change_method'; newMethod: string }
    | { type: 'add_header'; key: string; value: string }
    | { type: 'manual'; instructions: string };

export interface MatchedPattern {
    pattern: ErrorPattern;
    score: number;  // 0-1, how well it matched
    matchedTriggers: ErrorPatternTrigger[];
}

/**
 * Built-in error patterns
 */
export const BUILTIN_ERROR_PATTERNS: ErrorPattern[] = [
    // JIRA Deprecated Search
    {
        id: 'jira-search-deprecated',
        category: 'deprecated',
        name: 'JIRA Search Endpoint Deprecated',
        triggers: [
            { type: 'status', value: 410, weight: 2 },
            { type: 'url_contains', value: '/rest/api/3/search', weight: 1.5 },
            { type: 'url_contains', value: '/rest/api/2/search', weight: 1.5 },
        ],
        diagnosis: {
            summary: 'JIRA Search Endpoint Deprecated',
            explanation: 'JIRA deprecated the GET /rest/api/3/search endpoint. The new endpoint requires POST method with JQL in the request body.',
            rootCause: 'API version migration by Atlassian',
        },
        fixes: [
            {
                id: 'migrate-url',
                description: 'Update endpoint to /rest/api/3/search/jql',
                action: { type: 'update_url', newUrl: '/rest/api/3/search/jql' },
                confidence: 0.95,
            },
            {
                id: 'change-to-post',
                description: 'Change HTTP method from GET to POST',
                action: { type: 'change_method', newMethod: 'POST' },
                confidence: 0.95,
            },
        ],
        isBuiltin: true,
    },

    // Rate Limit
    {
        id: 'rate-limit-exceeded',
        category: 'rate_limit',
        name: 'API Rate Limit Exceeded',
        triggers: [
            { type: 'status', value: 429, weight: 3 },
            { type: 'output_contains', value: 'rate limit', weight: 1 },
            { type: 'output_contains', value: 'too many requests', weight: 1 },
        ],
        diagnosis: {
            summary: 'API Rate Limit Exceeded',
            explanation: 'The API returned 429 Too Many Requests. This usually means you\'ve exceeded the allowed number of requests in a time window.',
            rootCause: 'Request frequency exceeds API limits',
        },
        fixes: [
            {
                id: 'add-exponential-backoff',
                description: 'Add exponential backoff retry (wait 5s, 10s, 20s)',
                action: { type: 'add_retry', maxRetries: 3, backoffMs: 5000 },
                confidence: 0.85,
            },
            {
                id: 'manual-throttle',
                description: 'Reduce request frequency or use pagination',
                action: { type: 'manual', instructions: 'Consider reducing batch sizes, adding delays between requests, or implementing pagination.' },
                confidence: 0.7,
            },
        ],
        isBuiltin: true,
    },

    // Authentication Failed
    {
        id: 'auth-failed',
        category: 'auth',
        name: 'Authentication Failed',
        triggers: [
            { type: 'status', value: 401, weight: 3 },
            { type: 'output_contains', value: 'unauthorized', weight: 1 },
            { type: 'output_contains', value: 'invalid token', weight: 1.5 },
        ],
        diagnosis: {
            summary: 'Authentication Failed',
            explanation: 'The API returned 401 Unauthorized. The provided credentials may be invalid, expired, or missing.',
            rootCause: 'Invalid or expired authentication credentials',
        },
        fixes: [
            {
                id: 'check-credential',
                description: 'Verify the API token is valid and not expired',
                action: { type: 'manual', instructions: 'Go to Settings > Credentials and verify the API token. Regenerate if expired.' },
                confidence: 0.8,
            },
            {
                id: 'switch-credential',
                description: 'Try a different credential',
                action: { type: 'switch_credential', reason: 'Current credential may be invalid' },
                confidence: 0.6,
            },
        ],
        isBuiltin: true,
    },

    // Permission Denied
    {
        id: 'permission-denied',
        category: 'permission',
        name: 'Permission Denied',
        triggers: [
            { type: 'status', value: 403, weight: 3 },
            { type: 'output_contains', value: 'forbidden', weight: 1 },
            { type: 'output_contains', value: 'access denied', weight: 1 },
            { type: 'output_contains', value: 'insufficient permissions', weight: 1.5 },
        ],
        diagnosis: {
            summary: 'Permission Denied',
            explanation: 'The API returned 403 Forbidden. The authenticated user/app does not have permission to access this resource.',
            rootCause: 'Insufficient permissions for the requested resource',
        },
        fixes: [
            {
                id: 'check-scopes',
                description: 'Verify API token has required scopes/permissions',
                action: { type: 'manual', instructions: 'Check the API documentation for required scopes. Regenerate token with correct permissions.' },
                confidence: 0.75,
            },
        ],
        isBuiltin: true,
    },

    // Not Found
    {
        id: 'resource-not-found',
        category: 'not_found',
        name: 'Resource Not Found',
        triggers: [
            { type: 'status', value: 404, weight: 3 },
            { type: 'output_contains', value: 'not found', weight: 1 },
        ],
        diagnosis: {
            summary: 'Resource Not Found',
            explanation: 'The API returned 404 Not Found. The requested resource may not exist or the URL may be incorrect.',
            rootCause: 'Incorrect URL or non-existent resource',
        },
        fixes: [
            {
                id: 'verify-url',
                description: 'Verify the endpoint URL is correct',
                action: { type: 'manual', instructions: 'Check API documentation for the correct endpoint. Verify any path parameters are valid.' },
                confidence: 0.7,
            },
            {
                id: 'check-variables',
                description: 'Verify variable references resolve correctly',
                action: { type: 'manual', instructions: 'If using variables like {{step.0.output.id}}, verify the previous step output contains the expected data.' },
                confidence: 0.6,
            },
        ],
        isBuiltin: true,
    },

    // Invalid JSON
    {
        id: 'invalid-json',
        category: 'data_format',
        name: 'Invalid JSON Format',
        triggers: [
            { type: 'status', value: 400, weight: 1 },
            { type: 'output_contains', value: 'invalid json', weight: 2 },
            { type: 'output_contains', value: 'JSON parse', weight: 2 },
            { type: 'output_contains', value: 'Unexpected token', weight: 2 },
        ],
        diagnosis: {
            summary: 'Invalid JSON in Request Body',
            explanation: 'The request body contains invalid JSON. This is usually a syntax error in the JSON structure.',
            rootCause: 'Malformed JSON syntax',
        },
        fixes: [
            {
                id: 'use-json-fixer',
                description: 'Use AI JSON Fixer to correct the syntax',
                action: { type: 'manual', instructions: 'Click "Fix with AI" on the request body field to automatically correct JSON syntax.' },
                confidence: 0.9,
            },
        ],
        isBuiltin: true,
    },

    // Server Error
    {
        id: 'server-error-500',
        category: 'server_error',
        name: 'Internal Server Error',
        triggers: [
            { type: 'status', value: 500, weight: 3 },
            { type: 'output_contains', value: 'internal server error', weight: 1 },
        ],
        diagnosis: {
            summary: 'Server Error (500)',
            explanation: 'The API returned 500 Internal Server Error. This is a server-side issue that may be temporary.',
            rootCause: 'External service internal error',
        },
        fixes: [
            {
                id: 'retry-later',
                description: 'Retry the request after a short delay',
                action: { type: 'add_retry', maxRetries: 2, backoffMs: 3000 },
                confidence: 0.7,
            },
            {
                id: 'check-service-status',
                description: 'Check service status page',
                action: { type: 'manual', instructions: 'Visit the API provider\'s status page to check for ongoing incidents.' },
                confidence: 0.5,
            },
        ],
        isBuiltin: true,
    },

    // Postgres: Missing Relation
    {
        id: 'db-relation-missing',
        category: 'server_error',
        name: 'Database Relation Missing',
        triggers: [
            { type: 'output_contains', value: 'relation', weight: 1 },
            { type: 'output_contains', value: 'does not exist', weight: 1 },
            { type: 'regex', value: 'relation ".*" does not exist', weight: 3 },
        ],
        diagnosis: {
            summary: 'Missing Database Table',
            explanation: 'The application is attempting to access a database table (relation) that does not exist. This usually indicates a failed or missing migration.',
            rootCause: 'Database schema out of sync with application code',
        },
        fixes: [
            {
                id: 'run-migrations',
                description: 'Run database migrations',
                action: { type: 'manual', instructions: 'Run `npm run db:push` or `npm run db:migrate` to synchronize the schema.' },
                confidence: 0.9,
            },
            {
                id: 'check-schema-stabilizer',
                description: 'Verify Warm-up Stabilizer',
                action: { type: 'manual', instructions: 'Check server logs for "Schema stabilization" errors during startup.' },
                confidence: 0.8,
            },
        ],
        isBuiltin: true,
    },

    // Postgres: Missing Column
    {
        id: 'db-column-missing',
        category: 'server_error',
        name: 'Database Column Missing',
        triggers: [
            { type: 'output_contains', value: 'column', weight: 1 },
            { type: 'output_contains', value: 'does not exist', weight: 1 },
            { type: 'regex', value: 'column ".*" does not exist', weight: 3 },
        ],
        diagnosis: {
            summary: 'Missing Database Column',
            explanation: 'The application is attempting to access a table column that does not exist. This usually indicates a schema mismatch after an update.',
            rootCause: 'Database schema out of sync (missing column)',
        },
        fixes: [
            {
                id: 'run-push',
                description: 'Sync schema with db:push',
                action: { type: 'manual', instructions: 'Run `npm run db:push` to forcefully align the database schema.' },
                confidence: 0.9,
            },
        ],
        isBuiltin: true,
    },

    // Network/Connection Error
    {
        id: 'network-error',
        category: 'network',
        name: 'Network Connection Error',
        triggers: [
            { type: 'status', value: 0, weight: 3 },
            { type: 'output_contains', value: 'ECONNREFUSED', weight: 2 },
            { type: 'output_contains', value: 'ETIMEDOUT', weight: 2 },
            { type: 'output_contains', value: 'getaddrinfo', weight: 2 },
            { type: 'output_contains', value: 'network error', weight: 1.5 },
        ],
        diagnosis: {
            summary: 'Network Connection Failed',
            explanation: 'Unable to establish a connection to the server. The host may be unreachable or there may be a DNS issue.',
            rootCause: 'Network connectivity or DNS resolution failure',
        },
        fixes: [
            {
                id: 'verify-host',
                description: 'Verify the hostname is correct and accessible',
                action: { type: 'manual', instructions: 'Check that the URL hostname is correct and accessible from your network.' },
                confidence: 0.7,
            },
            {
                id: 'check-firewall',
                description: 'Check firewall and proxy settings',
                action: { type: 'manual', instructions: 'Ensure outbound connections to this host are allowed by your firewall/proxy.' },
                confidence: 0.5,
            },
        ],
        isBuiltin: true,
    },

    // Timeout
    {
        id: 'request-timeout',
        category: 'timeout',
        name: 'Request Timeout',
        triggers: [
            { type: 'status', value: 408, weight: 3 },
            { type: 'status', value: 504, weight: 3 },
            { type: 'output_contains', value: 'timeout', weight: 2 },
            { type: 'output_contains', value: 'timed out', weight: 2 },
        ],
        diagnosis: {
            summary: 'Request Timed Out',
            explanation: 'The request took too long to complete and was terminated. The server may be slow or the request may be too heavy.',
            rootCause: 'Server response time exceeded timeout limit',
        },
        fixes: [
            {
                id: 'increase-timeout',
                description: 'Increase request timeout limit',
                action: { type: 'manual', instructions: 'If the job supports timeout configuration, increase the value.' },
                confidence: 0.6,
            },
            {
                id: 'reduce-payload',
                description: 'Reduce request size or use pagination',
                action: { type: 'manual', instructions: 'Try reducing the amount of data requested. Use pagination or smaller batch sizes.' },
                confidence: 0.7,
            },
        ],
        isBuiltin: true,
    },

    // Missing Content-Type
    {
        id: 'missing-content-type',
        category: 'bad_request',
        name: 'Missing Content-Type Header',
        triggers: [
            { type: 'status', value: 415, weight: 3 },
            { type: 'output_contains', value: 'unsupported media type', weight: 2 },
            { type: 'output_contains', value: 'content-type', weight: 1 },
        ],
        diagnosis: {
            summary: 'Unsupported Media Type',
            explanation: 'The server returned 415 Unsupported Media Type. The Content-Type header may be missing or incorrect.',
            rootCause: 'Missing or incorrect Content-Type header',
        },
        fixes: [
            {
                id: 'add-content-type-json',
                description: 'Add Content-Type: application/json header',
                action: { type: 'add_header', key: 'Content-Type', value: 'application/json' },
                confidence: 0.9,
            },
        ],
        isBuiltin: true,
    },
];

/**
 * Match an error against patterns and return scored results
 */
export function matchPatterns(
    error: string | null,
    httpStatus?: number,
    url?: string,
    jobType?: string,
    customPatterns?: ErrorPattern[]
): MatchedPattern[] {
    const allPatterns = [...BUILTIN_ERROR_PATTERNS, ...(customPatterns || [])];
    const results: MatchedPattern[] = [];

    const errorLower = (error || '').toLowerCase();
    const urlLower = (url || '').toLowerCase();

    // A trigger can only be evidence if the evidence it inspects was supplied.
    // Scoring against triggers that had nothing to look at is what made this matcher
    // blind to its most retryable errors: request-timeout weights HTTP 408/504 at 3
    // each against two text triggers at 2, so an internal timeout carrying no HTTP
    // status could reach at most 2/10 = 0.20 and never cleared the 0.30 threshold.
    // Timeouts and network failures — the two classes most worth retrying — were
    // therefore the two that could never be classified, and retry-service.ts reads
    // `diagnosis.bestMatch?.pattern.category`, so an unmatched error is never retried.
    const hasError = Boolean(error && error.trim());
    const hasStatus = httpStatus !== undefined && httpStatus !== null;
    const hasUrl = Boolean(url && url.trim());
    const hasJobType = Boolean(jobType);

    const isApplicable = (type: ErrorPatternTrigger['type']): boolean => {
        switch (type) {
            case 'status': return hasStatus;
            case 'url_contains': return hasUrl;
            case 'job_type': return hasJobType;
            case 'output_contains':
            case 'regex':
            case 'error_code': return hasError;
            default: return false;
        }
    };

    for (const pattern of allPatterns) {
        let applicableWeight = 0;
        let strongestApplicable = 0;
        let strongestMatched = 0;
        let matchedWeight = 0;
        const matchedTriggers: ErrorPatternTrigger[] = [];

        for (const trigger of pattern.triggers) {
            const weight = trigger.weight || 1;
            // Skipped entirely, not merely unmatched: a trigger with no evidence to
            // inspect must not influence the score of the ones that had evidence.
            if (!isApplicable(trigger.type)) continue;
            applicableWeight += weight;
            strongestApplicable = Math.max(strongestApplicable, weight);

            let matched = false;
            switch (trigger.type) {
                case 'status':
                    matched = httpStatus === trigger.value;
                    break;
                case 'regex':
                    try {
                        matched = new RegExp(trigger.value as string, 'i').test(errorLower);
                    } catch {
                        matched = false;
                    }
                    break;
                case 'output_contains':
                    matched = errorLower.includes((trigger.value as string).toLowerCase());
                    break;
                case 'url_contains':
                    matched = urlLower.includes((trigger.value as string).toLowerCase());
                    break;
                case 'job_type':
                    matched = jobType === trigger.value;
                    break;
                case 'error_code':
                    matched = error?.includes(trigger.value as string) || false;
                    break;
            }

            if (matched) {
                matchedWeight += weight;
                strongestMatched = Math.max(strongestMatched, weight);
                matchedTriggers.push(trigger);
            }
        }

        // strongestApplicable is 0 when the pattern had no applicable trigger at all —
        // a URL-and-status-only pattern judged from an error string alone, say. That is
        // absence of evidence rather than a perfect match, so the pattern is skipped.
        if (matchedTriggers.length > 0 && strongestApplicable > 0) {
            // Confidence blends two readings of the same match.
            //
            // `decisiveness` asks how strong the best signal found was against the best
            // this pattern could have offered. It exists because these trigger lists are
            // ALTERNATIVES rather than cumulative evidence: network-error lists
            // ECONNREFUSED, ETIMEDOUT and getaddrinfo, and a socket failure is exactly
            // one of them. Judging by the summed total made a conclusive match look like
            // weak partial agreement — ECONNREFUSED scored 2/7.5 = 0.27, under the 0.30
            // threshold, so the clearest network failure there is went unclassified and
            // unretried.
            //
            // `corroboration` keeps the old proportion-of-evidence reading, so a pattern
            // several of whose triggers agree still outranks one resting on a single hit.
            // On decisiveness alone every match scored exactly 1.00, which cleared the
            // threshold but left matched_pattern_score carrying no information at all.
            const decisiveness = strongestMatched / strongestApplicable;
            const corroboration = matchedWeight / applicableWeight;
            const score = (decisiveness + corroboration) / 2;
            results.push({
                pattern,
                score,
                matchedTriggers,
            });
        }
    }

    // Sort by score descending, breaking ties on absolute matched weight. Narrowing the
    // denominator means a single applicable trigger can score 1.00, so two patterns can
    // tie on ratio while resting on very different amounts of evidence; the better
    // supported one should win.
    return results.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const aWeight = a.matchedTriggers.reduce((sum, t) => sum + (t.weight || 1), 0);
        const bWeight = b.matchedTriggers.reduce((sum, t) => sum + (t.weight || 1), 0);
        return bWeight - aWeight;
    });
}

/**
 * Get the best matching pattern if score is above threshold
 */
export function getBestMatch(
    error: string | null,
    httpStatus?: number,
    url?: string,
    jobType?: string,
    threshold: number = 0.3
): MatchedPattern | null {
    const matches = matchPatterns(error, httpStatus, url, jobType);
    if (matches.length > 0 && matches[0].score >= threshold) {
        return matches[0];
    }
    return null;
}

/**
 * Get pattern by ID
 */
export function getPatternById(id: string, customPatterns?: ErrorPattern[]): ErrorPattern | undefined {
    const allPatterns = [...BUILTIN_ERROR_PATTERNS, ...(customPatterns || [])];
    return allPatterns.find(p => p.id === id);
}
