export class TokenBucketRateLimiter {
    private tokens: number;
    private lastRefill: number;

    constructor(
        private capacity: number,
        private fillPerSecond: number
    ) {
        this.tokens = capacity;
        this.lastRefill = Date.now();
    }

    private refill() {
        const now = Date.now();
        const elapsedTime = now - this.lastRefill;
        const newTokens = elapsedTime * (this.fillPerSecond / 1000);
        
        if (newTokens > 0) {
            this.tokens = Math.min(this.capacity, this.tokens + newTokens);
            this.lastRefill = now;
        }
    }

    async acquire(tokens = 1): Promise<void> {
        if (tokens > this.capacity) {
            throw new Error(`Cannot acquire ${tokens} tokens, capacity is only ${this.capacity}`);
        }

        while (true) {
            this.refill();

            if (this.tokens >= tokens) {
                this.tokens -= tokens;
                return;
            }

            const tokensNeeded = tokens - this.tokens;
            const msToWait = (tokensNeeded / this.fillPerSecond) * 1000;
            
            await new Promise(resolve => setTimeout(resolve, Math.max(10, msToWait)));
        }
    }
}
