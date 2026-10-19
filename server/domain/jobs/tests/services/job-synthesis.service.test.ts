/**
 * JobSynthesisService — the HIL review loop.
 *
 * This suite existed but had never run once. It was committed under a 171-char
 * name of repeated "v2" — a botched shell redirect — with no .test.ts extension,
 * so vitest never collected it, and the name was long enough to break `git
 * worktree add` on any path with normal nesting. Its import path was also
 * written as if from the repo root rather than from this directory.
 *
 * It is the only coverage job-synthesis.service.ts has, and it passes.
 */


import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

// These six were referenced by the vi.mock factories below but never declared —
// the file was saved mid-edit. They survived only because the arrow bodies that
// close over them are never called by these three tests; tsc sees them for what
// they are. Declared with vi.hoisted so they exist before the hoisted factories.
const {
    mockGetPlaylistVideos,
    mockGetTranscript,
    mockTranscribe,
    mockIngestFileToKnowledgeStore,
    mockStoreJobOutputAsKnowledge,
    mockExtractAndCreateKnowledgeGraph,
} = vi.hoisted(() => ({
    mockGetPlaylistVideos: vi.fn().mockResolvedValue([]),
    mockGetTranscript: vi.fn().mockResolvedValue(""),
    mockTranscribe: vi.fn().mockResolvedValue(""),
    mockIngestFileToKnowledgeStore: vi.fn().mockResolvedValue(undefined),
    mockStoreJobOutputAsKnowledge: vi.fn().mockResolvedValue(undefined),
    mockExtractAndCreateKnowledgeGraph: vi.fn().mockResolvedValue(undefined),
}));

// Helper to create a chainable mock query
const createMockQuery = (result: any = []) => {
    const query = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        offset: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockReturnValue(Promise.resolve(result)),
        then: vi.fn(onFulfilled => Promise.resolve(result).then(onFulfilled))
    };
    return query;
};

// Mock database
vi.mock("@server/database_service.js", () => ({
    db: {
        select: vi.fn(() => createMockQuery()),
        insert: vi.fn(() => createMockQuery()),
        update: vi.fn(() => createMockQuery()),
        delete: vi.fn(() => createMockQuery()),
    },
}));

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

// Mock AI
vi.mock("@domain/ai/core/ai-client.service.js", () => ({
    normalizeGeminiModel: vi.fn(m => m),
    getEnabledAiProviders: vi.fn().mockResolvedValue(['google', 'openai', 'anthropic']),
    AIClientFactory: {
        getClient: vi.fn(() => ({
            execute: vi.fn().mockResolvedValue({
                success: true,
                output: JSON.stringify({
                    name: "Scraper Bot",
                    description: "Scrapes news",
                    type: "selenium",
                    tool: "Playwright",
                    config: { startUrl: "https://news.ycombinator.com" }
                })
            })
        }))
    }
}));

vi.mock("../ai/core/system-ai.service.js", () => ({
    systemAiService: {
        getAiConfig: vi.fn().mockResolvedValue({ provider: 'google', model: 'gemini' })
    }
}));

vi.mock("../../utils/logger.js", () => ({
    createLogger: vi.fn(() => ({
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn()
    }))
}));

import { jobSynthesisService } from "../../job-synthesis.service.js";
import { db } from "@server/database_service.js";

describe("JobSynthesisService - HIL Review Loop", () => {
    const mockContext = {
        role: "News Scraper",
        organizationId: 1,
        userId: "user-123"
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("should create an approval request when requireReview is true", async () => {
        // Mocking no existing jobs with same name
        (db.select as Mock).mockReturnValue(createMockQuery([]));
        
        // Mocking credentials lookup
        (db.select as Mock).mockReturnValueOnce(createMockQuery([{ id: 10 }]));

        // Mocking insert proposal result
        (db.insert as Mock).mockReturnValueOnce(createMockQuery([{ id: 50 }]));

        const result = await jobSynthesisService.synthesizeJob(
            mockContext.role,
            mockContext.organizationId,
            mockContext.userId,
            undefined,
            undefined,
            { requireReview: true }
        );

        expect(result.status).toBe("pending_review");
        expect(result.proposalId).toBe(50);
        expect(db.insert).toHaveBeenCalledTimes(1); 
    });

    it("should create a job directly when requireReview is false", async () => {
        // Mocking no existing jobs
        (db.select as Mock).mockReturnValue(createMockQuery([]));
        
        // Mocking credentials
        (db.select as Mock).mockReturnValueOnce(createMockQuery([{ id: 10 }]));
        
        // Mocking job insert result
        (db.insert as Mock).mockReturnValueOnce(createMockQuery([{ id: 100, name: "Scraper Bot" }]));
        // List of other inserts (collections, etc)
        (db.insert as Mock).mockReturnValue(createMockQuery([{ id: 200 }]));

        const result = await jobSynthesisService.synthesizeJob(
            mockContext.role,
            mockContext.organizationId,
            mockContext.userId,
            undefined,
            undefined,
            { requireReview: false }
        );

        expect(result.id).toBe(100);
        expect(db.insert).toHaveBeenCalled(); 
    });

    it("should finalize synthesis upon approval", async () => {
        const proposal = {
            id: 50,
            status: "approved",
            modifiedOutput: {
                type: "SKILL_PROPOSAL",
                action: "SKILL_PROPOSAL",
                role: "Reporter",
                jobDefinition: { name: "Reporter Bot", type: "ai_agent" },
                organizationId: 1,
                userId: "user-123"
            }
        };

        // Mock proposal lookup
        (db.select as Mock).mockReturnValueOnce(createMockQuery([proposal]));
        
        // Mock the recursive call to synthesizeJob (which will insert components)
        // First, check for unique name
        (db.select as Mock).mockReturnValueOnce(createMockQuery([]));
        // Then credentials
        (db.select as Mock).mockReturnValueOnce(createMockQuery([{ id: 10 }]));
        // Then insert job
        (db.insert as Mock).mockReturnValueOnce(createMockQuery([{ id: 101 }]));
        // Then insert collection
        (db.insert as Mock).mockReturnValueOnce(createMockQuery([{ id: 201 }]));
        // Then insert item
        (db.insert as Mock).mockReturnValueOnce(createMockQuery([{ id: 301 }]));

        const result = await jobSynthesisService.finalizeSynthesis(50, "user-123");

        expect(result.id).toBe(101);
        expect(db.insert).toHaveBeenCalled();
    });
});
