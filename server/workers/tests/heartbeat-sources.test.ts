/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@server/database_service.js", () => ({ db: {} }));
vi.mock("../../domain/integrations/core/agentmail.service.js", () => ({
    agentMailService: {
        forOrg: vi.fn(async () => agentMailService),
        getInboxAddress: vi.fn(async () => "oddjobapp@agentmail.to"),
        isConfigured: vi.fn(() => true),
        listMessages: vi.fn(),
    },
}));

// Project scoping has its own integration suite; here every thread is readable.
vi.mock("../../domain/integrations/core/agentmail-thread-scope.service.js", () => ({
    agentMailThreadScope: { assertReadable: vi.fn(), filterThreads: vi.fn(async (_ctx: unknown, threads: unknown[]) => threads), readableFilter: vi.fn(async () => () => true), record: vi.fn(), recordForMissionRun: vi.fn() },
    threadScopeCtx: (_context: unknown, organizationId: number) => ({ organizationId }),
}));

vi.mock("../../domain/tools/v1/capabilities/sdlc-tools.js", () => ({
    sdlcToolStubs: { jiraJqlSearch: vi.fn() },
}));

import { agentMailService } from "../../domain/integrations/core/agentmail.service.js";
import { sdlcToolStubs } from "../../domain/tools/v1/capabilities/sdlc-tools.js";
import { parseRssItems, pollAgentMailInbox, pollJiraQueue, pollRssFeed } from "../heartbeat-sources.js";

afterEach(() => vi.unstubAllGlobals());

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item><guid>g3</guid><title>Third</title><link>https://x/3</link><pubDate>Wed, 01 Oct 2025</pubDate></item>
  <item><guid>g2</guid><title>Second</title><link>https://x/2</link><pubDate>Tue, 30 Sep 2025</pubDate></item>
  <item><guid>g1</guid><title>First</title><link>https://x/1</link><pubDate>Mon, 29 Sep 2025</pubDate></item>
</channel></rss>`;

describe("parseRssItems", () => {
    it("parses rss items with guid fallback chain", () => {
        const items = parseRssItems(RSS);
        expect(items.map((i) => i.id)).toEqual(["g3", "g2", "g1"]);
        expect(items[0].title).toBe("Third");
        expect(items[0].link).toBe("https://x/3");
    });

    it("parses atom entries", () => {
        const atom = `<feed xmlns="http://www.w3.org/2005/Atom">
          <entry><id>e2</id><title>B</title><link href="https://x/b"/></entry>
          <entry><id>e1</id><title>A</title><link href="https://x/a"/></entry>
        </feed>`;
        expect(parseRssItems(atom).map((i) => i.id)).toEqual(["e2", "e1"]);
    });
});

describe("pollRssFeed", () => {
    it("first poll returns only the newest item (no backfill)", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, text: async () => RSS })));
        const items = await pollRssFeed(null, { url: "https://feed" });
        expect(items.map((i) => i.id)).toEqual(["g3"]);
    });

    it("returns items newer than the watermark, oldest first", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, text: async () => RSS })));
        const items = await pollRssFeed("g1", { url: "https://feed" });
        expect(items.map((i) => i.id)).toEqual(["g2", "g3"]);
    });
});

describe("pollAgentMailInbox", () => {
    it("filters outbound mail and items at/before the watermark", async () => {
        process.env.AGENTMAIL_INBOX = "oddjobapp@agentmail.to";
        vi.mocked(agentMailService.listMessages).mockResolvedValue({
            count: 3,
            messages: [
                { message_id: "m3", thread_id: "t", from: "dana@x.io", to: [], subject: "New", created_at: "2025-10-02T00:00:00Z" },
                { message_id: "m2", thread_id: "t", from: "Oddjob <oddjobapp@agentmail.to>", to: [], subject: "Our reply", created_at: "2025-10-01T12:00:00Z" },
                { message_id: "m1", thread_id: "t", from: "dana@x.io", to: [], subject: "Old", created_at: "2025-10-01T00:00:00Z" },
            ],
        } as any);

        const items = await pollAgentMailInbox("2025-10-01T00:00:00Z", {}, 7);
        expect(items).toHaveLength(1);
        expect(items[0].id).toBe("2025-10-02T00:00:00Z");
        expect(items[0].subject).toBe("New");
    });
});

describe("pollJiraQueue", () => {
    const issue = (key: string, updated: string) => ({
        key, summary: `Issue ${key}`, status: "Open", priority: "High",
        assignee: null, issueType: "Bug", project: "OPS", updated,
    });

    it("returns issues newer than the watermark, oldest first", async () => {
        vi.mocked(sdlcToolStubs.jiraJqlSearch).mockResolvedValue({
            success: true,
            issues: [issue("OPS-3", "2025-10-03"), issue("OPS-2", "2025-10-02"), issue("OPS-1", "2025-10-01")],
            total: 3,
        } as any);

        const items = await pollJiraQueue("2025-10-01", { jql: "project = OPS" }, 7);
        expect(items.map((i) => i.key)).toEqual(["OPS-2", "OPS-3"]);
        expect(items[items.length - 1].id).toBe("2025-10-03");
    });

    it("first poll caps at maxFirstPoll instead of draining the backlog", async () => {
        vi.mocked(sdlcToolStubs.jiraJqlSearch).mockResolvedValue({
            success: true,
            issues: Array.from({ length: 9 }, (_, i) => issue(`OPS-${i}`, `2025-10-0${i + 1}`)),
            total: 9,
        } as any);

        const items = await pollJiraQueue(null, { jql: "project = OPS", maxFirstPoll: 3 }, 7);
        expect(items).toHaveLength(3);
    });

    it("fails closed when jql or org is missing", async () => {
        await expect(pollJiraQueue(null, {}, 7)).resolves.toEqual([]);
        await expect(pollJiraQueue(null, { jql: "project = OPS" }, null)).resolves.toEqual([]);
    });
});
