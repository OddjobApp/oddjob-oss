import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../crew-tools.service.js", () => ({ crewToolsService: { execute: vi.fn() } }));
vi.mock("../crew-form-studio.service.js", () => ({ postTurn: vi.fn(), toolContext: () => ({ organizationId: 7 }) }));
import { crewToolsService } from "../crew-tools.service.js";
import { runDirectAgentStudioAction } from "../crew-agent-studio.service.js";

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(crewToolsService.execute).mockResolvedValue({ record: { name: "mount_agent_studio", ok: true, ms: 0 }, output: "mounted", artifact: { tool: "mount_agent_studio", payload: { type: "agent_studio_pod", props: {} } } });
});
function context(message: string, priorTurns: any[] = []) {
    return { message, priorTurns, cost: { toolCalls: 0 }, prefetch: { toolsMap: new Map([[1, [{ definition: { name: "mount_agent_studio" } }]]]) } } as any;
}
describe("direct Agent Studio mounting", () => {
    it.each(["Open Agent Studio", "Mount the agent studio.", "agent studio", "Please show bot builder"])("opens a draft for %s", async message => {
        expect(await runDirectAgentStudioAction(context(message), { id: 1 } as any)).toBe(true);
        expect(crewToolsService.execute).toHaveBeenCalledWith("mount_agent_studio", {}, expect.anything(), expect.anything());
    });
    it("reopens the previous agent for a bare gesture", async () => {
        await runDirectAgentStudioAction(context("Open Agent Studio", [{ artifacts: [{ payload: { type: "agent_studio_pod", props: { agentId: 42 } } }] }]), { id: 1 } as any);
        expect(crewToolsService.execute).toHaveBeenCalledWith("mount_agent_studio", { agentId: 42 }, expect.anything(), expect.anything());
    });
    it("still resolves a named agent, from the name rather than the whole message", async () => {
        await runDirectAgentStudioAction(context("Open Agent Studio for Support"), { id: 1 } as any);
        expect(crewToolsService.execute).toHaveBeenCalledWith("mount_agent_studio", { agentName: "Support" }, expect.anything(), expect.anything());
    });
    it("treats 'open the agent' as a gesture, not an agent named 'open'", async () => {
        await runDirectAgentStudioAction(context("open the agent"), { id: 1 } as any);
        expect(crewToolsService.execute).toHaveBeenCalledWith("mount_agent_studio", {}, expect.anything(), expect.anything());
    });
    it("opens the tab a mount request names", async () => {
        await runDirectAgentStudioAction(context("Open Agent Studio on the reach tab"), { id: 1 } as any);
        expect(crewToolsService.execute).toHaveBeenCalledWith("mount_agent_studio", { view: "reach" }, expect.anything(), expect.anything());
    });
});
