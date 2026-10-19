import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

/**
 * crew-1790715777859-69qaluh looped nine rounds on fabricated evidence:
 * "Action Taken: contacted the support team" over zero calls, "visited
 * ocao.org" over three browse_web failures that never passed a url, and a
 * "would you like me to: 1 or 2?" menu where both options were the agent's
 * own to perform.
 *
 * These pin the runtime guards: evasion detection at the turn boundary,
 * per-turn duplicate-failure dedup, validation errors that name the declared
 * parameters, and URL autofill that reads the agent's own draft.
 */

vi.mock("@server/database_service.js", () => ({
    db: {
        select: () => ({ from: () => ({ where: () => ({ limit: () => [], then: (r: any) => Promise.resolve([]).then(r) }) }) }),
    },
}));

vi.mock("../crew-turn-generation.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../crew-turn-generation.js")>();
    return { ...actual, generateForCard: vi.fn() };
});

import { CrewToolsService, digestToolOutput } from "../crew-tools.service.js";
import { detectEvasion, buildToolResultReminders, repairEvasion } from "../crew-speaker-turn.service.js";
import { generateForCard } from "../crew-turn-generation.js";
import type { ToolCallRecord } from "../crew-tools.service.js";

const ok = (name: string, digest?: string): ToolCallRecord => ({ name, ok: true, ms: 5, digest });
const fail = (name: string, error: string): ToolCallRecord => ({ name, ok: false, ms: 5, error });

describe("detectEvasion — ungrounded claims", () => {
    it("flags 'contacted the support team' with no send-capable call", () => {
        const reason = detectEvasion(
            "Action Taken: Contacted the Orange County Assessor’s Office support team for assistance.\n\n### Evidence Collected:\nThey do not offer a public API.",
            [],
        );
        expect(reason).toMatch(/contacted|third party/i);
    });

    it("flags a page visit with only failed browse attempts", () => {
        const reason = detectEvasion(
            "I visited https://www.ocao.org/ and found no API endpoint.",
            [fail("browse_web", "invalid arguments — url: Required")],
        );
        expect(reason).toMatch(/visited a page|no successful/i);
    });

    it("accepts a page visit backed by a successful browse", () => {
        expect(
            detectEvasion("I visited the assessor site — it lists parcel search only.", [ok("browse_web")]),
        ).toBeNull();
    });

    it("flags search findings when no lookup succeeded", () => {
        const reason = detectEvasion(
            "After performing the web search, I found several resources on filing a request.",
            [fail("browse_web", "url: Required")],
        );
        expect(reason).toMatch(/search findings/i);
    });

    it("accepts search findings backed by a successful lookup", () => {
        expect(
            detectEvasion("After performing the web search, I found the county's delinquent list.", [
                ok("google_search", "5 items"),
            ]),
        ).toBeNull();
    });

    it("flags an evidence section over zero successful calls", () => {
        const reason = detectEvasion("### Evidence Collected:\n- The site lists tools for data access.", []);
        expect(reason).toMatch(/no successful tool call/i);
    });

    it("leaves grounded work alone", () => {
        expect(
            detectEvasion("The county list attached as orange-county.pdf. I parsed 412 parcels.", [
                ok("attach_url", "orange-county.pdf"),
            ]),
        ).toBeNull();
    });
});

describe("detectEvasion — the menu loop", () => {
    it("flags 'would you like me to' over self-executable options", () => {
        const reason = detectEvasion(
            "Would you like me to:\n1. Visit the Orange County Assessor’s Office website\n2. Explore third-party data sources\n\nWhich option would you prefer?",
            [ok("search_unified_knowledge", "3 items")],
        );
        expect(reason).toMatch(/perform itself/i);
    });

    it("does not flag a genuine either/or the agent cannot decide", () => {
        expect(
            detectEvasion(
                "Would you like me to target the secured roll or the unsecured roll? These are different datasets and only one fits your search-by-zipcode requirement.",
                [],
            ),
        ).toBeNull();
    });
});

