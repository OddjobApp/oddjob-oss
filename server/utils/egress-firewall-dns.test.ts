import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EgressFirewall, type EgressLookup } from "./egress-firewall.js";

// The resolver is injected rather than mocked at the module level: a test
// pinned to a real domain's A record fails offline and stops proving anything
// the day that domain changes hands.
function resolvingTo(map: Record<string, string[]> | string[]): EgressLookup {
    return vi.fn(async (hostname: string) => {
        const addresses = Array.isArray(map) ? map : map[hostname];
        if (!addresses) throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
        return addresses.map((address) => ({ address }));
    });
}

describe("EgressFirewall DNS resolution guard", () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        delete process.env.AGENT_EGRESS_WHITELIST;
    });
    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it("blocks a public hostname whose A record is private", async () => {
        // The shape of localtest.me: a name that passes every string rule and
        // resolves to loopback.
        const decision = await EgressFirewall.validateResolvedHost(
            "totally-public.example",
            resolvingTo(["127.0.0.1"])
        );

        expect(decision.allowed).toBe(false);
        expect(decision.reason).toMatch(/127\.0\.0\.1/);
    });

    it("blocks when any one of several records is private", async () => {
        const decision = await EgressFirewall.validateResolvedHost(
            "split-horizon.example",
            resolvingTo(["93.184.216.34", "169.254.169.254"])
        );

        expect(decision.allowed).toBe(false);
        expect(decision.reason).toMatch(/169\.254\.169\.254/);
    });

    it("blocks a hostname resolving to an IPv6 unique-local address", async () => {
        const decision = await EgressFirewall.validateResolvedHost(
            "ula.example",
            resolvingTo(["fd12:3456::1"])
        );

        expect(decision.allowed).toBe(false);
    });

    it("allows a hostname that resolves entirely to public addresses", async () => {
        const decision = await EgressFirewall.validateResolvedHost(
            "example.com",
            resolvingTo(["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"])
        );

        expect(decision.allowed).toBe(true);
    });

    it("does not resolve an IP literal — validateUrl already judged it", async () => {
        const lookup = resolvingTo(["127.0.0.1"]);

        expect((await EgressFirewall.validateResolvedHost("127.0.0.1", lookup)).allowed).toBe(true);
        expect((await EgressFirewall.validateResolvedHost("[::1]", lookup)).allowed).toBe(true);
        expect(lookup).not.toHaveBeenCalled();
    });

    it("allows a name it cannot resolve, since fetch will fail on its own", async () => {
        const decision = await EgressFirewall.validateResolvedHost("nope.invalid", resolvingTo({}));

        expect(decision.allowed).toBe(true);
    });

    it("applies the resolution check to redirect hops, not just the first URL", async () => {
        const lookup = resolvingTo({
            "entry.example": ["93.184.216.34"],
            "redirect-target.example": ["10.1.2.3"],
        });
        const fetchStub = vi.fn(async () =>
            new Response(null, { status: 302, headers: { location: "https://redirect-target.example/x" } })
        );
        globalThis.fetch = fetchStub as any;

        const result = await EgressFirewall.fetch("https://entry.example/start", {}, { lookup });

        expect(result.allowed).toBe(false);
        expect(result.reason).toMatch(/10\.1\.2\.3/);
        expect(result.reason).toMatch(/via a redirect/);
        // The blocked hop was never requested.
        expect(fetchStub).toHaveBeenCalledTimes(1);
    });

    it("refuses before issuing a request when the entry host resolves privately", async () => {
        const fetchStub = vi.fn();
        globalThis.fetch = fetchStub as any;

        const result = await EgressFirewall.fetch(
            "https://entry.example/start",
            {},
            { lookup: resolvingTo(["192.168.1.10"]) }
        );

        expect(result.allowed).toBe(false);
        expect(fetchStub).not.toHaveBeenCalled();
    });
});

