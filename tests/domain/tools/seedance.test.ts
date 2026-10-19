import { describe, it, expect } from "vitest";
import { SEEDANCE_TOOLS } from "../../../server/domain/tools/v1/capabilities/seedance.js";
import { VIDEO_ASSEMBLY_TOOLS } from "../../../server/domain/tools/v1/capabilities/video-assembly.js";
import { getAgentTools } from "../../../server/domain/tools/v1/capabilities/index.js";
import { ARTIFACT_TOOLS, UNIVERSAL_PRESENTATION_TOOLS, detectArtifact } from "../../../server/domain/crew/core/crew-tools.service.js";

describe("Seedance & Video Assembly Capabilities", () => {
    describe("seedance_estimate_cost", () => {
        it("prices takes at fal.ai's list price for Seedance 2.0", async () => {
            const result = JSON.parse(await SEEDANCE_TOOLS.seedance_estimate_cost.execute({ shotCount: 5, durationSeconds: 5, resolution: "720p" }) as string);
            expect(result).toMatchObject({ takes: 5, perTakeCents: 152, totalCents: 760, centsPerSecond: 30.34 });
            expect(result.summary).toBe("5 takes of 5 seconds at 720p cost about $7.60 on fal.ai ($1.52 each).");

            const hd = JSON.parse(await SEEDANCE_TOOLS.seedance_estimate_cost.execute({ shotCount: 1, durationSeconds: 10, resolution: "1080p" }) as string);
            expect(hd).toMatchObject({ perTakeCents: 682, totalCents: 682 });
        });

        it("refuses lengths Seedance does not render", () => {
            expect(SEEDANCE_TOOLS.seedance_estimate_cost.parameters.safeParse({ shotCount: 1, durationSeconds: 30 }).success).toBe(false);
        });
    });

    describe("asking for and checking takes", () => {
        it("asks for a take of a saved shot by id, not a free prompt sent straight to a provider", () => {
            const submit = SEEDANCE_TOOLS.seedance_submit_shot;
            expect(submit.parameters.safeParse({ prompt: "Elena on a rooftop", durationSeconds: 5 }).success).toBe(false);
            expect(submit.parameters.safeParse({ shotId: 12, note: "tighter", endOnNextKeyframe: true }).success).toBe(true);
            expect(submit.description).toContain("nothing renders until a person approves it");
            expect(SEEDANCE_TOOLS.seedance_check_status.parameters.safeParse({ takeId: 3 }).success).toBe(true);
            expect(SEEDANCE_TOOLS.seedance_check_status.parameters.safeParse({ generationId: "seedance_1" }).success).toBe(false);
        });
    });

    describe("video-assembly tools", () => {
        it("assembles a saved scene, not clip URLs it is handed", async () => {
            const assemble = VIDEO_ASSEMBLY_TOOLS.assemble_scene_timeline;
            expect(assemble.parameters.safeParse({ sceneId: "SCENE-01" }).success).toBe(false);
            expect(assemble.parameters.safeParse({ sceneId: 21 }).success).toBe(true);
            expect(assemble.parameters.safeParse({ productionId: 7, sceneKey: "SCENE-02" }).success).toBe(true);
            expect(assemble.description).toContain("do not describe a reel before it is ready");

            const shotsOnly = assemble.parameters.parse({ shots: [{ shotNumber: 1, videoUrl: "https://example.com/shot1.mp4", durationSeconds: 4 }] });
            expect(JSON.parse(await assemble.execute(shotsOnly, { organizationId: 1 } as any) as string))
                .toEqual({ error: true, message: "Give sceneId, or productionId and sceneKey." });
        });

        it("renders the dailies review deck with the shots as given, and no promise of assembly", async () => {
            const deck = await VIDEO_ASSEMBLY_TOOLS.render_dailies_deck.execute({
                sceneId: "SCENE-01",
                sceneTitle: "The Rooftop Archive",
                budgetSpendUsd: 1.45,
                shots: [
                    { shotNumber: 1, prompt: "Elena enters doorway", cameraMotion: "Dolly In", seed: "#ELENA-01", videoUrl: "https://example.com/shot1.mp4", status: "approved" },
                    { shotNumber: 2, prompt: "Close up of artifact in hands", cameraMotion: "Static Macro", seed: "#ARTIFACT-01", status: "simulated" },
                ],
            });

            expect(deck).toContain("Dailies Review Deck: The Rooftop Archive");
            expect(deck).toContain("🟢 Approved");
            expect(deck).toContain("Simulated (no clip)");
            expect(deck).toContain("*No clip yet*");
            expect(deck).toContain("Director Controls");
            expect(deck).not.toContain("assembly");
            expect(deck).not.toContain("/approve-shot");
        });

        it("opens Media Studio with a payload the room recognizes, and takes no budget from the agent", async () => {
            const mount = VIDEO_ASSEMBLY_TOOLS.mount_media_studio;
            expect(mount.parameters.safeParse({ productionTitle: "Rooftop chase", create: true, aspectRatio: "2.39:1" }).success).toBe(true);
            expect(mount.parameters.parse({ budgetSpendUsd: 99 })).not.toHaveProperty("budgetSpendUsd");

            // Outside a room and naming nothing, it opens the studio's start form without reading or writing a production.
            const output = await mount.execute({ sceneId: "SCENE-03", aspectRatio: "2.39:1" }, { organizationId: 1 } as any) as string;
            // Offered to every crew agent and kept as an artifact, or a room never sees the studio.
            expect(ARTIFACT_TOOLS.has("mount_media_studio")).toBe(true);
            expect(UNIVERSAL_PRESENTATION_TOOLS).toContain("mount_media_studio");
            const artifact = detectArtifact("mount_media_studio", output);

            expect(artifact?.payload).toMatchObject({ type: "media_studio_pod", module: "MediaStudioPod", sceneId: "SCENE-03", aspectRatio: "2.39:1", created: false });
            expect(artifact?.payload).not.toHaveProperty("productionId");
            expect(artifact?.payload).not.toHaveProperty("mode");
        });
    });

    describe("tool registry registration", () => {
        it("registers seedance and video assembly tools in the main capability registry", () => {
            const tools = getAgentTools(true);
            expect(tools.seedance_submit_shot).toBeDefined();
            expect(tools.seedance_check_status).toBeDefined();
            expect(tools.seedance_estimate_cost).toBeDefined();
            expect(tools.assemble_scene_timeline).toBeDefined();
            expect(tools.render_dailies_deck).toBeDefined();
            expect(tools.mount_media_studio).toBeDefined();
        });
    });
});
