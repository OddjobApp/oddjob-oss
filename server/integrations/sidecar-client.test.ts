// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { sidecarBaseUrl, sidecarConfigured, sidecarFetch, sidecarHeaders, SidecarUnavailableError } from "./sidecar-client.js";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("sidecar client", () => {
    it("uses one address, :8002 by default, without a trailing slash or /api suffix", () => {
        vi.stubEnv("PYTHON_SERVICE_URL", "");
        vi.stubEnv("PYTHON_SIDECAR_URL", "");
        expect(sidecarBaseUrl()).toBe("http://localhost:8002");
        vi.stubEnv("PYTHON_SERVICE_URL", "http://sidecar:8002/api/v1/");
        expect(sidecarBaseUrl()).toBe("http://sidecar:8002");
    });

    it("sends the service token and the caller's organization", () => {
        vi.stubEnv("SIDECAR_SERVICE_TOKEN", "s".repeat(40));
        expect(sidecarHeaders(7)).toEqual({ "X-Service-Token": "s".repeat(40), "X-Organization-Id": "7" });
        expect(sidecarHeaders(null)).toEqual({ "X-Service-Token": "s".repeat(40) });
    });

    it.each([0, -1, 1.5, Number.NaN])("refuses organization %s rather than sending it", (org) => {
        expect(() => sidecarHeaders(org)).toThrow("valid organization");
    });

    it("in production, calls nothing until the sidecar is named and authenticated", async () => {
        vi.stubEnv("NODE_ENV", "production");
        vi.stubEnv("PYTHON_SERVICE_URL", "");
        vi.stubEnv("SIDECAR_SERVICE_TOKEN", "");
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        expect(sidecarConfigured()).toBe(false);
        await expect(sidecarFetch("/api/saas/connectors", { organizationId: 7 })).rejects.toBeInstanceOf(SidecarUnavailableError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("posts JSON to the path on the sidecar with both headers", async () => {
        vi.stubEnv("NODE_ENV", "production");
        vi.stubEnv("PYTHON_SERVICE_URL", "http://sidecar:8002");
        vi.stubEnv("SIDECAR_SERVICE_TOKEN", "s".repeat(40));
        const fetchMock = vi.fn(async () => new Response("{}"));
        vi.stubGlobal("fetch", fetchMock);
        await sidecarFetch("/api/saas/jira/comment", { organizationId: 9, body: { issue_key: "A-1" } });
        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe("http://sidecar:8002/api/saas/jira/comment");
        expect(init.method).toBe("POST");
        expect(init.headers).toEqual({ "X-Service-Token": "s".repeat(40), "X-Organization-Id": "9", "Content-Type": "application/json" });
        expect(JSON.parse(String(init.body))).toEqual({ issue_key: "A-1" });
    });
});
