import { describe, expect, it } from "vitest";
import {
    batchConcurrentToolCalls,
    crewToolsService,
    type CrewToolReason,
    type ResolvedCrewTool,
} from "../crew-tools.service.js";
import { crewOrchestratorService, isScribeAuthoringRequest } from "../crew-orchestrator.service.js";
import type { AgentCardRecord } from "@shared/schema/agent-cards.js";
import { z } from "zod";

describe("CREW Performance Optimizations", () => {
    it("memoizes function declarations across calls", () => {
        const dummyTool: ResolvedCrewTool = {
            definition: {
                name: "test_perf_tool",
                label: "Test Perf Tool",
                group: "system",
                description: "A fast performance test tool",
                parameters: z.object({ query: z.string().optional() }),
                execute: async () => "ok",
            },
            reason: "artifact",
        };

        const decl1 = crewToolsService.toFunctionDeclarations([dummyTool]);
        const decl2 = crewToolsService.toFunctionDeclarations([dummyTool]);

        expect(decl1[0]).toBe(decl2[0]); // Object identity check verifies in-memory cache hit
    });

    it("auto-sanitizes missing query argument for search tools", async () => {
        const searchTool: ResolvedCrewTool = {
            definition: {
                name: "search_unified_knowledge",
                label: "Search Unified Knowledge",
                group: "knowledge",
                description: "Searches knowledge base",
                parameters: z.object({ query: z.string().min(1) }),
                execute: async (args) => JSON.stringify({ searched: args.query }),
            },
            reason: "research",
        };

        // Calling without query should auto-sanitize rather than fail with invalid arguments
        const { record, output } = await crewToolsService.execute(
            "search_unified_knowledge",
            {},
            [searchTool],
            {
                organizationId: 342,
                userId: "test-user",
                named: { message: "What is Oddjob?" },
                positional: {},
            },
        );

        expect(record.ok).toBe(true);
        expect(output).toContain("What is Oddjob?");
    });

    it("sizes direct action requests and @mentions to 1 primary specialist", () => {
        const mockCard1: AgentCardRecord = {
            id: 114,
            organizationId: 342,
            name: "Sales Outreach Representative",
            description: "Sales specialist",
            personaType: "general",
            modelBindingProviderId: null,
            modelBindingModelId: null,
            capabilities: ["outreach"],
            tools: [],
            topicAffinities: ["General"],
            topicLabelAffinities: [],
            intentAffinities: ["Chat"],
            enabled: true,
            isDefault: false,
            oceanTraits: { o: 0.8, c: 0.7, e: 0.8, a: 0.8, n: 0.2 },
            soulArchetype: "Creative Catalyst",
            legend: "Sales lead",
            approvalBoundary: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        const mockCard2: AgentCardRecord = {
            ...mockCard1,
            id: 26,
            name: "Copilot",
            personaType: "copilot",
        };

        const members = [mockCard1, mockCard2];
        const actionMsg = "@Sales Outreach Representative Can you send a welcome message to jann@test.com?";
        const mentioned = crewOrchestratorService.parseMentions(actionMsg, members);

        expect(mentioned).toHaveLength(1);
        expect(mentioned[0].name).toBe("Sales Outreach Representative");
    });

    it("fast-routes first-person writing gestures to Scribe without hijacking code or email", () => {
        expect(isScribeAuthoringRequest("I want to write")).toBe(true);
        expect(isScribeAuthoringRequest("Help me write a proposal for Acme")).toBe(true);
        expect(isScribeAuthoringRequest("Write a unit test for the parser")).toBe(false);
        expect(isScribeAuthoringRequest("Write an email to the customer")).toBe(false);
    });

    describe("batchConcurrentToolCalls", () => {
        const tool = (name: string, reason: CrewToolReason): ResolvedCrewTool => ({
            definition: {
                name,
                label: name,
                group: "system",
                description: name,
                parameters: z.object({}),
                execute: async () => "ok",
            },
            reason,
        });

        const available = [
            tool("search_web", "research"),
            tool("get_dataset", "declared-read-safe"),
            tool("list_projects", "read-verb"),
            tool("mount_scribe_studio", "artifact"),
            tool("request_input", "human-input"),
            tool("propose_research_mission", "proposal"),
            tool("send_email", "declared-agent-tool"),
        ];

        it("runs adjacent read-only calls in one batch", () => {
            const batches = batchConcurrentToolCalls(
                [{ name: "search_web" }, { name: "get_dataset" }, { name: "list_projects" }],
                available,
            );

            expect(batches).toHaveLength(1);
            expect(batches[0].map((c) => c.name)).toEqual([
                "search_web",
                "get_dataset",
                "list_projects",
            ]);
        });

        it("isolates every call that is not admitted as read-only", () => {
            for (const name of [
                "mount_scribe_studio",
                "request_input",
                "propose_research_mission",
                "send_email",
            ]) {
                const batches = batchConcurrentToolCalls(
                    [{ name: "search_web" }, { name }, { name: "get_dataset" }],
                    available,
                );
                expect(batches.map((b) => b.map((c) => c.name))).toEqual([
                    ["search_web"],
                    [name],
                    ["get_dataset"],
                ]);
            }
        });

        it("preserves the declared order and loses no call", () => {
            const calls = [
                { name: "search_web" },
                { name: "get_dataset" },
                { name: "send_email" },
                { name: "list_projects" },
                { name: "mount_scribe_studio" },
            ];

            const flattened = batchConcurrentToolCalls(calls, available).flat();

            expect(flattened).toEqual(calls);
        });

        it("never batches a tool it cannot classify", () => {
            const batches = batchConcurrentToolCalls(
                [{ name: "search_web" }, { name: "not_offered_to_this_agent" }],
                available,
            );

            expect(batches).toHaveLength(2);
        });
    });
});
