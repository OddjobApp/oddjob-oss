import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

// Mock dependencies
const mockGetPlaylistVideos = vi.fn();
const mockGetTranscript = vi.fn();
const mockTranscribe = vi.fn();
const mockIngestFileToKnowledgeStore = vi.fn();
const mockExtractAndCreateKnowledgeGraph = vi.fn();
const mockStoreJobOutputAsKnowledge = vi.fn();

vi.mock("@domain/media/youtube-service.js", () => ({
    youtubeService: {
        getPlaylistVideos: (...args: any[]) => mockGetPlaylistVideos(...args),
        getTranscript: (...args: any[]) => mockGetTranscript(...args),
        downloadAudio: vi.fn().mockResolvedValue(Buffer.from("audio"))
    }
}));

vi.mock("@domain/media/transcription-service.js", () => ({
    transcriptionService: {
        transcribe: (...args: any[]) => mockTranscribe(...args)
    }
}));

vi.mock("@domain/knowledge/core/knowledge-store.js", () => ({
    ingestFileToKnowledgeStore: (...args: any[]) => mockIngestFileToKnowledgeStore(...args),
    storeJobOutputAsKnowledge: (...args: any[]) => mockStoreJobOutputAsKnowledge(...args)
}));

vi.mock("@domain/knowledge/core/extraction/knowledge-graph-extractor.js", () => ({
    extractAndCreateKnowledgeGraph: (...args: any[]) => mockExtractAndCreateKnowledgeGraph(...args)
}));

// Mock Database
const createMockQuery = (result: any = []) => ({
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnValue(Promise.resolve(result)),
    then: vi.fn(onFulfilled => Promise.resolve(result).then(onFulfilled))
});

vi.mock("@server/database_service.js", () => ({
    db: {
        select: vi.fn(() => createMockQuery()),
        insert: vi.fn(() => createMockQuery()),
        update: vi.fn(() => createMockQuery()),
        delete: vi.fn(() => createMockQuery()),
    }
}));

import { db } from "@server/database_service.js";

import { YouTubeSyncExecutor } from "@domain/jobs/core/executors/youtube-sync-executor.js";

describe("YouTubeSyncExecutor", () => {
    let executor: YouTubeSyncExecutor;

    beforeEach(() => {
        vi.clearAllMocks();
        executor = new YouTubeSyncExecutor();
    });

    it("should process videos from a playlist", async () => {
        const mockVideos = [
            { id: "vid1", title: "Video 1", url: "url1", channelTitle: "Ch1", duration: 100, description: "Desc", thumbnailUrl: "thumb" }
        ];
        mockGetPlaylistVideos.mockResolvedValue(mockVideos);
        mockGetTranscript.mockResolvedValue({ segments: [{ text: "Hello" }] });
        mockIngestFileToKnowledgeStore.mockResolvedValue(1001);

        const result = await executor.execute(
            { id: 1, organizationId: 1, createdBy: "user1" } as any,
            { playlistId: "pl1", knowledgeTopicId: 10, transcriptionEnabled: true, maxVideos: 5 } as any,
            {} as any,
            {} as any
        );

        expect(result.success).toBe(true);
        expect(mockGetPlaylistVideos).toHaveBeenCalledWith("pl1");
        expect(mockIngestFileToKnowledgeStore).toHaveBeenCalled();
        expect(mockExtractAndCreateKnowledgeGraph).toHaveBeenCalled();
    });

    it("should skip already ingested videos", async () => {
        const mockVideos = [{ id: "existing-vid", title: "Existing" }];
        mockGetPlaylistVideos.mockResolvedValue(mockVideos);

        // Mock existing record in DB
        vi.mocked(db.select).mockReturnValueOnce(createMockQuery([{ id: 1 }]) as any);

        const result = await executor.execute(
            { id: 1, organizationId: 1 } as any,
            { playlistId: "pl1", knowledgeTopicId: 10 } as any,
            {} as any,
            {} as any
        );

        expect(result.status).toBe("success");
        expect(mockIngestFileToKnowledgeStore).not.toHaveBeenCalled();
    });

    it("should fallback to Whisper if native transcript fails", async () => {
        const mockVideos = [{ id: "vid_no_transcript", title: "No Transcript", url: "url", channelTitle: "Ch" }];
        mockGetPlaylistVideos.mockResolvedValue(mockVideos);
        mockGetTranscript.mockResolvedValue(null); // No native transcript
        mockTranscribe.mockResolvedValue({ text: "Whisper text", segments: [] });

        await executor.execute(
            { id: 1, organizationId: 1 } as any,
            { playlistId: "pl1", knowledgeTopicId: 10, transcriptionEnabled: true } as any,
            {} as any,
            {} as any
        );

        expect(mockTranscribe).toHaveBeenCalled();
    });
});
