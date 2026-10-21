import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
const apiRequest = vi.hoisted(() => vi.fn());
vi.mock("@/lib/queryClient", async original => ({ ...await original<any>(), apiRequest }));
import { InlineApprovalCard } from "./InlineApprovalCard";
const payload = { kind: "outbound_message", channel: "email", proposalId: 99, organizationId: 9, from: "unverified@example.com", to: ["recipient@example.com"], cc: ["cc@example.com"], bcc: ["bcc@example.com"], subject: "Hello", body: "Reviewed body", status: "pending" };
beforeEach(() => {
    vi.clearAllMocks();
    apiRequest.mockImplementation(async (method: string, url: string) => ({ json: async () => url.includes("email-accounts") ? { accounts: [{ connectorId: 11, provider: "google", email: "verified@example.com", scope: "organization" }], preferredConnectorId: null } : method === "POST" ? { outboundMessage: { sent: true, preferenceSaved: true } } : { status: "pending", toolArgs: payload } }));
});
describe("email approval sender and preference", () => {
    it("confirms the real sender and submits opt-in without changing the draft recipients", async () => {
        render(<InlineApprovalCard payload={payload} onArtifactSubmit={vi.fn()} currentUserId="u1" />);
        expect(screen.getByTestId("approve-proposal-button")).toBeDisabled();
        await userEvent.selectOptions(await screen.findByLabelText("Send from"), "11");
        expect(screen.getByText("verified@example.com")).toBeInTheDocument();
        expect(screen.queryByText("unverified@example.com")).not.toBeInTheDocument();
        expect(screen.getByText("bcc@example.com")).toBeInTheDocument();
        await userEvent.click(screen.getByRole("checkbox"));
        await userEvent.click(screen.getByTestId("approve-proposal-button"));
        await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("POST", "/api/approvals/99/decision?organizationId=9", { decision: "approved", modifiedOutput: { emailAccount: { connectorId: 11, provider: "google", email: "verified@example.com", remember: true } } }));
    });
    it("keeps notification mail on AgentMail and does not offer personal sender preferences", async () => {
        render(<InlineApprovalCard payload={{ ...payload, sendTool: "send_agentmail" }} onArtifactSubmit={vi.fn()} currentUserId="u1" />);
        expect(screen.queryByLabelText("Send from")).not.toBeInTheDocument();
        expect(screen.getByTestId("approve-proposal-button")).toBeEnabled();
        await userEvent.click(screen.getByTestId("approve-proposal-button"));
        await waitFor(() => expect(apiRequest.mock.calls.some(([method]) => method === "POST")).toBe(true));
        expect(apiRequest.mock.calls.some(([, url]) => url.includes("email-accounts"))).toBe(false);
    });
});
