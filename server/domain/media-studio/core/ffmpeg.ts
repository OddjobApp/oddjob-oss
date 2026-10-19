import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import ffmpegStatic from "ffmpeg-static";

/**
 * The ffmpeg binary that ships with `ffmpeg-static`, called directly with
 * `child_process.spawn` (fluent-ffmpeg is deprecated). `FFMPEG_PATH` points at another
 * binary. The package downloads its binary at install time, so an install that skipped
 * install scripts has none, and assembly says so instead of failing on spawn.
 */

export interface ClipProbe {
    durationSeconds: number | null;
    hasVideo: boolean;
    hasAudio: boolean;
    width: number | null;
    height: number | null;
}

export interface FfmpegRunner {
    probe(file: string): Promise<ClipProbe>;
    run(args: string[]): Promise<void>;
}

export function ffmpegBinary(): string | null {
    const candidate = process.env.FFMPEG_PATH || ffmpegStatic;
    return candidate && existsSync(candidate) ? candidate : null;
}

/** Reads a clip's length and streams from what `ffmpeg -i` writes about its input. */
export function parseProbe(stderr: string): ClipProbe {
    const duration = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(stderr);
    const video = /Stream #\d+:\d+[^:\n]*: Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b/.exec(stderr);
    return {
        durationSeconds: duration ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) : null,
        hasVideo: /Stream #\d+:\d+[^:\n]*: Video:/.test(stderr),
        hasAudio: /Stream #\d+:\d+[^:\n]*: Audio:/.test(stderr),
        width: video ? Number(video[1]) : null,
        height: video ? Number(video[2]) : null,
    };
}

/** The last lines ffmpeg wrote, which carry its reason for failing. */
export function ffmpegReason(stderr: string): string {
    const lines = stderr.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return lines.slice(-4).join(" / ").slice(-600) || "ffmpeg wrote nothing";
}

function exec(binary: string, args: string[], timeoutMs: number): Promise<{ code: number | null; stderr: string }> {
    return new Promise((resolve, reject) => {
        const child = spawn(binary, args, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
        let stderr = "";
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk: string) => {
            stderr = (stderr + chunk).slice(-64_000);
        });
        const timer = setTimeout(() => {
            child.kill("SIGKILL");
            reject(new Error(`ffmpeg did not finish within ${Math.round(timeoutMs / 1000)} seconds.`));
        }, timeoutMs);
        child.on("error", (error) => {
            clearTimeout(timer);
            reject(new Error(`ffmpeg could not be started: ${error.message}`));
        });
        child.on("close", (code) => {
            clearTimeout(timer);
            resolve({ code, stderr });
        });
    });
}

export function createFfmpegRunner(binary: string, options: { timeoutMs?: number } = {}): FfmpegRunner {
    return {
        async probe(file) {
            // With no output named, ffmpeg describes the input and exits non-zero; the description is what is wanted.
            const { stderr } = await exec(binary, ["-hide_banner", "-nostdin", "-i", file], 30_000);
            return parseProbe(stderr);
        },
        async run(args) {
            const { code, stderr } = await exec(binary, args, options.timeoutMs ?? 10 * 60_000);
            if (code !== 0) throw new Error(`ffmpeg failed (exit ${code}): ${ffmpegReason(stderr)}`);
        },
    };
}
