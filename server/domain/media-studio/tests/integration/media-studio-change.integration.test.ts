/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { inArray, sql } from "drizzle-orm";
import { configureTestEnvironment } from "../../../../../tests/configure-test-environment.js";

/**
 * Changes asked for in a CREW room about something marked in Media Studio, against a
 * real database: drafted as checked edits that write nothing, applied exactly as the
 * card holds them, and refused for a scene that has changed since. The model is fake.
 */

configureTestEnvironment();

const { db } = await import("@server/database_service.js");
const { orgs, users, userOrgs } = await import("@shared/schema/auth.js");
const { mediaTakes } = await import("@shared/schema/media-studio.js");
const { mediaStudio } = await import("../../core/media-studio.service.js");
const { applyMediaChange, draftMediaChange, sceneDigest } = await import("../../core/media-change.js");
const { MEDIA_STUDIO_CHANGE_TOOLS } = await import("@domain/tools/v1/capabilities/media-studio-change-tools.js");
const { getAgentTools } = await import("@domain/tools/v1/capabilities/index.js");
const { UNIVERSAL_PRESENTATION_TOOLS, detectArtifact } = await import("@domain/crew/core/crew-tools.service.js");
const { findMediaChangeProposal } = await import("@shared/media-studio-crew.js");

let reachable = false;
try {
    await db.execute("SELECT 1" as any);
    reachable = true;
} catch (e: any) {
    console.warn(`[media-change] SKIPPED — no test database reachable (${e?.message ?? e}).`);
}

const stamp = Date.now();

