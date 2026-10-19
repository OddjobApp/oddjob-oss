/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { buildAssemblyPlan, reelDimensions, type PlanClip } from "../core/assembly-plan.js";
import { ffmpegReason, parseProbe } from "../core/ffmpeg.js";

const clip = (path: string, durationSeconds: number, transition: PlanClip["transition"] = "cut", hasAudio = true): PlanClip =>
    ({ path, durationSeconds, transition, hasAudio });
const graphOf = (args: string[]) => args[args.indexOf("-filter_complex") + 1].split(";");

describe("reel dimensions", () => {
    it("frames every aspect ratio at the takes' resolution, in even pixels", () => {
        expect(reelDimensions("16:9", "720p")).toEqual({ width: 1280, height: 720 });
        expect(reelDimensions("9:16", "720p")).toEqual({ width: 720, height: 1280 });
        expect(reelDimensions("2.39:1", "720p")).toEqual({ width: 1720, height: 720 });
        expect(reelDimensions("4:3", "720p")).toEqual({ width: 960, height: 720 });
        expect(reelDimensions("1:1", "1080p")).toEqual({ width: 1080, height: 1080 });
        expect(reelDimensions("16:9", "1080p")).toEqual({ width: 1920, height: 1080 });
    });
});

describe("the assembly plan", () => {
    it("fits one clip inside the frame, and gives a take with no sound a silent track", () => {
        const plan = buildAssemblyPlan({ clips: [clip("a.mp4", 5.04, "crossfade", false)], width: 1280, height: 720, output: "reel.mp4" });
        expect(plan).toMatchObject({ durationSeconds: 5.04, width: 1280, height: 720 });
        expect(plan.args.slice(0, 5)).toEqual(["-hide_banner", "-nostdin", "-y", "-i", "a.mp4"]);
        expect(graphOf(plan.args)).toEqual([
            "[0:v:0]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=24,format=yuv420p,trim=duration=5.04,setpts=PTS-STARTPTS,settb=AVTB[v0]",
            "anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=5.04,aformat=sample_fmts=fltp:channel_layouts=stereo[a0]",
        ]);
        expect(plan.args.slice(plan.args.indexOf("-map"))).toEqual([
            "-map", "[v0]", "-map", "[a0]",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "24",
            "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-movflags", "+faststart", "reel.mp4",
        ]);
    });

    it("cuts, crossfades and dips to black, each after the shot that names it", () => {
        const plan = buildAssemblyPlan({
            clips: [clip("1.mp4", 4, "crossfade"), clip("2.mp4", 5, "dip_to_black"), clip("3.mp4", 4, "cut"), clip("4.mp4", 6, "crossfade")],
            width: 1280, height: 720, output: "reel.mp4",
        });
        const graph = graphOf(plan.args);
        expect(graph[1]).toBe("[0:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=duration=4,asetpts=PTS-STARTPTS[a0]");
        expect(graph.slice(8)).toEqual([
            "[v0][v1]xfade=transition=fade:duration=0.75:offset=3.25[vx1]",
            "[a0][a1]acrossfade=d=0.75[ax1]",
            "[vx1][v2]xfade=transition=fadeblack:duration=1:offset=7.25[vx2]",
            "[ax1][a2]acrossfade=d=1[ax2]",
            "[vx2][v3]concat=n=2:v=1:a=0[vx3]",
            "[ax2][a3]concat=n=2:v=0:a=1[ax3]",
        ]);
        // 4 + 5 + 4 + 6, less the two overlaps; the last shot's crossfade leads nowhere.
        expect(plan.durationSeconds).toBe(17.25);
        expect(plan.args.slice(plan.args.indexOf("-map"), plan.args.indexOf("-map") + 4)).toEqual(["-map", "[vx3]", "-map", "[ax3]"]);
    });

    it("shortens a transition to half the shorter shot, and needs a clip", () => {
        const plan = buildAssemblyPlan({ clips: [clip("1.mp4", 1, "crossfade"), clip("2.mp4", 1.2)], width: 720, height: 720, output: "reel.mp4" });
        expect(graphOf(plan.args)[4]).toBe("[v0][v1]xfade=transition=fade:duration=0.5:offset=0.5[vx1]");
        expect(plan.durationSeconds).toBe(1.7);
        expect(() => buildAssemblyPlan({ clips: [], width: 720, height: 720, output: "reel.mp4" })).toThrow("A reel needs at least one clip.");
    });

    it("uses custom transitionDurationSeconds when specified", () => {
        const customClip: PlanClip = { path: "1.mp4", durationSeconds: 6, transition: "dip_to_black", transitionDurationSeconds: 1.5, hasAudio: true };
        const nextClip: PlanClip = { path: "2.mp4", durationSeconds: 6, transition: "cut", hasAudio: true };
        const plan = buildAssemblyPlan({ clips: [customClip, nextClip], width: 1280, height: 720, output: "reel.mp4" });
        expect(graphOf(plan.args)[4]).toBe("[v0][v1]xfade=transition=fadeblack:duration=1.5:offset=4.5[vx1]");
        expect(graphOf(plan.args)[5]).toBe("[a0][a1]acrossfade=d=1.5[ax1]");
        expect(plan.durationSeconds).toBe(10.5);
    });

    it("applies trim=start when trimInSeconds is specified", () => {
        const trimmedClip: PlanClip = {
            path: "1.mp4",
            durationSeconds: 4,
            trimInSeconds: 2,
            trimOutSeconds: 6,
            transition: "cut",
            hasAudio: true,
        };
        const plan = buildAssemblyPlan({ clips: [trimmedClip], width: 1280, height: 720, output: "reel.mp4" });
        const graph = graphOf(plan.args);
        expect(graph[0]).toContain("trim=start=2:duration=4");
        expect(graph[1]).toContain("atrim=start=2:duration=4");
    });

    it("appends tpad clone filter when holdDurationSeconds is specified", () => {
        const heldClip: PlanClip = {
            path: "1.mp4",
            durationSeconds: 5,
            holdDurationSeconds: 2,
            transition: "cut",
            hasAudio: true,
        };
        const plan = buildAssemblyPlan({ clips: [heldClip], width: 1280, height: 720, output: "reel.mp4" });
        const graph = graphOf(plan.args);
        expect(graph[0]).toContain("trim=duration=5,tpad=stop_mode=clone:stop_duration=2");
        expect(plan.durationSeconds).toBe(7);
    });

    it("composites V2 overlay clips using overlay filter", () => {
        const v1Clip: PlanClip = { path: "base.mp4", durationSeconds: 10, transition: "cut", hasAudio: true, track: 1 };
        const v2Clip: PlanClip = { path: "broll.mp4", durationSeconds: 3, startTimeSeconds: 2, transition: "cut", hasAudio: false, track: 2 };
        const plan = buildAssemblyPlan({ clips: [v1Clip, v2Clip], width: 1280, height: 720, output: "reel.mp4" });
        const graph = graphOf(plan.args);
        // The cutaway's frames are moved to where it plays, so it starts at its own
        // first frame rather than being revealed part-way through itself.
        expect(graph[2]).toContain("setpts=PTS-STARTPTS+2/TB");
        expect(graph[3]).toBe("[v0][v1]overlay=enable='between(t,2,5)':x=(W-w)/2:y=(H-h)/2:eof_action=pass[vov1]");
        expect(plan.args).toContain("[vov1]");
        expect(plan.durationSeconds).toBe(10);
    });

    it("builds no audio chain for an overlay, because nothing consumes it", () => {
        const v1Clip: PlanClip = { path: "base.mp4", durationSeconds: 10, transition: "cut", hasAudio: true, track: 1 };
        const v2Clip: PlanClip = { path: "broll.mp4", durationSeconds: 3, startTimeSeconds: 2, transition: "cut", hasAudio: true, track: 2 };
        const graph = graphOf(buildAssemblyPlan({ clips: [v1Clip, v2Clip], width: 1280, height: 720, output: "reel.mp4" }).args);
        // ffmpeg refuses a filter graph with an output nobody reads, so an overlay's
        // audio must never be built: only V1 audio reaches the output map.
        expect(graph.some((line) => line.endsWith("[a1]"))).toBe(false);
        expect(graph.some((line) => line.endsWith("[a0]"))).toBe(true);
    });

    it("times transitions from the trimmed length, not the untrimmed one", () => {
        const first: PlanClip = { path: "1.mp4", durationSeconds: 10, trimInSeconds: 1, trimOutSeconds: 5, transition: "crossfade", hasAudio: true };
        const second: PlanClip = { path: "2.mp4", durationSeconds: 10, trimInSeconds: 0, trimOutSeconds: 4, transition: "cut", hasAudio: true };
        const plan = buildAssemblyPlan({ clips: [first, second], width: 1280, height: 720, output: "reel.mp4" });
        // 4s and 4s of footage, a 0.75s crossfade: the join sits at 3.25s, not at 9.25s.
        expect(graphOf(plan.args)[4]).toBe("[v0][v1]xfade=transition=fade:duration=0.75:offset=3.25[vx1]");
        expect(plan.durationSeconds).toBe(7.25);
    });
});

