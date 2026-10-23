import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
vi.mock("../crew-turn-generation.js", () => ({ generateForCard: vi.fn() }));
import { generateForCard } from "../crew-turn-generation.js";
import { runBoundedFollowUp, MAX_COMPUTER_FOLLOW_UP_PASSES } from "../crew-speaker-turn.service.js";
import { crewToolsService, MAX_TOOL_CALLS_PER_TURN } from "../crew-tools.service.js";

const reply = (name?: string) => ({ content: name ? "" : "Verified", toolCalls: name ? [{ name, args: {} }] : [] }) as any;
const context = { organizationId: 7, userId: "user", named: {}, positional: {} };
function scope(names: string[], used = 1) {
    return {
        cost: { toolCalls: used }, card: { id: 1 }, orgId: 7, messages: [], result: reply(names[0]),
        sink: { availableTools: names.map(name => ({ definition: { name, parameters: z.object({}), execute: vi.fn().mockResolvedValue("observed") }, reason: "declared-agent-tool" })),
            toolContext: context, cost: { toolCalls: used }, toolsUsed: Array.from({ length: used }, () => ({ name: "trycua_create_session", ok: true, ms: 1 })), artifacts: [] },
    } as any;
}
beforeEach(() => vi.clearAllMocks());
describe('Gmail dependent reads', () => {
    it('executes a message listing after a profile check and allows rendering the result', async () => {
        const input = scope(['gmail_list_messages', 'render_table']);
        input.sink.toolsUsed = [{ name: 'gmail_get_profile', ok: true, ms: 1 }];
        vi.mocked(generateForCard).mockResolvedValueOnce(reply('render_table')).mockResolvedValueOnce(reply());
        const result = await runBoundedFollowUp(input);
        expect(input.sink.toolsUsed.map((r: any) => r.name)).toEqual(['gmail_get_profile', 'gmail_list_messages', 'render_table']);
        expect(result.content).toBe('Verified');
        const offered = vi.mocked(generateForCard).mock.calls[0][4]?.tools as any[];
        expect(offered.map(t => t.name)).toEqual(['render_table']);
        expect(vi.mocked(generateForCard).mock.calls.at(-1)?.[4]).not.toHaveProperty('tools');
    });
    it('does not grant outbound email tools during mailbox follow-up', async () => {
        const input = scope(['gmail_search', 'gmail_send']);
        vi.mocked(generateForCard).mockResolvedValue(reply());
        await runBoundedFollowUp(input);
        const offered = vi.mocked(generateForCard).mock.calls[0][4]?.tools as any[];
        expect(offered.some(t => t.name === 'gmail_send')).toBe(false);
    });
});
describe("computer-use follow-up", () => {
    it("runs dependent observe, click, and verification calls after session creation", async () => {
        const input = scope(["trycua_observe", "trycua_click"]);
        vi.mocked(generateForCard).mockResolvedValueOnce(reply("trycua_click")).mockResolvedValueOnce(reply("trycua_observe")).mockResolvedValueOnce(reply());
        const result = await runBoundedFollowUp(input);
        expect(input.sink.toolsUsed.map((r: any) => r.name)).toEqual(["trycua_create_session", "trycua_observe", "trycua_click", "trycua_observe"]);
        expect(result.content).toBe("Verified");
    });
    // Each pass is another model call with a person waiting on the same request,
    // so the loop is bounded by passes as well as by tools.
    it("withdraws tools at the pass cap, even with tool budget left", async () => {
        const input = scope(["trycua_observe"]);
        vi.mocked(generateForCard).mockImplementation(async (_a, _b, _c, _d, options) => reply(options?.tools ? "trycua_observe" : undefined));
        await runBoundedFollowUp(input);
        expect(input.sink.toolsUsed).toHaveLength(1 + MAX_COMPUTER_FOLLOW_UP_PASSES);
        expect(input.sink.toolsUsed.length).toBeLessThan(MAX_TOOL_CALLS_PER_TURN);
        // The last pass is the one that answers: it generates with tools withdrawn.
        expect(vi.mocked(generateForCard)).toHaveBeenCalledTimes(MAX_COMPUTER_FOLLOW_UP_PASSES);
        expect(vi.mocked(generateForCard).mock.calls.at(-1)?.[4]).not.toHaveProperty("tools");
    });

    it("withdraws tools at the total turn budget when one pass spends it", async () => {
        const input = scope(["trycua_observe"]);
        const manyCalls = { content: "", toolCalls: Array.from({ length: MAX_TOOL_CALLS_PER_TURN }, () => ({ name: "trycua_observe", args: {} })) } as any;
        input.result = manyCalls;
        vi.mocked(generateForCard).mockResolvedValue(reply());
        await runBoundedFollowUp(input);
        expect(input.sink.toolsUsed).toHaveLength(MAX_TOOL_CALLS_PER_TURN);
        expect(vi.mocked(generateForCard).mock.calls.at(-1)?.[4]).not.toHaveProperty("tools");
    });
    it("does not run an undeclared computer action", async () => {
        const input = scope(["trycua_observe"]);
        input.result = reply("trycua_click");
        vi.mocked(generateForCard).mockResolvedValue(reply());
        await runBoundedFollowUp(input);
        expect(input.sink.toolsUsed).toHaveLength(1);
        expect(input.sink.availableTools[0].definition.execute).not.toHaveBeenCalled();
    });
    it("keeps observation evidence while removing image bytes from text results", async () => {
        const input = scope(["trycua_screenshot"]);
        input.sink.availableTools[0].definition.execute.mockResolvedValue(JSON.stringify({ sessionId: "s", screenshotDataUrl: "data:image/png;base64," + "A".repeat(20000), ui: { visibleText: ["Save"], clickableRegions: [{ label: "Save", bounds: { x: 20, y: 30, width: 40, height: 10 } }] } }));
        const result = await crewToolsService.execute("trycua_screenshot", {}, input.sink.availableTools, context);
        expect(result.record.ok).toBe(true);
        const output = JSON.parse(result.output);
        expect(output.ui.visibleText).toEqual(["Save"]);
        expect(output).not.toHaveProperty("screenshotDataUrl");
    });
});
