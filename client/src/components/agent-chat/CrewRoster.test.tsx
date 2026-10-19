import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { CrewRoster, isCopilotCard } from "./CrewRoster";

/**
 * Characterization tests for a component lifted out of AgentChatPanel.
 *
 * AgentChatPanel went from 5,244 lines to 2,492 in one pass, with 2,713 lines
 * moved into seven new components. The existing suite covered that behaviour
 * only indirectly, by driving the whole panel, which is enough to show the
 * extraction preserved behaviour but not enough to keep it preserved: a later
 * change to one of these components can move its behaviour without any
 * panel-level test noticing, because the panel test asserts an outcome three
 * layers away from the code that produced it.
 *
 * So these describe the components as they are now, at their own boundary. They
 * are deliberately about observable behaviour — what renders, what a click
 * emits — and not about internals, because the point is to survive the next
 * refactor rather than to pin its shape.
 */
const agent = (id: number, name: string, personaType = "analyst") =>
    ({ id, name, personaType, description: `${name} description` }) as any;

describe("CrewRoster", () => {
    it("renders one selectable entry per agent", () => {
        render(
            <CrewRoster
                agents={[agent(1, "Analyst"), agent(2, "Media Creator")]}
                selectedIds={[]}
                onToggle={vi.fn()}
                isLoading={false}
            />,
        );

        expect(screen.getByText("Analyst")).toBeInTheDocument();
        expect(screen.getByText("Media Creator")).toBeInTheDocument();
    });

    it("reports which agent was toggled, by id", () => {
        const onToggle = vi.fn();
        render(
            <CrewRoster
                agents={[agent(1, "Analyst"), agent(2, "Media Creator")]}
                selectedIds={[]}
                onToggle={onToggle}
                isLoading={false}
            />,
        );

        fireEvent.click(screen.getByText("Media Creator"));
        expect(onToggle).toHaveBeenCalledWith(2);
    });

    it("renders a selected agent differently from the same agent unselected", () => {
        // The same agent either way, so sorting cannot account for the
        // difference, and the assertion does not pin which styling is used.
        const props = { agents: [agent(1, "Analyst")], onToggle: vi.fn(), isLoading: false };

        const { container: unselected } = render(<CrewRoster {...props} selectedIds={[]} />);
        const off = unselected.querySelector('[data-testid="crew-roster"]')!.innerHTML;

        const { container: selected } = render(<CrewRoster {...props} selectedIds={[1]} />);
        const on = selected.querySelector('[data-testid="crew-roster"]')!.innerHTML;

        expect(on).not.toBe(off);
    });

    it("shows placeholders while loading, and no agents", () => {
        render(<CrewRoster agents={[agent(1, "Analyst")]} selectedIds={[]} onToggle={vi.fn()} isLoading />);

        expect(screen.getByTestId("crew-roster")).toBeInTheDocument();
        // The roster must not render a half-loaded list.
        expect(screen.queryByText("Analyst")).not.toBeInTheDocument();
    });

    it("says so when the organization has no agents", () => {
        render(<CrewRoster agents={[]} selectedIds={[]} onToggle={vi.fn()} isLoading={false} />);

        // A distinct element, not an empty roster: "no agents" and "agents not
        // loaded yet" are different states and the component keeps them apart.
        expect(screen.getByTestId("crew-roster-empty")).toBeInTheDocument();
        expect(screen.queryByTestId("crew-roster")).not.toBeInTheDocument();
    });

    it("orders the roster selected first, then the Copilot, then alphabetically", () => {
        // Found by reading the component rather than the panel tests, which
        // never asserted order. It is the kind of rule a later refactor drops
        // without anything failing.
        render(
            <CrewRoster
                agents={[
                    agent(1, "Zeta"),
                    agent(2, "Alpha"),
                    agent(3, "Copilot", "copilot"),
                    agent(4, "Chosen"),
                ]}
                selectedIds={[4]}
                onToggle={vi.fn()}
                isLoading={false}
            />,
        );

        const roster = screen.getByTestId("crew-roster");
        const order = within(roster)
            .getAllByText(/^(Zeta|Alpha|Copilot|Chosen)$/)
            .map((e) => e.textContent);

        expect(order).toEqual(["Chosen", "Copilot", "Alpha", "Zeta"]);
    });
});

describe("isCopilotCard", () => {
    it("identifies the Copilot by persona type", () => {
        // The Copilot is not just another specialist — the room's default
        // selection depends on telling it apart.
        expect(isCopilotCard({ personaType: "copilot" })).toBe(true);
    });

    it("treats every other persona as a specialist", () => {
        expect(isCopilotCard({ personaType: "analyst" })).toBe(false);
        expect(isCopilotCard({ personaType: "ghostwriter" })).toBe(false);
        expect(isCopilotCard({})).toBe(false);
    });
});
