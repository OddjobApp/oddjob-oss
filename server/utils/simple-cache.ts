export class SimpleCache {
    private cache = new Map<string, { value: any; expiry: number }>();
    private ttlSeconds: number;

    constructor(options: { stdTTL: number; checkperiod?: number }) {
        this.ttlSeconds = options.stdTTL;
    }

    set(key: string, value: any): void {
        const expiry = Date.now() + (this.ttlSeconds * 1000);
        this.cache.set(key, { value, expiry });
    }

    get<T>(key: string): T | undefined {
        const item = this.cache.get(key);
        if (!item) return undefined;

        if (Date.now() > item.expiry) {
            this.cache.delete(key);
            return undefined;
        }

        return item.value;
    }

    del(key: string): void {
        this.cache.delete(key);
    }
}

