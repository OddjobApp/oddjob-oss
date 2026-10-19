// @vitest-environment node
// Booting the express app under the default jsdom environment trips
// "new TextEncoder().encode('') instanceof Uint8Array is incorrectly false" — the
// server-side integration suites all declare the node environment.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
// '../../server.js' does not exist — the original import was a guess ("Assuming your
// main express app is exported from server.js"), so this OAuth suite never collected
// and has never run. The app is exported from server/index.ts, and serverReady must be
// awaited before routes are registered.
import { app, serverReady } from '@server/index.js';

// vi.hoisted: the vi.mock factories below are hoisted above these declarations, so
// plain consts are read from the temporal dead zone and the file fails to collect.
const { mockDb, mockEncryptionService, insertedValues } = vi.hoisted(() => {
    // `values` lives on the chain object, which is rebuilt per call, so
    // `mockDb.values` was undefined and assertion 3 could never have run — it
    // failed as "undefined is not a spy" the moment the request got far enough
    // to reach it. One shared spy records what any chain was asked to insert.
    const insertedValues = vi.fn();
    // Chainable, order-independent, and thenable. The original double used
    // mockReturnThis for builders but resolved on `where`, which broke the chain the
    // moment the route called `.limit(1)`.
    const makeChain = (rows: any[] = []) => {
        const q: any = {
            from: () => q, innerJoin: () => q, leftJoin: () => q, where: () => q,
            orderBy: () => q, groupBy: () => q, limit: () => q, offset: () => q,
            values: (...args: any[]) => { insertedValues(...args); return q; },
            set: () => q, onConflictDoNothing: () => q,
            onConflictDoUpdate: () => q,
            returning: () => Promise.resolve([{ id: 1 }]),
            then: (resolve: any, reject: any) => Promise.resolve(rows).then(resolve, reject),
        };
        return q;
    };

    const mockDbRef: any = {};
    const built = {
        mockDb: {
            select: vi.fn(() => makeChain([])),   // no existing connector by default
            insert: vi.fn(() => makeChain([])),
            update: vi.fn(() => makeChain([])),
            delete: vi.fn(() => makeChain([])),
            execute: vi.fn().mockResolvedValue({ rows: [] }),
            transaction: vi.fn(async (cb: any) => cb(mockDbRef)),
        },
        mockEncryptionService: {
            store: vi.fn().mockResolvedValue({ id: 123 }),
        },
        insertedValues,
    };
    Object.assign(mockDbRef, built.mockDb);
    return built;
});

// database_service exports `pool` alongside `db`; omitting it makes vitest reject the
// mock outright ("No 'pool' export is defined").
vi.mock('@server/database_service.js', () => ({
    db: mockDb,
    pool: { query: vi.fn().mockResolvedValue({ rows: [] }), end: vi.fn(), connect: vi.fn() },
    getPoolMetrics: () => ({}),
    startPoolMetricsLogging: () => {},
    stopPoolMetricsLogging: () => {},
    checkDatabaseConnection: async () => ({ connected: true }),
    reinitializeDatabase: () => {},
    monitoredQuery: async (_n: string, fn: any) => fn(),
}));

// The OAuth routes are guarded by requireAuth — a 401 here is CORRECT behaviour, not a
// bug, and the original test never authenticated. This suite exercises the OAuth
// mechanics (state, token exchange, credential storage), so auth is stubbed to a
// pass-through with a session; the guard itself is covered by the auth suites.
vi.mock('@domain/core/auth/security.service.js', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
        ...actual,
        requireAuth: (req: any, _res: any, next: any) => {
            // Augment the real session rather than replacing it: express-session's
            // object carries touch()/save(), and swapping in a plain object made the
            // route throw "req.session.touch is not a function".
            if (!req.session) {
                req.session = { touch: () => {}, save: (cb?: any) => cb?.(), destroy: (cb?: any) => cb?.() };
            }
            req.session.userId = 'test-user';
            req.session.activeOrgId = 1;
            req.session.defaultOrgId = 1;
            req.user = { id: 'test-user', username: 'test-user', defaultOrgId: 1 };
            req.organizationId = 1;
            next();
        },
    };
});

