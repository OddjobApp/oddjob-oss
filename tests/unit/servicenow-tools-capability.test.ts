import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
    SERVICENOW_TOOLS,
    resolveInstanceUrl,
    getServiceNowConfig,
} from "../../server/domain/tools/v1/capabilities/servicenow.js";

/** Passing no organizationId keeps config resolution on the env path — no DB required. */
const NO_ORG = {} as any;

const ORIGINAL_ENV = { ...process.env };

function useEnvCredentials() {
    process.env.SERVICENOW_INSTANCE = "acme";
    process.env.SERVICENOW_USERNAME = "svc.oddjob";
    process.env.SERVICENOW_PASSWORD = "s3cret";
    delete process.env.SERVICENOW_ACCESS_TOKEN;
}

function clearEnvCredentials() {
    delete process.env.SERVICENOW_INSTANCE;
    delete process.env.SERVICENOW_USERNAME;
    delete process.env.SERVICENOW_PASSWORD;
    delete process.env.SERVICENOW_ACCESS_TOKEN;
}

/** Queues fetch responses in order and records the requests that were made. */
function mockFetch(responses: Array<{ ok?: boolean; status?: number; body: any }>) {
    const calls: Array<{ url: string; method: string; headers: Record<string, string>; body?: any }> = [];
    const queue = [...responses];
    const fetchMock = vi.fn(async (url: string, init: any = {}) => {
        calls.push({
            url,
            method: init.method || "GET",
            headers: init.headers || {},
            body: init.body ? JSON.parse(init.body) : undefined,
        });
        const next = queue.shift() ?? { body: { result: [] } };
        const isOk = next.ok ?? true;
        return {
            ok: isOk,
            status: next.status ?? (isOk ? 200 : 400),
            json: async () => next.body,
            text: async () => (typeof next.body === "string" ? next.body : JSON.stringify(next.body)),
        };
    });
    vi.stubGlobal("fetch", fetchMock);
    return calls;
}

beforeEach(() => {
    useEnvCredentials();
});

afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...ORIGINAL_ENV };
});

describe("resolveInstanceUrl", () => {
    it("expands a bare instance name to the service-now.com host", () => {
        expect(resolveInstanceUrl("acme")).toBe("https://acme.service-now.com");
    });

    it("adds a scheme to a bare host without inventing a subdomain", () => {
        expect(resolveInstanceUrl("acme.service-now.com")).toBe("https://acme.service-now.com");
    });

    it("preserves an explicit URL and strips trailing slashes", () => {
        expect(resolveInstanceUrl("https://acme.service-now.com/")).toBe("https://acme.service-now.com");
        expect(resolveInstanceUrl("  http://localhost:8080//  ")).toBe("http://localhost:8080");
    });
});

describe("getServiceNowConfig", () => {
    it("returns null when nothing is configured", async () => {
        clearEnvCredentials();
        await expect(getServiceNowConfig(null)).resolves.toBeNull();
    });

    it("reads env credentials and normalises the instance", async () => {
        const config = await getServiceNowConfig(null);
        expect(config).toEqual({
            instanceUrl: "https://acme.service-now.com",
            username: "svc.oddjob",
            password: "s3cret",
            accessToken: undefined,
        });
    });
});

describe("ServiceNow tool definitions", () => {
    it("every tool is dispatchable — has execute() and a parseable zod schema", () => {
        for (const [name, tool] of Object.entries(SERVICENOW_TOOLS)) {
            expect(typeof tool.execute, `${name}.execute`).toBe("function");
            expect(typeof (tool.parameters as any)?.safeParse, `${name}.parameters`).toBe("function");
            expect(tool.name, `${name}.name`).toBe(name);
        }
    });

    it("returns a setup hint instead of throwing when unconfigured", async () => {
        clearEnvCredentials();
        mockFetch([]);
        const result = await SERVICENOW_TOOLS.servicenow_search_incidents.execute({}, NO_ORG);
        expect(result).toContain("ServiceNow is not configured");
    });
});

describe("servicenow_search_incidents", () => {
    it("queries the incident table with basic auth and attaches record URLs", async () => {
        const calls = mockFetch([
            { body: { result: [{ sys_id: "a".repeat(32), number: "INC0010023", short_description: "VPN down" }] } },
        ]);

        const raw = await SERVICENOW_TOOLS.servicenow_search_incidents.execute(
            { query: "active=true^priority=1", limit: 5 },
            NO_ORG
        );

        expect(calls).toHaveLength(1);
        const url = new URL(calls[0].url);
        expect(url.origin + url.pathname).toBe("https://acme.service-now.com/api/now/table/incident");
        expect(url.searchParams.get("sysparm_query")).toBe("active=true^priority=1");
        expect(url.searchParams.get("sysparm_limit")).toBe("5");
        expect(calls[0].headers.Authorization).toBe(
            `Basic ${Buffer.from("svc.oddjob:s3cret").toString("base64")}`
        );

        const incidents = JSON.parse(raw);
        expect(incidents[0].number).toBe("INC0010023");
        expect(incidents[0].url).toContain("incident.do?sys_id=");
    });

    it("defaults to recently-updated active incidents when no query is given", async () => {
        const calls = mockFetch([{ body: { result: [] } }]);
        await SERVICENOW_TOOLS.servicenow_search_incidents.execute({}, NO_ORG);
        expect(new URL(calls[0].url).searchParams.get("sysparm_query")).toBe(
            "active=true^ORDERBYDESCsys_updated_on"
        );
    });
});

