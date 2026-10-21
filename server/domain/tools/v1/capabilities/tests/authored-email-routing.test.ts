/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
const proposal = vi.hoisted(() => vi.fn());
vi.mock("../crew-task-proposal-tools.js", () => ({ CREW_TASK_PROPOSAL_TOOLS: { propose_outbound_message: { execute: proposal } } }));
import { AGENTMAIL_TOOLS } from "../agentmail.js";
import { GOOGLE_WORKSPACE_TOOLS } from "../google-workspace.js";
import { MICROSOFT365_TOOLS } from "../microsoft365.js";
const context = { organizationId: 9, userId: "u1", sessionKey: "room-a" };
beforeEach(() => { vi.clearAllMocks(); proposal.mockResolvedValue('{"kind":"outbound_message","status":"pending"}'); });
describe("authored email enters sender confirmation", () => {
    it("does not alias a user-authored email to AgentMail and preserves HTML/CC/BCC", async () => {
        await AGENTMAIL_TOOLS.send_email.execute({ to: ["recipient@example.com"], subject: "Subject", html: "<b>Reviewed</b>", cc: ["cc@example.com"], bcc: ["bcc@example.com"] }, context);
        expect(proposal).toHaveBeenCalledWith(expect.objectContaining({ channel: "email", body: "<b>Reviewed</b>", bodyFormat: "html", cc: ["cc@example.com"], bcc: ["bcc@example.com"] }), context);
        expect(proposal.mock.calls[0][0]).not.toHaveProperty("emailAccount");
    });
    it("routes legacy Gmail sending to the same confirmation card", async () => {
        await GOOGLE_WORKSPACE_TOOLS.gmail_send.execute({ to: "one@example.com, two@example.com", subject: "Subject", body: "Draft", cc: "cc@example.com", is_html: false }, context);
        expect(proposal).toHaveBeenCalledWith(expect.objectContaining({ to: ["one@example.com", "two@example.com"], cc: ["cc@example.com"], sendTool: "gmail_send" }), context);
    });
    it("routes legacy Outlook sending to confirmation instead of sending immediately", async () => {
        await MICROSOFT365_TOOLS.outlook_send_email.execute({ to: ["recipient@example.com"], subject: "Subject", body: "<b>Draft</b>", isHtml: true }, context);
        expect(proposal).toHaveBeenCalledWith(expect.objectContaining({ sendTool: "outlook_send_email", bodyFormat: "html", body: "<b>Draft</b>" }), context);
    });
});
