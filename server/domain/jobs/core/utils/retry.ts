export async function withRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    baseDelayMs: number = 1000
): Promise<T> {
    let attempt = 0;
    while (true) {
        try {
            return await operation();
        } catch (error: any) {
            attempt++;
            if (attempt > maxRetries) {
                throw error;
            }
            // Check if it's a rate limit error (e.g. 429)
            if (error.response?.status === 429) {
                // Parse retry-after if available, otherwise use exponential backoff
                const retryAfterStr = error.response?.headers?.['retry-after'];
                let delay = retryAfterStr ? parseInt(retryAfterStr, 10) * 1000 : baseDelayMs * Math.pow(2, attempt);
                // Add jitter
                delay = delay + Math.random() * 1000;
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                // For other errors, use exponential backoff
                const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 500;
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
}
