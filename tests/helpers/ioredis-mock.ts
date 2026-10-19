/**
 * An ioredis double that redis-client's `createClient` can actually wrap.
 *
 * createClient does not hand back the client it constructs. It wraps `set`,
 * `get`, `setex` and `del` with metrics by calling `.bind(client)` on each, and
 * registers connect/ready/error/close listeners. A double missing any one of
 * them throws `Cannot read properties of undefined (reading 'bind')` — and it
 * throws while the module graph is still loading, because the governor modules
 * touch `redisService.client` at import time. The suite then reports **0 tests**
 * rather than a failure, and the stack names redis-client rather than the
 * double that caused it, which is why three separate suites sat dark with
 * three different symptoms.
 *
 * Anything not named here auto-stubs to an async no-op, so a suite that reaches
 * a new command gets `undefined` back instead of a collection error. Pass
 * `overrides` for the commands a test actually asserts on — spies created in a
 * `vi.hoisted` block, since a `vi.mock` factory is hoisted above the file's
 * own consts.
 *
 *   const { xadd } = vi.hoisted(() => ({ xadd: vi.fn().mockResolvedValue("1-0") }));
 *   vi.mock("ioredis", async () => {
 *       const { ioredisMockModule } = await import("../helpers/ioredis-mock.js");
 *       return ioredisMockModule({ xadd });
 *   });
 */
import { vi } from "vitest";

/** The commands createClient binds, and the connection surface it listens on. */
const REQUIRED_COMMANDS = ["set", "get", "setex", "del"] as const;

export function createIoredisMockClass(overrides: Record<string, unknown> = {}) {
    return class RedisMock {
        constructor() {
            for (const command of REQUIRED_COMMANDS) {
                if (!(command in overrides)) {
                    (this as any)[command] = vi.fn(async () =>
                        command === "del" ? 0 : command === "get" ? null : "OK",
                    );
                }
            }

            // Connection lifecycle: createClient attaches four listeners, and
            // ioredis returns the client from `on` for chaining.
            (this as any).on = (this as any).on ?? vi.fn(function (this: unknown) { return this; });
            (this as any).once = (this as any).once ?? vi.fn(function (this: unknown) { return this; });
            (this as any).quit = (this as any).quit ?? vi.fn(async () => "OK");
            (this as any).connect = (this as any).connect ?? vi.fn(async () => undefined);
            (this as any).disconnect = (this as any).disconnect ?? vi.fn(() => undefined);
            (this as any).ping = (this as any).ping ?? vi.fn(async () => "PONG");

            for (const [name, value] of Object.entries(overrides)) {
                (this as any)[name] = value;
            }

            // Unknown commands answer null rather than failing collection.
            return new Proxy(this, {
                get(target: any, prop: string | symbol) {
                    if (typeof prop !== "string") return target[prop];
                    if (!(prop in target)) target[prop] = vi.fn(async () => null);
                    return target[prop];
                },
            });
        }
    };
}

/** The module shape `vi.mock("ioredis", …)` has to return. */
export function ioredisMockModule(overrides: Record<string, unknown> = {}) {
    const RedisMock = createIoredisMockClass(overrides);
    return { default: RedisMock, Redis: RedisMock };
}

/**
 * The same idea one level up, for suites that mock redis-client itself.
 *
 * Listing only the commands a test asserts on is not enough: modules run
 * commands during import — pod-registry calls `redis.hset` as `server/auth`
 * loads — so an unlisted command is a TypeError before any test exists. Every
 * command answers a resolved promise, which is also what the fire-and-forget
 * callers need for their `.catch`.
 */
export function redisClientMockModule(overrides: Record<string, unknown> = {}) {
    const client: any = new Proxy({ ...overrides }, {
        get(target: any, prop: string | symbol) {
            if (typeof prop !== "string") return target[prop];
            if (!(prop in target)) target[prop] = vi.fn(async () => null);
            return target[prop];
        },
    });

    return {
        redis: client,
        subscriber: client,
        publisher: client,
        nodeRedisClient: client,
        getRedisClient: () => client,
        getRedisOptions: () => ({}),
        redisService: { isReady: () => true, client },
        redisManager: { isReady: () => true, client },
        recordCacheHit: () => {},
        recordCacheMiss: () => {},
        RedisService: class {},
    };
}
