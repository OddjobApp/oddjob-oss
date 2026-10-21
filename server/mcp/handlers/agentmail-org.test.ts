/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ forOrg: vi.fn(), send: vi.fn(), listThreads: vi.fn(), getThread: vi.fn() }));
vi.mock("../../domain/integrations/core/agentmail.service.js", () => ({ agentMailService: { forOrg: mocks.forOrg } }));
// Project scoping has its own integration suite; here every thread is readable.
vi.mock("../../domain/integrations/core/agentmail-thread-scope.service.js", () => ({
    agentMailThreadScope: { assertReadable: vi.fn(), filterThreads: vi.fn(async (_ctx: unknown, threads: unknown[]) => threads), readableFilter: vi.fn(async () => () => true), record: vi.fn(), recordForMissionRun: vi.fn() },
    threadScopeCtx: (_context: unknown, organizationId: number) => ({ organizationId }),
}));
import { handleAgentMailSend, handleAgentMailListThreads, handleAgentMailGetThread } from "./agentmail.js";
import { AGENTMAIL_TOOLS } from "../../domain/tools/v1/capabilities/agentmail.js";

beforeEach(() => {
    vi.clearAllMocks();
    mocks.forOrg.mockResolvedValue({ send: mocks.send, listThreads: mocks.listThreads, getThread: mocks.getThread });
    mocks.send.mockResolvedValue({ message_id: "m1", thread_id: "t1" });
    mocks.listThreads.mockResolvedValue({ count: 0, threads: [] });
    mocks.getThread.mockResolvedValue({ thread_id: "t1", messages: [] });
});
describe("AgentMail tool tenant propagation", () => {
    it("requires explicit organization context in MCP", async () => {
        const result = await handleAgentMailListThreads({});
        expect(JSON.stringify(result)).toContain("Organization context required");
        expect(mocks.forOrg).not.toHaveBeenCalled();
    });
    it("uses the caller's organization for MCP send, list and get", async () => {
        await handleAgentMailSend({ to: ["recipient@example.com"], subject: "Test", text: "Body" }, { organizationId: 9 });
        await handleAgentMailListThreads({}, { organizationId: 9 });
        await handleAgentMailGetThread({ thread_id: "t1" }, { organizationId: 9 });
        expect(mocks.forOrg.mock.calls).toEqual([[9], [9], [9]]);
        expect(mocks.send).toHaveBeenCalledOnce(); expect(mocks.listThreads).toHaveBeenCalledOnce(); expect(mocks.getThread).toHaveBeenCalledWith("t1");
    });
    it.each(["send_agentmail", "reply_agentmail", "list_agentmail_threads", "get_agentmail_thread"])("fails closed without context in %s", async name => {
        const result = await AGENTMAIL_TOOLS[name].execute({}, {});
        // CREW classifies Error-prefixed results as failed calls, so failed email cannot ground a success claim.
        expect(result).toMatch(/^Error:/);
        expect(mocks.forOrg).not.toHaveBeenCalled();
    });
    it("passes organization context through capability replies", async () => {
        const reply = vi.fn().mockResolvedValue({ message_id: "m2", thread_id: "t1" });
        mocks.forOrg.mockResolvedValue({ reply, getMessage: vi.fn().mockResolvedValue({ message_id: "m1", thread_id: "t1" }) });
        await AGENTMAIL_TOOLS.reply_agentmail.execute({ messageId: "m1", text: "Reply" }, { organizationId: 12 });
        expect(mocks.forOrg).toHaveBeenCalledWith(12); expect(reply).toHaveBeenCalledOnce();
    });
});
