import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const apiRequest = vi.hoisted(() => vi.fn());
vi.mock("@/lib/queryClient", () => ({ apiRequest }));
vi.mock("@domain-ui/core/ui/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
import { OrgAgentMailSettings } from "./OrgAgentMailSettings";

function show() {
    return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><OrgAgentMailSettings organizationId={9} /></QueryClientProvider>);
}
beforeEach(() => vi.clearAllMocks());
describe("organization AgentMail settings", () => {
    it("hides connection management from members", async () => {
        apiRequest.mockResolvedValue({ json: async () => ({ configured: true, inboxId: "nine@agentmail.to", canManage: false }) });
        show();
        expect(await screen.findByText("Connected: nine@agentmail.to")).toBeInTheDocument();
        expect(screen.queryByLabelText("AgentMail API key")).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Disconnect" })).not.toBeInTheDocument();
    });
    it("connects for the displayed organization and clears the secret", async () => {
        apiRequest.mockResolvedValue({ json: async () => ({ configured: false, canManage: true }) });
        show();
        await userEvent.type(await screen.findByLabelText("AgentMail inbox ID"), "nine@agentmail.to");
        await userEvent.type(screen.getByLabelText("AgentMail API key"), "new-key");
        await userEvent.click(screen.getByRole("button", { name: "Verify and connect" }));
        await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("PUT", "/api/integrations/agentmail/connection?organizationId=9", { inboxId: "nine@agentmail.to", apiKey: "new-key" }));
        await waitFor(() => expect(screen.getByLabelText("AgentMail API key")).toHaveValue(""));
    });
    it("disconnects without submitting a key or sending an email", async () => {
        apiRequest.mockResolvedValue({ json: async () => ({ configured: true, inboxId: "nine@agentmail.to", canManage: true }) });
        show();
        await userEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
        await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("DELETE", "/api/integrations/agentmail/connection?organizationId=9", undefined));
    });
});
