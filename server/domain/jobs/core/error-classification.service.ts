export enum ErrorCategory {
    TRANSIENT = 'transient',
    PERMANENT = 'permanent',
    RATE_LIMIT = 'rate_limit',
    AUTHENTICATION = 'authentication',
    AUTHORIZATION = 'authorization',
    VALIDATION = 'validation',
    BUILD_FAILURE = 'build_failure',
    TEST_FAILURE = 'test_failure',
    DEPENDENCY_MISSING = 'dependency_missing',
    WORKSPACE_ERROR = 'workspace_error',
    UNKNOWN = 'unknown',
}

export class ErrorClassificationService {
    classify(error: Error): ErrorCategory {
        const message = error.message ? error.message.toLowerCase() : '';
        const name = error.constructor ? error.constructor.name : '';

        // SDLC-specific: Build/compilation failures
        if (message.includes('build failed') || message.includes('compilation error') ||
            message.includes('tsc') || message.includes('type error') ||
            message.includes('typescript error') || message.includes('cannot find module') ||
            message.includes('syntax error') || message.includes('unexpected token') ||
            message.includes('export encountered errors') || message.includes('module not found')) {
            return ErrorCategory.BUILD_FAILURE;
        }

        // SDLC-specific: Test failures
        if (message.includes('test failed') || message.includes('assertion') ||
            message.includes('expect(') || message.includes('test suite failed') ||
            message.includes('jest') || message.includes('vitest') ||
            message.includes('playwright') || message.includes('spec failed')) {
            return ErrorCategory.TEST_FAILURE;
        }

        // SDLC-specific: Dependency/package issues
        if (message.includes('npm err') || message.includes('enoent') ||
            message.includes('package not found') || message.includes('peer dep') ||
            message.includes('could not resolve') || message.includes('npm install') ||
            message.includes('yarn') || message.includes('lock file')) {
            return ErrorCategory.DEPENDENCY_MISSING;
        }

        // SDLC-specific: Workspace/filesystem issues
        if (message.includes('workspace') || message.includes('no such file or directory') ||
            message.includes('permission denied') || message.includes('eacces') ||
            message.includes('disk full') || message.includes('git') && message.includes('error')) {
            return ErrorCategory.WORKSPACE_ERROR;
        }

        // Network errors
        if (message.includes('timeout') || message.includes('etimedout')) {
            return ErrorCategory.TRANSIENT;
        }
        if (message.includes('econnrefused') || message.includes('econnreset') || message.includes('network error')) {
            return ErrorCategory.TRANSIENT;
        }

        // Rate limiting
        if (message.includes('rate limit') || message.includes('429') || message.includes('too many requests')) {
            return ErrorCategory.RATE_LIMIT;
        }

        // Authentication
        if (message.includes('unauthorized') || message.includes('401') || message.includes('invalid api key')) {
            return ErrorCategory.AUTHENTICATION;
        }

        // Authorization
        if (message.includes('forbidden') || message.includes('403')) {
            return ErrorCategory.AUTHORIZATION;
        }

        // Validation
        if (name.includes('Validation') || message.includes('bad request') || message.includes('400') || message.includes('invalid input') || message.includes('validation') || message.includes('invalid')) {
            return ErrorCategory.VALIDATION;
        }

        // Permanent errors
        if (message.includes('not found') || message.includes('404')) {
            return ErrorCategory.PERMANENT;
        }

        // Default
        return ErrorCategory.UNKNOWN;
    }

    shouldRetry(category: ErrorCategory): boolean {
        return [
            ErrorCategory.TRANSIENT,
            ErrorCategory.RATE_LIMIT,
            ErrorCategory.BUILD_FAILURE,
            ErrorCategory.TEST_FAILURE,
            ErrorCategory.DEPENDENCY_MISSING,
        ].includes(category);
    }

    getRecoveryAction(category: ErrorCategory): string {
        switch (category) {
            case ErrorCategory.TRANSIENT:
                return 'Retry with exponential backoff';
            case ErrorCategory.RATE_LIMIT:
                return 'Wait and retry with longer delay';
            case ErrorCategory.AUTHENTICATION:
                return 'Refresh credentials and retry';
            case ErrorCategory.AUTHORIZATION:
                return 'Check permissions and retry';
            case ErrorCategory.VALIDATION:
                return 'Fix input data and retry';
            case ErrorCategory.PERMANENT:
                return 'Manual intervention required';
            case ErrorCategory.BUILD_FAILURE:
                return 'Clear build cache and retry compilation';
            case ErrorCategory.TEST_FAILURE:
                return 'Review test output and fix code, then re-run tests';
            case ErrorCategory.DEPENDENCY_MISSING:
                return 'Run npm install to restore dependencies, then retry';
            case ErrorCategory.WORKSPACE_ERROR:
                return 'Validate workspace health and repair filesystem state';
            default:
                return 'Investigate and retry';
        }
    }
}

export const errorClassificationService = new ErrorClassificationService();
