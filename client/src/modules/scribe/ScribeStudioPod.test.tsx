import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ScribeStudioPod } from "./ScribeStudioPod";

const STATION = "Original sentence. And more text that must survive.";

const viewWith = (annotation: Record<string, unknown>, content = STATION) => ({
    document: { id: 1, title: "Agreement", archetypeMode: "freeform", targetWordCount: 1000, currentRevision: 1, settings: {} as Record<string, unknown> },
    nodes: [{ id: 7, stationKey: "overview", title: "Overview", content, wordCount: 8, sortOrder: 1, targetPercentage: 1, status: "draft" }],
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
            critiqueBody: "Replace the sentence",
            proposedDiff: "Active proposed replacement",
            ...annotation,
        },
    ],
    telemetry: { completionPercentage: 0, totalWordCount: 8, targetWordCount: 1000, stationsComplete: 0, totalStations: 1, ekgPoints: [] },
});

const stubFetch = (view: ReturnType<typeof viewWith>) => {
    const fetchMock = vi.fn(async (_url: string, options?: RequestInit) => {
        if (options?.method === "POST") {
            // POST /nodes/:id answers with the updated node, not an ack — and
            // the server recounts the words on the way through, which the
            // footer depends on. Echoing the old count made the mock lie.
            const body = JSON.parse(String(options.body));
            const content = String(body.content ?? "");
            return new Response(
                JSON.stringify({
                    ...view.nodes[0],
                    content,
                    wordCount: content.trim().split(/\s+/).filter(Boolean).length,
                }),
                { status: 200, headers: { "content-type": "application/json" } },
            );
        }
        return new Response(JSON.stringify(view), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
};

describe("applying a proposed fix", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("replaces the anchored passage and leaves the rest of the station alone", async () => {
        // This used to save proposedDiff as the station's entire content. The
        // critic is asked for replacement text for the excerpt — a clause, not a
        // section — so one click wiped the author's draft, with no confirmation
        // and no undo, since the gallery bypasses the canvas snapshot history.
        const view = viewWith({ paragraphAnchor: "Original sentence" });
        const fetchMock = stubFetch(view);

        render(<ScribeStudioPod documentId={1} />);

        await screen.findByDisplayValue(STATION);
        fireEvent.click(screen.getByRole("button", { name: /apply proposed fix/i }));

        const expected = "Active proposed replacement. And more text that must survive.";
        await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue(expected));
        expect(fetchMock).toHaveBeenCalledWith("/api/scribe/nodes/7", expect.objectContaining({
            method: "POST",
            body: JSON.stringify({ content: expected }),
        }));
    });

    it("does not offer to apply a fix that has nowhere to go", async () => {
        // An unanchored critique is "about the section as a whole". There is no
        // way to place a replacement, and guessing meant overwriting everything.
        stubFetch(viewWith({ paragraphAnchor: null }));

        render(<ScribeStudioPod documentId={1} />);

        await screen.findByDisplayValue(STATION);
        expect(screen.queryByRole("button", { name: /apply proposed fix/i })).not.toBeInTheDocument();
    });

    it("does not offer to apply a fix for text that has changed", async () => {
        // The anchor is not in the station, so the critique is about a passage
        // the author already rewrote.
        stubFetch(viewWith({ paragraphAnchor: "a phrase that was deleted" }));

        render(<ScribeStudioPod documentId={1} />);

        await screen.findByDisplayValue(STATION);
        expect(screen.queryByRole("button", { name: /apply proposed fix/i })).not.toBeInTheDocument();
    });
});

describe("critiques that outlived their text", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("says a critique is outdated rather than presenting it as live", async () => {
        stubFetch(viewWith({ paragraphAnchor: "a phrase that was deleted", severity: "critical_conflict" }));

        render(<ScribeStudioPod documentId={1} />);

        expect(await screen.findByTestId("annotation-stale")).toHaveTextContent(/has changed/i);
    });

    it("keeps it out of the Health Index and says how many it left out", async () => {
        stubFetch(viewWith({ paragraphAnchor: "a phrase that was deleted", severity: "critical_conflict" }));

        render(<ScribeStudioPod documentId={1} />);

        // The one critical finding is about deleted text, so the document is
        // clean. Counting it meant an author who fixed a clause watched the
        // score refuse to move.
        expect(await screen.findByText(/100% Clean/)).toBeInTheDocument();
        expect(screen.queryByText(/1 critical/)).not.toBeInTheDocument();
        expect(screen.getByTestId("stale-excluded-count")).toHaveTextContent("1 outdated");
    });

    it("still counts a critique whose passage is untouched", async () => {
        stubFetch(viewWith({ paragraphAnchor: "Original sentence", severity: "critical_conflict" }));

        render(<ScribeStudioPod documentId={1} />);

        expect(await screen.findByText(/1 critical/)).toBeInTheDocument();
        expect(screen.queryByTestId("annotation-stale")).not.toBeInTheDocument();
        expect(screen.queryByTestId("stale-excluded-count")).not.toBeInTheDocument();
    });
});

