import { expect, afterEach, vi, beforeAll, afterAll } from 'vitest';
import { cleanup, configure } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';
import { configureTestEnvironment } from './configure-test-environment';

// Extend Vitest's expect with jest-dom matchers
expect.extend(matchers);

// Refuse to inherit a development or production database into tests.
configureTestEnvironment();

// testing-library's findBy*/waitFor default to a 1000ms timeout. That is fine
// for a single file and marginal for the full suite: client/src/modules/apps/
// AppStudioPod.test.tsx passed 31/31 in isolation while two of its tests failed
// in a full run, at 1064ms and 1008ms — just over the line. The suite runs with
// fileParallelism disabled and spends ~790s in environment setup, so a render
// that resolves comfortably alone can cross 1s under load.
//
// Raising the async ceiling makes those assertions wait rather than flake. It
// does not slow a passing test down: findBy resolves as soon as the element
// appears, and the timeout only bounds the failure case.
configure({ asyncUtilTimeout: 5000 });

// Mock AWS SDK components to prevent resolution errors
vi.mock("@aws-sdk/client-lambda", () => ({
    LambdaClient: class {},
    InvokeCommand: class {},
    ListFunctionsCommand: class {},
}));

vi.mock("@aws-sdk/client-cloudwatch-logs", () => ({
    CloudWatchLogsClient: class {},
    FilterLogEventsCommand: class {},
}));

vi.mock("snowflake-sdk", () => ({
    createConnection: vi.fn(),
}));

// --- Global AI Mocks ---
// This prevents tests from hitting real 401/403 errors during CI/CD
vi.mock("@server/domain/ai/core/providers/openai-client.ts", () => {
    return {
        OpenAIClient: class {
            execute = vi.fn().mockResolvedValue({
                success: true,
                output: JSON.stringify({ nodes: [{ id: 'n1', label: 'Person' }] }),
                metadata: { model: 'gpt-4', provider: 'openai' }
            });
        }
    };
});

vi.mock("@server/domain/ai/core/providers/google-client.ts", () => {
    return {
        GoogleClient: class {
            execute = vi.fn().mockResolvedValue({
                success: true,
                output: JSON.stringify({ content: "Mocked Gemini Response", success: true }),
                metadata: { model: 'gemini-pro', provider: 'google' }
            });
        }
    };
});

// Mock the System AI service as well since it uses the clients
vi.mock("@server/domain/ai/core/system-ai.service.ts", () => ({
    systemAiService: {
        ask: vi.fn().mockResolvedValue("Mocked System AI Answer"),
        think: vi.fn().mockResolvedValue({ action: "plan", detail: "Mocked thinking" }),
        getAiConfig: vi.fn().mockResolvedValue({ provider: 'google', model: 'gemini-2.0-flash', apiKey: 'test-key' }),
        getAiConfigWithFallback: vi.fn().mockResolvedValue({ primary: { provider: 'google', model: 'gemini-2.0-flash', apiKey: 'test-key' }, fallbacks: [] }),
    }
}));

vi.mock("@domain/ai/core/system-ai.service.js", () => ({
    systemAiService: {
        ask: vi.fn().mockResolvedValue("Mocked System AI Answer"),
        think: vi.fn().mockResolvedValue({ action: "plan", detail: "Mocked thinking" }),
        getAiConfig: vi.fn().mockResolvedValue({ provider: 'google', model: 'gemini-2.0-flash', apiKey: 'test-key' }),
        getAiConfigWithFallback: vi.fn().mockResolvedValue({ primary: { provider: 'google', model: 'gemini-2.0-flash', apiKey: 'test-key' }, fallbacks: [] }),
    }
}));

// Global Storage Mock for Credentials
// This provides a fallback for "Credential undefined" errors in legacy tests
vi.mock("@server/domain/knowledge/core/storage.service.ts", () => ({
    storage: {
        getCredential: vi.fn().mockImplementation(async (id) => {
            if (id === 1 || id === '1') {
                return {
                    id: 1,
                    name: 'Default Test Credential',
                    envVarName: 'GEMINI_API_KEY',
                    metadata: { provider: 'google', model: 'gemini-1.5-flash' }
                };
            }
            return null;
        })
    }
}));

