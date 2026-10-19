import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";

/**
 * The gaps that left crew-1790689275890 looping for thirty rounds:
 * no tool could pull a URL into the room, URL-bearing tools failed on a
 * missing `url` the user's own message carried, and "list_signal_feeds" was
 * a name agents invented rather than a tool that existed.
 *
 * These tests pin each fix: attach_url actually fetches and attaches, the
 * executor fills a missing url from the user's message, and signal feeds are
 * listable without their credentials leaving the service.
 */

vi.mock("@server/database_service.js", () => ({
    db: {
        select: () => ({ from: () => ({ where: () => ({ limit: () => [] }) }) }),
        insert: () => ({ values: () => ({ returning: () => [], onConflictDoUpdate: () => ({ returning: () => [] }) }) }),
    },
}));

const attachCalls: any[] = [];
vi.mock("@domain/knowledge/core/attachment.service.js", () => ({
    attachmentService: {
        attachToRoom: async (input: any) => {
            attachCalls.push(input);
            return {
                attachment: { id: 77, displayName: input.originalName },
                blob: { id: 12, byteSize: input.buffer.byteLength, mimeType: input.mimeType, parseStatus: "parsed", textLength: 42 },
            };
        },
    },
}));

const feedsResult: any[] = [];
vi.mock("@domain/signal-intelligence/core/signal-feeds.service.js", () => ({
    signalFeedsService: { listForOrg: async () => feedsResult },
}));

import { ATTACHMENT_TOOLS } from "@domain/tools/v1/capabilities/attachment-tools.js";
import { SPATIAL_TOOLS } from "@domain/tools/v1/capabilities/spatial-tools.js";
import { CrewToolsService, classifyReadOnly } from "../crew-tools.service.js";

describe("attach_url", () => {
    beforeEach(() => attachCalls.splice(0));
    afterEach(() => vi.unstubAllGlobals());

    const ctx = { organizationId: 291, sessionId: 55, projectId: 9, userId: "u1" };

    it("fetches the URL and attaches it to the room", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => ({
            ok: true,
            status: 200,
            headers: new Map([["content-type", "application/pdf"]]),
            arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        })));

        const out = JSON.parse(await ATTACHMENT_TOOLS.attach_url.execute(
            { url: "https://example.com/report.pdf" },
            ctx as any,
        ));

        expect(out.type).toBe("attachment_attached");
        expect(out.attachmentId).toBe(77);
        expect(out.parseStatus).toBe("parsed");
        expect(attachCalls).toHaveLength(1);
        expect(attachCalls[0].originalName).toBe("report.pdf");
        expect(attachCalls[0].mimeType).toBe("application/pdf");
        expect(attachCalls[0].orgId).toBe(291);
        expect(attachCalls[0].sessionId).toBe(55);
    });

    it("blocks private-network URLs through the egress firewall", async () => {
        const fetchSpy = vi.fn();
        vi.stubGlobal("fetch", fetchSpy);

        const out = JSON.parse(await ATTACHMENT_TOOLS.attach_url.execute(
            { url: "http://192.168.1.10/internal.pdf" },
            ctx as any,
        ));

        expect(out.error).toMatch(/Egress Firewall/i);
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(attachCalls).toHaveLength(0);
    });

    it("re-validates a redirect target instead of trusting the first URL", async () => {
        const fetchSpy = vi.fn(async (url: string) => {
            if (url.includes("evil-redirect")) {
                return { ok: true, status: 302, headers: new Map([["location", "http://169.254.169.254/latest"]]) };
            }
            return { ok: true, status: 200, headers: new Map([["content-type", "text/plain"]]), arrayBuffer: async () => new Uint8Array([1]).buffer };
        });
        vi.stubGlobal("fetch", fetchSpy as any);

        const out = JSON.parse(await ATTACHMENT_TOOLS.attach_url.execute(
            { url: "https://evil-redirect.example.com/x.pdf" },
            ctx as any,
        ));

        expect(out.error).toMatch(/Egress Firewall/i);
        expect(attachCalls).toHaveLength(0);
    });

    it("reports a missing organization instead of hanging", async () => {
        const out = JSON.parse(await ATTACHMENT_TOOLS.attach_url.execute(
            { url: "https://example.com/a.pdf" },
            {} as any,
        ));
        expect(out.error).toMatch(/organization/i);
    });

    it("reports a missing session instead of attaching to nowhere", async () => {
        const out = JSON.parse(await ATTACHMENT_TOOLS.attach_url.execute(
            { url: "https://example.com/a.pdf" },
            { organizationId: 291, projectId: 9 } as any,
        ));
        expect(out.error).toMatch(/room|session/i);
    });

    it("reports a fetch failure rather than claiming the file attached", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => ({
            ok: false, status: 404,
            headers: new Map(),
            arrayBuffer: async () => new ArrayBuffer(0),
        })));

        const out = JSON.parse(await ATTACHMENT_TOOLS.attach_url.execute(
            { url: "https://example.com/missing.pdf" },
            ctx as any,
        ));
        expect(out.error).toMatch(/404|Could not fetch/i);
        expect(attachCalls).toHaveLength(0);
    });
});

