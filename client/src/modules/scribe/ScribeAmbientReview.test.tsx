/**
 * Tier 1 ambient review, from keystroke to gutter.
 *
 * The canvas already had the UI for this — insight state, an apply handler, a
 * 500ms delta timer — but nothing ever passed onStreamDelta, so the whole path
 * was inert. And the shape the canvas renders is not the shape the server
 * sends. Both halves are what these tests hold.
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ScribeStudioPod } from "./ScribeStudioPod";

const view = {
    document: { id: 5, title: "MSA", archetypeMode: "saas_msa", targetWordCount: 5000, currentRevision: 1 },
    nodes: [
        {
            id: 11,
            stationKey: "liability",
            title: "Liability",
            content: "Vendor shall respond within four business hours.",
            wordCount: 7,
            sortOrder: 1,
            targetPercentage: 1,
            status: "draft",
        },
    ],
    activeBranch: { id: 1, name: "Main", branchKey: "main", status: "active" },
    allBranches: [{ id: 1, name: "Main", branchKey: "main", status: "active" }],
    annotations: [],
    entityLedger: [],
    telemetry: {
        completionPercentage: 0, totalWordCount: 7, targetWordCount: 5000,
        stationsComplete: 0, totalStations: 1, ekgPoints: [],
    },
};

/** One finding, in the wire shape the server actually returns. */
const vagueObligation = {
    ruleId: "vague_obligation",
    lensType: "legal",
    severity: "warning",
    title: "Unmeasurable obligation",
    detail: "This commits to a standard nobody can test.",
    start: 20,
    end: 28,
    excerpt: "promptly",
};

function harness(insights: unknown[] = [vagueObligation], ok = true) {
    const calls: Array<{ url: string; body: any }> = [];
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
        const body = options?.body ? JSON.parse(String(options.body)) : null;
        calls.push({ url: String(url), body });

        if (String(url).includes("/api/scribe/deltas")) {
            if (!ok) return new Response("nope", { status: 500 });
            return new Response(JSON.stringify({ insights, severity: "warning", published: true }), {
                status: 200, headers: { "content-type": "application/json" },
            });
        }
        return new Response(JSON.stringify(view), {
            status: 200, headers: { "content-type": "application/json" },
        });
    });
    vi.stubGlobal("fetch", fetchMock);
    return calls;
}

const type = async (text: string) => {
    const box = await screen.findByRole("textbox");
    fireEvent.change(box, { target: { value: text } });
};

describe("ambient review wiring", () => {
    beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it("posts the station text to the delta endpoint as the author types", async () => {
        const calls = harness();
        render(<ScribeStudioPod documentId={5} />);
        await type("Vendor shall respond promptly to each request.");

        await vi.advanceTimersByTimeAsync(600);

        await waitFor(() => {
            const delta = calls.find((c) => c.url.includes("/api/scribe/deltas"));
            expect(delta, "no delta was posted").toBeDefined();
            expect(delta!.body.documentId).toBe(5);
            expect(delta!.body.nodeId).toBe(11);
            expect(delta!.body.text).toContain("promptly");
        });
    });

    it("tells the server what it is already showing, so it broadcasts only on change", async () => {
        const calls = harness();
        render(<ScribeStudioPod documentId={5} />);

        await type("Vendor shall respond promptly.");
        await vi.advanceTimersByTimeAsync(600);
        await waitFor(() => expect(calls.some((c) => c.url.includes("deltas"))).toBe(true));

        await type("Vendor shall respond promptly today.");
        await vi.advanceTimersByTimeAsync(600);

        await waitFor(() => {
            const deltas = calls.filter((c) => c.url.includes("deltas"));
            expect(deltas.length).toBeGreaterThanOrEqual(2);
            // The second call carries the first call's findings.
            expect(deltas[1].body.previous).toEqual([vagueObligation]);
        });
    });

    it("renders the finding as a gutter marker the author can read", async () => {
        harness();
        render(<ScribeStudioPod documentId={5} />);
        await type("Vendor shall respond promptly to each request.");

        await vi.advanceTimersByTimeAsync(600);

        // The server's `detail` becomes the canvas's `message`; if the adapter
        // dropped a field this is what would go blank.
        await waitFor(() => {
            expect(screen.getByText(/Unmeasurable obligation/i)).toBeInTheDocument();
        });
    });

    it("keeps typing working when ambient review fails", async () => {
        harness([], false);
        render(<ScribeStudioPod documentId={5} />);
        await type("Vendor shall respond promptly.");

        await vi.advanceTimersByTimeAsync(600);

        // Advisory: a 500 must not surface as a document error or block the
        // editor. The text the author typed is still there.
        await waitFor(() => {
            expect(screen.getByRole("textbox")).toHaveValue("Vendor shall respond promptly.");
        });
        expect(screen.queryByText(/ambient review failed/i)).not.toBeInTheDocument();
    });

    it("does not post a delta before the author touches anything", async () => {
        const calls = harness();
        render(<ScribeStudioPod documentId={5} />);
        await screen.findByRole("textbox");

        await vi.advanceTimersByTimeAsync(2000);

        // Loading a document is not an edit.
        expect(calls.filter((c) => c.url.includes("deltas"))).toHaveLength(0);
    });
});