describe("a critique going stale during the session", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("marks a critique outdated as soon as the text moves under it, without a reload", async () => {
        // The audit's actual observation: critiques referencing text that had
        // already been replaced. The server marks staleness when it builds the
        // payload, but the author edits after that and the pod updates node
        // content locally — so a payload flag is wrong from the first keystroke.
        // This is why the pod re-derives rather than trusting what it was sent.
        const view = viewWith({ id: 9, paragraphAnchor: "Original sentence" });
        view.annotations.push({
            id: 10,
            nodeId: 7,
            lensType: "stylistic",
            severity: "warning",
            status: "open",
            title: "Tighten this",
            critiqueBody: "Too wordy",
            proposedDiff: null,
            paragraphAnchor: "Original sentence",
        } as any);
        stubFetch(view);

        render(<ScribeStudioPod documentId={1} />);

        await screen.findByDisplayValue(STATION);
        expect(screen.queryByTestId("annotation-stale")).not.toBeInTheDocument();

        // Rewrite the passage both critiques point at.
        fireEvent.click(screen.getByRole("button", { name: /apply proposed fix/i }));

        await waitFor(() =>
            expect(screen.getByRole("textbox")).toHaveValue(
                "Active proposed replacement. And more text that must survive.",
            ),
        );
        // Both critiques are now about a sentence that is gone, but they are
        // retired by different means, and the difference is the point.
        //
        // The one whose fix was applied is RESOLVED: handleApplyDiff now closes
        // the finding it acted on, which persists and survives a reload. It used
        // to be retired only by staleness — a client-side derivation that came
        // back as an open critique the next time the document loaded, and left
        // the gallery counting everything except the work actually done.
        //
        // The second one is merely stale: nobody acted on it, so it is still
        // open, just no longer anchored. A resolved critique does not render the
        // stale badge, hence one rather than two.
        await waitFor(() => expect(screen.getAllByTestId("annotation-stale")).toHaveLength(1));
        expect(screen.getByTestId("stale-excluded-count")).toHaveTextContent("1 outdated");
    });
});

describe("the progress footer", () => {
    afterEach(() => vi.unstubAllGlobals());

    /** A document whose telemetry payload is deliberately out of date. */
    const staleTelemetryView = () => {
        const view = viewWith({ paragraphAnchor: "Original sentence" });
        // What the server computed when the page loaded: nothing written yet.
        view.telemetry = {
            completionPercentage: 0,
            totalWordCount: 0,
            targetWordCount: 5000,
            stationsComplete: 0,
            totalStations: 1,
            ekgPoints: [],
        } as any;
        view.document.targetWordCount = 5000;
        view.nodes[0].wordCount = 8;
        return view;
    };

    /** Scoped to the dock: the figures appear in nested spans. */
    const dockText = async () => (await screen.findByTestId("scribe-telemetry-dock")).textContent ?? "";

    it("reports the document as it stands, not as the payload found it", async () => {
        // The audit's finding: an author filled three stations and the footer
        // sat at its page-load figures until publishing forced a reload. The
        // payload here says 0 words and 0 stations done; the nodes say 8 words.
        stubFetch(staleTelemetryView());

        render(<ScribeStudioPod documentId={1} />);

        expect(await dockText()).toContain("8 / 5000w");
        expect(await dockText()).toContain("1 / 1 Done");
    });

    it("moves as the author writes, with no reload", async () => {
        stubFetch(staleTelemetryView());

        render(<ScribeStudioPod documentId={1} />);
        expect(await dockText()).toContain("8 / 5000w");

        // Applying a fix rewrites the station; the POST answers with the node
        // the server recounted, and the footer must follow without a reload.
        fireEvent.click(screen.getByRole("button", { name: /apply proposed fix/i }));

        await waitFor(async () => expect(await dockText()).toContain("9 / 5000w"));
    });

    it("does not count a station that only holds its seeded scaffolding", async () => {
        // Stations are created with the framework's suggestedScaffolding as
        // their content, and 18 of the 21 scaffolding strings are longer than
        // the 100 characters that used to mean "complete" — so a document
        // reported its stations Done before a word was written.
        const view = viewWith(
            { paragraphAnchor: null },
            "Start with the business outcome this engagement achieves, then provide context on why this work is being undertaken now.",
        );
        view.nodes[0].wordCount = 0;
        view.document.targetWordCount = 5000;
        stubFetch(view);

        render(<ScribeStudioPod documentId={1} />);

        expect((await screen.findByTestId("scribe-telemetry-dock")).textContent).toContain("0 / 1 Done");
    });
});

