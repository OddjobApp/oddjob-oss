
import { executeCurlJob } from "@domain/core/infrastructure/http-executor.service.js";
import { CurlConfig } from "@shared/schema";
import { credentialsService } from "@domain/auth/core/credentials-service.js";

// Mock storage.getCredential to avoid DB dependency
const mockGetCredential = async (id: number) => {
    if (id === 1) {
        return {
            id: 1,
            name: "Test Bearer",
            type: "api_key",
            envVarName: "TEST_API_KEY",
            metadata: {},
            createdAt: new Date(),
            updatedAt: new Date(),
            organizationId: 1
        };
    }
    if (id === 2) {
        return {
            id: 2,
            name: "Test Basic",
            type: "basic_auth", // Assuming this type exists or we want to test generic creds
            envVarName: "TEST_BASIC_KEY",
            metadata: {},
            createdAt: new Date(),
            updatedAt: new Date(),
            organizationId: 1
        };
    }
    return null;
};

// Polyfill credentialsService for the test
(credentialsService as any).getById = mockGetCredential;

// Mock process.env
process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/oddjob"; // Dummy URL to satisfy init
process.env.TEST_API_KEY = "secret-bearer-token";
process.env.TEST_BASIC_KEY = "user:password";

// Mock fetch to inspect headers
global.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
    console.log(`\n[FETCH] ${url}`);
    if (init?.headers) {
        console.log("[HEADERS]", JSON.stringify(init.headers, null, 2));
    }
    return {
        ok: true,
        text: async () => '{"success": true}',
        status: 200,
        statusText: "OK"
    } as Response;
};

async function runTests() {
    console.log("=== Starting CURL Auth Evaluation ===");

    // Test 1: Bearer Token (Existing Logic)
    console.log("\nTest 1: Bearer Token (Credential ID 1)");
    const configBearer: CurlConfig = {
        url: "https://api.example.com/v1/resource",
        method: "GET",
        authType: "bearer", // Expected field
        credentialId: 1
    };
    await executeCurlJob(configBearer);

    // Test 2: Basic Auth (Potential Missing Logic)
    console.log("\nTest 2: Basic Auth (Credential ID 2)");
    const configBasic: CurlConfig = {
        url: "https://api.example.com/v1/resource",
        method: "GET",
        authType: "basic", // Expected field
        credentialId: 2
    };
    await executeCurlJob(configBasic);

    // Test 3: Explicit Headers (Manual Override)
    console.log("\nTest 3: Explicit Headers");
    const configManual: CurlConfig = {
        url: "https://api.example.com/v1/resource",
        method: "GET",
        authType: "none",
        headers: { "Authorization": "Basic bWFudWFsOm92ZXJyaWRl" }
    };
    await executeCurlJob(configManual);
}

runTests().catch(console.error);
