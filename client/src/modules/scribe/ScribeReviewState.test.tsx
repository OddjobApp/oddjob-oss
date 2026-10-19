import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ScribeStudioPod } from "./ScribeStudioPod";

/**
 * Applying a critic's fix, and what the review state does afterwards.
 *
 * Two faults sat in handleApplyDiff. It never touched the annotation, so a
 * critique stayed open after the author had acted on it — which made the
 * gallery's "N / M done" count everything except the work actually done. And it
 * returned silently on three conditions, the important one being an anchor that
 * no longer matches the text: exactly the case where the passage moved under the
 * critique, where the author pressed Apply and was told nothing at all.
 */
const STATION = "Clause 1. The parties shall agree. And more text that must survive.";
const ANCHOR = "The parties shall agree.";

const view = (annotation: Record<string, unknown> = {}) => ({
    document: {
        id: 1,
        title: "Agreement",
        archetypeMode: "freeform",
        targetWordCount: 1000,
        currentRevision: 1,
        settings: {} as Record<string, unknown>,
    },
    nodes: [
        {
            id: 7,
            documentId: 1,
            stationKey: "overview",
            title: "Overview",
            content: STATION,
            wordCount: 12,
            sortOrder: 1,
            targetPercentage: 1,
            status: "draft",
        },
    ],
    activeBranch: { id: 1, name: "Main", status: "active" },
    allBranches: [{ id: 1, name: "Main", status: "active" }],
    annotations: [
        {
            id: 9,
            nodeId: 7,
            lensType: "legal",
            severity: "suggestion",
            status: "open",
            title: "Use active voice",
            critiqueBody: "Rewrite it.",
            proposedDiff: "The parties agree.",
            paragraphAnchor: ANCHOR,
            ...annotation,
        },
    ],
    telemetry: {
        completionPercentage: 0,
        totalWordCount: 12,
        targetWordCount: 1000,
        stationsComplete: 0,
        totalStations: 1,
        ekgPoints: [],
    },
});

let calls: Array<{ url: string; method: string; body?: any }>;

function stub(docView: any, opts: { patchFails?: boolean } = {}) {
    calls = [];
    const fetchMock = vi.fn(async (input: any, options?: RequestInit) => {
        const url = typeof input === "string" ? input : String(input?.url ?? "");
        const method = options?.method ?? "GET";
        calls.push({ url, method, body: options?.body ? JSON.parse(String(options.body)) : undefined });
        const json = (d: unknown, status = 200) =>
            new Response(JSON.stringify(d), { status, headers: { "content-type": "application/json" } });

        if (method === "PATCH" && url.includes("/annotations/")) {
            if (opts.patchFails) return json({ error: "nope" }, 500);
            return json({ ...docView.annotations[0], status: "resolved" });
        }
        if (method === "POST" && url.includes("/nodes/")) {
            const body = JSON.parse(String(options!.body));
            return json({ ...docView.nodes[0], content: body.content });
        }
        return json(docView);
    });
    vi.stubGlobal("fetch", fetchMock);
}

afterEach(() => vi.unstubAllGlobals());

const clickApply = async () => {
    const btn = await screen.findByRole("button", { name: /apply proposed fix/i });
    fireEvent.click(btn);
};

describe("applying a critic's proposed fix", () => {
    it("writes the replacement and resolves the finding it came from", async () => {
        stub(view());
        render(<ScribeStudioPod documentId={1} />);
        await clickApply();

        await waitFor(() => {
            const save = calls.find((c) => c.method === "POST" && c.url.includes("/nodes/7"));
            expect(save?.body.content).toBe("Clause 1. The parties agree. And more text that must survive.");
        });

        // The half that was missing: the critique is closed, so "N / M done"
        // finally counts the work the author actually did.
        await waitFor(() => {
            const patch = calls.find((c) => c.method === "PATCH" && c.url.includes("/annotations/9"));
            expect(patch?.body).toEqual({ status: "resolved" });
        });
    });

    it("hides Apply entirely once the passage has moved", async () => {
        // markStaleness derives this on every render, so a critique whose anchor
        // is no longer in the text never offers the button. The guard inside
        // handleApplyDiff is therefore defensive rather than a path an author
        // reaches from here — worth keeping, not worth claiming as a fix.
        stub(view({ paragraphAnchor: "A sentence that is no longer there." }));
        render(<ScribeStudioPod documentId={1} />);

        await screen.findByText(/use active voice/i);
        expect(screen.queryByRole("button", { name: /apply proposed fix/i })).not.toBeInTheDocument();
    });

    it("leaves the finding open when the write fails", async () => {
        // Resolving a critique whose fix never saved would be the same lie in
        // the other direction. This also covers a 500 carrying a JSON body,
        // which res.json() parses happily — handleSaveContent used to spread
        // that error object into the document as if it were the saved node.
        stub(view());
        const base = view();
        vi.stubGlobal(
            "fetch",
            vi.fn(async (input: any, options?: RequestInit) => {
                const url = typeof input === "string" ? input : String(input?.url ?? "");
                const method = options?.method ?? "GET";
                if (method === "POST" && url.includes("/nodes/")) {
                    return new Response(JSON.stringify({ error: "Storage quota exceeded" }), {
                        status: 500,
                        headers: { "content-type": "application/json" },
                    });
                }
                if (method === "PATCH") throw new Error("must not resolve a finding whose fix failed");
                return new Response(JSON.stringify(base), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                });
            }),
        );

        render(<ScribeStudioPod documentId={1} />);
        await clickApply();

        expect(await screen.findByText(/storage quota exceeded/i)).toBeInTheDocument();
    });
});

describe("toggling review state", () => {
    it("reports a failure rather than leaving the gallery disagreeing with the server", async () => {
        stub(view(), { patchFails: true });
        render(<ScribeStudioPod documentId={1} />);

        const toggle = await screen.findByRole("button", { name: /mark this critique resolved/i });
        fireEvent.click(toggle);

        await waitFor(() =>
            expect(screen.getByText(/nope/i)).toBeInTheDocument(),
        );
    });
});
