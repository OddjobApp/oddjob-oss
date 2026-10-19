const DEFAULT_TEST_DATABASE_URL = "postgresql://oddjob_test@127.0.0.1:5432/oddjob_test";

export interface TestEnvironmentResult {
    databaseUrl: string;
    source: "default" | "TEST_DATABASE_URL";
}

/**
 * Configure a database URL that is visibly test-only.
 *
 * Production/development DATABASE_URL values are intentionally ignored. Tests
 * must use TEST_DATABASE_URL or the local, credential-free default.
 */
export function configureTestEnvironment(
    environment: NodeJS.ProcessEnv = process.env,
): TestEnvironmentResult {
    const configuredUrl = environment.TEST_DATABASE_URL?.trim();
    const databaseUrl = configuredUrl || DEFAULT_TEST_DATABASE_URL;

    assertSafeTestDatabaseUrl(databaseUrl);

    environment.NODE_ENV = "test";
    environment.DATABASE_URL = databaseUrl;

    return {
        databaseUrl,
        source: configuredUrl ? "TEST_DATABASE_URL" : "default",
    };
}

/**
 * The only sanctioned way for a test to open its OWN database connection.
 *
 * Tests that hand-roll a connection string bypass configureTestEnvironment entirely.
 * Two audit suites did exactly that — hardcoding the development database on port
 * 5433 — and inserted orgs and jobs straight into it. Route every direct pool/client
 * through here so the same "must be a test database" rule applies.
 */
export function requireTestDatabaseUrl(environment: NodeJS.ProcessEnv = process.env): string {
    const databaseUrl = environment.DATABASE_URL?.trim();
    if (!databaseUrl) {
        throw new Error(
            "No DATABASE_URL in the test environment. Tests must not fall back to a hardcoded database.",
        );
    }
    assertSafeTestDatabaseUrl(databaseUrl);
    return databaseUrl;
}

export function assertSafeTestDatabaseUrl(databaseUrl: string): void {
    let parsed: URL;
    try {
        parsed = new URL(databaseUrl);
    } catch {
        throw new Error("TEST_DATABASE_URL must be a valid PostgreSQL URL.");
    }

    if (!/^postgres(?:ql)?:$/.test(parsed.protocol)) {
        throw new Error("TEST_DATABASE_URL must use the postgres or postgresql protocol.");
    }

    const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
    if (!/(^|[_-])test($|[_-])/i.test(databaseName)) {
        throw new Error(
            "Refusing to run tests: TEST_DATABASE_URL database name must contain a distinct 'test' segment.",
        );
    }
}

/**
 * Configure LLM provider mode for automated testing.
 * When E2E_MOCK_LLM or TEST_MOCK_LLM is enabled, sets LLM_PROVIDER to "mock".
 */
export function configureTestLLM(environment: NodeJS.ProcessEnv = process.env): boolean {
    const isMock = environment.E2E_MOCK_LLM === "true" || environment.TEST_MOCK_LLM === "true" || environment.MOCK_LLM === "true";
    if (isMock) {
        environment.LLM_PROVIDER = "mock";
    }
    return isMock;
}


