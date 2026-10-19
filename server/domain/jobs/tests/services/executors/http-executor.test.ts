/**
 * HTTP Executor (executeCurlJob) tests
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
const mockGetCredential = vi.fn();

vi.stubGlobal('fetch', mockFetch);

vi.mock("@domain/auth/core/credentials-service.js", () => ({
    credentialsService: {
        getById: (...args: unknown[]) => mockGetCredential(...args),
    },
}));

import { CurlConfig } from "@shared/schema/index.js";
import { executeCurlJob } from "@domain/core/infrastructure/http-executor.service.js";

describe('HTTP Executor (executeCurlJob)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetCredential.mockResolvedValue(null);
        mockFetch.mockResolvedValue({
            ok: true,
            status: 200,
            text: async () => '{"ok":true}',
            statusText: 'OK'
        });
    });

    it('returns response body on success', async () => {
        const config: CurlConfig = { url: 'https://api.example.com/data', method: 'GET', authType: 'none' };
        const result = await executeCurlJob(config);

        expect(result).toBe('{"ok":true}');
        expect(mockFetch).toHaveBeenCalledWith(
            expect.stringContaining('https://api.example.com/data'),
            expect.objectContaining({
                method: 'GET',
            })
        );
    });

    it('returns JSON string when body is object', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            status: 200,
            statusText: 'OK',
            text: async () => JSON.stringify({ data: 'value' })
        });
        const config: CurlConfig = { url: 'https://api.example.com', method: 'GET', authType: 'none' };

        const result = await executeCurlJob(config);

        expect(result).toBe('{"data":"value"}');
    });

    it('throws on HTTP error status', async () => {
        mockFetch.mockResolvedValue({
            ok: false,
            status: 404,
            statusText: 'Not Found',
            text: async () => 'Not Found'
        });
        const config: CurlConfig = { url: 'https://api.example.com/missing', method: 'GET', authType: 'none' };

        await expect(executeCurlJob(config)).rejects.toThrow('Request failed');
        await expect(executeCurlJob(config)).rejects.toThrow('404');
    });

    it('appends query params to URL', async () => {
        const config: CurlConfig = {
            url: 'https://api.example.com/search',
            method: 'GET',
            queryParams: { q: 'test', limit: '10' },
            authType: 'none',
        };

        await executeCurlJob(config);

        expect(mockFetch).toHaveBeenCalledWith(
            expect.stringContaining('q=test'),
            expect.any(Object)
        );
    });

    it('uses Bearer auth when credential has key and no authType', async () => {
        mockGetCredential.mockResolvedValue({
            id: 1,
            envVarName: 'API_KEY',
            type: 'api',
        });
        process.env.API_KEY = 'secret-token';

        const config: CurlConfig = { url: 'https://api.example.com', method: 'GET', credentialId: 1, authType: 'none' };

        await executeCurlJob(config);

        expect(mockFetch).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                headers: expect.objectContaining({
                    Authorization: 'Bearer secret-token',
                }),
            })
        );

        delete process.env.API_KEY;
    });

    it('uses Basic auth when credential type is basic', async () => {
        mockGetCredential.mockResolvedValue({
            id: 1,
            envVarName: 'BASIC_AUTH',
            type: 'basic',
        });
        process.env.BASIC_AUTH = 'user:pass';

        const config: CurlConfig = { url: 'https://api.example.com', method: 'GET', credentialId: 1, authType: 'basic' };

        await executeCurlJob(config);

        expect(mockFetch).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                headers: expect.objectContaining({
                    Authorization: expect.stringContaining('Basic '),
                }),
            })
        );

        delete process.env.BASIC_AUTH;
    });

    it('passes custom headers from config', async () => {
        const config: CurlConfig = {
            url: 'https://api.example.com',
            method: 'GET',
            headers: { 'X-Custom-Header': 'value' },
            authType: 'none',
        };

        await executeCurlJob(config);

        expect(mockFetch).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                headers: expect.objectContaining({
                    'X-Custom-Header': 'value',
                }),
            })
        );
    });
});