describe("execute() — duplicate failure dedup and schema-rich errors", () => {
    const service = new CrewToolsService();
    const calls: any[] = [];
    const fakeBrowse = {
        definition: {
            name: "browse_web",
            label: "Browse",
            description: "test",
            parameters: z.object({ url: z.string().url(), depth: z.number().optional() }),
            execute: async (params: any) => { calls.push(params); return JSON.stringify({ ok: true }); },
        },
        reason: "declared-read-safe" as const,
    };

    beforeEach(() => calls.splice(0));

    it("an identical failed call is not re-executed in the same turn", async () => {
        const ctx = { organizationId: 291, named: { message: "no url here" } } as any;

        const first = await service.execute("browse_web", {}, [fakeBrowse], ctx);
        const second = await service.execute("browse_web", {}, [fakeBrowse], ctx);

        expect(first.record.ok).toBe(false);
        expect(second.record.ok).toBe(false);
        expect(second.record.error).toMatch(/repeat of an identical call/i);
        expect(second.record.ms).toBe(0);
        expect(calls).toHaveLength(0);
    });

    it("the same tool with different arguments still runs", async () => {
        const ctx = { organizationId: 291, named: {} } as any;

        await service.execute("browse_web", {}, [fakeBrowse], ctx);
        const retried = await service.execute(
            "browse_web",
            { url: "https://example.com/real" },
            [fakeBrowse],
            ctx,
        );

        expect(retried.record.ok).toBe(true);
        expect(calls).toHaveLength(1);
    });

    it("the failure cache is scoped to the turn's context", async () => {
        const ctx1 = { organizationId: 291, named: {} } as any;
        const ctx2 = { organizationId: 291, named: {} } as any;

        await service.execute("browse_web", {}, [fakeBrowse], ctx1);
        const fresh = await service.execute("browse_web", {}, [fakeBrowse], ctx2);

        // A new turn's context re-runs the validation rather than reporting a repeat.
        expect(fresh.record.error).toMatch(/^invalid arguments/);
    });

    it("validation errors name the declared parameters, not just the bad field", async () => {
        const result = await service.execute(
            "browse_web",
            {},
            [fakeBrowse],
            { organizationId: 291, named: {} } as any,
        );

        expect(result.output).toMatch(/Declared parameters/);
        expect(result.output).toMatch(/url: string \(required\)/);
    });
});

describe("URL autofill — beyond the user's message", () => {
    const service = new CrewToolsService();
    let captured: any = null;
    const fakeBrowse = {
        definition: {
            name: "browse_web",
            label: "Browse",
            description: "test",
            parameters: z.object({ url: z.string().url() }),
            execute: async (params: any) => { captured = params; return JSON.stringify({ ok: true }); },
        },
        reason: "declared-read-safe" as const,
    };

    beforeEach(() => { captured = null; });

    it("fills url from the draft the agent just wrote", async () => {
        const result = await service.execute(
            "browse_web",
            {},
            [fakeBrowse],
            {
                organizationId: 291,
                named: {
                    message: "check the assessor site",
                    lastDraft: "I will now browse https://www.ocassessor.gov/ for the list.",
                },
            } as any,
        );
        expect(result.record.ok).toBe(true);
        expect(captured.url).toBe("https://www.ocassessor.gov/");
    });

    it("falls back to recent turns when neither message nor draft carries one", async () => {
        const result = await service.execute(
            "browse_web",
            {},
            [fakeBrowse],
            {
                organizationId: 291,
                named: {
                    message: "open it",
                    priorText: "Some earlier turn\nThe list is at https://taxbill.octreasurer.gov/ as discussed.",
                },
            } as any,
        );
        expect(result.record.ok).toBe(true);
        expect(captured.url).toBe("https://taxbill.octreasurer.gov/");
    });

    it("the user's own message still wins over the draft", async () => {
        await service.execute(
            "browse_web",
            {},
            [fakeBrowse],
            {
                organizationId: 291,
                named: {
                    message: "use https://user-given.example.com/",
                    lastDraft: "I will browse https://agent-invented.example.com/",
                },
            } as any,
        );
        expect(captured.url).toBe("https://user-given.example.com/");
    });
});