describe("bootstrapping a session document", () => {
    afterEach(() => vi.unstubAllGlobals());

    const captureUrls = () => {
        const urls: string[] = [];
        vi.stubGlobal("fetch", vi.fn(async (url: string) => {
            urls.push(String(url));
            return new Response(JSON.stringify(viewWith({ paragraphAnchor: null })), {
                status: 200,
                headers: { "content-type": "application/json" },
            });
        }));
        return urls;
    };

    it("asks for the framework the mount requested", async () => {
        // The session bootstrap creates the document when none exists, and with
        // no mode it created a freeform one — so a studio opened for an SOW
        // could get the generic skeleton purely by reaching the session first.
        const urls = captureUrls();

        render(<ScribeStudioPod sessionId={42} archetypeMode="sow_statement_of_work" />);

        await waitFor(() => expect(urls.length).toBeGreaterThan(0));
        expect(urls[0]).toContain("mode=sow_statement_of_work");
    });

    it("leaves the mode out when the mount did not name one", async () => {
        // Not the same as sending freeform: the server keeps its own default,
        // and an existing document is not re-framed by a bare page load.
        const urls = captureUrls();

        render(<ScribeStudioPod sessionId={42} />);

        await waitFor(() => expect(urls.length).toBeGreaterThan(0));
        expect(urls[0]).not.toContain("mode=");
    });
});

describe("inquiry-driven document brief", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("requires outcome and audience, then sends a structured brief to crystallize", async () => {
        const fresh = viewWith({ paragraphAnchor: null }, "");
        fresh.nodes[0].wordCount = 0;
        fresh.telemetry.totalWordCount = 0;
        let crystallizeBody: any = null;

        vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
            if (String(url).includes("/crystallize")) {
                crystallizeBody = JSON.parse(String(options?.body));
                return new Response(JSON.stringify({
                    ...fresh,
                    nodes: [{ ...fresh.nodes[0], content: "Drafted opening", wordCount: 2 }],
                    telemetry: { ...fresh.telemetry, totalWordCount: 2 },
                }), { status: 200, headers: { "content-type": "application/json" } });
            }
            return new Response(JSON.stringify(fresh), {
                status: 200,
                headers: { "content-type": "application/json" },
            });
        }));

        render(<ScribeStudioPod documentId={1} />);
        const build = await screen.findByRole("button", { name: /build structured draft/i });
        expect(build).toBeDisabled();

        fireEvent.change(screen.getByLabelText(/what must this document accomplish/i), {
            target: { value: "Secure approval for the migration" },
        });
        fireEvent.change(screen.getByLabelText(/who will read or approve it/i), {
            target: { value: "CIO and procurement" },
        });
        fireEvent.change(screen.getByPlaceholderText(/required sections, deadline/i), {
            target: { value: "Board-ready; cite all cost assumptions" },
        });
        fireEvent.click(build);

        await waitFor(() => expect(crystallizeBody).not.toBeNull());
        expect(crystallizeBody.contextParagraph).toContain("Desired outcome: Secure approval for the migration");
        expect(crystallizeBody.contextParagraph).toContain("Primary audience and approvers: CIO and procurement");
        expect(crystallizeBody.extractedEntities).toMatchObject({
            desired_outcome: "Secure approval for the migration",
            primary_audience: "CIO and procurement",
            constraints: "Board-ready; cite all cost assumptions",
        });
    });
});

