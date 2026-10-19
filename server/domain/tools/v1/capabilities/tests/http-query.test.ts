import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WEB_TOOLS } from "../web.js";
import { httpConnectorService } from "@domain/integrations/http-connector.service.js";
import { classifyToolFailure } from "@domain/crew/core/crew-tools.service.js";

describe("http_query capability", () => {
    beforeEach(() => {
        httpConnectorService.clearCache();
    });

    it("has read-safe idempotency declared", () => {
        expect(WEB_TOOLS.http_query).toBeDefined();
        expect(WEB_TOOLS.http_query.idempotency).toBe("read-safe");
    });

    it("returns formatted json on successful API query", async () => {
        vi.spyOn(httpConnectorService, "executeQuery").mockResolvedValueOnce({
            success: true,
            status: 200,
            data: { temperature: 21.5, unit: "celsius" },
        });

        const res = await WEB_TOOLS.http_query.execute(
            { url: "https://api.open-meteo.com/v1/forecast", params: { latitude: 37.77, longitude: -122.41 }, method: "GET", cacheTtlSeconds: 60 },
            {} as any
        );

        expect(typeof res).toBe("string");
        const parsed = JSON.parse(res);
        expect(parsed.temperature).toBe(21.5);
        expect(classifyToolFailure(res)).toBeNull();
    });

    it("returns Error: on failure so classifyToolFailure marks it ok: false", async () => {
        vi.spyOn(httpConnectorService, "executeQuery").mockResolvedValueOnce({
            success: false,
            status: 403,
            data: null,
            error: 'Access to private or local host "127.0.0.1" is forbidden.',
        });

        const res = await WEB_TOOLS.http_query.execute(
            { url: "http://127.0.0.1/admin", method: "GET", cacheTtlSeconds: 60 },
            {} as any
        );

        expect(res).toContain("Error: HTTP query to http://127.0.0.1/admin failed");
        expect(classifyToolFailure(res)).not.toBeNull();
        expect(classifyToolFailure(res)).toContain("Access to private or local host");
    });
});
