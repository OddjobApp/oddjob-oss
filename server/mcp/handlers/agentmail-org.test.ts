/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ forContext: vi.fn(), send: vi.fn(), listThreads: vi.fn(), getThread: vi.fn() }));
vi.mock("../../domain/integrations/core/agentmail.service.js", () => ({ agentMailService: { forContext: mocks.forContext } }));
import { handleAgentMailSend, handleAgentMailListThreads, handleAgentMailGetThread } from "./agentmail.js";
import { AGENTMAIL_TOOLS } from "../../domain/tools/v1/capabilities/agentmail.js";

beforeEach(() => {
    vi.clearAllMocks();
    mocks.forContext.mockResolvedValue({ send: mocks.send, listThreads: mocks.listThreads, getThread: mocks.getThread });
    mocks.send.mockResolvedValue({ message_id: "m1", thread_id: "t1" });
    mocks.listThreads.mockResolvedValue({ count: 0, threads: [] });
    mocks.getThread.mockResolvedValue({ thread_id: "t1", messages: [] });
});
describe("AgentMail tool tenant propagation", () => {
    it("propagates the trusted room context for mailbox resolution", async () => {
        await AGENTMAIL_TOOLS.list_agentmail_threads.execute({ limit: 10 }, { organizationId: 9, sessionKey: "room-a" });
        expect(mocks.forContext).toHaveBeenCalledWith(9, "room-a");
        await handleAgentMailListThreads({}, { organizationId: 9, sessionKey: "room-b" });
        expect(mocks.forContext).toHaveBeenCalledWith(9, "room-b");
    });
    it("requires explicit organization context in MCP", async () => {
        const result = await handleAgentMailListThreads({});
        expect(JSON.stringify(result)).toContain("Organization context required");
        expect(mocks.forContext).not.toHaveBeenCalled();
    });
    it("uses the caller's organization for MCP send, list and get", async () => {
        await handleAgentMailSend({ to: ["recipient@example.com"], subject: "Test", text: "Body" }, { organizationId: 9 });
        await handleAgentMailListThreads({}, { organizationId: 9 });
        await handleAgentMailGetThread({ thread_id: "t1" }, { organizationId: 9 });
        expect(mocks.forContext.mock.calls).toEqual([[9, undefined], [9, undefined], [9, undefined]]);
        expect(mocks.send).toHaveBeenCalledOnce(); expect(mocks.listThreads).toHaveBeenCalledOnce(); expect(mocks.getThread).toHaveBeenCalledWith("t1");
    });
    it.each(["send_agentmail", "reply_agentmail", "list_agentmail_threads", "get_agentmail_thread"])("fails closed without context in %s", async name => {
        const result = await AGENTMAIL_TOOLS[name].execute({}, {});
        // CREW classifies Error-prefixed results as failed calls, so failed email cannot ground a success claim.
        expect(result).toMatch(/^Error:/);
        expect(mocks.forContext).not.toHaveBeenCalled();
    });
    it("passes organization context through capability replies", async () => {
        const reply = vi.fn().mockResolvedValue({ message_id: "m2", thread_id: "t1" });
        mocks.forContext.mockResolvedValue({ reply });
        await AGENTMAIL_TOOLS.reply_agentmail.execute({ messageId: "m1", text: "Reply" }, { organizationId: 12 });
        expect(mocks.forContext).toHaveBeenCalledWith(12, undefined); expect(reply).toHaveBeenCalledOnce();
    });
});