describe("servicenow_get_incident", () => {
    it("looks up by number when given a display number", async () => {
        const calls = mockFetch([{ body: { result: [{ sys_id: "b".repeat(32), number: "INC0010023" }] } }]);
        await SERVICENOW_TOOLS.servicenow_get_incident.execute({ incident: "INC0010023" }, NO_ORG);
        expect(new URL(calls[0].url).searchParams.get("sysparm_query")).toBe("number=INC0010023");
    });

    it("looks up by sys_id when given a 32-char hex id", async () => {
        const sysId = "c".repeat(32);
        const calls = mockFetch([{ body: { result: [{ sys_id: sysId }] } }]);
        await SERVICENOW_TOOLS.servicenow_get_incident.execute({ incident: sysId }, NO_ORG);
        expect(new URL(calls[0].url).searchParams.get("sysparm_query")).toBe(`sys_id=${sysId}`);
    });

    it("reports a clean miss rather than returning an empty array", async () => {
        mockFetch([{ body: { result: [] } }]);
        const result = await SERVICENOW_TOOLS.servicenow_get_incident.execute({ incident: "INC9999999" }, NO_ORG);
        expect(result).toContain("No ServiceNow incident found");
    });
});

describe("servicenow_update_incident", () => {
    it("resolves an incident number to a sys_id, then PATCHes mapped state values", async () => {
        const sysId = "d".repeat(32);
        const calls = mockFetch([
            { body: { result: [{ sys_id: sysId }] } },
            { body: { result: { number: "INC0010023", state: "Resolved" } } },
        ]);

        const raw = await SERVICENOW_TOOLS.servicenow_update_incident.execute(
            { incident: "INC0010023", state: "resolved", work_notes: "Restarted the tunnel", urgency: "low" },
            NO_ORG
        );

        expect(calls).toHaveLength(2);
        expect(new URL(calls[0].url).searchParams.get("sysparm_fields")).toBe("sys_id");

        expect(calls[1].method).toBe("PATCH");
        expect(calls[1].url).toContain(`/api/now/table/incident/${sysId}`);
        // "resolved" -> 6 and "low" urgency -> 3 in the stock Table API scale.
        expect(calls[1].body).toEqual({ state: "6", urgency: "3", work_notes: "Restarted the tunnel" });

        expect(JSON.parse(raw).updated).toBe(true);
    });

    it("skips the API call entirely when no updatable field is supplied", async () => {
        const calls = mockFetch([{ body: { result: [{ sys_id: "e".repeat(32) }] } }]);
        const result = await SERVICENOW_TOOLS.servicenow_update_incident.execute(
            { incident: "e".repeat(32) },
            NO_ORG
        );
        expect(result).toContain("Nothing to update");
        expect(calls).toHaveLength(0);
    });
});

describe("servicenow_create_incident", () => {
    it("maps urgency and impact words onto ServiceNow's numeric scale", async () => {
        const calls = mockFetch([{ body: { result: { sys_id: "f".repeat(32), number: "INC0010099" } } }]);

        await SERVICENOW_TOOLS.servicenow_create_incident.execute(
            { short_description: "Printer offline", urgency: "high", impact: "medium" },
            NO_ORG
        );

        expect(calls[0].method).toBe("POST");
        expect(calls[0].body).toEqual({ short_description: "Printer offline", urgency: "1", impact: "2" });
    });
});

describe("error handling", () => {
    it("surfaces the message from a ServiceNow error envelope", async () => {
        mockFetch([
            {
                ok: false,
                status: 401,
                body: { error: { message: "User Not Authenticated", detail: "Required to provide Auth information" } },
            },
        ]);

        await expect(
            SERVICENOW_TOOLS.servicenow_search_incidents.execute({}, NO_ORG)
        ).rejects.toThrow(/401.*User Not Authenticated.*Required to provide Auth information/);
    });

    it("keeps a non-JSON body (e.g. an SSO redirect page) readable and capped", async () => {
        mockFetch([{ ok: false, status: 302, body: "<html>".repeat(500) }]);
        await expect(
            SERVICENOW_TOOLS.servicenow_search_incidents.execute({}, NO_ORG)
        ).rejects.toThrow(/ServiceNow API error 302/);
    });
});
