/**
 * The transcript window has to be the RECENT window.
 *
 * `getTranscript` ordered ascending and then applied the limit, so it returned
 * the oldest N turns. runRound asks it for TRANSCRIPT_WINDOW turns to build
 * every agent's prompt, which meant that past N turns a room fed its agents the
 * opening of the conversation forever — and `toGenerationMessages`, which takes
 * the last window of what it is handed, cannot recover rows the query never
 * returned.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@server/database_service.js";
import { crewSessions, crewTurns, orgs } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { crewOrchestratorService } from "../core/crew-orchestrator.service.js";
import { crewRepository } from "../core/crew-repository.js";

const KEY = `crew-window-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const TOTAL = 20;

let orgId = 0;
let sessionId = 0;

beforeAll(async () => {
    const [org] = await db
        .insert(orgs)
        .values({ name: `Transcript Window Test ${KEY}` })
        .returning();
    orgId = org.id;

    const [session] = await db
        .insert(crewSessions)
        .values({ organizationId: orgId, sessionKey: KEY })
        .returning();
    sessionId = session.id;

    for (let i = 1; i <= TOTAL; i++) {
        await db.insert(crewTurns).values({
            sessionId,
            organizationId: orgId,
            speakerType: "user",
            speakerName: "You",
            content: `turn ${i}`,
            round: i,
        });
    }
});

afterAll(async () => {
    if (sessionId) await db.delete(crewTurns).where(eq(crewTurns.sessionId, sessionId));
    if (sessionId) await db.delete(crewSessions).where(eq(crewSessions.id, sessionId));
    if (orgId) await db.delete(orgs).where(eq(orgs.id, orgId));
});

describe("getTranscript", () => {
    it("returns the NEWEST turns when the room is longer than the window", async () => {
        const window = await crewRepository.getTranscript(sessionId, 5);

        expect(window.map((t) => t.content)).toEqual([
            "turn 16",
            "turn 17",
            "turn 18",
            "turn 19",
            "turn 20",
        ]);
    });

    it("hands them back oldest-first, so the prompt reads forwards", async () => {
        const window = await crewRepository.getTranscript(sessionId, 8);

        const ids = window.map((t) => t.id);
        expect([...ids].sort((a, b) => a - b)).toEqual(ids);
    });

    it("returns the whole room, in order, when it fits inside the limit", async () => {
        const all = await crewRepository.getTranscript(sessionId, TOTAL + 10);

        expect(all).toHaveLength(TOTAL);
        expect(all[0].content).toBe("turn 1");
        expect(all[all.length - 1].content).toBe(`turn ${TOTAL}`);
    });
});