describe("reading ffmpeg", () => {
    it("reads a clip's length, frame and streams", () => {
        const stderr = [
            "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'clip.mp4':",
            "  Metadata:",
            "    major_brand     : isom",
            "  Duration: 00:01:05.04, start: 0.000000, bitrate: 1234 kb/s",
            "  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 1280x720 [SAR 1:1 DAR 16:9], 1100 kb/s, 24 fps, 24 tbr, 12288 tbn (default)",
            "  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706d), 48000 Hz, stereo, fltp, 128 kb/s (default)",
            "At least one output file must be specified",
        ].join("\n");
        expect(parseProbe(stderr)).toEqual({ durationSeconds: 65.04, hasVideo: true, hasAudio: true, width: 1280, height: 720 });
        expect(parseProbe("  Duration: N/A, bitrate: N/A\n  Stream #0:0: Audio: mp3, 44100 Hz, stereo")).toEqual({ durationSeconds: null, hasVideo: false, hasAudio: true, width: null, height: null });
    });

    it("keeps the last lines ffmpeg wrote as its reason", () => {
        expect(ffmpegReason("ffmpeg version 6.1.1\r\n  built with gcc\n\nclip-0.mp4: Invalid data found when processing input\n")).toBe(
            "ffmpeg version 6.1.1 / built with gcc / clip-0.mp4: Invalid data found when processing input",
        );
        expect(ffmpegReason("")).toBe("ffmpeg wrote nothing");
    });
});
