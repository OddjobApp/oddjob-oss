export interface RetryOptions {
    maxRetries?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    backoffFactor?: number;
    jitter?: boolean;
    timeoutMs?: number;
    isRetryable?: (error: Error) => boolean;
    onRetry?: (error: Error, attempt: number) => void;
    signal?: AbortSignal;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, "signal" | "timeoutMs">> = {
    maxRetries: 3,
    initialDelayMs: 1000,
    maxDelayMs: 30000,
    backoffFactor: 2,
    jitter: true,
    isRetryable: () => true,
    onRetry: () => { },
};

export async function retry<T>(
    fn: () => Promise<T>,
    options: RetryOptions = {}
): Promise<T> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
        if (opts.signal?.aborted) {
            throw new Error("Retry aborted");
        }

        try {
            if (opts.timeoutMs) {
                return await executeWithTimeout(fn, opts.timeoutMs);
            }
            return await fn();

        } catch (error: any) {
            lastError = error;

            if (attempt >= opts.maxRetries) {
                break;
            }

            if (!opts.isRetryable(error)) {
                throw error;
            }

            const delay = calculateDelay(attempt, opts);
            opts.onRetry(error, attempt + 1);

            await sleep(delay, opts.signal);
        }
    }

    throw lastError || new Error("Retry failed with no error");
}

async function executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number
): Promise<T> {
    return Promise.race([
        fn(),
        new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs);
        }),
    ]);
}

function calculateDelay(attempt: number, opts: typeof DEFAULT_OPTIONS): number {
    let delay = opts.initialDelayMs * Math.pow(opts.backoffFactor, attempt);
    delay = Math.min(delay, opts.maxDelayMs);

    if (opts.jitter) {
        const jitterFactor = 0.75 + Math.random() * 0.5;
        delay = Math.floor(delay * jitterFactor);
    }

    return delay;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(resolve, ms);

        signal?.addEventListener("abort", () => {
            clearTimeout(timeout);
            reject(new Error("Sleep aborted"));
        });
    });
}

export function withRetry<T extends (...args: any[]) => Promise<any>>(
    fn: T,
    options: RetryOptions = {}
): T {
    return ((...args: Parameters<T>) => retry(() => fn(...args), options)) as T;
}

export const RetryPredicates = {
    networkErrors: (error: Error) => {
        const message = error.message.toLowerCase();
        return (
            message.includes("network") ||
            message.includes("econnrefused") ||
            message.includes("econnreset") ||
            message.includes("etimedout") ||
            message.includes("timeout") ||
            message.includes("socket hang up")
        );
    },
    serverErrors: (error: any) => {
        const status = error.status || error.statusCode;
        return status >= 500 && status < 600;
    },
    rateLimits: (error: any) => {
        const status = error.status || error.statusCode;
        return status === 429;
    },
    transientErrors: (error: any) => {
        return (
            RetryPredicates.networkErrors(error) ||
            RetryPredicates.serverErrors(error) ||
            RetryPredicates.rateLimits(error)
        );
    },
};

export async function fetchWithRetry(
    url: string,
    init?: RequestInit,
    retryOptions?: RetryOptions
): Promise<Response> {
    return retry(async () => {
        const response = await fetch(url, init);
        if (response.status >= 500) {
            const error: any = new Error(`HTTP ${response.status}`);
            error.status = response.status;
            throw error;
        }
        return response;
    }, {
        isRetryable: RetryPredicates.transientErrors,
        ...retryOptions,
    });
}

