export class CircuitBreaker {
    private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
    private failures = 0;
    private nextAttempt = 0;

    constructor(
        private threshold: number,
        private timeoutMs: number
    ) {}

    async execute<T>(action: () => Promise<T>): Promise<T> {
        if (this.state === 'OPEN') {
            if (Date.now() > this.nextAttempt) {
                this.state = 'HALF_OPEN';
            } else {
                throw new Error("Circuit breaker is OPEN");
            }
        }

        try {
            const result = await action();
            if (this.state === 'HALF_OPEN') {
                this.state = 'CLOSED';
                this.failures = 0;
            }
            return result;
        } catch (error) {
            this.failures++;
            if (this.failures >= this.threshold) {
                this.state = 'OPEN';
                this.nextAttempt = Date.now() + this.timeoutMs;
            }
            throw error;
        }
    }
}
