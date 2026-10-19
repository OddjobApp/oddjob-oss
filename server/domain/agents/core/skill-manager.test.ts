import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import { SkillManager } from "./skill-manager.js";
import type { ToolDefinition } from "../../tools/v1/capabilities/types.js";

// An ESM namespace is not configurable, so fs.appendFileSync cannot be spied on
// in place. Mock the module instead, keeping every other export real.
vi.mock("fs", async (importOriginal) => {
    const actual = await importOriginal<typeof import("fs")>();
    return { ...actual, default: actual, appendFileSync: vi.fn() };
});

/**
 * SkillManager decides which tools an agent can see, on every run.
 *
 * It sits in the hot path of `runAgentLoop` (agent-runner.ts:29), which every
 * non-script caller reaches — the copilot, the ai-agent executor, computer-use,
 * job-test, and `delegate_task` itself. Nothing pinned its behaviour before, so
 * the two defects below shipped unnoticed:
 *
 *   1. Category keywords were matched with `String.includes`, so "im[pr]ove"
 *      and "ap[pr]ove" activated `knowledge` through the two-letter keyword
 *      "pr". Activation was close to arbitrary.
 *   2. The never-prune list named three tools that do not exist, while the
 *      real delegation tools — which declare no `group` and therefore fall to
 *      `utility` — were left unprotected and pruned out of most runs.
 */

function tool(name: string, group?: string): ToolDefinition {
    return { name, description: `test tool ${name}`, group } as unknown as ToolDefinition;
}

describe("SkillManager.identifyRelevantSkills", () => {
    it("matches keywords on word boundaries, not substrings", () => {
        // "improve" contains "pr", a `knowledge` keyword. Under substring
        // matching this returned ["knowledge", "operations"]; the goal is about
        // pipelines and nothing else.
        const skills = SkillManager.identifyRelevantSkills("improve the pipeline deployment");
        expect(skills).toContain("operations");
        expect(skills).not.toContain("knowledge");
    });

    it("does not let 'browse' inside a word activate the data category", () => {
        // "row" is a `data` keyword and sits inside "browse".
        const skills = SkillManager.identifyRelevantSkills("browse the vendor website");
        expect(skills).toContain("web");
        expect(skills).not.toContain("data");
    });

    it("does not let 'time' inside 'estimate' activate utility", () => {
        const skills = SkillManager.identifyRelevantSkills("estimate the mission cost");
        expect(skills).toContain("operations");
        expect(skills).not.toContain("utility");
    });

    it("still matches simple plurals and verb forms", () => {
        // The boundary fix must not swing the other way: "files" has to keep
        // matching the "file" keyword, and "pipelines" the "pipeline" one.
        expect(SkillManager.identifyRelevantSkills("list the files")).toContain("files");
        expect(SkillManager.identifyRelevantSkills("show all pipelines")).toContain("operations");
        expect(SkillManager.identifyRelevantSkills("browsing the docs")).toContain("web");
    });

    it("matches underscored tool-shaped keywords exactly", () => {
        expect(SkillManager.identifyRelevantSkills("open a pull_request")).toContain("knowledge");
    });

    it("falls back to knowledge + utility when nothing matches", () => {
        expect(SkillManager.identifyRelevantSkills("xyzzy plugh")).toEqual(["knowledge", "utility"]);
    });

    it("reads the goal and the last user message, not assistant turns", () => {
        const history = [
            { role: "user", content: "nothing relevant here" },
            { role: "assistant", content: "let me query the dataset for you" },
        ];
        const skills = SkillManager.identifyRelevantSkills("xyzzy plugh", history);
        expect(skills).toEqual(["knowledge", "utility"]);
    });
});

describe("SkillManager.pruneTools", () => {
    beforeEach(() => vi.restoreAllMocks());

    it("never prunes the delegation tools", () => {
        // These declare no `group`, so getToolCategory returns "utility" — a
        // category this goal does not activate. Only the never-prune list can
        // save them, and it previously named three tools that do not exist
        // (spawn_sub_mission, blackboard_read, blackboard_write) instead.
        const tools = [
            tool("delegate_task"),
            tool("request_help"),
            tool("review_bids"),
            tool("accept_bid"),
        ];
        const kept = SkillManager.pruneTools("build the pipeline", [], tools).map(t => t.name);
        expect(kept).toEqual(["delegate_task", "request_help", "review_bids", "accept_bid"]);
    });

    it("keeps tools whose category the goal activates", () => {
        const tools = [tool("query_dataset", "Data"), tool("send_sms", "Twilio")];
        const kept = SkillManager.pruneTools("query the dataset", [], tools).map(t => t.name);
        expect(kept).toContain("query_dataset");
        expect(kept).not.toContain("send_sms");
    });

    it("does not widen the set it was given", () => {
        const tools = [tool("send_sms", "Twilio")];
        expect(SkillManager.pruneTools("query the dataset", [], tools).length).toBeLessThanOrEqual(1);
    });

    it("writes nothing to disk", () => {
        // The previous implementation called fs.appendFileSync on every prune,
        // synchronously, to a path resolved against the process cwd — leaving an
        // agent_debug_service.log in whatever directory the server started from.
        SkillManager.pruneTools("query the dataset", [], [tool("query_dataset", "Data")]);
        expect(fs.appendFileSync).not.toHaveBeenCalled();
    });
});