// Global Database Mock
// Prevents tests from hitting real Postgres and ensures deterministic results
vi.mock("@server/database_service.js", async (importOriginal) => {
    const actual = await importOriginal() as any;
    return {
        ...actual,
        checkDatabaseConnection: vi.fn().mockResolvedValue({ connected: true }),
    }
});

// Global Credentials Service Mock
vi.mock("@domain/auth/core/credentials-service.js", () => ({
    credentialsService: {
        list: vi.fn().mockResolvedValue([]),
        getById: vi.fn().mockImplementation(async (id) => {
            if (id === 1 || id === '1') {
                return { id: 1, type: 'ai_provider', envVarName: 'GEMINI_API_KEY', metadata: { provider: 'google' } };
            }
            return null;
        }),
        // Same contract as getById above; the real one tries the caller's org,
        // then platform-level credentials, never another tenant's.
        getForExecution: vi.fn().mockImplementation(async (id) => {
            if (id === 1 || id === '1') {
                return { id: 1, type: 'ai_provider', envVarName: 'GEMINI_API_KEY', metadata: { provider: 'google' } };
            }
            return null;
        }),
        create: vi.fn().mockImplementation(async (data) => ({ id: 99, ...data })),
        update: vi.fn().mockImplementation(async (id, data) => ({ id, ...data })),
        delete: vi.fn().mockResolvedValue(undefined),
        checkSecret: vi.fn().mockResolvedValue(true),
        testConnection: vi.fn().mockResolvedValue({ success: true, message: 'OK' }),
    }
}));

// Cleanup after each test case
afterEach(() => {
    cleanup();
    // Storage outlives cleanup(), and jsdom shares one origin across a file, so a
    // component that remembers something leaves it for every test that follows. That
    // is how a Media Studio preference written for production 7 in one test decided
    // which view another file's studio opened in — passing alone, failing in the suite,
    // and pointing at neither.
    try { window.localStorage.clear(); } catch { /* storage can be unavailable */ }
    try { window.sessionStorage.clear(); } catch { /* storage can be unavailable */ }
});

// Browser-specific mocks
if (typeof window !== 'undefined') {
    // ... same as before
    // Mock window.matchMedia for components that use it
    Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: (query: string) => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: () => { },
            removeListener: () => { },
            addEventListener: () => { },
            removeEventListener: () => { },
            dispatchEvent: () => { },
        }),
    });

    // Mock ResizeObserver
    (global as any).ResizeObserver = class ResizeObserver {
        observe() { }
        unobserve() { }
        disconnect() { }
    };

    // Mock IntersectionObserver
    (global as any).IntersectionObserver = class IntersectionObserver {
        constructor() { }
        observe() { }
        unobserve() { }
        disconnect() { }
    };

    // Mock window.scrollTo
    Object.defineProperty(window, 'scrollTo', {
        writable: true,
        value: () => { },
    });

    // Mock EventSource for SSE
    (global as any).EventSource = class EventSource {
        constructor() { }
        close() { }
        addEventListener() { }
        removeEventListener() { }
    };

    // Mock structuredClone if missing in jsdom
    if (!(global as any).structuredClone) {
        (global as any).structuredClone = (obj: any) => JSON.parse(JSON.stringify(obj));
    }
}

// Mock console methods for cleaner test output
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

beforeAll(() => {
    console.error = (...args) => {
        if (
            typeof args[0] === 'string' &&
            args[0].includes('Warning: ReactDOM.render is no longer supported')
        ) {
            return;
        }
        originalConsoleError.call(console, ...args);
    };

    console.warn = (...args) => {
        if (
            typeof args[0] === 'string' &&
            (args[0].includes('Warning:') || args[0].includes('was not wrapped in act'))
        ) {
            return;
        }
        originalConsoleWarn.call(console, ...args);
    };
});

afterAll(() => {
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
});
