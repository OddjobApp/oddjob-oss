import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Header } from "../Header";

vi.mock("wouter", () => ({
    useLocation: () => ["/dashboard", vi.fn()],
    useSearch: () => "",
    Link: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

vi.mock("@domain-ui/core/ui/components/ui/sidebar", () => ({
    SidebarTrigger: () => <button data-testid="sidebar-trigger" />,
}));

vi.mock("../NotificationInbox.js", () => ({
    NotificationInbox: () => <div data-testid="notification-inbox" />,
}));

vi.mock("../HeaderMissionTicker.js", () => ({
    HeaderMissionTicker: () => <div data-testid="header-mission-ticker" />,
}));

vi.mock("../../stores/decision.store", () => ({
    useDecisionStore: (selector: any) => selector({ pendingCount: 0 }),
}));

describe("Header Copilot Assistant Button", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("renders the copilot assistant button with correct initial aria state", () => {
        render(
            <Header
                title="Dashboard"
                breadcrumbs={["Home"]}
                isAssistantOpen={false}
            />
        );

        const button = screen.getByTestId("copilot-header-button");
        expect(button).toBeInTheDocument();
        expect(button).toHaveAttribute("aria-expanded", "false");
        expect(button).toHaveAttribute("title", "Open Oddjob Assistant");
    });

    it("reflects open state with aria-expanded=true and close title", () => {
        render(
            <Header
                title="Dashboard"
                breadcrumbs={["Home"]}
                isAssistantOpen={true}
            />
        );

        const button = screen.getByTestId("copilot-header-button");
        expect(button).toHaveAttribute("aria-expanded", "true");
        expect(button).toHaveAttribute("title", "Close Oddjob Assistant");
    });

    it("calls onToggleAssistant when clicked", () => {
        const handleToggle = vi.fn();
        render(
            <Header
                title="Dashboard"
                breadcrumbs={["Home"]}
                isAssistantOpen={false}
                onToggleAssistant={handleToggle}
            />
        );

        const button = screen.getByTestId("copilot-header-button");
        fireEvent.click(button);

        expect(handleToggle).toHaveBeenCalledTimes(1);
    });

    it("dispatches agent-assist-request event with toggle=true when no direct handler is provided", () => {
        const eventListener = vi.fn();
        window.addEventListener("agent-assist-request", eventListener);

        render(
            <Header
                title="Dashboard"
                breadcrumbs={["Home"]}
                isAssistantOpen={false}
            />
        );

        const button = screen.getByTestId("copilot-header-button");
        fireEvent.click(button);

        expect(eventListener).toHaveBeenCalledTimes(1);
        const event = eventListener.mock.calls[0][0] as CustomEvent;
        expect(event.detail?.toggle).toBe(true);

        window.removeEventListener("agent-assist-request", eventListener);
    });
});
