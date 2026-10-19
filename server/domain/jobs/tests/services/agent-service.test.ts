
import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

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
        returning: vi.fn().mockReturnThis(),
        then: vi.fn(onFulfilled => Promise.resolve(result).then(onFulfilled))
    };
    return query;
};

// Mock database
vi.mock("@server/database_service.js", () => {
    return {
        db: {
            select: vi.fn(() => createMockQuery()),
            insert: vi.fn(() => createMockQuery()),
            update: vi.fn(() => createMockQuery()),
            delete: vi.fn(() => createMockQuery()),
            query: {
                jobs: {
                    findFirst: vi.fn()
                }
            },
            execute: vi.fn().mockResolvedValue({ rows: [] }),
        },
        pool: {
            query: vi.fn().mockResolvedValue({ rows: [] })
        }
    };
});

// The parsed-upload cache is Redis. Unmocked, processUploadedFiles failed with
// "Connection is closed" wherever Redis was not running, CI's verify job included.
vi.mock("@domain/auth/core/embed-profile-cache.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@domain/auth/core/embed-profile-cache.js")>()),
    setFileCache: vi.fn().mockResolvedValue(undefined),
    getFileCache: vi.fn().mockResolvedValue(null),
}));

// Mock dependencies
vi.mock("@domain/agents/agent-runner.js", () => ({
    runAgentLoop: vi.fn().mockResolvedValue({
        output: "Mock Agent Response",
        history: [],
        usage: { promptTokens: 10, completionTokens: 10 }
    })
}));

vi.mock("@domain/ai/core/ai-client.service.js", () => ({
    AIClientFactory: {
        getClient: vi.fn().mockReturnValue({
            generate: vi.fn()
        })
    },
    FallbackAIClient: vi.fn()
}));

vi.mock("@domain/core/infrastructure/file-parser.service.js", () => ({
    FileParser: {
        parse: vi.fn().mockResolvedValue({ content: "parsed content", type: "text", summary: "summary" })
    }
}));

vi.mock("@domain/core/infrastructure/system-context.service.js", () => ({
    systemContextService: {}
}));

vi.mock("@domain/knowledge/core/rag/embedding-service.js", () => ({
    embeddingService: {
        generateAndStoreEmbedding: vi.fn().mockResolvedValue(undefined)
    }
}));

vi.mock("@domain/knowledge/core/rag.service.js", () => ({
    ragService: {}
}));

vi.mock("@domain/ai/core/prompt-service.js", () => ({
    promptService: {
        getTools: vi.fn().mockReturnValue(["tool1", "tool2"]),
        buildSystemPrompt: vi.fn().mockResolvedValue({ prompt: "mock prompt", scope: "mock scope" }),
        getScreenHint: vi.fn().mockReturnValue("mock hint")
    }
}));

vi.mock("@domain/agents/core/critic-service.js", () => ({
    criticService: {
        getRelevantCritiques: vi.fn().mockResolvedValue([]),
        assessInteraction: vi.fn().mockResolvedValue(undefined)
    }
}));

vi.mock("@domain/governor/core/molt-producer.js", () => ({
    MoltProducer: vi.fn().mockImplementation(() => ({
        publish: vi.fn().mockResolvedValue(undefined)
    }))
}));

// agent.service.ts imports the CLASS and constructs its own instance
// (`new SidecarSyncService()` at module scope), so mocking only the exported
// singleton left the class undefined and the whole suite failed to collect.
vi.mock("@domain/knowledge/core/sidecar-sync-service.js", () => {
    // A real class, because agent.service.ts calls `new SidecarSyncService()` and
    // a vi.fn() is not constructible.
    class SidecarSyncServiceStub {
        syncMemory = vi.fn().mockResolvedValue(undefined);
        fetchConsolidatedContext = vi.fn().mockResolvedValue(undefined);
        logObservation = vi.fn().mockResolvedValue(undefined);
    }
    return {
        SidecarSyncService: SidecarSyncServiceStub,
        sidecarSyncService: new SidecarSyncServiceStub(),
    };
});

