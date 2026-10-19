import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";
import { uploadFileToGemini } from "@domain/ai/core/gemini-files.service.js";
import { ORG_GEMINI_KEY_MISSING, resolveOrgGeminiKey } from "@domain/ai/core/org-gemini-key.js";

export interface TranscriptionSegment {
    id: number;
    start: number;
    end: number;
    text: string;
}

export interface TranscriptionResult {
    text: string;
    segments: TranscriptionSegment[];
}

const TRANSCRIPTION_MODEL = process.env.GEMINI_TRANSCRIPTION_MODEL || "gemini-2.5-flash";

const AUDIO_MIME_TYPES: Record<string, string> = {
    mp3: "audio/mp3",
    wav: "audio/wav",
    m4a: "audio/mp4",
    mp4: "audio/mp4",
    aac: "audio/aac",
    ogg: "audio/ogg",
    oga: "audio/ogg",
    opus: "audio/ogg",
    flac: "audio/flac",
    webm: "audio/webm",
    aiff: "audio/aiff",
};

export function audioMimeType(fileName: string): string {
    const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
    return AUDIO_MIME_TYPES[ext] ?? "audio/mp3";
}

const SYSTEM_PROMPT = `You transcribe audio verbatim.
Return ONLY a JSON object: {"text": string, "segments": [{"start": number, "end": number, "text": string}]}.
- "text" is the full transcript in the spoken language. Do not translate, summarize or add commentary.
- "segments" split it into consecutive utterances of one or two sentences, with "start" and "end" in seconds from the beginning of the audio.
- If there is no speech, return {"text": "", "segments": []}.`;

/**
 * Parses the model's JSON transcript. Segment timestamps from a general model
 * are approximate; they are rounded and kept monotonic, never invented when
 * absent (a segment without times is dropped from `segments`, its words stay
 * in `text`).
 */
export function parseTranscript(output: string): TranscriptionResult {
    const cleaned = output.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(cleaned) as { text?: unknown; segments?: unknown };
    const text = typeof parsed.text === "string" ? parsed.text.trim() : "";
    const raw = Array.isArray(parsed.segments) ? parsed.segments : [];
    const segments: TranscriptionSegment[] = [];
    let lastEnd = 0;
    for (const s of raw as Array<Record<string, unknown>>) {
        const start = Number(s?.start);
        const end = Number(s?.end);
        const segText = typeof s?.text === "string" ? s.text.trim() : "";
        if (!segText || !Number.isFinite(start) || !Number.isFinite(end)) continue;
        const safeStart = Math.max(lastEnd, Math.round(start * 100) / 100);
        const safeEnd = Math.max(safeStart, Math.round(end * 100) / 100);
        segments.push({ id: segments.length, start: safeStart, end: safeEnd, text: segText });
        lastEnd = safeEnd;
    }
    return { text: text || segments.map((s) => s.text).join(" "), segments };
}

export class TranscriptionService {
    /**
     * Transcribe audio with Gemini, on the organization's own key.
     *
     * This ran on OpenAI Whisper, which no organization can connect: under
     * strict BYOK it either billed the platform or refused. Gemini reads audio
     * natively, so transcription now runs where every other AI call does —
     * through the org-aware client, inside the org's budget and spend tracking.
     */
    async transcribe(audioBuffer: Buffer, fileName: string = "audio.mp3", organizationId?: number | null): Promise<TranscriptionResult> {
        const apiKey = await resolveOrgGeminiKey(organizationId);
        if (!apiKey) throw new Error(`${ORG_GEMINI_KEY_MISSING} to transcribe audio`);

        const mimeType = audioMimeType(fileName);
        // Files API rather than inline data: voice notes and YouTube audio
        // routinely exceed the inline request limit. Uploaded with the same key
        // the call runs on, since a file is only readable by its own project.
        const upload = await uploadFileToGemini(
            { id: 0, name: fileName, assetType: "file", sourceType: "upload", fileData: audioBuffer.toString("base64"), contentType: mimeType },
            apiKey,
        );

        const client = AIClientFactory.getClient({ provider: "google", model: TRANSCRIPTION_MODEL } as any);
        const response = await client.execute({
            model: TRANSCRIPTION_MODEL,
            systemPrompt: SYSTEM_PROMPT,
            userPrompt: "Transcribe the attached audio.",
            requestType: "json",
            temperature: 0,
            useCache: false,
            enableQueryExpansion: false,
            saveOutputToFile: false,
            ...(organizationId != null ? { organizationId } : {}),
        } as any, undefined, apiKey, [{ fileUri: upload.fileUri, mimeType }]);

        if (!response.success || !response.output) {
            throw new Error(`Transcription failed: ${response.error || "the model returned no transcript"}`);
        }
        return parseTranscript(response.output);
    }
}

export const transcriptionService = new TranscriptionService();
export default transcriptionService;
