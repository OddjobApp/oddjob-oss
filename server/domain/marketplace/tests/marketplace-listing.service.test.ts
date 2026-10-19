/** @vitest-environment node */

/**
 * install_count is counted in the database. `read + 1` in this process meant two
 * orgs installing the same listing at the same time recorded one install.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { calls, listingRow, agentCardService } = vi.hoisted(() => ({
    calls: { updates: [] as any[], wheres: 0 },
    listingRow: { current: {} as any },
    agentCardService: { getById: vi.fn(), create: vi.fn() },
}));

vi.mock("@server/database_service.js", () => ({
    db: {
        select: () => ({
            from: () => ({
                where: (condition: any) => {
                    calls.wheres += 1;
                    const rows = [listingRow.current];
                    return {
                        limit: async () => rows,
                        orderBy: () => ({ limit: async () => rows }),
                        condition,
                    };
                },
            }),
        }),
        insert: () => ({ values: () => ({ returning: async () => [listingRow.current] }) }),
        update: () => ({
            set: (values: any) => {
                calls.updates.push(values);
                return { where: async () => undefined };
            },
        }),
    },
}));

vi.mock("@server/domain/agent-cards/core/agent-card.service.js", () => ({ agentCardService }));

const { MarketplaceListingService } = await import("../core/marketplace-listing.service.js");

const service = new MarketplaceListingService();

beforeEach(() => {
    vi.clearAllMocks();
    calls.updates = [];
    calls.wheres = 0;
    listingRow.current = {
        id: 5,
        organizationId: 9,
        isPublic: true,
        installCount: 4,
        name: "Daily Jira Bot",
        description: "Posts a summary",
        agentCardSnapshot: {
            name: "Daily Jira Bot",
            personaType: "analyst",
            capabilities: ["jira-integration"],
            tools: [{ name: "jira_search" }],
            topicAffinities: ["not_a_real_topic"],
            intentAffinities: [],
        },
    };
    agentCardService.create.mockResolvedValue({ id: 88, name: "Daily Jira Bot" });
});

describe("marketplaceListingService.install", () => {
    it("increments the counter in SQL rather than writing a number it read", async () => {
        await service.install(5, 42);

        const increment = calls.updates.find((u) => "installCount" in u);
        expect(increment).toBeDefined();
        // A literal 5 here would be the lost update: it encodes the value this
        // process happened to read.
        expect(typeof increment.installCount).not.toBe("number");
        expect(increment.updatedAt).toBeInstanceOf(Date);
    });

    it("clones the snapshot into the installing org, dropping affinities the categories do not name", async () => {
        const result = await service.install(5, 42);

        expect(agentCardService.create).toHaveBeenCalledWith(42, expect.objectContaining({
            name: "Daily Jira Bot",
            personaType: "analyst",
            topicAffinities: [],
        }));
        expect(result).toEqual({ agentCardId: 88, agentCardName: "Daily Jira Bot" });
    });

    it("hides a withdrawn listing from install", async () => {
        listingRow.current.isPublic = false;
        await expect(service.install(5, 42)).rejects.toThrow(/not found/i);
        expect(agentCardService.create).not.toHaveBeenCalled();
    });
});

describe("marketplaceListingService.listPublic", () => {
    it("builds one query whether or not a category is given", async () => {
        await service.listPublic();
        await service.listPublic("research");
        // One `where` per call: the earlier version built the whole query twice
        // when a category was passed.
        expect(calls.wheres).toBe(2);
    });
});

describe("marketplaceListingService.unpublish", () => {
    it("refuses to withdraw another organization's listing", async () => {
        await expect(service.unpublish(42, 5)).rejects.toThrow(/not found/i);
        expect(calls.updates).toHaveLength(0);
    });

    it("withdraws its own listing and stamps it", async () => {
        await service.unpublish(9, 5);
        expect(calls.updates[0]).toMatchObject({ isPublic: false });
        expect(calls.updates[0].updatedAt).toBeInstanceOf(Date);
    });
});
