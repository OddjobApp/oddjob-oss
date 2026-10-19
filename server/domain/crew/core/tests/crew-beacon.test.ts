import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
    participants: [] as Array<{ userId: string }>,
    project: null as null | { ownerUserId: string | null },
    projectMembers: [] as Array<{ principalId: string }>,
    posted: [] as any[],
    pushed: [] as Array<{ userId: string; payload: any }>,
    published: [] as any[],
}));

vi.mock("@server/database_service.js", async () => {
    const schema = await import("@shared/schema/index.js");
    const query = (table: unknown) => {
        const rows = () => (table === schema.projects ? (state.project ? [state.project] : []) : state.projectMembers);
        const chain: any = { where: () => chain, limit: () => chain, then: (res: any, rej: any) => Promise.resolve(rows()).then(res, rej) };
        return chain;
    };
    return { db: { select: () => ({ from: (table: unknown) => query(table) }) } };
});
vi.mock("@domain/core/notifications/push.service.js", () => ({
    pushService: {
        sendToUser: async (userId: string, payload: any) => {
            state.pushed.push({ userId, payload });
            return userId === "nobody-home" ? 0 : 1;
        },
    },
}));
vi.mock("../crew-participants.service.js", () => ({
    crewParticipantsService: { ensureParticipant: async () => undefined, list: async () => state.participants },
}));
vi.mock("../crew-repository.js", () => ({
    crewRepository: { postTurn: async (_org: number, _session: number, values: any) => { state.posted.push(values); return { id: 99, ...values }; } },
}));
vi.mock("../crew-stream.service.js", () => ({ crewStreamService: { publish: async (e: any) => { state.published.push(e); } } }));

import { beaconRecipients, crewBeaconService, parseBeacon } from "../crew-beacon.service.js";

describe("parseBeacon", () => {
    it("accepts a fix and keeps a believable timestamp", () => {
        const at = new Date().toISOString();
        expect(parseBeacon({ lat: 33.68, lng: -117.9, accuracyM: 12.4, at })).toEqual({ lat: 33.68, lng: -117.9, accuracyM: 12.4, at });
    });

    it("rejects coordinates off the globe and silly accuracy", () => {
        expect(() => parseBeacon({ lat: 91, lng: 0 })).toThrow(/lat/);
        expect(() => parseBeacon({ lat: 0, lng: -181 })).toThrow(/lng/);
        expect(() => parseBeacon({ lat: "x", lng: 0 })).toThrow(/lat/);
        expect(() => parseBeacon({ lat: 0, lng: 0, accuracyM: -1 })).toThrow(/accuracyM/);
    });

    it("drops a phone clock that is days off", () => {
        expect(parseBeacon({ lat: 0, lng: 0, at: "2001-01-01T00:00:00Z" }).at).toBeUndefined();
    });
});

describe("crewBeaconService.raise", () => {
    beforeEach(() => {
        state.participants = [{ userId: "me" }, { userId: "ana" }, { userId: "nobody-home" }];
        state.project = null;
        state.projectMembers = [];
        state.posted = [];
        state.pushed = [];
        state.published = [];
    });

    it("posts a map the room and agents can see, and notifies everyone else", async () => {
        const result = await crewBeaconService.raise({
            orgId: 342,
            room: { id: 5, sessionKey: "crew-1-a" },
            userId: "me",
            displayName: "Jann",
            beacon: { lat: 33.68, lng: -117.9, accuracyM: 8, at: "2026-10-08T17:00:00.000Z" },
        });

        const turn = state.posted[0];
        expect(turn).toMatchObject({ speakerType: "user", userId: "me", speakerName: "Jann" });
        // The agents read coordinates as prose; people get a map.
        expect(turn.content).toContain("33.68000, -117.90000");
        expect(turn.artifacts[0]).toMatchObject({
            tool: "location_beacon",
            payload: { type: "assistant_map", title: "Jann's location", markers: [{ lat: 33.68, lng: -117.9, label: "Jann" }] },
        });
        expect(state.published[0]).toMatchObject({ type: "turn", sessionKey: "crew-1-a" });

        // Not the sender; everyone else, with a link to the room.
        expect(state.pushed.map((p) => p.userId)).toEqual(["ana", "nobody-home"]);
        expect(state.pushed[0].payload.url).toBe("/workspace/chat/crew-1-a?orgId=342");
        expect(result).toMatchObject({ notified: 1, recipients: 2 });
    });

    it("reaches everyone in the room's project, not only the room", async () => {
        state.participants = [{ userId: "me" }];
        state.project = { ownerUserId: "owner" };
        state.projectMembers = [{ principalId: "ana" }, { principalId: "me" }, { principalId: "bo" }];
        const people = await beaconRecipients(342, { id: 5, projectId: 3 }, "me");
        expect(people.sort()).toEqual(["ana", "bo", "owner"]);
    });

    it("keeps to the room's participants when the room is not in a project", async () => {
        state.project = { ownerUserId: "owner" };
        state.projectMembers = [{ principalId: "stranger" }];
        const people = await beaconRecipients(342, { id: 5, projectId: null }, "me");
        expect(people.sort()).toEqual(["ana", "nobody-home"]);
    });
});
