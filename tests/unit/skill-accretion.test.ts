import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { skillAccretionService } from "../../server/domain/agents/core/skill-accretion.service.js";
import { systemAiService } from "../../server/domain/ai/core/system-ai.service.js";
import * as fs from "fs";
import * as path from "path";

// Mock dependencies
vi.mock("../../server/domain/ai/core/system-ai.service.js", () => ({
    systemAiService: {
        generateText: vi.fn(),
    },
}));

vi.mock("fs", async () => {
    const actual = await vi.importActual<typeof import("fs")>("fs");
    return {
        ...actual,
        promises: {
            mkdir: vi.fn().mockResolvedValue(undefined),
            writeFile: vi.fn().mockResolvedValue(undefined),
        },
    };
});

describe("Skill Accretion Service", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("should skip accretion if history contains no tool calls", async () => {
        const runData = {
            goal: "Say hello",
            history: [
                { type: "thought", content: "I should say hello." },
                { type: "thought", content: "Hello user!" }
            ],
            response: "Hello user!"
        };

        await skillAccretionService.accreteFromRun(runData);

        expect(systemAiService.generateText).not.toHaveBeenCalled();
        expect(fs.promises.writeFile).not.toHaveBeenCalled();
    });

    it("should generate a skill if history contains tool calls", async () => {
        const runData = {
            goal: "Find list of missions",
            history: [
                { type: "thought", content: "I need to look up the missions." },
                { type: "action", toolName: "list_missions", toolArgs: {}, observation: "Found 1 mission." },
                { type: "thought", content: "I will confirm the mission to the user." }
            ],
            response: "I found the mission Deploy Website."
        };

        const mockResponse = `
---
name: list-missions-skill
description: Distilled skill to list active missions
---
# Instructions
Call the list_missions tool to get a list of active missions.
`;

        vi.mocked(systemAiService.generateText).mockResolvedValue(mockResponse);

        await skillAccretionService.accreteFromRun(runData);

        // Verify LLM prompt was sent
        expect(systemAiService.generateText).toHaveBeenCalledOnce();
        
        // Verify folder and file were written
        expect(fs.promises.mkdir).toHaveBeenCalledWith(
            expect.stringContaining(path.join(".agents", "skills", "list-missions-skill")),
            { recursive: true }
        );
        expect(fs.promises.writeFile).toHaveBeenCalledWith(
            expect.stringContaining(path.join(".agents", "skills", "list-missions-skill", "SKILL.md")),
            mockResponse.trim(),
            "utf8"
        );
    });
});
