/**
 * OpenAPI Auth Introspection Tests
 *
 * Tests the applyOpenApiAuth function via the exported executor.
 * We isolate the auth logic by importing it directly from the module
 * using a re-export shim approach — the function is package-private
 * so we test it end-to-end through the executor's HTTP request shape.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Extract applyOpenApiAuth by importing the module internals ────────────────
// We expose the function for testing by importing the module and calling
// the executor with a mocked fetch + DB, then asserting on headers.

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

vi.mock("@server/database_service.js", () => ({
    db: {
        select: vi.fn().mockReturnThis(),
        from:   vi.fn().mockReturnThis(),
        where:  vi.fn().mockReturnThis(),
        limit:  vi.fn(),
    },
}));
vi.mock("drizzle-orm", async (importOriginal) => {
    const actual = await importOriginal<typeof import("drizzle-orm")>();
    return { ...actual, eq: vi.fn() };
});

import { db } from "@server/database_service.js";

const makeSpec = (securitySchemes: any, operationSecurity?: any[]) => ({
    servers: [{ url: "https://api.example.com" }],
    paths: {
        "/things": {
            get: {
                operationId: "listThings",
                security: operationSecurity,
            },
        },
    },
    components: { securitySchemes },
});

const makeCredential = (type: string) => ({
    id: 1,
    envVarName: "TEST_SECRET",
    type,
});

const makeOkResponse = () => ({
    ok: true,
    text: async () => '{"result":"ok"}',
});

async function runExecutor(spec: any, credentialType: string) {
    process.env.TEST_SECRET = "supersecret123";

    const { db: mockDb } = await import("@server/database_service.js") as any;
    // First DB call: apiSpecs
    mockDb.limit
        .mockResolvedValueOnce([{ id: 1, content: JSON.stringify(spec) }])
        // Second DB call: credentials
        .mockResolvedValueOnce([makeCredential(credentialType)]);

    mockFetch.mockResolvedValue(makeOkResponse());

    const { OpenApiExecutor } = await import("../../core/executors/openapi-executor.js");
    const executor = new OpenApiExecutor();

    const job = { id: 1 } as any;
    const pipeline = {} as any;
    const context = {} as any;
    const config = {
        specId: 1,
        operationId: "listThings",
        parameters: {},
        credentialId: 1,
    };

    await executor.execute(job, config, pipeline, context);
    return mockFetch.mock.calls[0][1] as RequestInit;
}

describe("applyOpenApiAuth — HTTP Bearer", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFetch.mockReset();
    });

    it("uses Bearer when spec declares http/bearer scheme", async () => {
        const spec = makeSpec(
            { BearerAuth: { type: "http", scheme: "bearer" } },
            [{ BearerAuth: [] }],
        );
        const init = await runExecutor(spec, "api_key");
        expect((init.headers as any)["Authorization"]).toBe("Bearer supersecret123");
    });

    it("uses Basic when spec declares http/basic scheme", async () => {
        const spec = makeSpec(
            { BasicAuth: { type: "http", scheme: "basic" } },
            [{ BasicAuth: [] }],
        );
        const init = await runExecutor(spec, "password");
        const expected = `Basic ${Buffer.from("supersecret123").toString("base64")}`;
        expect((init.headers as any)["Authorization"]).toBe(expected);
    });
});

describe("applyOpenApiAuth — apiKey", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFetch.mockReset();
    });

    it("puts apiKey in header when in=header", async () => {
        const spec = makeSpec(
            { ApiKeyHeader: { type: "apiKey", in: "header", name: "X-Api-Key" } },
            [{ ApiKeyHeader: [] }],
        );
        const init = await runExecutor(spec, "api_key");
        expect((init.headers as any)["X-Api-Key"]).toBe("supersecret123");
        expect((init.headers as any)["Authorization"]).toBeUndefined();
    });

    it("puts apiKey in query when in=query", async () => {
        const spec = makeSpec(
            { ApiKeyQuery: { type: "apiKey", in: "query", name: "api_key" } },
            [{ ApiKeyQuery: [] }],
        );
        await runExecutor(spec, "api_key");
        const calledUrl = mockFetch.mock.calls[0][0] as string;
        expect(calledUrl).toContain("api_key=supersecret123");
    });
});

describe("applyOpenApiAuth — OAuth2", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFetch.mockReset();
    });

    it("uses Bearer for oauth2 scheme", async () => {
        const spec = makeSpec(
            { OAuth2: { type: "oauth2", flows: {} } },
            [{ OAuth2: [] }],
        );
        const init = await runExecutor(spec, "oauth_token");
        expect((init.headers as any)["Authorization"]).toBe("Bearer supersecret123");
    });
});

describe("applyOpenApiAuth — fallback", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFetch.mockReset();
    });

    it("falls back to Bearer when no security schemes defined", async () => {
        const spec = makeSpec({}, []);
        const init = await runExecutor(spec, "api_key");
        expect((init.headers as any)["Authorization"]).toBe("Bearer supersecret123");
    });

    it("falls back to Basic when credential type is password and no scheme defined", async () => {
        const spec = makeSpec({}, []);
        const init = await runExecutor(spec, "password");
        const expected = `Basic ${Buffer.from("supersecret123").toString("base64")}`;
        expect((init.headers as any)["Authorization"]).toBe(expected);
    });

    it("falls back to Bearer when scheme name not found in securitySchemes", async () => {
        const spec = makeSpec(
            {},
            [{ UnknownScheme: [] }],
        );
        const init = await runExecutor(spec, "api_key");
        expect((init.headers as any)["Authorization"]).toBe("Bearer supersecret123");
    });
});
