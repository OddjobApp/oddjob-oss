export interface CircuitBreakerState {
    failures: number;
    lastFailureTime: number;
    status: 'closed' | 'open' | 'half-open';
}

export class CircuitBreaker {
    private static breakers: Record<string, CircuitBreakerState> = {};
    private static readonly BREAKER_THRESHOLD = 3;
    private static readonly BREAKER_RESET_TIMEOUT = 30000; // 30 seconds

    public static isOpen(source: string): boolean {
        const breaker = this.breakers[source];
        if (!breaker || breaker.status === 'closed') return false;

        if (breaker.status === 'open') {
            const now = Date.now();
            if (now - breaker.lastFailureTime > this.BREAKER_RESET_TIMEOUT) {
                breaker.status = 'half-open';
                return false;
            }
            return true;
        }

        return false;
    }

    public static recordFailure(source: string) {
        if (!this.breakers[source]) {
            this.breakers[source] = { failures: 0, lastFailureTime: 0, status: 'closed' };
        }
        const breaker = this.breakers[source];
        breaker.failures++;
        breaker.lastFailureTime = Date.now();

        if (breaker.failures >= this.BREAKER_THRESHOLD) {
            breaker.status = 'open';
        }
    }

    public static recordSuccess(source: string) {
        if (this.breakers[source]) {
            this.breakers[source] = { failures: 0, lastFailureTime: 0, status: 'closed' };
        }
    }
}

