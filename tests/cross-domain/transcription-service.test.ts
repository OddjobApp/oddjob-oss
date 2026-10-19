import { describe, it, expect, beforeEach, vi } from "vitest";

// Undo the global setup.ts mock so we test the real service
vi.unmock("@domain/media/transcription-service.js");

const mocks = vi.hoisted(() => ({
    resolveOrgGeminiKey: vi.fn(),
    uploadFileToGemini: vi.fn(),
    execute: vi.fn(),
    getClient: vi.fn(),
}));

vi.mock("@domain/ai/core/org-gemini-key.js", async (importOriginal) => {
    const actual = await importOriginal<any>();
    return {
        ...actual,
        resolveOrgGeminiKey: mocks.resolveOrgGeminiKey,
    };
});

vi.mock("@domain/ai/core/gemini-files.service.js", () => ({
    uploadFileToGemini: mocks.uploadFileToGemini,
}));

vi.mock("@domain/ai/core/ai-client.service.js", () => ({
    AIClientFactory: {
        getClient: mocks.getClient,
    },
}));

import { TranscriptionService, audioMimeType } from "@server/domain/media/transcription-service";

describe("TranscriptionService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getClient.mockReturnValue({ execute: mocks.execute });
        mocks.uploadFileToGemini.mockResolvedValue({ fileUri: "gs://files/audio-1" });
    });

    it("transcribes audio through the org-aware Gemini client", async () => {
        mocks.resolveOrgGeminiKey.mockResolvedValue("org-gemini-key");
        mocks.execute.mockResolvedValue({
            success: true,
            output: JSON.stringify({
                text: "Transcribed text",
                segments: [{ start: 0, end: 1, text: "Transcribed text" }],
            }),
        });

        const service = new TranscriptionService();
        const result = await service.transcribe(Buffer.from("dummy audio"), "audio.mp3", 7);

        expect(result.text).toBe("Transcribed text");
        expect(result.segments).toEqual([{ id: 0, start: 0, end: 1, text: "Transcribed text" }]);
        expect(mocks.resolveOrgGeminiKey).toHaveBeenCalledWith(7);
        expect(mocks.uploadFileToGemini).toHaveBeenCalledWith(
            expect.objectContaining({ name: "audio.mp3", contentType: "audio/mp3" }),
            "org-gemini-key",
        );
        expect(mocks.getClient).toHaveBeenCalledWith(expect.objectContaining({ provider: "google" }));
    });

    it("refuses to transcribe on a platform key when the org has none", async () => {
        mocks.resolveOrgGeminiKey.mockResolvedValue(undefined);

        const service = new TranscriptionService();
        await expect(service.transcribe(Buffer.from("audio"), "audio.mp3", 7)).rejects.toThrow(
            /Gemini API key/,
        );
        expect(mocks.getClient).not.toHaveBeenCalled();
        expect(mocks.uploadFileToGemini).not.toHaveBeenCalled();
    });
});

describe("audioMimeType", () => {
    it("maps known audio extensions and defaults to mp3", () => {
        expect(audioMimeType("note.m4a")).toBe("audio/mp4");
        expect(audioMimeType("clip.ogg")).toBe("audio/ogg");
        expect(audioMimeType("file.unknown")).toBe("audio/mp3");
    });
});
