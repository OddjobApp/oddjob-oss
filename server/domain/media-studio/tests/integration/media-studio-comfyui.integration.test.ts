/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inArray } from "drizzle-orm";
import { configureTestEnvironment } from "../../../../../tests/configure-test-environment.js";

/**
 * ComfyUI takes against a real database: a workflow imported, refused when it isn't an
 * API export or can't render, and checked against the server's nodes; a take asked for
 * with it and kept with its own copy of the workflow; refused when the workflow needs a
 * keyframe the shot lacks; sent on approval with the uploaded frame, seed and negative
 * prompt; and stored when it finishes. ComfyUI is replaced by a provider that answers at
 * once.
 */

configureTestEnvironment();
const storageRoot = path.join(os.tmpdir(), `media-comfyui-test-${process.pid}-${Date.now()}`);
process.env.ODDJOB_STORAGE_ROOT = storageRoot;

const { db } = await import("@server/database_service.js");
const { orgs, users, userOrgs } = await import("@shared/schema/auth.js");
const { mediaStudio } = await import("../../core/media-studio.service.js");

let reachable = false;
try {
    await db.execute("SELECT 1" as any);
    reachable = true;
} catch (e: any) {
    console.warn(`[media-comfyui] SKIPPED — no test database reachable (${e?.message ?? e}).`);
}

const stamp = Date.now();
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const images = { configured: true, model: "fake-image", estimatedCostCents: 4, async generate() { return { mimeType: "image/png", content: png, model: "fake-image" }; } } as any;

const wanGraph = {
    "3": { class_type: "KSampler", inputs: { seed: 123, steps: 20, cfg: 6, sampler_name: "uni_pc", scheduler: "simple", denoise: 1, model: ["37", 0], positive: ["50", 0], negative: ["50", 1], latent_image: ["50", 2] } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: "a fox in the snow", clip: ["38", 0] } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: "blurry, static", clip: ["38", 0] } },
    "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["39", 0] } },
    "37": { class_type: "UNETLoader", inputs: { unet_name: "wan2.1_i2v_480p_14B_fp8_e4m3fn.safetensors", weight_dtype: "default" } },
    "38": { class_type: "CLIPLoader", inputs: { clip_name: "umt5_xxl_fp8_e4m3fn_scaled.safetensors", type: "wan" } },
    "39": { class_type: "VAELoader", inputs: { vae_name: "wan_2.1_vae.safetensors" } },
    "50": { class_type: "WanImageToVideo", inputs: { width: 832, height: 480, length: 81, batch_size: 1, positive: ["6", 0], negative: ["7", 0], vae: ["39", 0], start_image: ["52", 0] } },
    "52": { class_type: "LoadImage", inputs: { image: "example.png" } },
    "57": { class_type: "CreateVideo", inputs: { images: ["8", 0], fps: 16 } },
    "58": { class_type: "SaveVideo", inputs: { video: ["57", 0], filename_prefix: "video/ComfyUI", format: "auto", codec: "auto" } },
};

function fakeComfy() {
    const calls = { upload: [] as string[], submit: [] as any[] };
    const state: { status: any } = { status: { state: "queued" } };
    const provider = {
        name: "comfyui", label: "ComfyUI", notConfigured: "ComfyUI is not configured on this platform (no COMFYUI_BASE_URL), so nothing was rendered.",
        configured: true, resolution: "720p", centsPerSecond: 0,
        estimateCents: () => 0,
        endpointFor: () => "http://comfy.test:8188/prompt",
        async uploadImage(_content: Buffer, mimeType: string) {
            calls.upload.push(mimeType);
            return `oddjob-frame-${calls.upload.length}.png`;
        },
        async submit(input: any) {
            calls.submit.push(input);
            return { endpoint: "http://comfy.test:8188/prompt", requestId: `p-${calls.submit.length}` };
        },
        async status() { return state.status; },
        async result() { return { videoUrl: "http://comfy.test:8188/view?filename=take.mp4&subfolder=&type=output", mimeType: "video/mp4" }; },
        async download() { return Buffer.from("mp4-bytes"); },
    } as any;
    return { provider, calls, state };
}

