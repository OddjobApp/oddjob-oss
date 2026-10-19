/**
 * CURL Debugger tests
 * @vitest-environment node
 */

import { describe, it, expect } from "vitest";
import { detectApiProvider, analyzeError } from "../../../shared/utils/curlDebugger.js";

describe("curlDebugger", () => {
    describe("detectApiProvider", () => {
        it("detects JIRA from URL", () => {
            expect(detectApiProvider("https://mycompany.atlassian.net/rest/api/3/search")).toMatchObject({
                provider: "jira",
                knownFixes: expect.any(Object),
            });
        });

        it("detects JIRA from jira in URL", () => {
            expect(detectApiProvider("https://jira.example.com/api")).toMatchObject({ provider: "jira" });
        });

        it("detects JIRA from credential type", () => {
            expect(detectApiProvider("https://api.example.com", "jira")).toMatchObject({ provider: "jira" });
        });

        it("detects Slack from URL", () => {
            expect(detectApiProvider("https://slack.com/api/chat.postMessage")).toMatchObject({ provider: "slack" });
            expect(detectApiProvider("https://api.slack.com/methods")).toMatchObject({ provider: "slack" });
        });

        it("detects GitHub from URL", () => {
            expect(detectApiProvider("https://api.github.com/repos")).toMatchObject({ provider: "github" });
            expect(detectApiProvider("https://github.com/owner/repo")).toMatchObject({ provider: "github" });
        });

        it("returns generic for unknown URLs", () => {
            expect(detectApiProvider("https://api.example.com/v1/data")).toMatchObject({ provider: "generic" });
        });
    });

    describe("analyzeError", () => {
        it("categorizes 401 as auth error", () => {
            const result = analyzeError(
                { success: false, metadata: { status: 401, url: "https://api.example.com" } },
                { url: "https://api.example.com" }
            );
            expect(result.category).toBe("auth");
            expect(result.severity).toBe("error");
            expect(result.summary).toBe("Authentication Failed");
        });

        it("categorizes 403 as auth error", () => {
            const result = analyzeError(
                { success: false, metadata: { status: 403 } },
                { url: "https://api.example.com" }
            );
            expect(result.category).toBe("auth");
            expect(result.summary).toBe("Access Forbidden");
        });

        it("categorizes 404 as not_found", () => {
            const result = analyzeError(
                { success: false, metadata: { status: 404 } },
                { url: "https://api.example.com/resource" }
            );
            expect(result.category).toBe("not_found");
            expect(result.summary).toBe("Endpoint Not Found");
        });

        it("categorizes 410 as deprecated", () => {
            const result = analyzeError(
                { success: false, metadata: { status: 410 } },
                { url: "https://api.example.com/old" }
            );
            expect(result.category).toBe("deprecated");
            expect(result.summary).toBe("Deprecated Endpoint");
        });

        it("categorizes 500 as server_error", () => {
            const result = analyzeError(
                { success: false, metadata: { status: 500 } },
                { url: "https://api.example.com" }
            );
            expect(result.category).toBe("server_error");
            expect(result.severity).toBe("warning");
        });

        it("categorizes status 0 as network", () => {
            const result = analyzeError(
                { success: false, metadata: { status: 0 } },
                { url: "https://unreachable.example.com" }
            );
            expect(result.category).toBe("network");
            expect(result.summary).toBe("Network Error");
        });

        it("provides auth suggestions when credentialId missing", () => {
            const result = analyzeError(
                { success: false, metadata: { status: 401 } },
                { url: "https://api.example.com", method: "GET" }
            );
            expect(result.suggestions.some((s) => s.action.includes("credentials") || s.action.includes("Add credentials"))).toBe(true);
        });

        it("provides JIRA known fix for deprecated search endpoint", () => {
            const result = analyzeError(
                { success: false, metadata: { status: 410 } },
                { url: "https://my.atlassian.net/rest/api/3/search", method: "GET" }
            );
            const urlFix = result.suggestions.find((s) => s.autoFix?.field === "url");
            expect(urlFix).toBeDefined();
            expect(urlFix?.autoFix?.value).toBe("/rest/api/3/search/jql");
        });

        it("sorts suggestions by priority", () => {
            const result = analyzeError(
                { success: false, metadata: { status: 400 } },
                { url: "https://api.example.com", method: "POST", body: "{}" }
            );
            for (let i = 1; i < result.suggestions.length; i++) {
                expect(result.suggestions[i].priority).toBeGreaterThanOrEqual(result.suggestions[i - 1].priority);
            }
        });
    });
});
