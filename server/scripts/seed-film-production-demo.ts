import "dotenv/config";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { eq, and, or, gt } from "drizzle-orm";
import { db } from "../database_service.js";
import {
    agentCards,
    crewCommitments,
    crewDecisions,
    crewMembers,
    crewSessions,
    crewTurns,
    mediaAssemblies,
    mediaAssets,
    mediaKeyframes,
    mediaPlotPoints,
    mediaProductions,
    mediaScenes,
    mediaShots,
    mediaTakes,
    orgs,
    supervisorNotes,
    userOrgs,
    users,
} from "@shared/schema/index.js";
import { mediaStudio } from "../domain/media-studio/core/media-studio.service.js";
import { ffmpegBinary } from "../domain/media-studio/core/ffmpeg.js";
import type { OrgContext } from "../utils/auth-context.js";

const TARGET_ORG_IDS = [291, 473];
const SESSION_KEY = "crew-film-studio-alpha";
const PRODUCTION_TITLE = "Project Chimera: Neural Interface Teaser";
const STYLE_BIBLE =
    "Cyber-industrial, high-contrast anamorphic 35mm, volumetric amber haze with cold cyan rim lighting, Kodak 2383 film stock emulation, deep blacks";

function generateTestClip(binary: string, tempDir: string, filename: string, sourceFilter: string, seconds: number): Buffer {
    const filePath = path.join(tempDir, filename);
    const args = [
        "-hide_banner",
        "-nostdin",
        "-y",
        "-f",
        "lavfi",
        "-i",
        sourceFilter,
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440",
        "-t",
        String(seconds),
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        filePath,
    ];

    const res = spawnSync(binary, args, { encoding: "utf8" });
    if (res.status !== 0) {
        throw new Error(`Failed to generate ${filename}: ${res.stderr?.slice(-400)}`);
    }
    return fs.readFileSync(filePath);
}