describe("what remains after a publish", () => {
    afterEach(() => vi.unstubAllGlobals());

    const publishedView = (over: Record<string, unknown> = {}, nodeUpdatedAt?: string) => {
        const view = viewWith({ paragraphAnchor: null });
        (view.document as any).settings = {
            publications: [
                {
                    versionTag: "v1.0",
                    publishedAt: "2026-08-29T10:00:00.000Z",
                    releaseNotes: "First issue for review",
                    wordCount: 306,
                    attachmentId: 88,
                    ...over,
                },
            ],
        };
        if (nodeUpdatedAt) (view.nodes[0] as any).updatedAt = nodeUpdatedAt;
        return view;
    };

    const dock = async () => (await screen.findByTestId("scribe-telemetry-dock")).textContent ?? "";

    it("says what was published, after the modal has closed", async () => {
        // The modal showed a tick for 1600ms and then closed, leaving nothing.
        // An author who looked away could not tell whether it had happened.
        stubFetch(publishedView());

        render(<ScribeStudioPod documentId={1} />);

        expect(await screen.findByTestId("scribe-published-state")).toBeInTheDocument();
        expect(await dock()).toContain("v1.0");
        expect(await dock()).toContain("306w");
    });

    it("links to the asset it produced", async () => {
        stubFetch(publishedView());

        render(<ScribeStudioPod documentId={1} />);

        const link = await screen.findByRole("link", { name: /open asset/i });
        expect(link).toHaveAttribute("href", "/api/attachments/88/download");
    });

    it("shows nothing for a document that has never been published", async () => {
        stubFetch(viewWith({ paragraphAnchor: null }));

        render(<ScribeStudioPod documentId={1} />);

        await screen.findByTestId("scribe-telemetry-dock");
        expect(screen.queryByTestId("scribe-published-state")).not.toBeInTheDocument();
    });

    it("warns when the draft has moved on since the asset was cut", async () => {
        // The question an author actually acts on: is the file I would send
        // someone still this document?
        stubFetch(publishedView({}, "2026-08-29T11:00:00.000Z"));

        render(<ScribeStudioPod documentId={1} />);

        expect(await screen.findByTestId("scribe-published-stale")).toHaveTextContent("1 edited since");
    });

    it("stays quiet while the asset still matches the draft", async () => {
        stubFetch(publishedView({}, "2026-08-29T09:00:00.000Z"));

        render(<ScribeStudioPod documentId={1} />);

        await screen.findByTestId("scribe-published-state");
        expect(screen.queryByTestId("scribe-published-stale")).not.toBeInTheDocument();
    });

    it("offers a new version rather than a first one", async () => {
        stubFetch(publishedView());

        render(<ScribeStudioPod documentId={1} />);

        expect(await screen.findByRole("button", { name: /publish new version/i })).toBeInTheDocument();
    });
});

describe("publishing", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("sends the typography theme the author chose", async () => {
        // The dock declared the theme, passed it, and handlePublish took two
        // arguments — so every publish fell back to corporate_legal whatever
        // was picked, in the route and in the stored publication record alike.
        const view = viewWith({ paragraphAnchor: null });
        const calls: Array<{ url: string; body: any }> = [];

        vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
            if (options?.method === "POST") {
                calls.push({ url: String(url), body: JSON.parse(String(options.body)) });
                return new Response(JSON.stringify({ success: true }), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                });
            }
            return new Response(JSON.stringify(view), {
                status: 200,
                headers: { "content-type": "application/json" },
            });
        }));

        render(<ScribeStudioPod documentId={1} />);

        // The theme picker lives in the dock, not the modal, which is part of
        // why the value went missing on the way through.
        fireEvent.change(await screen.findByRole("combobox", { name: /typographic export theme/i }), { target: { value: "novel_manuscript" } });
        fireEvent.click(screen.getByRole("button", { name: /publish to project/i }));
        fireEvent.click(screen.getByRole("button", { name: /publish milestone/i }));

        await waitFor(() => {
            const publish = calls.find((c) => c.url.includes("/publish"));
            expect(publish?.body.theme).toBe("novel_manuscript");
        });
    });

    it("sends custom version tag and release notes entered in the modal", async () => {
        const view = viewWith({ paragraphAnchor: null });
        const calls: Array<{ url: string; body: any }> = [];

        vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
            if (options?.method === "POST") {
                calls.push({ url: String(url), body: JSON.parse(String(options.body)) });
                return new Response(JSON.stringify({ success: true }), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                });
            }
            return new Response(JSON.stringify(view), {
                status: 200,
                headers: { "content-type": "application/json" },
            });
        }));

        render(<ScribeStudioPod documentId={1} />);

        fireEvent.click(await screen.findByRole("button", { name: /publish to project/i }));

        // Edit version tag
        const versionInput = screen.getByPlaceholderText(/e\.g\. v1\.0\.0/i);
        fireEvent.change(versionInput, { target: { value: "v2.5.0-rc1" } });

        // Edit release notes
        const notesInput = screen.getByPlaceholderText(/describe major clauses/i);
        fireEvent.change(notesInput, { target: { value: "All milestones approved by stakeholder review" } });

        fireEvent.click(screen.getByRole("button", { name: /publish milestone/i }));

        await waitFor(() => {
            const publish = calls.find((c) => c.url.includes("/publish"));
            expect(publish?.body.versionTag).toBe("v2.5.0-rc1");
            expect(publish?.body.releaseNotes).toBe("All milestones approved by stakeholder review");
        });
    });

    it("displays error message in modal when publish fails", async () => {
        const view = viewWith({ paragraphAnchor: null });

        vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
            if (options?.method === "POST" && String(url).includes("/publish")) {
                return new Response(JSON.stringify({ message: "Storage quota exceeded" }), {
                    status: 500,
                    headers: { "content-type": "application/json" },
                });
            }
            return new Response(JSON.stringify(view), {
                status: 200,
                headers: { "content-type": "application/json" },
            });
        }));

        render(<ScribeStudioPod documentId={1} />);

        fireEvent.click(await screen.findByRole("button", { name: /publish to project/i }));
        fireEvent.click(screen.getByRole("button", { name: /publish milestone/i }));

        const errorMsg = await screen.findByTestId("scribe-publish-error");
        expect(errorMsg).toBeInTheDocument();
        expect(errorMsg).toHaveTextContent(/Storage quota exceeded|Publish failed/i);
    });

    it("reloads and displays published state after publishing succeeds", async () => {
        const initialView = viewWith({ paragraphAnchor: null });
        const updatedPublishedView = {
            ...initialView,
            document: {
                ...initialView.document,
                currentRevision: 2,
                settings: {
                    ...initialView.document.settings,
                    publications: [
                        {
                            versionTag: "v1.0",
                            publishedAt: new Date().toISOString(),
                            releaseNotes: "Approved manuscript",
                            wordCount: 150,
                            attachmentId: 42,
                        },
                    ],
                },
            },
        };

        let postCalled = false;
        vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
            if (options?.method === "POST" && String(url).includes("/publish")) {
                postCalled = true;
                return new Response(JSON.stringify({ success: true }), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                });
            }
            return new Response(JSON.stringify(postCalled ? updatedPublishedView : initialView), {
                status: 200,
                headers: { "content-type": "application/json" },
            });
        }));

        render(<ScribeStudioPod documentId={1} />);

        fireEvent.click(await screen.findByRole("button", { name: /publish to project/i }));
        fireEvent.click(screen.getByRole("button", { name: /publish milestone/i }));

        expect(await screen.findByTestId("scribe-published-state")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /publish new version/i })).toBeInTheDocument();
    });
});

