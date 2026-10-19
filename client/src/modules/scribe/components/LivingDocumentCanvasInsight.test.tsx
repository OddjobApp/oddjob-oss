/**
 * How a live insight is attributed to whoever found it.
 *
 * The card's byline was a three-way ternary that sent everything other than
 * LegalSentinel and GhostWriter to "🔍 Critic". Tier 1 is a regex engine, so
 * every rule finding since Tier 1 shipped carried an AI critic's byline — the
 * precise claim the RuleEngine role exists to avoid making. And the Discuss
 * button offered "@RuleEngine", an agent that is not in the crew, while passing
 * a tag the handler prefixes again, producing "@@LegalSentinel".
 *
 * None of it throws, which is why it survived: it is all correct-looking text.
 */

import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LivingDocumentCanvas, type ScribeLiveInsight } from "./LivingDocumentCanvas";

const node = { id: 7, content: "The Annual Fee is £2.1M.", title: "Fees", sortOrder: 1 } as any;

const insight = (over: Partial<ScribeLiveInsight> = {}): ScribeLiveInsight => ({
    id: "figure_conflict:10",
    agentRole: "RuleEngine",
    lensType: "fact_check",
    type: "warning",
    title: "Annual Fee is stated as both £2.4M and £2.1M",
    message: "Earlier the document says £2.4M; here it says £2.1M.",
    originalExcerpt: "£2.1M",
    ...over,
});

const renderCanvas = (insights: ScribeLiveInsight[], onDiscuss?: any) =>
    render(
        <LivingDocumentCanvas
            activeNode={node}
            documentTitle="Agreement"
            onSaveContent={vi.fn()}
            liveInsights={insights}
            onDiscussWithCrew={onDiscuss}
        />,
    );

describe("attribution", () => {
    it("labels a rule finding as a rule, not as a critic", () => {
        renderCanvas([insight()]);

        // The exact badge text, not a loose /Critic/ — the canvas footer names
        // the listening agents too, and matching that would pass either way.
        expect(screen.getByText("◆ Rule")).toBeInTheDocument();
        expect(screen.queryByText("🔍 Critic")).not.toBeInTheDocument();
    });

    it("still names the agents that really did review the clause", () => {
        renderCanvas([insight({ agentRole: "LegalSentinel" })]);
        expect(screen.getByText("⚖️ Legal Sentinel")).toBeInTheDocument();
    });

    it("gives the copy editor its own byline instead of the critic's", () => {
        renderCanvas([insight({ agentRole: "CopyEditor" })]);

        expect(screen.getByText("✏️ Copy Editor")).toBeInTheDocument();
        expect(screen.queryByText("🔍 Critic")).not.toBeInTheDocument();
    });
});

describe("discussing a finding", () => {
    it("opens with the room for a rule, since there is no @RuleEngine agent", async () => {
        const onDiscuss = vi.fn();
        renderCanvas([insight()], onDiscuss);

        await userEvent.click(screen.getByRole("button", { name: /Discuss with/ }));

        // undefined, not "RuleEngine": the handler falls back to @Crew.
        expect(onDiscuss).toHaveBeenCalledWith("£2.1M", undefined);
    });

    it("does not offer to mention an agent that is not in the crew", () => {
        renderCanvas([insight()], vi.fn());
        expect(screen.queryByText(/@RuleEngine/)).not.toBeInTheDocument();
    });

    it("passes a real agent's handle without an @, which the handler adds", async () => {
        const onDiscuss = vi.fn();
        renderCanvas([insight({ agentRole: "LegalSentinel" })], onDiscuss);

        await userEvent.click(screen.getByRole("button", { name: /Discuss with/ }));

        // "@LegalSentinel" here becomes "@@LegalSentinel" in the prompt.
        expect(onDiscuss).toHaveBeenCalledWith("£2.1M", "LegalSentinel");
    });
});
