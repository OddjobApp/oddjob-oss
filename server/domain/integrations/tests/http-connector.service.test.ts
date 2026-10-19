import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  HttpConnectorService,
  extractJsonPath,
} from "../http-connector.service.js";

describe("HttpConnectorService", () => {
  let service: HttpConnectorService;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    service = new HttpConnectorService();
    service.clearCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    service.clearCache();
  });

  describe("extractJsonPath", () => {
    it("extracts direct and nested properties", () => {
      const data = {
        current_weather: {
          temperature: 21.5,
          windspeed: 12.3,
          condition: "sunny",
        },
      };

      expect(extractJsonPath(data, "current_weather.temperature")).toBe(21.5);
      expect(extractJsonPath(data, "current_weather.condition")).toBe("sunny");
      expect(extractJsonPath(data, "$.current_weather.windspeed")).toBe(12.3);
    });

    it("extracts array indices", () => {
      const data = {
        daily: {
          temperature_2m_max: [22, 24, 21, 19],
        },
      };

      expect(extractJsonPath(data, "daily.temperature_2m_max[0]")).toBe(22);
      expect(extractJsonPath(data, "daily.temperature_2m_max[2]")).toBe(21);
    });

    it("returns original data if path is missing or null", () => {
      const data = { temp: 25 };
      expect(extractJsonPath(data, "")).toBe(data);
      expect(extractJsonPath(data, undefined)).toBe(data);
    });

    it("returns null for non-existent path without throwing", () => {
      const data = { temp: 25 };
      expect(extractJsonPath(data, "weather.forecast.invalid")).toBeNull();
    });
  });

  describe("SSRF Protection", () => {
    it("rejects local and private hostnames", async () => {
      const forbiddenUrls = [
        "http://localhost:3000/api",
        "http://127.0.0.1:8080",
        "http://0.0.0.0/secrets",
        "http://169.254.169.254/latest/meta-data",
        "http://metadata.google.internal/computeMetadata/v1",
        "http://10.0.0.1/admin",
        "http://192.168.1.1/router",
        "http://172.16.0.1/private",
      ];

      for (const url of forbiddenUrls) {
        const res = await service.executeQuery({ url }, 1);
        expect(res.success).toBe(false);
        expect(res.status).toBe(403);
        expect(res.error).toMatch(/blocked by egress firewall/i);
      }
    });

    // These four all reached the network before the service was moved onto
    // EgressFirewall: its own guard read the bracketed IPv6 hostname with
    // startsWith("fd00:"), which can never match.
    it("rejects IPv6 private, link-local and IPv4-mapped hosts", async () => {
      const fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy as any;

      const forbiddenUrls = [
        "http://[::1]:8080/admin",
        "http://[fd12:3456::1]/private",
        "http://[fe80::1]/link-local",
        "http://[::ffff:127.0.0.1]:5000/api",
      ];

      for (const url of forbiddenUrls) {
        const res = await service.executeQuery({ url }, 1);
        expect(res.success).toBe(false);
        expect(res.status).toBe(403);
      }
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("rejects a public host that redirects into private space", async () => {
      // A single guard on the caller's URL is not enough: fetch follows
      // cross-host redirects, so this chain used to return the metadata
      // service's body to the caller.
      globalThis.fetch = vi.fn(async (input: any) => {
        if (String(input).includes("example.com")) {
          return new Response(null, {
            status: 302,
            headers: { location: "http://169.254.169.254/latest/meta-data/" },
          });
        }
        return new Response("SHOULD-NEVER-BE-REACHED", { status: 200 });
      }) as any;

      const res = await service.executeQuery({ url: "https://example.com/redirector" }, 1);

      expect(res.success).toBe(false);
      expect(res.status).toBe(403);
      expect(res.error).toMatch(/blocked by egress firewall/i);
      expect(JSON.stringify(res.data)).not.toContain("SHOULD-NEVER-BE-REACHED");
    });

    it("honours AGENT_EGRESS_WHITELIST, which this service used to bypass", async () => {
      const previous = process.env.AGENT_EGRESS_WHITELIST;
      process.env.AGENT_EGRESS_WHITELIST = "api.open-meteo.com";
      try {
        const res = await service.executeQuery({ url: "https://evil.example/collect" }, 1);
        expect(res.success).toBe(false);
        expect(res.status).toBe(403);
        expect(res.error).toMatch(/whitelist/i);
      } finally {
        if (previous === undefined) delete process.env.AGENT_EGRESS_WHITELIST;
        else process.env.AGENT_EGRESS_WHITELIST = previous;
      }
    });

    it("rejects non-HTTP protocols", async () => {
      const invalidProtocols = [
        "file:///etc/passwd",
        "ftp://example.com/file",
        "gopher://example.com",
        "data:text/plain;base64,SGVsbG8=",
      ];

      for (const url of invalidProtocols) {
        const res = await service.executeQuery({ url }, 1);
        expect(res.success).toBe(false);
        expect(res.status).toBe(400);
      }
    });
  });

  describe("External query execution and caching", () => {
    it("successfully queries public endpoint and extracts path", async () => {
      const mockPayload = {
        latitude: 37.77,
        longitude: -122.42,
        current_weather: {
          temperature: 18.5,
          windspeed: 8.2,
          weathercode: 0,
        },
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => mockPayload,
      } as any);

      const res = await service.executeQuery(
        {
          url: "https://api.open-meteo.com/v1/forecast",
          params: { latitude: 37.77, longitude: -122.42, current_weather: "true" },
          jsonPath: "current_weather.temperature",
          cacheTtlSeconds: 60,
        },
        1
      );

      expect(res.success).toBe(true);
      expect(res.data).toBe(18.5);
      expect(res.cached).toBe(false);

      // Verify second call is served from cache
      const cachedRes = await service.executeQuery(
        {
          url: "https://api.open-meteo.com/v1/forecast",
          params: { latitude: 37.77, longitude: -122.42, current_weather: "true" },
          jsonPath: "current_weather.temperature",
          cacheTtlSeconds: 60,
        },
        1
      );

      expect(cachedRes.success).toBe(true);
      expect(cachedRes.data).toBe(18.5);
      expect(cachedRes.cached).toBe(true);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it("handles HTTP error status codes gracefully", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ error: "Upstream down" }),
      } as any);

      const res = await service.executeQuery(
        {
          url: "https://api.weather.com/v1/live",
        },
        1
      );

      expect(res.success).toBe(false);
      expect(res.status).toBe(503);
      expect(res.error).toContain("HTTP 503");
    });
  });
});
