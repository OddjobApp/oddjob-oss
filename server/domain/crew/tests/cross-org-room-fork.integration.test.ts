/**
 * Opening a crew room URL under a different organization used to fork it.
 *
 * crew_sessions is unique on (organization_id, session_key), not on session_key, so
 * ensureSession's insert happily created a SECOND room wearing the same key. The fork
 * was created empty — members are only attached when the caller passes agentCardIds,
 * and opening an existing room does not — so the round aborted on "No agents in this
 * crew". The user saw a crew that would not answer in a room that visibly had one,
 * because they were looking at a different room. 46 duplicated keys had accumulated.
 *
 * Only creation is guarded: a key already present in the requested org returns before
 * this check, so the 5 keys that legitimately hold real turns in more than one
 * organization keep resolving.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@server/database_service.js";
import { crewSessions, orgs } from "@shared/schema/index.js";
import { eq, inArray } from "drizzle-orm";
import { crewOrchestratorService } from "../core/crew-orchestrator.service.js";
import { ensureSession } from "../core/crew-session.service.js";

const KEY = `crew-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let orgA = 0;
let orgB = 0;

beforeAll(async () => {
    // orgs.name is UNIQUE, so these are generated per run.
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [a] = await db.insert(orgs).values({ name: `Crew Fork Test A ${stamp}` }).returning();
    const [b] = await db.insert(orgs).values({ name: `Crew Fork Test B ${stamp}` }).returning();
    // The drizzle field is `id`; it maps to the org_id column.
    orgA = a.id;
    orgB = b.id;
});

afterAll(async () => {
    await db.delete(crewSessions).where(eq(crewSessions.sessionKey, KEY));
    if (orgA && orgB) await db.delete(orgs).where(inArray(orgs.id, [orgA, orgB]));
});

describe("ensureSession — cross-org room keys", () => {
    it("creates the room in the org that first opens it", async () => {
        const created = await ensureSession(orgA, KEY, undefined);
        expect(created.organizationId).toBe(orgA);
        expect(created.sessionKey).toBe(KEY);
    });

    it("returns the SAME room when the owning org opens it again", async () => {
        const first = await ensureSession(orgA, KEY, undefined);
        const second = await ensureSession(orgA, KEY, undefined);
        expect(second.id).toBe(first.id);
    });

    it("refuses to fork the room into another org, with a 404", async () => {
        await expect(ensureSession(orgB, KEY, undefined)).rejects.toMatchObject({
            statusCode: 404,
            code: "ROOM_NOT_IN_ORG",
        });
    });

    it("leaves no empty duplicate behind after the refusal", async () => {
        await ensureSession(orgB, KEY, undefined).catch(() => {});
        const rows = await db.select().from(crewSessions).where(eq(crewSessions.sessionKey, KEY));
        expect(rows).toHaveLength(1);
        expect(rows[0].organizationId).toBe(orgA);
    });

    it("does not leak which organization owns the room", async () => {
        const err = await ensureSession(orgB, KEY, undefined).catch((e) => e);
        expect(String(err.message)).not.toContain(String(orgA));
    });
});