describe("URL autofill in execute()", () => {
    const service = new CrewToolsService();
    let captured: any = null;
    const fakeBrowse = {
        definition: {
            name: "browse_web",
            idempotency: "read-safe" as const,
            label: "Browse",
            group: "Research",
            riskLevel: "low" as const,
            description: "test",
            parameters: z.object({ url: z.string().url() }),
            execute: async (params: any) => { captured = params; return JSON.stringify({ ok: true }); },
        },
        reason: "declared-read-safe" as const,
    };
    const fakeAttach = {
        definition: {
            ...fakeBrowse.definition,
            name: "attach_url",
            parameters: z.object({ url: z.string().url(), fileName: z.string().optional() }),
        },
        reason: "declared-read-safe" as const,
    };

    beforeEach(() => { captured = null; });

    it("fills browse_web's url from the user's message", async () => {
        const result = await service.execute(
            "browse_web",
            {},
            [fakeBrowse],
            { organizationId: 291, named: { message: "Summarize https://example.com/spec.pdf for me" } } as any,
        );
        expect(result.record.ok).toBe(true);
        expect(captured.url).toBe("https://example.com/spec.pdf");
    });

    it("fills attach_url's url from the user's message", async () => {
        const result = await service.execute(
            "attach_url",
            {},
            [fakeAttach],
            { organizationId: 291, named: { message: "Lets use https://example.com/data.csv" } } as any,
        );
        expect(result.record.ok).toBe(true);
        expect(captured.url).toBe("https://example.com/data.csv");
    });

    it("strips trailing sentence punctuation from the extracted URL", async () => {
        await service.execute(
            "browse_web",
            {},
            [fakeBrowse],
            { organizationId: 291, named: { message: "Read https://example.com/doc.pdf." } } as any,
        );
        expect(captured.url).toBe("https://example.com/doc.pdf");
    });

    it("does not overwrite an explicit url the caller supplied", async () => {
        await service.execute(
            "browse_web",
            { url: "https://other.example.com/chosen" },
            [fakeBrowse],
            { organizationId: 291, named: { message: "https://example.com/spec.pdf" } } as any,
        );
        expect(captured.url).toBe("https://other.example.com/chosen");
    });

    it("still returns a validation error when the message has no URL", async () => {
        const result = await service.execute(
            "browse_web",
            {},
            [fakeBrowse],
            { organizationId: 291, named: { message: "browse the docs please" } } as any,
        );
        expect(result.record.ok).toBe(false);
        expect(result.record.error).toMatch(/invalid arguments/i);
    });
});

describe("list_signal_feeds", () => {
    beforeEach(() => feedsResult.splice(0));

    it("is admitted as a declared read-safe tool", () => {
        expect(classifyReadOnly(SPATIAL_TOOLS.list_signal_feeds as any)).toBe("declared-read-safe");
    });

    it("requires an organization", async () => {
        const out = JSON.parse(await SPATIAL_TOOLS.list_signal_feeds.execute({} as any, {} as any));
        expect(out.error).toMatch(/organization/i);
    });

    it("lists feeds org-scoped and never exposes credentials", async () => {
        feedsResult.push({
            id: 3,
            name: "County RSS",
            sourceType: "rss",
            url: "https://county.gov/feed.xml?token=SECRET",
            authCredentials: { bearer: "SECRET-TOKEN" },
            enabled: true,
            status: "active",
            lastPollAt: null,
            lastSuccessAt: null,
            consecutiveFailures: 0,
        });

        const out = JSON.parse(await SPATIAL_TOOLS.list_signal_feeds.execute({} as any, { organizationId: 291 } as any));

        expect(out.type).toBe("signal_feed_list");
        expect(out.count).toBe(1);
        expect(out.feeds[0].name).toBe("County RSS");
        // The feed URL is cut to its host — query strings carry tokens.
        expect(out.feeds[0].url).toBe("county.gov");
        // Nothing in the payload may carry the credential through.
        expect(JSON.stringify(out)).not.toContain("SECRET");
    });
});