describe("buildToolResultReminders — empty lookups escalate", () => {
    it("points an empty lookup at external sources instead of letting it restate nothing", () => {
        const reminder = buildToolResultReminders(
            [ok("search_unified_knowledge", "0 items")],
            "find the county delinquent list",
        );
        expect(reminder).toMatch(/google_search|browse_web/i);
        expect(reminder).toMatch(/nothing|did not produce/i);
    });

    it("stays quiet when lookups returned something", () => {
        const reminder = buildToolResultReminders(
            [ok("search_unified_knowledge", "3 items: a, b, c")],
            "find the county delinquent list",
        );
        expect(reminder).not.toMatch(/escalate to google_search/i);
    });
});

describe("repairEvasion — a still-evasive rewrite never posts", () => {
    const card = { name: "Copilot" } as any;
    const FABRICATED = "Action Taken: Contacted the Orange County Assessor’s Office support team for assistance.";

    const repair = (toolsUsed: ToolCallRecord[], visible = FABRICATED) =>
        repairEvasion({ cost: {} as any, card, orgId: 1, messages: [], toolsUsed, visible });

    beforeEach(() => vi.mocked(generateForCard).mockReset());

    it("returns the draft untouched when nothing evades", async () => {
        const result = await repair([ok("browse_web")], "I browsed the assessor site — it lists parcel search only.");
        expect(result).toContain("parcel search");
        expect(generateForCard).not.toHaveBeenCalled();
    });

    it("returns a repaired draft that no longer evades", async () => {
        vi.mocked(generateForCard).mockResolvedValue({ content: "I could not reach anyone — no contact tool exists in this room." } as any);
        const result = await repair([]);
        expect(result).toMatch(/could not reach anyone/i);
    });

    it("replaces a still-evasive repair with the factual fallback when nothing ran", async () => {
        vi.mocked(generateForCard).mockResolvedValue({ content: FABRICATED } as any);
        const result = await repair([]);
        expect(result).not.toContain("Contacted");
        expect(result).toMatch(/no tool ran/i);
    });

    // The subtle case: an unrelated call succeeded while the claimed action
    // never ran. The old guard returned the evasive text because
    // every(t => !t.ok) was false over a non-empty array.
    it("replaces a still-evasive repair even when an unrelated call succeeded", async () => {
        vi.mocked(generateForCard).mockResolvedValue({ content: FABRICATED } as any);
        const result = await repair([ok("search_unified_knowledge", "2 items")]);
        expect(result).not.toContain("Contacted");
        expect(result).toMatch(/only search_unified_knowledge succeeded/i);
    });

    it("names the failed calls in the fallback", async () => {
        vi.mocked(generateForCard).mockResolvedValue({ content: FABRICATED } as any);
        const result = await repair([fail("browse_web", "url: Required")]);
        expect(result).toMatch(/browse_web \(url: Required\) failed/i);
    });

    // MAX_TURN_REPAIRS caps the total repair generations across a turn — when
    // it is spent the evasive draft still cannot post: the factual fallback
    // fires with zero additional model calls.
    it("posts the factual fallback with no model call when the repair budget is spent", async () => {
        const result = await repairEvasion({
            cost: {} as any, card, orgId: 1, messages: [], toolsUsed: [], visible: FABRICATED,
            repairs: { used: 3, max: 3 },
        });
        expect(result).not.toContain("Contacted");
        expect(result).toMatch(/no tool ran/i);
        expect(generateForCard).not.toHaveBeenCalled();
    });
});
