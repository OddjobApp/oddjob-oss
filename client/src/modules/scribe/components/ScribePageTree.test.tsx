import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { ScribePageTree, type ScribeTreeNode } from "./ScribePageTree";

/**
 * The tree's job is navigation and filing, and the two things worth pinning are
 * that nesting renders as nesting, and that the move menu never offers a target
 * the server will refuse. Offering an illegal parent turns a cycle guard into an
 * error message the author has to read and interpret.
 */
const node = (
    id: number,
    title: string,
    children: ScribeTreeNode[] = [],
    labels: string[] = [],
): ScribeTreeNode => ({
    id,
    title,
    parentDocumentId: null,
    labels,
    archetypeMode: "freeform",
    sessionId: id * 10,
    updatedAt: new Date().toISOString(),
    children,
});

const GRANDCHILD = node(3, "Entity Reference");
const CHILD = node(2, "Data Model", [GRANDCHILD]);
const ROOT = node(1, "Shelfie PRD", [CHILD], ["prd"]);
const SIBLING = node(4, "Retention Policy", [], ["legal"]);

const LABELS = [
    { label: "prd", count: 1 },
    { label: "legal", count: 1 },
];

let calls: Array<{ url: string; method: string; body?: any }>;

function stubFetch(tree: ScribeTreeNode[] = [ROOT, SIBLING]) {
    calls = [];
    const fetchMock = vi.fn(async (input: any, options?: RequestInit) => {
        // fetch is reached through apiRequest, which also fires a CSRF/user
        // request; accept whatever shape the first argument arrives in.
        const url = typeof input === "string" ? input : String(input?.url ?? input ?? "");
        const method = options?.method ?? "GET";
        calls.push({
            url,
            method,
            body: options?.body ? JSON.parse(String(options.body)) : undefined,
        });
        const json = (data: unknown) =>
            new Response(JSON.stringify(data), {
                status: 200,
                headers: { "content-type": "application/json" },
            });

        if (url.includes("/api/scribe/labels")) return json(LABELS);
        if (url.includes("/api/scribe/tree")) {
            const match = /label=([^&]+)/.exec(url);
            if (match) {
                const wanted = decodeURIComponent(match[1]);
                return json(tree.filter((t) => t.labels.includes(wanted)));
            }
            return json(tree);
        }
        return json({ id: 2, parentDocumentId: null, labels: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
}

beforeEach(() => stubFetch());
afterEach(() => vi.unstubAllGlobals());

describe("ScribePageTree", () => {
    it("renders the tree with children nested under their parent", async () => {
        render(<ScribePageTree />);

        expect(await screen.findByText("Shelfie PRD")).toBeInTheDocument();
        expect(screen.getByText("Data Model")).toBeInTheDocument();
        expect(screen.getByText("Entity Reference")).toBeInTheDocument();

        // Nesting is structural, not just indentation.
        const root = screen.getByTestId("scribe-tree-node-1");
        expect(root.querySelector('[data-testid="scribe-tree-node-2"]')).not.toBeNull();
        expect(root.querySelector('[data-testid="scribe-tree-node-3"]')).not.toBeNull();
        expect(root.querySelector('[data-testid="scribe-tree-node-4"]')).toBeNull();
    });

    it("opens a document when its title is clicked", async () => {
        const onOpenDocument = vi.fn();
        render(<ScribePageTree onOpenDocument={onOpenDocument} />);

        fireEvent.click(await screen.findByRole("button", { name: "Open Data Model" }));
        expect(onOpenDocument).toHaveBeenCalledWith(2);
    });

    it("collapses and re-expands a branch", async () => {
        render(<ScribePageTree />);
        await screen.findByText("Shelfie PRD");

        fireEvent.click(screen.getByRole("button", { name: "Collapse Shelfie PRD" }));
        expect(screen.queryByText("Data Model")).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Expand Shelfie PRD" }));
        expect(screen.getByText("Data Model")).toBeInTheDocument();
    });

    it("marks the manuscript that is currently open", async () => {
        render(<ScribePageTree activeDocumentId={2} />);
        await screen.findByText("Data Model");

        const active = screen.getByTestId("scribe-tree-node-2").firstElementChild;
        expect(active?.className).toContain("emerald");
    });

    it("never offers a document itself or its descendants as a new parent", async () => {
        render(<ScribePageTree />);
        await screen.findByText("Shelfie PRD");

        fireEvent.click(screen.getByRole("button", { name: "Move Shelfie PRD" }));
        const menu = screen.getByTestId("scribe-tree-move-1");

        // Legal: an unrelated root. Illegal: itself, its child, its grandchild —
        // all of which setDocumentParent would reject.
        expect(menu.textContent).toContain("Retention Policy");
        expect(menu.textContent).not.toContain("Shelfie PRD");
        expect(menu.textContent).not.toContain("Data Model");
        expect(menu.textContent).not.toContain("Entity Reference");
        expect(screen.getByRole("button", { name: "File Shelfie PRD at the root" })).toBeInTheDocument();
    });

    it("sends the move, and null to return a document to the root", async () => {
        render(<ScribePageTree />);
        await screen.findByText("Data Model");

        fireEvent.click(screen.getByRole("button", { name: "Move Data Model" }));
        fireEvent.click(screen.getByRole("button", { name: "File Data Model under Retention Policy" }));

        await waitFor(() => {
            const patch = calls.find((c) => c.method === "PATCH");
            expect(patch?.url).toContain("/api/scribe/documents/2/parent");
            expect(patch?.body).toEqual({ parentDocumentId: 4 });
        });
    });

    it("filters by label and clears the filter", async () => {
        render(<ScribePageTree />);
        await screen.findByText("Shelfie PRD");

        fireEvent.click(screen.getByRole("button", { name: "Filter by legal" }));

        await waitFor(() => {
            expect(screen.getByText("Retention Policy")).toBeInTheDocument();
            expect(screen.queryByText("Shelfie PRD")).not.toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole("button", { name: "Clear label filter" }));
        await waitFor(() => expect(screen.getByText("Shelfie PRD")).toBeInTheDocument());
    });

    it("says the filter is empty rather than looking broken", async () => {
        render(<ScribePageTree />);
        await screen.findByText("Shelfie PRD");

        // No document carries this label, so the tree comes back empty.
        stubFetch([]);
        fireEvent.click(screen.getByRole("button", { name: "Filter by prd" }));

        await waitFor(() => expect(screen.getByText(/No manuscripts labelled/i)).toBeInTheDocument());
    });

    it("edits labels on the open manuscript and sends the full set", async () => {
        render(<ScribePageTree activeDocumentId={1} />);
        await screen.findByText("Shelfie PRD");

        const input = screen.getByTestId("scribe-label-input");
        fireEvent.change(input, { target: { value: "shelfie" } });
        fireEvent.submit(input.closest("form")!);

        await waitFor(() => {
            const put = calls.find((c) => c.method === "PUT");
            expect(put?.url).toContain("/api/scribe/documents/1/labels");
            // The whole set, because the server normalises it — a delta would
            // mean guessing the stored form of an existing label.
            expect(put?.body).toEqual({ labels: ["prd", "shelfie"] });
        });
    });

    it("removes a label by clicking its chip", async () => {
        render(<ScribePageTree activeDocumentId={1} />);
        await screen.findByText("Shelfie PRD");

        fireEvent.click(screen.getByRole("button", { name: "Remove label prd" }));

        await waitFor(() => {
            const put = calls.find((c) => c.method === "PUT");
            expect(put?.body).toEqual({ labels: [] });
        });
    });

    it("deletes a document only after a second, confirming click", async () => {
        const onDocumentDeleted = vi.fn();
        render(<ScribePageTree activeDocumentId={2} onDocumentDeleted={onDocumentDeleted} />);
        await screen.findByText("Data Model");

        // First click arms; nothing is sent yet.
        fireEvent.click(screen.getByRole("button", { name: "Delete Data Model" }));
        expect(calls.some((c) => c.method === "DELETE")).toBe(false);

        fireEvent.click(screen.getByRole("button", { name: "Confirm delete Data Model" }));

        await waitFor(() => {
            const del = calls.find((c) => c.method === "DELETE");
            expect(del?.url).toContain("/api/scribe/documents/2");
        });
        // The open manuscript is gone — the host is told so it can leave it.
        expect(onDocumentDeleted).toHaveBeenCalledWith(2);
    });

    it("does not report the deletion of a document that is not open", async () => {
        const onDocumentDeleted = vi.fn();
        render(<ScribePageTree activeDocumentId={1} onDocumentDeleted={onDocumentDeleted} />);
        await screen.findByText("Data Model");

        fireEvent.click(screen.getByRole("button", { name: "Delete Data Model" }));
        fireEvent.click(screen.getByRole("button", { name: "Confirm delete Data Model" }));

        await waitFor(() => expect(calls.some((c) => c.method === "DELETE")).toBe(true));
        expect(onDocumentDeleted).not.toHaveBeenCalled();
    });

    it("shows no label editor when nothing is open", async () => {
        render(<ScribePageTree />);
        await screen.findByText("Shelfie PRD");
        expect(screen.queryByTestId("scribe-label-input")).not.toBeInTheDocument();
    });

    it("surfaces the reason a move was refused", async () => {
        render(<ScribePageTree />);
        await screen.findByText("Data Model");

        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response("nope", { status: 400, statusText: "Bad Request" })),
        );

        fireEvent.click(screen.getByRole("button", { name: "Move Data Model" }));
        fireEvent.click(screen.getByRole("button", { name: "File Data Model under Retention Policy" }));

        // A silent no-op would leave the author believing the move happened.
        expect(await screen.findByTestId("scribe-tree-error")).toBeInTheDocument();
    });
});
