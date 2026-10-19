import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    key: vi.fn(),
    upload: vi.fn(),
    execute: vi.fn(),
}));

vi.mock("@domain/ai/core/org-gemini-key.js", () => ({
    ORG_GEMINI_KEY_MISSING: "Connect your organization's Gemini API key in Organization Settings",
    resolveOrgGeminiKey: mocks.key,
}));
vi.mock("@domain/ai/core/gemini-files.service.js", () => ({ uploadFileToGemini: mocks.upload }));
vi.mock("@domain/ai/core/ai-client.service.js", () => ({
    AIClientFactory: { getClient: () => ({ execute: mocks.execute }) },
}));

import { audioMimeType, parseTranscript, transcriptionService } from "./transcription-service.js";

describe("Gemini transcription", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.key.mockResolvedValue("org-key");
        mocks.upload.mockResolvedValue({ fileUri: "https://generativelanguage.googleapis.com/v1beta/files/abc", mimeType: "audio/ogg" });
    });

    it("transcribes on the organization's key, inside its AI context", async () => {
        mocks.execute.mockResolvedValue({ success: true, output: JSON.stringify({
            text: "Ship the fix today.",
            segments: [{ start: 0, end: 1.84, text: "Ship the fix today." }],
        }) });

        const result = await transcriptionService.transcribe(Buffer.from("audio"), "note.ogg", 7);

        expect(mocks.key).toHaveBeenCalledWith(7);
        expect(mocks.upload.mock.calls[0][1]).toBe("org-key");
        expect(mocks.upload.mock.calls[0][0]).toMatchObject({ name: "note.ogg", contentType: "audio/ogg" });
        const [config, , apiKey, attachments] = mocks.execute.mock.calls[0];
        expect(config).toMatchObject({ organizationId: 7, requestType: "json", temperature: 0 });
        expect(apiKey).toBe("org-key");
        expect(attachments).toEqual([{ fileUri: "https://generativelanguage.googleapis.com/v1beta/files/abc", mimeType: "audio/ogg" }]);
        expect(result).toEqual({ text: "Ship the fix today.", segments: [{ id: 0, start: 0, end: 1.84, text: "Ship the fix today." }] });
    });

    it("refuses without an organization key instead of using a platform one", async () => {
        mocks.key.mockResolvedValue(null);
        await expect(transcriptionService.transcribe(Buffer.from("audio"), "note.mp3", 7)).rejects.toThrow(/Gemini API key/);
        expect(mocks.upload).not.toHaveBeenCalled();
    });

    it("reports a failed model call rather than an empty transcript", async () => {
        mocks.execute.mockResolvedValue({ success: false, error: "429 quota" });
        await expect(transcriptionService.transcribe(Buffer.from("audio"), "note.mp3", 7)).rejects.toThrow(/429 quota/);
    });
});

describe("parseTranscript", () => {
    it("drops segments without times, keeps their words in text, and keeps time monotonic", () => {
        const parsed = parseTranscript("```json\n" + JSON.stringify({
            text: "",
            segments: [
                { start: 0, end: 2.004, text: "One." },
                { start: "x", end: 3, text: "Two." },
                { start: 1.5, end: 4, text: "Three." },
            ],
        }) + "\n```");
        expect(parsed.segments).toEqual([
            { id: 0, start: 0, end: 2, text: "One." },
            { id: 1, start: 2, end: 4, text: "Three." },
        ]);
        expect(parsed.text).toBe("One. Three.");
    });

    it("maps file extensions to audio types", () => {
        expect(audioMimeType("a.M4A")).toBe("audio/mp4");
        expect(audioMimeType("a.opus")).toBe("audio/ogg");
        expect(audioMimeType("noext")).toBe("audio/mp3");
    });
});