describe("room for the manuscript", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    /**
     * jsdom gives every element a zero-width box, so the container the rails
     * are fitted into has to be measured for it.
     */
    const withContainerWidth = (width: number, viewport: number) => {
        vi.stubGlobal("innerWidth", viewport);
        vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
            width,
            height: 800,
            top: 0,
            left: 0,
            right: width,
            bottom: 800,
            x: 0,
            y: 0,
            toJSON: () => ({}),
        } as DOMRect);
    };

    it("folds the spine when the manuscript would be squeezed", async () => {
        // 1037px of rail on a 1920px screen left the canvas 461px.
        withContainerWidth(1037, 1920);
        stubFetch(viewWith({ paragraphAnchor: null }));

        render(<ScribeStudioPod documentId={1} />);

        // The folded spine offers the control to put it back.
        expect(await screen.findByTitle(/expand subway spine/i)).toBeInTheDocument();
    });

    it("leaves both rails alone when there is room for them", async () => {
        withContainerWidth(1600, 1920);
        stubFetch(viewWith({ paragraphAnchor: null }));

        render(<ScribeStudioPod documentId={1} />);

        await screen.findByTestId("scribe-telemetry-dock");
        expect(screen.queryByTitle(/expand subway spine/i)).not.toBeInTheDocument();
    });

    it("keeps the critics dock open when folding the spine was enough", async () => {
        withContainerWidth(1037, 1920);
        stubFetch(viewWith({ paragraphAnchor: null }));

        render(<ScribeStudioPod documentId={1} />);

        await screen.findByTitle(/expand subway spine/i);
        // The dock's own tab switcher is only rendered while it is open.
        expect(screen.getByRole("button", { name: /critics/i })).toBeInTheDocument();
    });

    it("does not re-decide the layout once the author has set it", async () => {
        // Folding a rail back open and having it close again on the next
        // resize would be worse than the squeeze this fixes.
        withContainerWidth(1037, 1920);
        stubFetch(viewWith({ paragraphAnchor: null }));

        render(<ScribeStudioPod documentId={1} />);

        fireEvent.click(await screen.findByTitle(/expand subway spine/i));

        await waitFor(() => expect(screen.queryByTitle(/expand subway spine/i)).not.toBeInTheDocument());
    });
});
