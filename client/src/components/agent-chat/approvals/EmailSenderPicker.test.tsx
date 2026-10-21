import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
const apiRequest = vi.hoisted(() => vi.fn());
vi.mock("@/lib/queryClient", () => ({ apiRequest }));
import { EmailSenderPicker } from "./EmailSenderPicker";
const accounts = [{ connectorId: 11, provider: "google", email: "google@example.com", scope: "organization" }, { connectorId: 12, provider: "microsoft", email: "office@example.com", scope: "project" }];
beforeEach(() => vi.clearAllMocks());
function show(preferredConnectorId: number | null = null, available = accounts) {
    const onChange = vi.fn();
    apiRequest.mockResolvedValue({ json: async () => ({ accounts: available, preferredConnectorId, unavailable: 0 }) });
    render(<EmailSenderPicker url="/api/approvals/99/email-accounts?organizationId=9" onChange={onChange} disabled={false} />);
    return onChange;
}
describe("authored email sender picker", () => {
    it("requires a choice and leaves remember unchecked by default", async () => {
        const change = show(); await screen.findByLabelText("Send from");
        expect(screen.getByLabelText("Send from")).toHaveValue("");
        expect(screen.getByRole("checkbox")).not.toBeChecked();
        expect(change).toHaveBeenLastCalledWith(null);
        expect(apiRequest.mock.calls.every(([method]) => method === "GET")).toBe(true);
    });
    it("confirms the exact account and offers opt-in saving without sending anything", async () => {
        const change = show(); await userEvent.selectOptions(await screen.findByLabelText("Send from"), "12");
        expect(change).toHaveBeenLastCalledWith({ connectorId: 12, email: "office@example.com", provider: "microsoft", remember: false });
        await userEvent.click(screen.getByRole("checkbox"));
        expect(change).toHaveBeenLastCalledWith({ connectorId: 12, email: "office@example.com", provider: "microsoft", remember: true });
        expect(apiRequest).toHaveBeenCalledOnce();
    });
    it("preselects a verified saved sender but keeps confirmation and saving explicit", async () => {
        const change = show(11); await waitFor(() => expect(screen.getByLabelText("Send from")).toHaveValue("11"));
        expect(change).toHaveBeenLastCalledWith({ connectorId: 11, email: "google@example.com", provider: "google", remember: false });
        expect(screen.getByText("You still confirm each email before it is sent.")).toBeInTheDocument();
    });
    it("does not offer AgentMail as a fallback when no account is connected", async () => {
        show(null, []); expect(await screen.findByRole("alert")).toHaveTextContent("AgentMail will not be used as a fallback");
        expect(screen.queryByLabelText("Send from")).not.toBeInTheDocument();
    });
    it("forgets the current user's saved sender through the authenticated org endpoint", async () => {
        const change = show(11); await userEvent.click(await screen.findByRole("button", { name: "Forget saved sender" }));
        expect(apiRequest).toHaveBeenCalledWith("DELETE", "/api/approvals/email-sender/preference?organizationId=9");
        await waitFor(() => expect(change).toHaveBeenLastCalledWith(null));
    });
});