// The initiate route stores a CSRF state token in redis.
vi.mock('@domain/core/infrastructure/redis/redis-client.js', () => {
    const store = new Map<string, string>();

    // The app touches a wide slice of the ioredis surface (setex, get, hset, ...).
    // Enumerating it by hand converges slowly and fails one method at a time, so the
    // client auto-stubs any unknown method as an async no-op while the few calls this
    // suite depends on are backed by a real map.
    const known: Record<string, any> = {
        setex: vi.fn(async (k: string, _ttl: number, v: string) => { store.set(k, v); return 'OK'; }),
        set: vi.fn(async (k: string, v: string) => { store.set(k, v); return 'OK'; }),
        get: vi.fn(async (k: string) => store.get(k) ?? null),
        del: vi.fn(async (k: string) => { store.delete(k); return 1; }),
        exists: vi.fn(async (k: string) => (store.has(k) ? 1 : 0)),
        on: vi.fn(),
    };
    const client: any = new Proxy(known, {
        get(target, prop: string | symbol) {
            if (typeof prop !== 'string') return undefined;
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
});

// The callback resolves the caller's organization via getUserOrgContext, which reads
// the user's org membership from the database. With the db mocked to return no rows
// that yields "Organization context required" (403). Resolve it directly instead.
vi.mock('@server/utils/auth-context.js', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
        ...actual,
        getUserOrgContext: async () => ({
            userId: 'test-user',
            organizationId: 1,
            isAdmin: true,
            isSuperAdmin: false,
            isOrgAdmin: true,
        }),
    };
});

vi.mock('@domain/auth/core/encrypted-credentials.service.js', () => ({
    encryptedCredentialsService: mockEncryptionService
}));

// Token-exchange fetch stub. Assigning global.fetch at module scope did not survive
// to assertion time (it read back undefined — "undefined is not a spy"), so it is
// installed per-test via vi.stubGlobal, which vitest tracks and restores.
let fetchMock: ReturnType<typeof vi.fn>;

describe("Jira OAuth 2.0 Flow", () => {

    beforeAll(async () => {
        // Routes are registered asynchronously during boot; without this the requests
        // below race registration and 404.
        await serverReady;
    });

    beforeEach(() => {
        vi.clearAllMocks();
        // The adapter refuses to exchange a code without real credentials,
        // where the inline implementation carried "YOUR_JIRA_CLIENT_ID"
        // placeholders and would have posted them to Atlassian.
        vi.stubEnv("JIRA_CLIENT_ID", "test-client-id");
        vi.stubEnv("JIRA_CLIENT_SECRET", "test-client-secret");
        fetchMock = vi.fn(async () => ({
            ok: true,
            status: 200,
            headers: new Headers(),
            text: async () => JSON.stringify({ access_token: 'fake-access-token', refresh_token: 'fake-refresh-token' }),
            json: async () => ({ access_token: 'fake-access-token', refresh_token: 'fake-refresh-token' }),
        }));
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("should redirect to the Jira authorization URL", async () => {
        const response = await request(app)
            .get("/api/saas/connectors/jira/oauth/initiate")
            .expect(302);

        expect(response.headers.location).toContain('https://auth.atlassian.com/authorize');
    });

    it("should handle the callback, exchange the code, and store credentials", async () => {
        // The state is single-use and issued by the adapter, so it has to come
        // from a real initiate rather than a magic string. The previous version
        // sent `state=fake-state` and passed because the redis double's `del`
        // reported success for any key — it never proved a state round-trip.
        const initiated = await request(app)
            .get("/api/saas/connectors/jira/oauth/initiate")
            .expect(302);
        const state = new URL(initiated.headers.location).searchParams.get("state");
        expect(state).toBeTruthy();

        const response = await request(app)
            .get(`/api/saas/connectors/jira/oauth/callback?code=fake-code&state=${state}`)
            .expect(302); // Expect redirect back to the frontend

        // 1. Was the Jira token endpoint called?
        expect(fetchMock).toHaveBeenCalledWith('https://auth.atlassian.com/oauth/token', expect.any(Object));

        // 2. Were the tokens stored securely, and filed under the CONNECTOR?
        //    This asserted `0` — the temporary entityId the first implementation
        //    never replaced. Since `store` upserts on (entityType, entityId,
        //    credentialType) without matching the organization, that made one
        //    row for every organization's Jira tokens, each connection
        //    overwriting the last. The connector id (1, from the db double's
        //    `returning`) is what a later read looks it up by.
        expect(mockEncryptionService.store).toHaveBeenCalledOnce();
        expect(mockEncryptionService.store).toHaveBeenCalledWith(
            expect.any(Number), 'saas_connector', 1, 'jira_oauth_token',
            expect.objectContaining({
                accessToken: 'fake-access-token',
                refreshToken: 'fake-refresh-token',
            })
        );

        // 3. Was a new saas_connector created?
        expect(mockDb.insert).toHaveBeenCalledOnce();
        expect(insertedValues).toHaveBeenCalledWith(expect.objectContaining({ platform: 'jira', status: 'connected' }));

        // 4. Did we redirect back to the integrations page?
        expect(response.headers.location).toBe('/admin/integrations?status=jira_connected');
    });

    it("refuses a callback whose state was never issued", async () => {
        await request(app)
            .get("/api/saas/connectors/jira/oauth/callback?code=fake-code&state=never-issued")
            .expect(400);

        expect(mockEncryptionService.store).not.toHaveBeenCalled();
    });
});
