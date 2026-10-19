import { describe, expect, it } from "vitest";
import {
    assertSafeTestDatabaseUrl,
    configureTestEnvironment,
} from "./configure-test-environment";

describe("configureTestEnvironment", () => {
    it("uses a credential-free, test-only local database by default", () => {
        const environment: NodeJS.ProcessEnv = {};

        const result = configureTestEnvironment(environment);

        expect(result.source).toBe("default");
        expect(environment.NODE_ENV).toBe("test");
        expect(environment.DATABASE_URL).toContain("/oddjob_test");
        expect(new URL(environment.DATABASE_URL!).password).toBe("");
    });

    it("accepts an explicit test database", () => {
        const environment: NodeJS.ProcessEnv = {
            TEST_DATABASE_URL: "postgresql://runner@example.test:5432/oddjob_test_ci",
        };

        const result = configureTestEnvironment(environment);

        expect(result.source).toBe("TEST_DATABASE_URL");
        expect(environment.DATABASE_URL).toBe(environment.TEST_DATABASE_URL);
    });

    it("refuses a database that is not visibly test-only", () => {
        expect(() => assertSafeTestDatabaseUrl(
            "postgresql://runner@example.test:5432/oddjob",
        )).toThrow(/Refusing to run tests/);
    });
});

