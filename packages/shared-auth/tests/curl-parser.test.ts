/**
 * curlParser Tests — Parse and Generate cURL commands
 */

import { describe, it, expect } from "vitest";
import {
    parseCurlCommand,
    generateCurlCommand,
    parseQueryString,
    detectAuthFromHeaders,
    buildFullUrl,
    escapeForShell
} from "@shared/utils/curlParser.js";

describe("curlParser", () => {

    describe("parseCurlCommand", () => {
        it("parses a simple GET request", () => {
            const curl = "curl https://api.example.com/users";
            const result = parseCurlCommand(curl);
            expect(result.url).toBe("https://api.example.com/users");
            expect(result.method).toBe("GET");
            expect(result.headers).toEqual({});
        });

        it("parses a POST request with headers and data", () => {
            const curl = `curl -X POST "https://api.example.com/data" \\
                -H "Content-Type: application/json" \\
                -d '{"key": "value"}'`;
            const result = parseCurlCommand(curl);
            expect(result.method).toBe("POST");
            expect(result.url).toBe("https://api.example.com/data");
            expect(result.headers["Content-Type"]).toBe("application/json");
            expect(result.body).toBe('{"key": "value"}');
        });

        it("detects Bearer auth from headers", () => {
            const curl = `curl https://api.example.com -H "Authorization: Bearer my-token"`;
            const result = parseCurlCommand(curl);
            expect(result.authType).toBe("bearer");
            expect(result.authValue).toBe("my-token");
        });

        it("detects Basic auth from -u flag", () => {
            const curl = `curl -u "user:pass" https://api.example.com`;
            const result = parseCurlCommand(curl);
            expect(result.authType).toBe("basic");
            expect(result.authValue).toBe("user:pass");
        });

        it("extracts query parameters from URL", () => {
            const curl = `curl "https://api.example.com/search?q=vitest&limit=10"`;
            const result = parseCurlCommand(curl);
            expect(result.url).toBe("https://api.example.com/search");
            expect(result.queryParams).toEqual({ q: "vitest", limit: "10" });
        });

        it("defaults to POST when -d is present without -X", () => {
            const curl = `curl https://api.example.com -d "payload"`;
            const result = parseCurlCommand(curl);
            expect(result.method).toBe("POST");
            expect(result.body).toBe("payload");
        });

        it("handles single and double quotes correctly", () => {
            const curl = 'curl -H "X-Header: \'single-quoted\'" \'https://example.com\'';
            const result = parseCurlCommand(curl);
            expect(result.url).toBe("https://example.com");
            expect(result.headers["X-Header"]).toBe("'single-quoted'");
        });
    });

    describe("generateCurlCommand", () => {
        const normalize = (s: string) => s.replace(/\\/g, "").replace(/\s+/g, " ").trim();

        it("generates a simple GET command", () => {
            const options = { url: "https://example.com", method: "GET" };
            const curl = generateCurlCommand(options);
            expect(normalize(curl)).toBe('curl "https://example.com"');
        });

        it("includes headers and body", () => {
            const options = {
                url: "https://example.com/api",
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: '{"status": "ok"}'
            };
            const curl = generateCurlCommand(options);
            const norm = normalize(curl);
            expect(norm).toContain("-X POST");
            expect(norm).toContain('-H "Content-Type: application/json"');
            expect(norm).toContain("-d '{\"status\": \"ok\"}'");
            expect(norm).toContain('"https://example.com/api"');
        });

        it("appends query parameters to URL", () => {
            const options = {
                url: "https://example.com/search",
                method: "GET",
                queryParams: { p: "1", q: "test" }
            };
            const curl = generateCurlCommand(options);
            expect(normalize(curl)).toContain('"https://example.com/search?p=1&q=test"');
        });
    });

    describe("detectAuthFromHeaders", () => {
        it("detects Bearer token", () => {
            const headers = { "Authorization": "Bearer abc-123" };
            expect(detectAuthFromHeaders(headers)).toEqual({ authType: "bearer", token: "abc-123" });
        });

        it("detects Basic auth", () => {
            // Case insensitive check
            const headers = { "authorization": "Basic dXNlcjpwYXNz" };
            expect(detectAuthFromHeaders(headers)).toEqual({ authType: "basic", token: "dXNlcjpwYXNz" });
        });

        it("returns none for missing or unknown auth", () => {
            expect(detectAuthFromHeaders({ "X-Other": "val" })).toEqual({ authType: "none" });
        });
    });

    describe("buildFullUrl", () => {
        it("joins baseUrl and queryParams", () => {
            expect(buildFullUrl("http://api.com", { a: "1", b: "2" })).toBe("http://api.com?a=1&b=2");
        });

        it("handles existing question mark in URL", () => {
            expect(buildFullUrl("http://api.com?orig=val", { a: "1" })).toBe("http://api.com?orig=val&a=1");
        });
    });

    describe("parseQueryString", () => {
        it("parses key-value pairs", () => {
            expect(parseQueryString("a=1&b=2")).toEqual({ a: "1", b: "2" });
        });

        it("handles decoded characters", () => {
            expect(parseQueryString("q=hello%20world")).toEqual({ q: "hello world" });
        });
    });

    describe("escapeForShell", () => {
        it("escapes single quotes", () => {
            expect(escapeForShell("don't delete")).toBe("don'\\''t delete");
        });
    });
});
