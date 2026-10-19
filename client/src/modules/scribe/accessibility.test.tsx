/**
 * Scribe Studio, run through axe.
 *
 * The audit listed accessibility risks it could not confirm from screenshots —
 * icon-only controls without labels, and no announcements for autosave or audit
 * completion. Reading the markup would have been guessing, so this measures
 * instead, and keeps measuring.
 *
 * What it found, on the two states an author actually starts in: a branch
 * selector with no accessible name at all, a publish dialog whose close button
 * announced as "button", and two selects labelled only by a tooltip. Autosave
 * changed its text silently, so whether a save had landed was information only
 * a sighted author had.
 *
 * jsdom has no layout, so contrast and reflow cannot be judged here — those
 * need a real browser, and the audit said as much. This covers what static
 * markup can answer.
 */

import React from "react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import axe from "axe-core";
import { ScribeStudioPod } from "./ScribeStudioPod";

const view: any = {
    document: {
        id: 1,
        title: "Master Services Agreement",
        archetypeMode: "saas_msa",
        targetWordCount: 5000,
        settings: {},
    },
    nodes: [
        { id: 7, stationKey: "overview", title: "1. Overview", content: "The vendor accepts unlimited liability for all losses.", wordCount: 8, sortOrder: 1, targetPercentage: 0.5, status: "draft", updatedAt: "2026-08-29T09:00:00.000Z" },
        { id: 8, stationKey: "fees", title: "2. Fees", content: "The Annual Fee is £2.4M.", wordCount: 6, sortOrder: 2, targetPercentage: 0.5, status: "draft", updatedAt: "2026-08-29T09:00:00.000Z" },
    ],
    activeBranch: { id: 1, name: "Main", status: "active" },
    allBranches: [{ id: 1, name: "Main", status: "active" }],
    annotations: [
        { id: 9, nodeId: 7, lensType: "legal", severity: "critical_conflict", status: "open", title: "Uncapped liability", critiqueBody: "Unlimited exposure.", proposedDiff: null, paragraphAnchor: "unlimited liability" },
    ],
    telemetry: { completionPercentage: 20, totalWordCount: 14, targetWordCount: 5000, stationsComplete: 1, totalStations: 2, ekgPoints: [] },
};

const stub = (payload: unknown) =>
    vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } })),
    );

/** Contrast and reflow need a real browser; everything else is answerable here. */
const scan = (container: HTMLElement) =>
    axe.run(container, { rules: { "color-contrast": { enabled: false } } } as any) as unknown as Promise<{
        violations: Array<{ id: string; impact: string | null; nodes: unknown[] }>;
    }>;

const describeViolations = (violations: Array<{ id: string; impact: string | null }>) =>
    violations.map((v) => `${v.impact}: ${v.id}`).join(", ");

describe("the studio, as an author finds it", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("has no axe violations while drafting", async () => {
        stub(view);

        const { container } = render(<ScribeStudioPod documentId={1} />);
        await screen.findByTestId("scribe-telemetry-dock");

        const { violations } = await scan(container);
        expect(describeViolations(violations)).toBe("");
    }, 30_000);

    it("has none with the publish dialog open", async () => {
        // The dialog's close button announced as "button" and nothing else.
        stub(view);

        const { container } = render(<ScribeStudioPod documentId={1} />);
        fireEvent.click(await screen.findByRole("button", { name: /publish to project/i }));

        const { violations } = await scan(container);
        expect(describeViolations(violations)).toBe("");
    }, 30_000);

    it("has none on the entry canvas, before anything is written", async () => {
        const fresh = JSON.parse(JSON.stringify(view));
        fresh.nodes.forEach((n: any) => {
            n.content = "";
            n.wordCount = 0;
        });
        fresh.telemetry.totalWordCount = 0;
        stub(fresh);

        const { container } = render(<ScribeStudioPod documentId={1} />);
        await screen.findByTestId("scribe-warm-canvas");

        const { violations } = await scan(container);
        expect(describeViolations(violations)).toBe("");
    }, 30_000);
});

describe("controls that have to say what they are", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("names the branch selector", async () => {
        // It had no accessible name at all, so a screen reader announced the
        // current branch as the whole of what the control is.
        stub(view);

        render(<ScribeStudioPod documentId={1} />);

        expect(await screen.findByRole("combobox", { name: /branch/i })).toBeInTheDocument();
    });

    it("names the station status selector", async () => {
        stub(view);

        render(<ScribeStudioPod documentId={1} />);

        expect(await screen.findByRole("combobox", { name: /station status/i })).toBeInTheDocument();
    });

    it("names the export theme selector", async () => {
        stub(view);

        render(<ScribeStudioPod documentId={1} />);

        expect(await screen.findByRole("combobox", { name: /export theme/i })).toBeInTheDocument();
    });

    it("leaves no icon-only button unnamed", async () => {
        stub(view);

        const { container } = render(<ScribeStudioPod documentId={1} />);
        await screen.findByTestId("scribe-telemetry-dock");
        fireEvent.click(screen.getByRole("button", { name: /publish to project/i }));

        const unnamed = Array.from(container.querySelectorAll("button")).filter(
            (b) => !b.textContent?.trim() && !b.getAttribute("aria-label") && !b.getAttribute("title"),
        );

        expect(unnamed.map((b) => b.outerHTML.slice(0, 100))).toEqual([]);
    });
});

describe("what happens without being asked for", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("announces the save state rather than only showing it", async () => {
        // Autosave is the one thing that happens unprompted, and it changed its
        // text silently — so whether a save had landed was information only a
        // sighted author had.
        stub(view);

        render(<ScribeStudioPod documentId={1} />);

        const statuses = await screen.findAllByRole("status");

        // "No changes" is part of this vocabulary now: the footer used to render
        // a green "Synced" before anything had been saved, and after a failed
        // write. What must be announced is the real state, whichever it is.
        expect(
            statuses.some((el) => /synced|saving|no changes|not saved/i.test(el.textContent ?? "")),
        ).toBe(true);
    });

    it("announces politely, so it cannot cut across reading", async () => {
        stub(view);

        render(<ScribeStudioPod documentId={1} />);

        const statuses = await screen.findAllByRole("status");
        for (const el of statuses) {
            expect(el.getAttribute("aria-live")).toBe("polite");
        }
    });

    it("announces that a critic audit has finished", async () => {
        stub(view);

        render(<ScribeStudioPod documentId={1} />);

        const statuses = await screen.findAllByRole("status");
        expect(statuses.some((el) => /audit complete/i.test(el.textContent ?? ""))).toBe(true);
    });

    it("keeps the announcement out of the button's own name", async () => {
        // The first cut nested the live region inside the Audit button, so the
        // button announced as "Audit, Audit complete, 1 finding" — and its name
        // changed every time the findings did.
        stub(view);

        render(<ScribeStudioPod documentId={1} />);

        expect(await screen.findByRole("button", { name: /^audit$/i })).toBeInTheDocument();
    });
});
