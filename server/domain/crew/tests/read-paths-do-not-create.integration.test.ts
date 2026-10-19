/**
 * Reading a crew room must never bring one into existence.
 *
 * authorizeRoom called ensureSession — find-or-CREATE — from every route, so any GET
 * could mint a room in whatever organization that particular request resolved to. The
 * SSE stream did exactly that: it arrived with no orgId, fell back to the user's
 * default org, and created the room there while every other call on the page addressed
 * the selected org. The user was then locked out of a room they had just opened.
 *
 * Creation now belongs to POST /message alone.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@server/database_service.js";
import { crewSessions, orgs } from "@shared/schema/index.js";
import { eq, inArray } from "drizzle-orm";
import { crewOrchestratorService } from "../core/crew-orchestrator.service.js";
import { ensureSession } from "../core/crew-session.service.js";
import { crewRepository } from "../core/crew-repository.js";

const KEY = `crew-read-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let orgA = 0;
let orgB = 0;

beforeAll(async () => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [a] = await db.insert(orgs).values({ name: `Read Path Test A ${stamp}` }).returning();
    const [b] = await db.insert(orgs).values({ name: `Read Path Test B ${stamp}` }).returning();
    orgA = a.id;
    orgB = b.id;
});

afterAll(async () => {
    await db.delete(crewSessions).where(eq(crewSessions.sessionKey, KEY));
    if (orgA && orgB) await db.delete(orgs).where(inArray(orgs.id, [orgA, orgB]));
});

describe("findSession — the read path", () => {
    it("returns null for a room that does not exist, and creates nothing", async () => {
        expect(await crewRepository.findSession(orgA, KEY)).toBeNull();

        const rows = await db.select().from(crewSessions).where(eq(crewSessions.sessionKey, KEY));
        expect(rows).toHaveLength(0);
    });

    it("stays null however many times it is called", async () => {
        for (let i = 0; i < 3; i++) {
            expect(await crewRepository.findSession(orgA, KEY)).toBeNull();
        }
        const rows = await db.select().from(crewSessions).where(eq(crewSessions.sessionKey, KEY));
        expect(rows).toHaveLength(0);
    });

    it("finds the room once something actually creates it", async () => {
        const created = await ensureSession(orgA, KEY, undefined);
        const found = await crewRepository.findSession(orgA, KEY);
        expect(found?.id).toBe(created.id);
    });

    it("does not see another org's room, and still creates nothing", async () => {
        expect(await crewRepository.findSession(orgB, KEY)).toBeNull();

        // The critical property: a read from the wrong org leaves no second room behind.
        const rows = await db.select().from(crewSessions).where(eq(crewSessions.sessionKey, KEY));
        expect(rows).toHaveLength(1);
        expect(rows[0].organizationId).toBe(orgA);
    });
});

/**
 * Reading a room that does not exist yet must not look like a broken room.
 *
 * Making reads non-creating was right, but answering 404 for a room the user had just
 * opened made every new room render as an error — rooms only come into existence on the
 * first POST /message. Empty and missing are different states, and the client needs the
 * former.
 */
describe("a room that has not been created yet", () => {
    it("is empty, not missing — findSession returns null and the caller renders empty", async () => {
        const fresh = `crew-empty-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        expect(await crewRepository.findSession(orgA, fresh)).toBeNull();

        // And still nothing was created by asking.
        const rows = await db.select().from(crewSessions).where(eq(crewSessions.sessionKey, fresh));
        expect(rows).toHaveLength(0);
    });
});
