/**
 * The critic pass, end to end from the gallery button to the annotation list.
 *
 * Both halves of this have now been wrong at different times, and neither
 * failure was visible: the pod called a route that does not exist, and it read
 * the response as a bare array when the route answers `{ annotations }`. Each
 * on its own leaves the gallery empty with nothing logged to the user, so the
 * two things worth pinning are the exact URL and the envelope shape.
 */

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ScribeStudioPod } from "./ScribeStudioPod";

const view = {
    document: { id: 1, title: "Agreement", archetypeMode: "freeform", targetWordCount: 1000 },
    nodes: [
        {
            id: 7,
            stationKey: "overview",
            title: "Overview",
            content: "The indemnity is uncapped and survives termination indefinitely.",
            wordCount: 9,
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
        completionPercentage: 0,
        totalWordCount: 9,
        targetWordCount: 1000,
        stationsComplete: 0,
        totalStations: 1,
        ekgPoints: [],
    },
};

const freshAnnotation = {
    id: 41,
    nodeId: 7,
    lensType: "legal",
    severity: "warning",
    title: "Uncapped indemnity",
    critiqueBody: "Liability has no ceiling.",
    proposedDiff: null,
    status: "open",
};

/** Records every request so the URL under test can be asserted directly. */
function harness(criticResponse: unknown, status = 200) {
    const calls: Array<{ url: string; method?: string }> = [];
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
        calls.push({ url, method: options?.method });
        if (String(url).includes("/critics/") || String(url).includes("/critic/")) {
            return new Response(JSON.stringify(criticResponse), {
                status,
                headers: { "content-type": "application/json" },
            });
        }
        return new Response(JSON.stringify(view), {
            status: 200,
            headers: { "content-type": "application/json" },
        });
    });
    vi.stubGlobal("fetch", fetchMock);
    return calls;
}

/** The critic gallery's own Audit button, not the whole-manuscript one. */
const runCriticPass = async () => {
    const button = await screen.findByRole("button", { name: /^audit$/i });
    fireEvent.click(button);
};

describe("scribe critic pass", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("calls the route the server actually serves", async () => {
        const calls = harness({ annotations: [freshAnnotation] });
        render(<ScribeStudioPod documentId={1} />);
        await screen.findByDisplayValue(/uncapped/i);

        await runCriticPass();

        await waitFor(() => {
            const critic = calls.find((c) => c.url.includes("critic"));
            expect(critic, "no critic request was made").toBeDefined();
            // /critic/pass 404s. The route is /critics/evaluate.
            expect(critic!.url).toBe("/api/scribe/critics/evaluate");
            expect(critic!.method).toBe("POST");
        });
    });

    it("unwraps the { annotations } envelope onto the gallery", async () => {
        harness({ annotations: [freshAnnotation] });
        render(<ScribeStudioPod documentId={1} />);
        await screen.findByDisplayValue(/uncapped/i);

        await runCriticPass();

        // Reading the envelope as an array put an object into the list and the
        // gallery rendered nothing at all.
        await waitFor(() => {
            expect(screen.getByText("Uncapped indemnity")).toBeInTheDocument();
        });
    });

    it("sends each custom lens its definition, not just its name", async () => {
        const calls: Array<{ url: string; body: any }> = [];
        vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
            calls.push({ url, body: options?.body ? JSON.parse(String(options.body)) : null });
            if (String(url).includes("critic")) {
                return new Response(JSON.stringify({ annotations: [] }), {
                    status: 200, headers: { "content-type": "application/json" },
                });
            }
            return new Response(JSON.stringify(view), {
                status: 200, headers: { "content-type": "application/json" },
            });
        }));

        render(<ScribeStudioPod documentId={1} />);
        await screen.findByDisplayValue(/uncapped/i);
        await runCriticPass();

        await waitFor(() => {
            const critic = calls.find((c) => c.url.includes("critic"));
            expect(critic).toBeDefined();
            // The server only has criteria for the built-in lenses. Sending a
            // bare id asks the model to review in a lens it has no definition
            // for, and silently discards what the author typed.
            const defs = critic!.body.lensDefinitions ?? [];
            expect(defs.length, "no lens definitions were sent").toBeGreaterThan(0);
            for (const d of defs) {
                expect(critic!.body.lenses).toContain(d.id);
                expect(d.description, `lens ${d.id} was sent with no description`).toBeTruthy();
            }
        });
    });

    it("surfaces a failed critic pass instead of going quiet", async () => {
        harness({ error: "critic unavailable" }, 500);
        render(<ScribeStudioPod documentId={1} />);
        await screen.findByDisplayValue(/uncapped/i);

        await runCriticPass();

        await waitFor(() => {
            expect(screen.getByText(/critic pass failed|HTTP 500/i)).toBeInTheDocument();
        });
    });
});
