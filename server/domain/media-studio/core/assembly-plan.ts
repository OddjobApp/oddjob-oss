import type { MediaAspectRatio, ShotTransition, VideoResolution } from "@shared/media-studio.js";

/**
 * How a scene's approved takes become one reel: the ffmpeg arguments, worked out
 * without running anything so they can be tested as text.
 *
 * Every clip is fitted inside the production's frame (letterboxed, never cropped or
 * stretched) at one frame rate, pixel format and timebase, and given a stereo track,
 * silent when the take has none, because xfade, acrossfade and concat all refuse
 * inputs that differ. A shot's transition leads into the next shot; the last shot's
 * leads nowhere.
 */

export const REEL_FPS = 24;

/** Seconds a transition overlaps two shots, before it is shortened to fit a short shot. */
export const TRANSITION_SECONDS: Record<Exclude<ShotTransition, "cut">, number> = { crossfade: 0.75, dip_to_black: 1 };

const SHORT_SIDE: Record<VideoResolution, number> = { "720p": 720, "1080p": 1080 };
const RATIO: Record<MediaAspectRatio, number> = { "16:9": 16 / 9, "9:16": 9 / 16, "2.39:1": 2.39, "4:3": 4 / 3, "1:1": 1 };
const even = (n: number) => Math.round(n / 2) * 2;

/** The reel's frame: the takes' resolution on its short side, the production's aspect ratio, even pixels for H.264. */
export function reelDimensions(aspectRatio: MediaAspectRatio, resolution: VideoResolution): { width: number; height: number } {
    const short = SHORT_SIDE[resolution];
    const ratio = RATIO[aspectRatio];
    return ratio >= 1 ? { width: even(short * ratio), height: short } : { width: short, height: even(short / ratio) };
}

export interface PlanClip {
    path: string;
    durationSeconds: number;
    hasAudio: boolean;
    /** The transition into the next clip. */
    transition: ShotTransition;
    /** Optional custom transition duration in seconds (overrides default). */
    transitionDurationSeconds?: number;
    /** Track index: 1 = V1 primary, 2 = V2 overlay/cutaway (default 1) */
    track?: number;
    /** Start offset in seconds on the timeline for overlay clips */
    startTimeSeconds?: number;
    /** In-point trim offset within the source asset in seconds (default 0) */
    trimInSeconds?: number;
    /** Out-point trim offset within the source asset in seconds */
    trimOutSeconds?: number;
    /** Freeze frame hold extension in seconds beyond source asset */
    holdDurationSeconds?: number;
}

export interface AssemblyPlan {
    args: string[];
    durationSeconds: number;
    width: number;
    height: number;
}

const seconds = (n: number) => String(Number(n.toFixed(3)));

/** What a clip contributes before any hold: its trimmed span, else its whole length. */
function trimmedLength(clip: PlanClip): number {
    const trimIn = clip.trimInSeconds ?? 0;
    return clip.trimOutSeconds !== undefined && clip.trimOutSeconds > trimIn
        ? clip.trimOutSeconds - trimIn
        : clip.durationSeconds;
}

/**
 * How long a clip actually plays: its trimmed span plus any freeze-frame hold.
 *
 * Every timing decision reads this — transition offsets, the reel's length, an
 * overlay's window — because a trim that the filter graph honours but the arithmetic
 * ignores puts the transitions somewhere the footage no longer is.
 */
function playLength(clip: PlanClip): number {
    return trimmedLength(clip) + (clip.holdDurationSeconds ?? 0);
}

