import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const apiRequest = vi.hoisted(() => vi.fn());
vi.mock("@/lib/queryClient", () => ({ apiRequest }));
import { RoomAgentMailSettings } from "./RoomAgentMailSettings";
async function show(data: unknown) {
    apiRequest.mockResolvedValue({ json: async () => data });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RoomAgentMailSettings organizationId={9} sessionKey="room-a" /></QueryClientProvider>);
    await userEvent.click(screen.getByRole("button", { name: "Integrations" }));
}
beforeEach(() => vi.clearAllMocks());
describe("Room Integrations mailbox", () => {
    it("shows members the mailbox without credential or assignment controls", async () => {
        await show({ configured: true, inboxId: "room-a@agentmail.to", organizationConnected: true, canManage: false });
        expect(await screen.findByText("Connected: room-a@agentmail.to")).toBeInTheDocument();
        expect(screen.queryByLabelText("Inbox ID")).not.toBeInTheDocument();
    });
    it("asks administrators to connect the organization first", async () => {
        await show({ configured: false, organizationConnected: false, canManage: true });
        expect(await screen.findByRole("link", { name: "Organization Settings" })).toHaveAttribute("href", "/settings?orgId=9");
        expect(screen.queryByLabelText("Inbox ID")).not.toBeInTheDocument();
    });
    it("assigns only after an explicit submit, without accepting an API key", async () => {
        await show({ configured: false, organizationConnected: true, canManage: true });
        await userEvent.type(await screen.findByLabelText("Inbox ID"), "room-a@agentmail.to");
        expect(apiRequest.mock.calls.every(([method]) => method === "GET")).toBe(true);
        await userEvent.click(screen.getByRole("button", { name: "Verify and assign" }));
        await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("PUT", "/api/crew/room-a/integrations/agentmail?organizationId=9", { inboxId: "room-a@agentmail.to" }));
        expect(document.querySelector('input[type="password"]')).toBeNull();
    });
});