describe("EgressFirewall.fetch redirect method semantics", () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => { globalThis.fetch = originalFetch; });

    const publicLookup: EgressLookup = async () => [{ address: "93.184.216.34" }];

    function recordingStub(status: number) {
        const calls: RequestInit[] = [];
        let n = 0;
        const stub = vi.fn(async (_input: any, init: RequestInit) => {
            calls.push(init);
            n += 1;
            return n === 1
                ? new Response(null, { status, headers: { location: "https://b.example/next" } })
                : new Response("done", { status: 200 });
        });
        return { stub, calls };
    }

    it("rewrites a POST to a bodyless GET across a 302", async () => {
        const { stub, calls } = recordingStub(302);
        globalThis.fetch = stub as any;

        const r = await EgressFirewall.fetch(
            "https://a.example/start",
            { method: "POST", body: JSON.stringify({ x: 1 }) },
            { lookup: publicLookup }
        );

        expect(r.allowed).toBe(true);
        expect(calls[0].method).toBe("POST");
        expect(calls[1].method).toBe("GET");
        expect(calls[1].body).toBeUndefined();
    });

    it("preserves method and body across a 307", async () => {
        const { stub, calls } = recordingStub(307);
        globalThis.fetch = stub as any;

        await EgressFirewall.fetch(
            "https://a.example/start",
            { method: "POST", body: "payload" },
            { lookup: publicLookup }
        );

        expect(calls[1].method).toBe("POST");
        expect(calls[1].body).toBe("payload");
    });
});

describe("EgressFirewall.fetch body-header stripping", () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => { globalThis.fetch = originalFetch; });

    const publicLookup: EgressLookup = async () => [{ address: "93.184.216.34" }];

    function stubRedirect() {
        const calls: RequestInit[] = [];
        let n = 0;
        globalThis.fetch = vi.fn(async (_i: any, init: RequestInit) => {
            calls.push(init);
            n += 1;
            return n === 1
                ? new Response(null, { status: 302, headers: { location: "https://b.example/next" } })
                : new Response("done", { status: 200 });
        }) as any;
        return calls;
    }

    it("drops content headers when a POST becomes a bodyless GET", async () => {
        const calls = stubRedirect();

        await EgressFirewall.fetch(
            "https://a.example/start",
            {
                method: "POST",
                body: '{"x":1}',
                headers: { "Content-Type": "application/json", "Content-Length": "7", "X-Trace": "keep-me" },
            },
            { lookup: publicLookup }
        );

        const second = calls[1].headers as Record<string, string>;
        expect(Object.keys(second)).not.toContain("Content-Type");
        expect(Object.keys(second).map((k) => k.toLowerCase())).not.toContain("content-length");
        // Everything that is not about the body survives the hop.
        expect(second["X-Trace"]).toBe("keep-me");
    });

    it("keeps content headers on a 307, which keeps the body", async () => {
        const calls: RequestInit[] = [];
        let n = 0;
        globalThis.fetch = vi.fn(async (_i: any, init: RequestInit) => {
            calls.push(init);
            n += 1;
            return n === 1
                ? new Response(null, { status: 307, headers: { location: "https://b.example/next" } })
                : new Response("done", { status: 200 });
        }) as any;

        await EgressFirewall.fetch(
            "https://a.example/start",
            { method: "POST", body: "payload", headers: { "Content-Type": "application/json" } },
            { lookup: publicLookup }
        );

        expect((calls[1].headers as Record<string, string>)["Content-Type"]).toBe("application/json");
        expect(calls[1].body).toBe("payload");
    });

    it("accepts a Headers instance as well as a plain object", async () => {
        const calls = stubRedirect();

        await EgressFirewall.fetch(
            "https://a.example/start",
            { method: "POST", body: "x", headers: new Headers({ "content-type": "text/plain", "x-trace": "keep-me" }) },
            { lookup: publicLookup }
        );

        const second = calls[1].headers as Record<string, string>;
        expect(second["content-type"]).toBeUndefined();
        expect(second["x-trace"]).toBe("keep-me");
    });
});