async function seedOrg(targetOrgId: number) {
    console.log(`\n🎬 --- Seeding Org ID: ${targetOrgId} ---`);

    // 1. Verify Org & Admin User
    const [targetOrg] = await db.select().from(orgs).where(eq(orgs.id, targetOrgId)).limit(1);
    if (!targetOrg) {
        console.warn(`Target organization ${targetOrgId} not found, skipping.`);
        return;
    }
    console.log(`✅ Target Organization: ${targetOrg.name} (id=${targetOrg.id})`);

    const [adminUser] = await db
        .select()
        .from(users)
        .where(or(eq(users.username, "admin2"), eq(users.username, "admin")))
        .limit(1);
    if (!adminUser) {
        throw new Error(`Admin user not found.`);
    }
    console.log(`✅ Admin User: ${adminUser.username} (${adminUser.id})`);

    // Ensure userOrg membership
    const [membership] = await db
        .select()
        .from(userOrgs)
        .where(and(eq(userOrgs.userId, adminUser.id), eq(userOrgs.orgId, targetOrgId)))
        .limit(1);
    if (!membership) {
        // user_orgs is membership and nothing else — (userId, orgId) is its whole
        // primary key. A role belongs to organizationRoleAssignments; asking for one here did
        // not typecheck and would have failed on an unknown column at runtime.
        await db.insert(userOrgs).values({
            userId: adminUser.id,
            orgId: targetOrgId,
        });
        console.log(`✅ Added ${adminUser.username} to org ${targetOrgId}`);
    }

    const ctx: OrgContext = {
        organizationId: targetOrgId,
        userId: adminUser.id,
        isAdmin: true,
        isSuperAdmin: true,
        isOrgAdmin: true,
    };

    // 2. Seed / Ensure Film Production Personas in agentCards
    const personasToSeed = [
        {
            name: "Creative Director",
            description: "Leads story development, narrative arcs, and script pacing for cinematic productions.",
            personaType: "creative-director",
            topicAffinities: ["Media", "General"] as any,
            intentAffinities: ["Chat", "Video"] as any,
            capabilities: ["narrative_design", "pacing_analysis"],
            tools: ["mount_media_studio", "propose_decision_matrix"],
        },
        {
            name: "Visual Artist",
            description: "Develops visual style bibles, aesthetic prompts, color grading profiles, and keyframe stills.",
            personaType: "visual-artist",
            topicAffinities: ["Media"] as any,
            intentAffinities: ["Image Generation", "Video"] as any,
            capabilities: ["style_bible", "keyframe_rendering"],
            tools: ["generate_image", "mount_media_studio"],
        },
        {
            name: "Technical Director",
            description: "Coordinates render queues, Seedance take execution, camera parameters, and timeline conformance.",
            personaType: "technical-director",
            topicAffinities: ["Media", "Code"] as any,
            intentAffinities: ["Video", "Code Execution"] as any,
            capabilities: ["video_render", "timeline_conformance"],
            tools: ["mount_media_studio", "assemble_scene_timeline", "render_dailies_deck"],
        },
        {
            name: "Producer",
            description: "Manages project budget, GPU cost ceilings, timeline envelopes, and governance approval gates.",
            personaType: "producer",
            topicAffinities: ["Media", "Finance"] as any,
            intentAffinities: ["Analysis", "Chat"] as any,
            capabilities: ["budget_tracking", "governance_gates"],
            tools: ["propose_decision_matrix", "request_governance_approval", "mount_media_studio"],
        },
    ];

    const seededCardIds: number[] = [];
    for (const p of personasToSeed) {
        const [existing] = await db
            .select()
            .from(agentCards)
            .where(and(eq(agentCards.organizationId, targetOrgId), eq(agentCards.name, p.name)))
            .limit(1);

        if (existing) {
            seededCardIds.push(existing.id);
            console.log(`   Existing card found: ${p.name} (id=${existing.id})`);
        } else {
            const [created] = await db
                .insert(agentCards)
                .values({
                    organizationId: targetOrgId,
                    name: p.name,
                    description: p.description,
                    personaType: p.personaType,
                    topicAffinities: p.topicAffinities,
                    intentAffinities: p.intentAffinities,
                    capabilities: p.capabilities,
                    tools: p.tools,
                    enabled: true,
                })
                .returning();
            seededCardIds.push(created.id);
            console.log(`   Created card: ${p.name} (id=${created.id})`);
        }
    }

    // 3. Seed / Ensure CREW Room Session
    let [session] = await db
        .select()
        .from(crewSessions)
        .where(and(eq(crewSessions.organizationId, targetOrgId), eq(crewSessions.sessionKey, SESSION_KEY)))
        .limit(1);

    if (!session) {
        [session] = await db
            .insert(crewSessions)
            .values({
                organizationId: targetOrgId,
                sessionKey: SESSION_KEY,
                title: "Film Studio Alpha: Project Chimera",
                mode: "build",
                status: "active",
                createdBy: adminUser.id,
                activeTopic: "Project Chimera 15s Teaser Production",
                consensusLevel: 88,
                nextSteps: "Publish 15s teaser trailer to distribution channels, release GPU budget hold, and commence Scene 2 pre-production script breakdown.",
            })
            .returning();
        console.log(`✅ Created CREW Session: ${session.title} (key=${SESSION_KEY}, id=${session.id})`);
    } else {
        [session] = await db
            .update(crewSessions)
            .set({
                title: "Film Studio Alpha: Project Chimera",
                status: "active",
                mode: "build",
                activeTopic: "Project Chimera 15s Teaser Production",
                consensusLevel: 88,
                nextSteps: "Publish 15s teaser trailer to distribution channels, release GPU budget hold, and commence Scene 2 pre-production script breakdown.",
                updatedAt: new Date(),
            })
            .where(eq(crewSessions.id, session.id))
            .returning();
        console.log(`✅ Found & Reactivated CREW Session: ${session.title} (id=${session.id})`);
    }

    // Ensure crew members are in the session
    for (const cardId of seededCardIds) {
        const [existingMember] = await db
            .select()
            .from(crewMembers)
            .where(and(eq(crewMembers.sessionId, session.id), eq(crewMembers.agentCardId, cardId)))
            .limit(1);

        if (!existingMember) {
            await db.insert(crewMembers).values({
                sessionId: session.id,
                agentCardId: cardId,
            });
        }
    }
    console.log(`✅ Linked 4 agent cards to CREW session members.`);

    // 4. Seed / Ensure Media Production
    let [production] = await db
        .select()
        .from(mediaProductions)
        .where(and(eq(mediaProductions.organizationId, targetOrgId), eq(mediaProductions.title, PRODUCTION_TITLE)))
        .limit(1);

    if (!production) {
        [production] = await db
            .insert(mediaProductions)
            .values({
                organizationId: targetOrgId,
                title: PRODUCTION_TITLE,
                aspectRatio: "16:9",
                budgetLimitCents: 5000,
                style: STYLE_BIBLE,
                videoEngine: "fal",
                crewSessionId: session.id,
                createdBy: adminUser.id,
            })
            .returning();
        console.log(`✅ Created Media Production: "${production.title}" (id=${production.id})`);
    } else {
        await db
            .update(mediaProductions)
            .set({
                crewSessionId: session.id,
                style: STYLE_BIBLE,
                aspectRatio: "16:9",
                budgetLimitCents: 5000,
            })
            .where(eq(mediaProductions.id, production.id));
        console.log(`✅ Updated Media Production: "${production.title}" (id=${production.id})`);
    }

    // 5. Seed Scene 1: "The Breakthrough"
    let [scene] = await db
        .select()
        .from(mediaScenes)
        .where(and(eq(mediaScenes.productionId, production.id), eq(mediaScenes.sceneKey, "SCENE-01")))
        .limit(1);

    if (!scene) {
        [scene] = await db
            .insert(mediaScenes)
            .values({
                productionId: production.id,
                organizationId: targetOrgId,
                position: 1,
                sceneKey: "SCENE-01",
                title: "The Breakthrough",
                synopsis:
                    "Inside a dark bio-optics laboratory, a researcher activates a prototype neural crown, bridging consciousness with a volumetric data ocean.",
                location: "Bio-Optics Cleanroom",
                timeOfDay: "Night",
                mood: "Tense & Visionary",
            })
            .returning();
        console.log(`✅ Created Scene 1: "${scene.title}" (${scene.sceneKey})`);
    }

    // 6. Seed Plot Points
    const plotPointDefs = [
        {
            position: 1,
            title: "The Setup",
            beat: "Cold optics lab humming with dormant fiber-optic filaments glowing in faint amber.",
        },
        {
            position: 2,
            title: "The Link",
            beat: "Neural crown activated, cyan biometric pulses arcing across the subject's temple.",
        },
        {
            position: 3,
            title: "The Synthesis",
            beat: "Subject's pupil dilates; reality dissolves into an infinite volumetric data landscape.",
        },
    ];

    const seededPlotPoints: any[] = [];
    for (const pp of plotPointDefs) {
        let [existingPp] = await db
            .select()
            .from(mediaPlotPoints)
            .where(and(eq(mediaPlotPoints.sceneId, scene.id), eq(mediaPlotPoints.position, pp.position)))
            .limit(1);

        if (!existingPp) {
            [existingPp] = await db.insert(mediaPlotPoints).values({
                sceneId: scene.id,
                organizationId: targetOrgId,
                position: pp.position,
                title: pp.title,
                beat: pp.beat,
            }).returning();
        }
        seededPlotPoints.push(existingPp);
    }
    console.log(`✅ Verified Plot Points for Scene 1.`);

    // 7. Seed 3 Shots
    const shotDefs = [
        {
            position: 1,
            prompt:
                "Slow tracking forward dolly shot through an atmospheric optics laboratory, fiber-optic cables emitting pulsing amber light, cinematic haze, 8k, photorealistic",
            cameraMotion: "Dolly Forward",
            durationSeconds: 4,
            transition: "crossfade" as const,
            transitionDurationSeconds: 0.5,
            framing: "Wide",
            lens: "35mm Anamorphic",
            action: "Camera glides forward past glass optical tables and suspended amber filaments.",
        },
        {
            position: 2,
            prompt:
                "Macro extreme close-up of neural interface crown glowing with cyan biometrics on human temple, shallow depth of field, anamorphic lens flare",
            cameraMotion: "Slow Orbit",
            durationSeconds: 5,
            transition: "dip_to_black" as const,
            transitionDurationSeconds: 0.75,
            framing: "Extreme Close-Up",
            lens: "85mm Macro",
            action: "Subtle pulse of cyan illumination reflects across subject's skin as the interface boots.",
        },
        {
            position: 3,
            prompt:
                "Volumetric data landscape rushing towards camera, iridescent neural pathways expanding into infinite light",
            cameraMotion: "Fast Zoom In",
            durationSeconds: 4,
            transition: "cut" as const,
            transitionDurationSeconds: null,
            framing: "Hyperspace POV",
            lens: "Ultra-Wide",
            action: "Camera plunges through concentric rings of luminescent data geometries.",
        },
    ];

    const seededShots: any[] = [];
    for (const sd of shotDefs) {
        let [shot] = await db
            .select()
            .from(mediaShots)
            .where(and(eq(mediaShots.sceneId, scene.id), eq(mediaShots.position, sd.position)))
            .limit(1);

        if (!shot) {
            [shot] = await db
                .insert(mediaShots)
                .values({
                    sceneId: scene.id,
                    organizationId: targetOrgId,
                    position: sd.position,
                    prompt: sd.prompt,
                    cameraMotion: sd.cameraMotion,
                    durationSeconds: sd.durationSeconds,
                    transition: sd.transition,
                    transitionDurationSeconds: sd.transitionDurationSeconds,
                    framing: sd.framing,
                    lens: sd.lens,
                    action: sd.action,
                })
                .returning();
            console.log(`   Created Shot ${shot.position}: ${shot.framing} (${shot.durationSeconds}s)`);
        } else {
            console.log(`   Found Shot ${shot.position}: (id=${shot.id})`);
        }
        seededShots.push(shot);
    }

    // Clean up any extraneous shots beyond the 3 canonical shots for Scene 1
    const extraShots = await db.select().from(mediaShots).where(and(eq(mediaShots.sceneId, scene.id), gt(mediaShots.position, 3)));
    for (const es of extraShots) {
        await db.delete(mediaTakes).where(eq(mediaTakes.shotId, es.id));
        await db.delete(mediaShots).where(eq(mediaShots.id, es.id));
    }

    // Seed Keyframes for each plot point and link to corresponding shot
    for (let i = 0; i < seededPlotPoints.length; i++) {
        const pp = seededPlotPoints[i];
        let [kf] = await db.select().from(mediaKeyframes)
            .where(and(eq(mediaKeyframes.plotPointId, pp.id), eq(mediaKeyframes.status, "approved")))
            .limit(1);
        if (!kf) {
            const bin = ffmpegBinary();
            if (!bin) {
                console.warn(`⚠️ No FFmpeg binary found; skipping keyframe generation for beat ${pp.position}.`);
                continue;
            }
            const tempPngPath = path.join(os.tmpdir(), `kf_${production.id}_${pp.id}.png`);
            const colorHex = i === 0 ? "0x0284c7" : i === 1 ? "0x06b6d4" : "0x8b5cf6";
            spawnSync(bin, ["-hide_banner", "-nostdin", "-y", "-f", "lavfi", "-i", `color=c=${colorHex}:s=1280x720`, "-vframes", "1", tempPngPath]);
            const pngContent = fs.readFileSync(tempPngPath);
            try { fs.unlinkSync(tempPngPath); } catch {}
            const imgAsset = await mediaStudio.saveAsset(ctx, production.id, {
                kind: "image",
                mimeType: "image/png",
                content: pngContent,
                source: "demo_seeder",
                width: 1280,
                height: 720,
            });
            [kf] = await db.insert(mediaKeyframes).values({
                plotPointId: pp.id,
                organizationId: targetOrgId,
                prompt: pp.beat,
                status: "approved",
                mode: "live",
                imageAssetId: imgAsset.id,
                isSelected: true,
            }).returning();
            console.log(`   Created approved keyframe for Beat ${pp.position}: "${pp.title}"`);
        }
        if (seededShots[i]) {
            await db.update(mediaShots).set({ referenceKeyframeId: kf.id, plotPointId: pp.id }).where(eq(mediaShots.id, seededShots[i].id));
        }
    }
    console.log(`✅ Verified Keyframes and linked referenceKeyframeIds for all 3 shots.`);

    // 8. Generate Local Sample MP4 Video Clips and Save as Media Assets
    const bin = ffmpegBinary();
    if (!bin) {
        console.warn(`⚠️ No FFmpeg binary found; skipping video clip generation.`);
    } else {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `oddjob-clips-${targetOrgId}-`));

        try {
            const clip1Buffer = generateTestClip(bin, tempDir, "shot1_lab.mp4", "testsrc=size=1280x720:rate=30", 4);
            const clip2Buffer = generateTestClip(bin, tempDir, "shot2_crown.mp4", "smptebars=size=1280x720:rate=30", 5);
            const clip3Buffer = generateTestClip(bin, tempDir, "shot3_leap.mp4", "testsrc2=size=1280x720:rate=30", 4);

            const asset1 = await mediaStudio.saveAsset(ctx, production.id, {
                kind: "video",
                mimeType: "video/mp4",
                content: clip1Buffer,
                source: "demo_seeder",
                durationSeconds: 4,
                width: 1280,
                height: 720,
            });

            const asset2 = await mediaStudio.saveAsset(ctx, production.id, {
                kind: "video",
                mimeType: "video/mp4",
                content: clip2Buffer,
                source: "demo_seeder",
                durationSeconds: 5,
                width: 1280,
                height: 720,
            });

            const asset3 = await mediaStudio.saveAsset(ctx, production.id, {
                kind: "video",
                mimeType: "video/mp4",
                content: clip3Buffer,
                source: "demo_seeder",
                durationSeconds: 4,
                width: 1280,
                height: 720,
            });

            console.log(`✅ Saved 3 video assets (Asset IDs: ${asset1.id}, ${asset2.id}, ${asset3.id})`);

            // Seed Takes for each shot
            for (let i = 0; i < seededShots.length; i++) {
                const shot = seededShots[i];
                const asset = i === 0 ? asset1 : i === 1 ? asset2 : asset3;
                const dur = i === 1 ? 5 : 4;

                const [existingTake] = await db
                    .select()
                    .from(mediaTakes)
                    .where(and(eq(mediaTakes.shotId, shot.id), eq(mediaTakes.takeNumber, 1)))
                    .limit(1);

                if (!existingTake) {
                    await db.insert(mediaTakes).values({
                        shotId: shot.id,
                        organizationId: targetOrgId,
                        takeNumber: 1,
                        prompt: shot.prompt,
                        cameraMotion: shot.cameraMotion,
                        durationSeconds: dur,
                        status: "approved",
                        mode: "live",
                        videoAssetId: asset.id,
                        costCents: 120,
                    });
                }
            }
            console.log(`✅ Verified Approved Takes for all 3 shots.`);

            // 9. Test Assembly Conformance
            console.log(`\n🎞️ Testing Full Timeline Assembly for Scene 1...`);
            const assembledProd = await mediaStudio.assembleScene(ctx, scene.id, { wait: true });
            const assembly = assembledProd.scenes.find((s) => s.id === scene.id)?.assembly;
            console.log(`✅ Assembly Status: ${assembly?.status}`);
            console.log(`   Duration: ${assembly?.durationSeconds}s`);
            console.log(`   Reel URL: ${assembly?.reelUrl}`);

            // 10. Seed Full 5-Turn Demo Dialogue, Commitments, Notes, and Decisions in CREW Session
            console.log(`\n💬 Seeding 5-Turn Film Production CREW Dialogue, Notes, and Commitments...`);
            await db.delete(crewTurns).where(eq(crewTurns.sessionId, session.id));
            await db.delete(crewCommitments).where(eq(crewCommitments.sessionId, session.id));
            await db.delete(supervisorNotes).where(eq(supervisorNotes.sessionId, session.id));
            await db.delete(crewDecisions).where(eq(crewDecisions.sessionId, session.id));

            // Seed live commitments / todos
            await db.insert(crewCommitments).values([
                {
                    sessionId: session.id,
                    organizationId: targetOrgId,
                    title: "Audit GPU compute burn rate and release budget lock",
                    detail: "Verified total spend of $3.60 against $50.00 ceiling and returned unallocated compute quota.",
                    ownerType: "agent",
                    ownerId: "Producer",
                    status: "completed",
                    createdBy: "Producer",
                },
                {
                    sessionId: session.id,
                    organizationId: targetOrgId,
                    title: "Export 4K ProRes master and conform stereo audio mix",
                    detail: "Conform master high-bitrate archival file from Scene 1 assembly.",
                    ownerType: "agent",
                    ownerId: "Technical Director",
                    status: "completed",
                    createdBy: "Technical Director",
                },
                {
                    sessionId: session.id,
                    organizationId: targetOrgId,
                    title: "Finalize Scene 2 keyframe character concepts",
                    detail: "Develop character style bible sketches for the neural interface protagonist in cyan/amber aesthetic.",
                    ownerType: "agent",
                    ownerId: "Visual Artist",
                    status: "open",
                    createdBy: "Visual Artist",
                },
            ]);

            // Seed supervisor notes
            await db.insert(supervisorNotes).values([
                {
                    sessionId: session.id,
                    organizationId: targetOrgId,
                    round: 3,
                    noteType: "consensus" as const,
                    content: "Full squad consensus (88%) achieved on 35mm Anamorphic aesthetic treatment (Option A) with cold cyan/amber volumetric contrast.",
                },
                {
                    sessionId: session.id,
                    organizationId: targetOrgId,
                    round: 3,
                    noteType: "summary" as const,
                    content: "Scene 1 ('The Breakthrough') was storyboarded, rendered, and conformed into an 11.75s master teaser reel within budget ($3.60 of $50.00 ceiling).",
                },
            ]);

            // Seed accepted formal decision
            await db.insert(crewDecisions).values([
                {
                    sessionId: session.id,
                    organizationId: targetOrgId,
                    statement: "Adopt Option A (35mm Anamorphic Cyber-Industrial) treatment with amber/cyan volumetric contrast for all Project Chimera teaser assets.",
                    status: "accepted" as const,
                    rationale: "88% squad consensus with highest cinematic immersion and strong fiber-optic edge contrast.",
                    createdBy: "Visual Artist",
                },
            ]);

            const demoTurns = [
                {
                    sessionId: session.id,
                    organizationId: targetOrgId,
                    speakerType: "supervisor" as const,
                    speakerName: "Studio Supervisor",
                    round: 1,
                    topic: "Production Briefing & Studio Initialization",
                    content: `🎬 **Film Studio Alpha initialized.**\n\nWelcome team. We are assembled to produce a 15-second cinematic promotional teaser for **Project Chimera**.\n\n* **Creative Director**: Leads narrative beat breakdown & pacing.\n* **Visual Artist**: Locks the Style Bible & generates keyframe concepts.\n* **Technical Director**: Coordinates Seedance video takes & timeline conforming.\n* **Producer**: Monitors GPU credit burn rate & manages executive governance.\n\nLet us begin by mounting the Media Studio and reviewing Scene 1: "The Breakthrough".`,
                    artifacts: [],
                },
                {
                    sessionId: session.id,
                    organizationId: targetOrgId,
                    speakerType: "agent" as const,
                    agentCardId: seededCardIds[0], // Creative Director
                    speakerName: "Creative Director",
                    round: 1,
                    topic: "Creative Direction & Narrative Arc",
                    content: `I have structured Scene 1: **"The Breakthrough"** into three tightly paced narrative beats:\n1. **The Setup**: Atmospheric lab with dormant amber filaments.\n2. **The Link**: Subject boots the prototype neural crown with cyan biometric pulses.\n3. **The Synthesis**: Reality dissolves into an infinite volumetric data landscape.\n\nMounting Media Studio on the workspace rail now to inspect the scene storyboard and shot list.`,
                    artifacts: [
                        {
                            tool: "mount_media_studio",
                            payload: {
                                type: "media_studio_pod",
                                module: "MediaStudioPod",
                                component: "MediaStudioPod",
                                title: production.title,
                                productionId: production.id,
                                sceneId: scene.sceneKey,
                                sceneTitle: scene.title,
                                aspectRatio: "16:9",
                            },
                        },
                    ],
                },
                {
                    sessionId: session.id,
                    organizationId: targetOrgId,
                    speakerType: "agent" as const,
                    agentCardId: seededCardIds[1], // Visual Artist
                    speakerName: "Visual Artist",
                    round: 2,
                    topic: "Visual Style Bible & Deliberation Matrix",
                    content: `I evaluated two visual styles for Project Chimera and opened a Decision Matrix for team consensus. **Option A (35mm Anamorphic Cyber-Industrial)** achieved **88% team consensus** (8.7/10 overall score). The Kodak 2383 film stock emulation and anamorphic flares provide the required psychological immersion. Style Bible is now locked.`,
                    artifacts: [
                        {
                            tool: "propose_decision_matrix",
                            payload: {
                                type: "crew_decision_matrix_pod",
                                topic: "Cinematic Aesthetic & Style Bible Selection",
                                recommendedCandidateId: "opt-a",
                                consensusPercentage: 88,
                                criteria: [
                                    { key: "mood", label: "Atmospheric Tension", weight: 0.35 },
                                    { key: "fidelity", label: "Photorealistic Render Fidelity", weight: 0.4 },
                                    { key: "continuity", label: "Subject Temporal Coherence", weight: 0.25 },
                                ],
                                candidates: [
                                    {
                                        id: "opt-a",
                                        name: "Option A: 35mm Anamorphic Cyber-Industrial",
                                        description:
                                            "High-contrast 35mm anamorphic lenses, volumetric amber haze with cold cyan rim lighting, Kodak 2383 film stock emulation.",
                                        scores: { mood: 9.2, fidelity: 8.8, continuity: 8.1 },
                                        overallScore: 8.7,
                                        pros: ["Highest cinematic immersion", "Exceptional edge contrast on glowing fiber-optics"],
                                        cons: ["Slightly higher render compute requirement"],
                                    },
                                    {
                                        id: "opt-b",
                                        name: "Option B: Clean Digital High-Key Sci-Fi",
                                        description:
                                            "Clinical white cleanroom lighting with soft diffuse reflections and 60fps high shutter speed.",
                                        scores: { mood: 6.8, fidelity: 7.9, continuity: 7.5 },
                                        overallScore: 7.4,
                                        pros: ["Fast render times"],
                                        cons: ["Lacks visceral emotional weight for the neural bridge moment"],
                                    },
                                ],
                                personaStances: [
                                    {
                                        agentName: "Creative Director",
                                        preferredCandidateId: "opt-a",
                                        confidence: 0.95,
                                        rationale: "Option A delivers the necessary emotional weight and depth for the breakthrough moment.",
                                    },
                                    {
                                        agentName: "Visual Artist",
                                        preferredCandidateId: "opt-a",
                                        confidence: 0.92,
                                        rationale: "35mm anamorphic flares and cold cyan accents match the neural interface visual language.",
                                    },
                                    {
                                        agentName: "Technical Director",
                                        preferredCandidateId: "opt-a",
                                        confidence: 0.85,
                                        rationale: "Seedance render engine handles volumetric lighting and lens flares with high consistency.",
                                    },
                                    {
                                        agentName: "Producer",
                                        preferredCandidateId: "opt-a",
                                        confidence: 0.8,
                                        rationale: "GPU cost fits comfortably within our $50.00 production ceiling.",
                                    },
                                ],
                            },
                        },
                    ],
                },
                {
                    sessionId: session.id,
                    organizationId: targetOrgId,
                    speakerType: "agent" as const,
                    agentCardId: seededCardIds[2], // Technical Director
                    speakerName: "Technical Director",
                    round: 2,
                    topic: "Render Queue & Timeline Assembly",
                    content: `All 3 shots have completed generation via our multi-engine render pipeline and have been approved into the dailies deck:\n* **Shot 1 (Wide Dolly, 4.0s)**: Approved Take 1\n* **Shot 2 (Macro Crown, 5.0s)**: Approved Take 1\n* **Shot 3 (POV Hyper-Zoom, 4.0s)**: Approved Take 1\n\nTimeline conformance executed cleanly with crossfade and dip-to-black transitions. Master conformed reel **SCENE-01** (11.75s, 1280x720 30fps) is ready for playback.`,
                    artifacts: [],
                },
                {
                    sessionId: session.id,
                    organizationId: targetOrgId,
                    speakerType: "agent" as const,
                    agentCardId: seededCardIds[3], // Producer
                    speakerName: "Producer",
                    round: 3,
                    topic: "Budget Governance & Action Checkpoint",
                    content: `Production budget update: Total spend is **$3.60** across 3 takes and 1 conform pass (well within our **$50.00** ceiling).\n\nI have registered an executive **Governance Checkpoint Gate** for the final teaser release sign-off. Please review and authorize the distribution action.`,
                    artifacts: [
                        {
                            tool: "request_governance_approval",
                            payload: {
                                type: "crew_governance_gate_pod",
                                checkpoint: {
                                    id: `gov-chimera-${targetOrgId}`,
                                    actionKey: "conformed_release_signoff",
                                    actionTitle: "Conformed 15s Master Teaser Release Sign-Off",
                                    riskTier: "low",
                                    requestedBy: "Producer",
                                    blastRadius: {
                                        affectedServices: ["Media Studio Engine", "CDN Distribution", "Audit Ledger"],
                                        dataDestructionRisk: false,
                                        estimatedCostUsd: 3.6,
                                        tenantsImpactedCount: 1,
                                        summary: "Final conform approved with 3 shots sequenced and synced. Total production spend $3.60 of $50.00 ceiling.",
                                    },
                                    executionPayload: {
                                        productionId: production.id,
                                        sceneId: scene.sceneKey,
                                        assemblyStatus: "ready",
                                        targetFormat: "16:9 1080p MP4",
                                        distributionChannels: ["social_teaser", "investor_deck"],
                                    },
                                    status: "pending",
                                    requestedAt: new Date().toISOString(),
                                },
                            },
                        },
                    ],
                },
            ];

            for (const dt of demoTurns) {
                await db.insert(crewTurns).values(dt);
            }
            console.log(`✅ Seeded 5 full turns with Decision Matrix, Governance Gate, Commitments, and Notes.`);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    }
}

async function main() {
    console.log(`\n🎬 Starting Film Production Studio Demo Seeding Across Target Orgs...`);
    for (const orgId of TARGET_ORG_IDS) {
        await seedOrg(orgId);
    }
    console.log(`\n🎉 ALL TARGET ORGS SEEDED SUCCESSFULLY!`);
    console.log(`CREW Room URL: http://localhost:5000/workspace/chat/${SESSION_KEY}`);
    process.exit(0);
}

main().catch((err) => {
    console.error(`❌ Seeding failed:`, err);
    process.exit(1);
});