describe.skipIf(!reachable)("Media Studio on ComfyUI", () => {
    let orgId: number, otherOrgId: number;
    let ownerId: string, strangerId: string;
    const ownerEmail = `comfy_owner_${stamp}@example.test`;
    const ctx = (userId: string, organizationId = orgId) =>
        ({ organizationId, userId, isAdmin: false, isSuperAdmin: false, isOrgAdmin: false }) as any;

    beforeAll(async () => {
        const [a, b] = await db.insert(orgs).values([
            { name: `Comfy ${stamp}`, slug: `comfy-${stamp}` },
            { name: `Comfy other ${stamp}`, slug: `comfy-other-${stamp}` },
        ] as any).returning();
        orgId = a.id;
        otherOrgId = b.id;
        const [owner, stranger] = await db.insert(users).values([
            { username: `comfy_owner_${stamp}`, password: "not-a-real-password", email: ownerEmail },
            { username: `comfy_stranger_${stamp}`, password: "not-a-real-password", email: `comfy_stranger_${stamp}@example.test` },
        ] as any).returning();
        ownerId = owner.id;
        strangerId = stranger.id;
        await db.insert(userOrgs).values([{ userId: ownerId, orgId }, { userId: strangerId, orgId: otherOrgId }] as any);
    });

    afterAll(async () => {
        if (!orgId) return;
        await db.delete(orgs).where(inArray(orgs.id, [orgId, otherOrgId])).catch(() => {});
        await db.delete(users).where(inArray(users.id, [ownerId, strangerId].filter(Boolean))).catch(() => {});
        fs.rmSync(storageRoot, { recursive: true, force: true });
    });

    it("imports a workflow, refuses what it can't render, and renders a take with the workflow it was asked with", async () => {
        const comfy = fakeComfy();
        const requestApproval = async () => ({ id: 987654 });
        let p = await mediaStudio.createProduction(ctx(ownerId), { title: "Comfy chase", aspectRatio: "16:9" });

        // A bare switch to ComfyUI installs the Wan 2.1 starter rather than refusing:
        // a room that asks for ComfyUI before importing anything gets something that
        // renders. An unusable workflow is still refused, below.
        const started = await mediaStudio.setVideoEngine(ctx(ownerId), p.id, { engine: "comfyui" });
        expect(started.video).toMatchObject({ engine: "comfyui", workflow: { name: "Wan 2.1 Image-to-Video" } });
        await expect(mediaStudio.setVideoEngine(ctx(ownerId), p.id, { engine: "comfyui", workflow: { graph: { nodes: [], links: [] } } }))
            .rejects.toThrow("This is ComfyUI's editor format.");
        await expect(mediaStudio.setVideoEngine(ctx(ownerId), p.id, { engine: "comfyui", workflow: { graph: { "1": { class_type: "UNETLoader", inputs: {} } } } }))
            .rejects.toThrow("This workflow can't render takes yet. No prompt was found");

        p = await mediaStudio.setVideoEngine(ctx(ownerId), p.id, { engine: "comfyui", workflow: { name: "Wan i2v", graph: wanGraph } });
        expect(p.video).toMatchObject({
            engine: "comfyui", label: "ComfyUI",
            workflow: { name: "Wan i2v", nodeCount: 11, fps: 16, mapping: { prompt: { nodeId: "6", input: "text" }, startImage: { nodeId: "52", input: "image" }, frames: { nodeId: "50", input: "length" } } },
        });
        expect(await mediaStudio.checkVideoEngine(ctx(ownerId), p.id, { comfyui: { configured: true, notConfigured: "", missingNodes: async () => ["WanImageToVideo"], installedModels: async () => [] } }))
            .toEqual({ engine: "comfyui", configured: true, reachable: true, missingNodes: ["WanImageToVideo"], models: [], activeModel: "wan2.1_i2v_480p_14B_fp8_e4m3fn.safetensors", error: null });

        p = await mediaStudio.addScene(ctx(ownerId), p.id, { title: "Arrival" });
        const sceneId = p.scenes[0].id;
        p = await mediaStudio.addPlotPoint(ctx(ownerId), sceneId, { title: "She sees the drone" });
        p = await mediaStudio.addPlotPoint(ctx(ownerId), sceneId, { title: "She runs" });
        const firstPoint = p.scenes[0].plotPoints[0].id;
        p = await mediaStudio.requestKeyframe(ctx(ownerId), firstPoint, {}, { generator: images, wait: true });
        p = await mediaStudio.approveKeyframe(ctx(ownerId), p.scenes[0].plotPoints[0].keyframes[0].id);
        p = await mediaStudio.makeShotFromPlotPoint(ctx(ownerId), firstPoint);
        const shotId = p.scenes[0].shots[0].id;
        p = await mediaStudio.updateShot(ctx(ownerId), shotId, { action: "She crouches", seed: "42", negativePrompt: "text overlays", durationSeconds: 5 });
        p = await mediaStudio.addShot(ctx(ownerId), sceneId, { action: "Wide on the stairwell", durationSeconds: 3 });
        const bareShotId = p.scenes[0].shots[1].id;

        await expect(mediaStudio.requestTake(ctx(ownerId), bareShotId, {}, { provider: comfy.provider, requestApproval }))
            .rejects.toThrow('The ComfyUI workflow "Wan i2v" starts from an image: approve this shot\'s keyframe first.');
        await expect(mediaStudio.requestTake(ctx(ownerId), shotId, { endOnNextKeyframe: true }, { provider: comfy.provider, requestApproval }))
            .rejects.toThrow('The ComfyUI workflow "Wan i2v" has no end image input, so a take can\'t end on a keyframe.');

        p = await mediaStudio.requestTake(ctx(ownerId), shotId, {}, { provider: comfy.provider, requestApproval });
        const take = p.scenes[0].shots[0].takes[0];
        expect(take).toMatchObject({ status: "pending_approval", provider: "comfyui", costCents: 0, mode: "live" });
        expect(take.request).toMatchObject({ engine: "comfyui", workflowName: "Wan i2v", seed: 42, durationSeconds: 5 });
        expect(take.request).not.toHaveProperty("workflow");

        // Importing another workflow afterwards does not change what this take renders.
        const faster = { ...wanGraph, "3": { ...wanGraph["3"], inputs: { ...wanGraph["3"].inputs, steps: 4 } } };
        p = await mediaStudio.setVideoEngine(ctx(ownerId), p.id, { engine: "comfyui", workflow: { name: "Wan fast", graph: faster } });

        const outcome = await mediaStudio.onTakeDecision(
            { id: 987654, organizationId: orgId, modifiedOutput: { kind: "media_take_render", takeId: take.id } },
            "approved", { userId: ownerId, email: ownerEmail }, { provider: comfy.provider, follow: false },
        );
        expect(outcome).toMatchObject({ handled: true, success: true, status: "queued" });
        expect(comfy.calls.upload).toEqual(["image/png"]);
        const sent = comfy.calls.submit[0];
        expect(sent).toMatchObject({ imageUrl: "oddjob-frame-1.png", endImageUrl: null, seed: 42, negativePrompt: "text overlays", durationSeconds: 5 });
        expect(sent.workflow.name).toBe("Wan i2v");
        expect(sent.workflow.graph["3"].inputs.steps).toBe(20);
        expect(sent.prompt).toContain("Action: She crouches.");

        comfy.state.status = { state: "completed" };
        p = await mediaStudio.refreshTakeStatus(ctx(ownerId), take.id, { provider: comfy.provider });
        expect(p.scenes[0].shots[0].takes[0]).toMatchObject({ status: "ready_for_review", videoUrl: expect.stringMatching(/^\/api\/media-studio\/assets\/\d+$/) });

        p = await mediaStudio.setVideoEngine(ctx(ownerId), p.id, { engine: "fal" });
        expect(p.video).toMatchObject({ engine: "fal", label: "fal.ai", workflow: { name: "Wan fast" } });
        await expect(mediaStudio.setVideoEngine(ctx(strangerId, otherOrgId), p.id, { engine: "comfyui" })).rejects.toThrow("Production not found.");
    });
});