export function buildAssemblyPlan(input: { clips: PlanClip[]; width: number; height: number; output: string }): AssemblyPlan {
    const { clips, width, height, output } = input;
    if (!clips.length) throw new Error("A reel needs at least one clip.");

    // Which track a clip is on decides what is built for it, so it is settled first.
    const v1Indices: number[] = [];
    const v2Indices: number[] = [];
    clips.forEach((c, idx) => {
        if (c.track === 2) v2Indices.push(idx);
        else v1Indices.push(idx);
    });

    // If all clips are overlays (edge case), treat the first as V1
    if (v1Indices.length === 0) {
        v1Indices.push(v2Indices.shift()!);
    }
    const isOverlay = new Set(v2Indices);

    const graph: string[] = [];
    clips.forEach((clip, i) => {
        const trimIn = clip.trimInSeconds ?? 0;
        const d = seconds(trimmedLength(clip));
        const trimFilter = trimIn > 0 ? `trim=start=${seconds(trimIn)}:duration=${d}` : `trim=duration=${d}`;
        const atrimFilter = trimIn > 0 ? `atrim=start=${seconds(trimIn)}:duration=${d}` : `atrim=duration=${d}`;
        const holdFilter = clip.holdDurationSeconds && clip.holdDurationSeconds > 0
            ? `,tpad=stop_mode=clone:stop_duration=${seconds(clip.holdDurationSeconds)}`
            : "";
        // An overlay is composited onto the timeline at its own start time, so its
        // frames have to be moved there. Without the shift every overlay plays from the
        // reel's first frame and is merely hidden until its window opens, so what shows
        // is the middle of the cutaway, not its beginning.
        const shift = isOverlay.has(i) ? `+${seconds(Math.max(0, clip.startTimeSeconds ?? 0))}/TB` : "";

        // Ends in fps, not settb=AVTB: xfade needs every input at the same timebase and a
        // declared constant frame rate. settb gave the first but, in ffmpeg 7 (the Linux
        // ffmpeg-static build), left the rate unknown ("current rate of 1/0 is invalid"),
        // so every reel with a crossfade or dip failed to cut on Linux. fps gives both.
        graph.push(
            `[${i}:v:0]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,`
            + `setsar=1,fps=${REEL_FPS},format=yuv420p,${trimFilter}${holdFilter},setpts=PTS-STARTPTS${shift},fps=${REEL_FPS}[v${i}]`,
        );
        // No audio chain for an overlay: only V1 audio reaches the output map, and a
        // filter output nothing consumes makes ffmpeg refuse the whole graph.
        if (isOverlay.has(i)) return;
        graph.push(clip.hasAudio
            ? `[${i}:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,${atrimFilter},asetpts=PTS-STARTPTS[a${i}]`
            : `anullsrc=channel_layout=stereo:sample_rate=48000,${atrimFilter},aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`);
    });

    let video = `v${v1Indices[0]}`;
    let audio = `a${v1Indices[0]}`;
    let length = playLength(clips[v1Indices[0]]);

    for (let j = 1; j < v1Indices.length; j++) {
        const prevIdx = v1Indices[j - 1];
        const currIdx = v1Indices[j];
        const previous = clips[prevIdx];
        const next = clips[currIdx];
        const [joinedVideo, joinedAudio] = [`vx${j}`, `ax${j}`];
        const nextDuration = playLength(next);

        if (previous.transition === "cut") {
            graph.push(`[${video}][v${currIdx}]concat=n=2:v=1:a=0[${joinedVideo}]`, `[${audio}][a${currIdx}]concat=n=2:v=0:a=1[${joinedAudio}]`);
            length += nextDuration;
        } else {
            const requested = previous.transitionDurationSeconds ?? TRANSITION_SECONDS[previous.transition];
            const prevDur = playLength(previous);
            const overlap = Math.min(requested, prevDur / 2, nextDuration / 2);
            const kind = previous.transition === "crossfade" ? "fade" : "fadeblack";
            graph.push(
                `[${video}][v${currIdx}]xfade=transition=${kind}:duration=${seconds(overlap)}:offset=${seconds(length - overlap)}[${joinedVideo}]`,
                `[${audio}][a${currIdx}]acrossfade=d=${seconds(overlap)}[${joinedAudio}]`,
            );
            length += nextDuration - overlap;
        }
        video = joinedVideo;
        audio = joinedAudio;
    }

    // Apply V2 Overlays
    v2Indices.forEach((v2Idx, k) => {
        const overlayClip = clips[v2Idx];
        const start = Math.max(0, overlayClip.startTimeSeconds ?? 0);
        const end = start + playLength(overlayClip);
        const joinedVideo = `vov${k + 1}`;
        // eof_action=pass: once the cutaway runs out, the base timeline carries on
        // rather than freezing on the overlay's last frame.
        graph.push(
            `[${video}][v${v2Idx}]overlay=enable='between(t,${seconds(start)},${seconds(end)})':x=(W-w)/2:y=(H-h)/2:eof_action=pass[${joinedVideo}]`,
        );
        video = joinedVideo;
        length = Math.max(length, end);
    });

    return {
        args: [
            "-hide_banner", "-nostdin", "-y",
            ...clips.flatMap((clip) => ["-i", clip.path]),
            "-filter_complex", graph.join(";"),
            "-map", `[${video}]`, "-map", `[${audio}]`,
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-r", String(REEL_FPS),
            "-c:a", "aac", "-b:a", "160k", "-ar", "48000",
            "-movflags", "+faststart",
            output,
        ],
        durationSeconds: Number(length.toFixed(3)),
        width,
        height,
    };
}
