import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EgressFirewall } from "../../server/utils/egress-firewall.js";
import { skillService } from "../../server/domain/agents/core/skill-service.js";
import { SystemWorker } from "../../server/workers/system-worker.js";
import { pythonGateway } from "../../server/domain/integrations/core/gateway/python.gateway.js";

// Mock pythonGateway
vi.mock("../../server/domain/integrations/core/gateway/python.gateway.js", () => ({
    pythonGateway: {
        executeScript: vi.fn().mockResolvedValue({ success: true, result: "mocked-python-result" }),
    },
}));

describe("Security Hardening & Egress Firewall", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        delete process.env.AGENT_EGRESS_WHITELIST;
    });

    describe("EgressFirewall", () => {
        it("should block loopback and local hostnames", () => {
            expect(EgressFirewall.validateUrl("http://localhost/path").allowed).toBe(false);
            expect(EgressFirewall.validateUrl("http://127.0.0.1:8080").allowed).toBe(false);
            expect(EgressFirewall.validateUrl("http://0.0.0.0").allowed).toBe(false);
            expect(EgressFirewall.validateUrl("http://[::1]").allowed).toBe(false);
            expect(EgressFirewall.validateUrl("http://test.local").allowed).toBe(false);
        });

        it("should block cloud metadata API", () => {
            expect(EgressFirewall.validateUrl("http://169.254.169.254/latest/meta-data").allowed).toBe(false);
        });

        it("should block private subnets", () => {
            expect(EgressFirewall.validateUrl("http://192.168.1.1").allowed).toBe(false);
            expect(EgressFirewall.validateUrl("http://10.0.0.1").allowed).toBe(false);
            expect(EgressFirewall.validateUrl("http://172.16.0.1").allowed).toBe(false);
        });

        it("should allow valid public domains", () => {
            expect(EgressFirewall.validateUrl("https://google.com").allowed).toBe(true);
            expect(EgressFirewall.validateUrl("https://github.com/profile").allowed).toBe(true);
        });

        it("should enforce domain whitelist if configured", () => {
            process.env.AGENT_EGRESS_WHITELIST = "atlassian.com,github.com";

            expect(EgressFirewall.validateUrl("https://github.com/repo").allowed).toBe(true);
            expect(EgressFirewall.validateUrl("https://jira.atlassian.com").allowed).toBe(true);
            expect(EgressFirewall.validateUrl("https://google.com").allowed).toBe(false);
        });

        // `URL.hostname` keeps the brackets on an IPv6 literal, so a guard
        // written as startsWith("fd00:") never fires. A prior copy of this
        // check in http-connector.service.ts had every IPv6 branch dead for
        // exactly that reason, and its tests only covered IPv4 literals.
        it("should block IPv6 loopback, link-local and unique-local in bracketed form", () => {
            expect(EgressFirewall.validateUrl("http://[::1]/").allowed).toBe(false);
            expect(EgressFirewall.validateUrl("http://[::]/").allowed).toBe(false);
            expect(EgressFirewall.validateUrl("http://[fe80::1]/").allowed).toBe(false);
            expect(EgressFirewall.validateUrl("http://[feb0::1]/").allowed).toBe(false);
            expect(EgressFirewall.validateUrl("http://[fc00::1]/").allowed).toBe(false);
            expect(EgressFirewall.validateUrl("http://[fd12:3456::1]/").allowed).toBe(false);
            expect(EgressFirewall.validateUrl("http://[fdff::1]/").allowed).toBe(false);
        });

        it("should block IPv4-mapped IPv6 forms of private addresses", () => {
            // URL normalizes these to [::ffff:7f00:1] / [::ffff:a9fe:a9fe].
            expect(EgressFirewall.validateUrl("http://[::ffff:127.0.0.1]/").allowed).toBe(false);
            expect(EgressFirewall.validateUrl("http://[::ffff:169.254.169.254]/").allowed).toBe(false);
            expect(EgressFirewall.validateUrl("http://[::ffff:10.0.0.1]/").allowed).toBe(false);
            // The deprecated IPv4-compatible form, normalized to [::7f00:1].
            expect(EgressFirewall.validateUrl("http://[::127.0.0.1]/").allowed).toBe(false);
        });

        it("should still allow an IPv4-mapped public address", () => {
            expect(EgressFirewall.validateUrl("http://[::ffff:8.8.8.8]/").allowed).toBe(true);
        });

        it("should block the rest of 172.16.0.0/12 and CGNAT, without over-blocking public space", () => {
            expect(EgressFirewall.validateUrl("http://172.20.0.1").allowed).toBe(false);
            expect(EgressFirewall.validateUrl("http://172.31.255.254").allowed).toBe(false);
            expect(EgressFirewall.validateUrl("http://100.64.0.1").allowed).toBe(false);
            // Public: the previous startsWith("172.2")/startsWith("172.3")
            // rules blocked these, and startsWith("172.16") missed 172.20.
            expect(EgressFirewall.validateUrl("http://172.217.0.1").allowed).toBe(true);
            expect(EgressFirewall.validateUrl("http://172.32.0.1").allowed).toBe(true);
        });

        it("should reject non-HTTP protocols", () => {
            expect(EgressFirewall.validateUrl("file:///etc/passwd").allowed).toBe(false);
            expect(EgressFirewall.validateUrl("gopher://example.com").allowed).toBe(false);
            expect(EgressFirewall.validateUrl("data:text/plain;base64,SGVsbG8=").allowed).toBe(false);
        });
    });

    describe("EgressFirewall.fetch redirect handling", () => {
        const originalFetch = globalThis.fetch;
        afterEach(() => { globalThis.fetch = originalFetch; });

        /** A fetch stub that 302s once, to `location`. */
        function redirectOnceTo(location: string) {
            let call = 0;
            return vi.fn(async (input: any) => {
                call += 1;
                if (call === 1) {
                    return new Response(null, { status: 302, headers: { location } });
                }
                return new Response(`REACHED ${String(input)}`, { status: 200 });
            });
        }

        it("blocks a redirect from a public host into private space", async () => {
            // The whole point: validating only the caller's URL lets an allowed
            // host redirect into the metadata service after the check passed.
            globalThis.fetch = redirectOnceTo("http://169.254.169.254/latest/meta-data/") as any;

            const result = await EgressFirewall.fetch("https://example.com/start");

            expect(result.allowed).toBe(false);
            expect(result.reason).toMatch(/private or reserved/i);
            expect(result.reason).toMatch(/redirect/i);
            expect(result.response).toBeUndefined();
        });

        it("blocks a redirect that uses an IPv4-mapped IPv6 loopback", async () => {
            globalThis.fetch = redirectOnceTo("http://[::ffff:127.0.0.1]:9/") as any;

            const result = await EgressFirewall.fetch("https://example.com/start");

            expect(result.allowed).toBe(false);
        });

        it("follows a redirect between allowed hosts and reports the final URL", async () => {
            globalThis.fetch = redirectOnceTo("https://example.org/final") as any;

            const result = await EgressFirewall.fetch("https://example.com/start");

            expect(result.allowed).toBe(true);
            expect(result.finalUrl).toBe("https://example.org/final");
            expect(await result.response!.text()).toContain("REACHED");
        });

        it("never passes redirect: follow to the underlying fetch", async () => {
            const spy = redirectOnceTo("https://example.org/final");
            globalThis.fetch = spy as any;

            await EgressFirewall.fetch("https://example.com/start", { method: "GET" });

            for (const call of spy.mock.calls) {
                expect((call[1] as RequestInit).redirect).toBe("manual");
            }
        });

        it("refuses a redirect chain longer than the limit", async () => {
            globalThis.fetch = vi.fn(async () =>
                new Response(null, { status: 302, headers: { location: "https://example.com/next" } })
            ) as any;

            const result = await EgressFirewall.fetch("https://example.com/start", {}, { maxRedirects: 2 });

            expect(result.allowed).toBe(false);
            expect(result.reason).toMatch(/too many redirects/i);
        });

        it("refuses a blocked URL without issuing a request", async () => {
            const spy = vi.fn();
            globalThis.fetch = spy as any;

            const result = await EgressFirewall.fetch("http://169.254.169.254/latest/meta-data/");

            expect(result.allowed).toBe(false);
            expect(spy).not.toHaveBeenCalled();
        });
    });

    describe("JavaScript Sandbox constructor leakage blocking", () => {
        it("should block direct constructor retrieval", async () => {
            const code = `
                result = args.constructor;
            `;
            const res = await skillService._executeJS("test_escape", code, { value: 42 });
            expect(res.success).toBe(false);
            expect(res.error).toContain("Security Exception");
        });

        it("should block nested constructor constructor evaluation", async () => {
            const code = `
                const fn = args.constructor.constructor;
                result = fn("return process")();
            `;
            const res = await skillService._executeJS("test_escape_nest", code, { value: 42 });
            expect(res.success).toBe(false);
            expect(res.error).toContain("Security Exception");
        });

        it("should block this.constructor escapes", async () => {
            const code = `
                result = this.constructor.constructor("return process")();
            `;
            const res = await skillService._executeJS("test_escape_this", code, { value: 42 });
            expect(res.success).toBe(false);
            expect(res.error).toMatch(/Security Exception|Cannot read properties of undefined/);
        });

        it("should block bracket constructor access", async () => {
            const code = `
                const prop = "const" + "ructor";
                result = args[prop];
            `;
            const res = await skillService._executeJS("test_bracket_escape", code, { value: 42 });
            expect(res.success).toBe(false);
            expect(res.error).toContain("Security Exception");
        });

        it("should permit normal JavaScript computations", async () => {
            const code = `
                result = args.value * 2;
            `;
            const res = await skillService._executeJS("test_normal", code, { value: 21 });
            expect(res.success).toBe(true);
            expect(res.result).toBe(42);
        });
    });

    describe("SystemWorker BullMQ processing", () => {
        it("should process execute-python-skill and forward to Python sidecar gateway", async () => {
            const executeFn = SystemWorker.prototype.execute;
            const mockThis = {
                logger: { info: vi.fn() }
            };
            const job = {
                name: "execute-python-skill",
                queueName: "system",
                data: {
                    code: "print('hello')",
                    args: { x: 1 }
                }
            };

            const result = await executeFn.call(mockThis, job as any);
            expect(pythonGateway.executeScript).toHaveBeenCalledWith("print('hello')", { x: 1 });
            expect(result).toEqual({ success: true, result: "mocked-python-result" });
        });
    });
});