describe.skipIf(!reachable)("Media Studio changes from the room", () => {
    let orgId: number, otherOrgId: number;
    let ownerId: string, strangerId: string;
    const ctx = (userId: string, organizationId = orgId) =>
        ({ organizationId, userId, isAdmin: false, isSuperAdmin: false, isOrgAdmin: false }) as any;

    beforeAll(async () => {
        const [a, b] = await db.insert(orgs).values([
            { name: `Change ${stamp}`, slug: `change-${stamp}` },
            { name: `Change other ${stamp}`, slug: `change-other-${stamp}` },
        ] as any).returning();
        orgId = a.id;
        otherOrgId = b.id;
        const [owner, stranger] = await db.insert(users).values([
            { username: `change_owner_${stamp}`, password: "not-a-real-password", email: `change_owner_${stamp}@example.test` },
            { username: `change_stranger_${stamp}`, password: "not-a-real-password", email: `change_stranger_${stamp}@example.test` },
        ] as any).returning();
        ownerId = owner.id;
        strangerId = stranger.id;
        await db.insert(userOrgs).values([{ userId: ownerId, orgId }, { userId: strangerId, orgId: otherOrgId }] as any);
    });

    afterAll(async () => {
        if (!orgId) return;
        await db.execute(sql`delete from agent_long_term_memories where user_id in (${ownerId}, ${strangerId})`).catch(() => undefined);
        await db.execute(sql`delete from knowledge_topics where organization_id = ${orgId}`).catch(() => undefined);
        await db.delete(orgs).where(inArray(orgs.id, [orgId, otherOrgId])).catch(() => {});
        await db.delete(users).where(inArray(users.id, [ownerId, strangerId].filter(Boolean))).catch(() => {});
    });

    async function production() {
        let p = await mediaStudio.createProduction(ctx(ownerId), { title: "Rooftop chase", aspectRatio: "2.39:1" });
        p = await mediaStudio.addScene(ctx(ownerId), p.id, { title: "Arrival" });
        const sceneId = p.scenes[0].id;
        p = await mediaStudio.updateScene(ctx(ownerId), sceneId, { location: "Archive rooftop", timeOfDay: "night", mood: "tense" });
        p = await mediaStudio.addPlotPoint(ctx(ownerId), sceneId, { title: "She reaches the roof" });
        p = await mediaStudio.addPlotPoint(ctx(ownerId), sceneId, { title: "She runs" });
        p = await mediaStudio.addShot(ctx(ownerId), sceneId, { action: "Elena crouches behind the parapet", dialogue: [{ speaker: "Elena", line: "Not tonight." }] });
        p = await mediaStudio.addShot(ctx(ownerId), sceneId, { action: "Wide on the stairwell" });
        return p;
    }
    const selectionOf = (p: any) => ({ productionId: p.id, sceneId: p.scenes[0].id, sceneKey: "SCENE-01", kind: "scene" as const, id: p.scenes[0].id, label: "SCENE-01: Arrival" });
    const colder = (p: any, extra: unknown[] = []) => async () => "```json\n" + JSON.stringify({
        edits: [
            { op: "update_scene", patch: { mood: "cold, watchful", location: "Archive rooftop" } },
            { op: "add_plot_point", title: "The drone spots her", beat: "A red light sweeps the parapet.", afterPlotPointId: p.scenes[0].plotPoints[0].id },
            { op: "update_shot", shotId: p.scenes[0].shots[0].id, patch: { dialogue: [{ speaker: "Elena", line: "Not tonight.", delivery: "whispering" }] } },
            ...extra,
        ],
    }) + "\n```";

    it("drafts a change as checked edits, says what changes, and writes nothing", async () => {
        const p = await production();
        const scene = p.scenes[0];
        const prompts: string[] = [];
        const model = colder(p, [{ op: "remove_shot", shotId: 999999 }]);
        const drafted = await draftMediaChange(ctx(ownerId), selectionOf(p), "Make it colder and add a beat where the drone spots her", {
            model: async (prompt) => { prompts.push(prompt); return model(); },
        });

        expect("refused" in drafted).toBe(false);
        const proposal = drafted as Exclude<typeof drafted, { refused: string }>;
        expect(proposal).toMatchObject({
            productionId: p.id, productionTitle: "Rooftop chase", sceneId: scene.id, sceneKey: "SCENE-01", sceneTitle: "Arrival",
            target: { kind: "scene", id: scene.id, label: "SCENE-01: Arrival" }, baseDigest: sceneDigest(scene),
        });
        expect(proposal.proposalId).toMatch(/^mediachg_[a-f0-9]{32}$/);
        expect(proposal.edits).toHaveLength(3);
        expect(proposal.changes).toEqual([
            'Scene mood: "tense" → "cold, watchful"',
            'New plot point after plot point 1 ("She reaches the roof"): "The drone spots her" — A red light sweeps the parapet.',
            'Shot 1 dialogue: Elena: "Not tonight." → Elena (whispering): "Not tonight."',
        ]);
        expect(proposal.skipped).toEqual(["There is no shot 999999 in SCENE-01, so it was left out."]);
        expect(prompts[0]).toContain("<instruction>Make it colder and add a beat where the drone spots her</instruction>");
        expect(prompts[0]).toContain(`"id":${scene.shots[0].id}`);

        expect((await mediaStudio.getProduction(ctx(ownerId), p.id)).scenes[0]).toMatchObject({ mood: "tense" });
    });

    it("applies exactly the card from the room, and refuses it once the scene has changed", async () => {
        const p = await production();
        const proposal = await draftMediaChange(ctx(ownerId), selectionOf(p), "Make it colder", { model: colder(p) }) as any;
        const apply = MEDIA_STUDIO_CHANGE_TOOLS.apply_media_change;
        const tool = { organizationId: orgId, userId: ownerId } as any;

        const out = await apply.execute({ proposal }, tool) as string;
        const artifact = detectArtifact("apply_media_change", out);
        expect(artifact?.payload).toMatchObject({ type: "media_studio_pod", productionId: p.id, proposalId: proposal.proposalId, sceneId: "SCENE-01", sceneTitle: "Arrival" });
        const room = [{ artifacts: [{ payload: { type: "media_change_proposal", ...proposal } }] }, { artifacts: [artifact!] }];
        expect(findMediaChangeProposal(room as any, proposal.proposalId)).toMatchObject({ applied: true });

        const after = (await mediaStudio.getProduction(ctx(ownerId), p.id)).scenes[0];
        expect(after).toMatchObject({ mood: "cold, watchful", location: "Archive rooftop" });
        expect(after.plotPoints.map((pp) => pp.title)).toEqual(["She reaches the roof", "The drone spots her", "She runs"]);
        expect(after.shots[0].dialogue).toEqual([{ speaker: "Elena", line: "Not tonight.", delivery: "whispering" }]);

        expect(await apply.execute({ proposal }, tool)).toBe(
            "Not applied: SCENE-01 has changed since this was drafted. Ask again and I'll draft it against the scene as it is now.",
        );
        await expect(applyMediaChange(ctx(strangerId, otherOrgId), proposal)).rejects.toThrow("Production not found.");
    });

    it("says when there is nothing to draft, corrects an unusable reply once, and keeps other organizations out", async () => {
        const p = await production();
        const shot2 = p.scenes[0].shots[1];
        await db.insert(mediaTakes).values({ shotId: shot2.id, organizationId: orgId, takeNumber: 1, prompt: "x", durationSeconds: 4, status: "simulated", mode: "simulation" } as any);

        expect(await draftMediaChange(ctx(ownerId), selectionOf(p), "Cut the wide shot", { model: async () => JSON.stringify({ edits: [{ op: "remove_shot", shotId: shot2.id }] }) }))
            .toEqual({ refused: "Nothing in that could be drafted: Shot 2 has takes, so it is not removed here." });
        expect(await draftMediaChange(ctx(ownerId), selectionOf(p), "Make it better", { model: async () => '{"edits": []}' }))
            .toEqual({ refused: "That would not change SCENE-01. Say more specifically what should change." });

        const replies = ["Sure! Here is what I would change.", JSON.stringify({ edits: [{ op: "update_scene", patch: { timeOfDay: "dawn" } }] })];
        const corrected = await draftMediaChange(ctx(ownerId), selectionOf(p), "Set it at dawn", { model: async () => replies.shift() });
        expect(corrected).toMatchObject({ changes: ['Scene time of day: "night" → "dawn"'] });
        expect(replies).toHaveLength(0);

        await expect(draftMediaChange(ctx(strangerId, otherOrgId), selectionOf(p), "Make it colder", { model: colder(p) })).rejects.toThrow("Production not found.");
    });

    it("is reached by the room's direct path only, never offered to an agent", () => {
        const tools = getAgentTools(true);
        expect(tools.propose_media_change).toBeDefined();
        expect(tools.apply_media_change).toBeDefined();
        expect(UNIVERSAL_PRESENTATION_TOOLS).not.toContain("propose_media_change");
        expect(UNIVERSAL_PRESENTATION_TOOLS).not.toContain("apply_media_change");
    });
});
