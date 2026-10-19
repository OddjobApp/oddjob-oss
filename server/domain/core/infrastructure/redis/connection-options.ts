import type { RedisOptions } from "ioredis";

/** Connection options for clients that accept an options object (e.g. BullMQ). */
export function redisConnectionOptions(environment: NodeJS.ProcessEnv = process.env): RedisOptions {
    let url: URL;
    try {
        url = new URL(environment.REDIS_URL || "redis://127.0.0.1:6379");
    } catch {
        throw new Error("REDIS_URL must be a valid Redis URL");
    }
    if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
        throw new Error("REDIS_URL must use redis:// or rediss://");
    }
    const database = url.pathname.slice(1);
    if (database && !/^\d+$/.test(database)) {
        throw new Error("REDIS_URL database must be a non-negative integer");
    }
    const port = Number(environment.REDIS_URL ? url.port || 6379 : environment.REDIS_PORT || 6379);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error("Redis port must be an integer between 1 and 65535");
    }
    return {
        host: environment.REDIS_URL ? url.hostname.replace(/^\[|\]$/g, "") : environment.REDIS_HOST || url.hostname,
        port,
        db: Number(database || 0),
        ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
        ...(environment.REDIS_PASSWORD || url.password
            ? { password: environment.REDIS_PASSWORD || decodeURIComponent(url.password) }
            : {}),
        ...(url.protocol === "rediss:" ? { tls: {} } : {}),
    };
}