vi.mock("@domain/mission/core/mission.service.js", () => ({
    missionService: {
        getMissionForEntity: vi.fn().mockResolvedValue(undefined),
        getMissionDetail: vi.fn().mockResolvedValue(undefined),
        updateBlackboard: vi.fn().mockResolvedValue(undefined)
    }
}));

vi.mock("@domain/ai/core/system-ai.service.js", () => ({
    systemAiService: {
        getAiConfig: vi.fn().mockResolvedValue({}),
        getAiConfigWithFallback: vi.fn().mockResolvedValue({})
    }
}));

vi.mock("@domain/governor/core/governor-resolver.js", () => ({
    governorResolver: {
        resolveGovernance: vi.fn().mockResolvedValue({ enabled: false, mode: 'OFF', rules: [], source: 'none' })
    }
}));

vi.mock("@server/utils/logger.js", () => ({
    createLogger: vi.fn(() => ({
        info: vi.fn(),
        debug: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
    })),
}));

import { agentService } from "@domain/agents/agent.service.js";
import { db, pool } from "@server/database_service.js";
import { runAgentLoop } from "@domain/agents/agent-runner.js";

describe("AgentService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("processUploadedFiles", () => {
        it("should parse and cache uploaded files", async () => {
            const mockFiles = [
                { buffer: Buffer.from("test"), mimetype: "text/plain", originalname: "test.txt", size: 4 }
            ] as any[];

            const result = await agentService.processUploadedFiles(mockFiles);

            expect(result).toHaveLength(1);
            expect(result[0].name).toBe("test.txt");
            expect(result[0].id).toBeDefined();
        });
    });

    describe("chat", () => {
        const mockInput = {
            // NOT a greeting: "Hello" matches GREETING_RE in chat-intent.ts and is
            // answered with a canned (and randomly chosen) reply without ever reaching
            // the agent loop, which is what this case is here to exercise.
            message: "Summarise the current deployment risk for me",
            userContext: {
                organizationId: 1,
                userId: "user-1",
                isAdmin: true,
                isSuperAdmin: false,
                isOrgAdmin: true
            }
        };

        it("should return agent response for a simple chat", async () => {
            const result = await agentService.chat(mockInput as any) as any;

            expect(result.response).toBe("Mock Agent Response");
            expect(runAgentLoop).toHaveBeenCalled();
            expect(db.insert).toHaveBeenCalled(); // Should save messages
        });

        it("should handle fast-path queries for job counts", async () => {
            (pool.query as Mock).mockResolvedValueOnce({ rows: [{ count: 5 }] });

            const result = await agentService.chat({
                ...mockInput,
                message: "how many jobs"
            } as any);

            // The job-count fast-path returns a { response, metadata } envelope,
            // not a bare string.
            expect(result.response).toBe("There are **5 jobs** in the system.");
            expect(runAgentLoop).not.toHaveBeenCalled();
        });
    });

    describe("saveMessage", () => {
        it("should insert message into database", async () => {
            const spy = vi.spyOn(db, 'insert');
            await agentService.saveMessage(1, "user-1", "user", "test content");
            expect(spy).toHaveBeenCalled();
        });

        it("should check for duplicates before saving", async () => {
            (db.select as Mock).mockReturnValueOnce(createMockQuery([{ id: 1 }]));

            const result = await agentService.saveMessage(1, "user-1", "user", "test content");

            expect(result).toBe(1);
            expect(db.insert).not.toHaveBeenCalled();
        });
    });

    describe("submitFeedback", () => {
        it("should update message with rating and feedback", async () => {
            const spy = vi.spyOn(db, 'update');
            await agentService.submitFeedback(1, { rating: 1, feedback: "Good job", reason: "helpful" });
            expect(spy).toHaveBeenCalled();
        });
    });
});
