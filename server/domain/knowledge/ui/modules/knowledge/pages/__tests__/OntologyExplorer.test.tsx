import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const apiRequest = vi.fn();
vi.mock("@/lib/queryClient", async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return { ...actual, apiRequest: (...args: any[]) => apiRequest(...args) };
});

import { OntologyExplorer, ActionRow, availableHopsFor } from "../OntologyExplorer";

const DEFINE_LINK_TYPE = {
    name: "define_link_type",
    description: "Declare a relationship between two Object Types.",
    effect: "write",
    riskLevel: "low",
    requiresApproval: true,
    parametersSchema: { sourceType: "string", name: "string", inverseName: "string", sourceProperty: "string" },
};

const OBJECT_TYPES = [
    { name: "Mission", description: "A mission.", properties: { id: "integer", name: "string" }, titleProperty: "name", backing: "virtual" },
    { name: "Mission Run", description: "One execution.", properties: { id: "integer", name: "string", status: "string" }, titleProperty: "name", backing: "virtual" },
];

const RUN_OF = {
    name: "run_of", inverseName: "has_run", description: "The mission this execution ran.",
    sourceType: "Mission Run", targetType: "Mission", cardinality: "one_to_one",
    backing: "derived", sourceProperty: "missionId", targetTypeProperty: null, targetTypeMap: {},
};
const SUB_RUN_OF = {
    name: "sub_run_of", inverseName: "has_sub_run", description: "The run this was spawned from.",
    sourceType: "Mission Run", targetType: "Mission Run", cardinality: "one_to_one",
    backing: "derived", sourceProperty: "parentId", targetTypeProperty: null, targetTypeMap: {},
};

/** Route each call the component makes to a canned payload. */
function respond(routes: Record<string, any>) {
    apiRequest.mockImplementation(async (_method: string, url: string) => {
        const key = Object.keys(routes).find((k) => url.startsWith(k));
        if (!key) throw new Error(`Unexpected request: ${url}`);
        const body = routes[key];
        if (body instanceof Error) throw body;
        return { json: async () => body };
    });
}

function renderPage() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <OntologyExplorer />
        </QueryClientProvider>,
    );
}

describe("availableHopsFor", () => {
    it("offers a link from both ends, because an inverse is a real way out", () => {
        expect(availableHopsFor("Mission Run", [RUN_OF] as any)).toEqual([
            expect.objectContaining({ name: "run_of", direction: "forward", to: "Mission" }),
        ]);
        expect(availableHopsFor("Mission", [RUN_OF] as any)).toEqual([
            expect.objectContaining({ name: "has_run", direction: "inverse", to: "Mission Run" }),
        ]);
    });

    it("yields both hops of a self-referential link", () => {
        const hops = availableHopsFor("Mission Run", [SUB_RUN_OF] as any);
        expect(hops.map((h) => h.name)).toEqual(["sub_run_of", "has_sub_run"]);
    });

    it("states cardinality on the forward hop only", () => {
        // Declared source -> target. Printing `one_to_one` above the several runs that
        // `has_run` returns would contradict what is on the screen, which is why the
        // service leaves it off traversal results too.
        expect(availableHopsFor("Mission Run", [RUN_OF] as any)[0].cardinality).toBe("one_to_one");
        expect(availableHopsFor("Mission", [RUN_OF] as any)[0].cardinality).toBeUndefined();
    });

    it("finds a polymorphic link from a type named only in its discriminator map", () => {
        const poly = { ...RUN_OF, name: "resource_of", inverseName: "has_resource", sourceType: "Project Resource", targetType: null, targetTypeMap: { mission: "Mission" } };
        const hops = availableHopsFor("Mission", [poly] as any);
        expect(hops).toEqual([expect.objectContaining({ name: "has_resource", direction: "inverse", to: "Project Resource" })]);
    });

    it("marks a polymorphic forward hop as landing somewhere that varies", () => {
        const poly = { ...RUN_OF, sourceType: "Project Resource", targetType: null, targetTypeMap: { mission: "Mission" } };
        expect(availableHopsFor("Project Resource", [poly] as any)[0].polymorphic).toBe(true);
    });
});

describe("OntologyExplorer traversal", () => {
    beforeEach(() => {
        apiRequest.mockReset();
    });

    it("walks from an instance to the objects on the other end, and back again", async () => {
        respond({
            "/api/ontology/object-types": { objectTypes: OBJECT_TYPES },
            "/api/ontology/actions": { actions: [] },
            "/api/ontology/objects/Mission%20Run/7/links/run_of": {
                link: { name: "run_of", direction: "forward", fromType: "Mission Run", toType: "Mission" },
                objects: [{ id: 3, name: "Nightly ingest" }],
                complete: true,
            },
            "/api/ontology/objects/Mission%20Run": { objects: [{ id: 7, name: "first attempt", status: "failed" }] },
            "/api/ontology/link-types": { linkTypes: [RUN_OF] },
        });

        const user = userEvent.setup();
        renderPage();

        await user.click(await screen.findByRole("button", { name: /Mission Run/ }));
        const row = await screen.findByTitle("Follow first attempt");
        await user.click(row);

        // The object's declared relationships become the navigation.
        const hop = await screen.findByRole("button", { name: /run_of/ });
        await user.click(hop);

        const result = await screen.findByRole("button", { name: /Nightly ingest/ });
        await user.click(result);

        // Now focused on the Mission, one hop deep, with the way back on screen.
        const trail = screen.getByRole("navigation", { name: "Traversal trail" });
        expect(trail).toHaveTextContent("first attempt");
        expect(trail).toHaveTextContent("run_of");
        expect(trail).toHaveTextContent("Nightly ingest");

        await user.click(screen.getByRole("button", { name: "first attempt" }));
        await waitFor(() => expect(screen.queryByText("Nightly ingest")).not.toBeInTheDocument());
    });

    it("says why a traversal is empty instead of showing a bare empty list", async () => {
        // An unset foreign key and "nothing is related" lead to opposite conclusions.
        respond({
            "/api/ontology/object-types": { objectTypes: OBJECT_TYPES },
            "/api/ontology/actions": { actions: [] },
            "/api/ontology/objects/Mission%20Run/7/links/run_of": {
                link: { name: "run_of", direction: "forward", fromType: "Mission Run", toType: "Mission" },
                objects: [],
                complete: true,
                note: "This Mission Run has no value for 'missionId', so the link resolves to nothing.",
            },
            "/api/ontology/objects/Mission%20Run": { objects: [{ id: 7, name: "first attempt", status: "failed" }] },
            "/api/ontology/link-types": { linkTypes: [RUN_OF] },
        });

        const user = userEvent.setup();
        renderPage();

        await user.click(await screen.findByRole("button", { name: /Mission Run/ }));
        await user.click(await screen.findByTitle("Follow first attempt"));
        await user.click(await screen.findByRole("button", { name: /run_of/ }));

        expect(await screen.findByText(/no value for 'missionId'/)).toBeInTheDocument();
        expect(screen.queryByText("Nothing on the other end of this relationship.")).not.toBeInTheDocument();
    });

    it("warns when the answer may be partial rather than letting it read as complete", async () => {
        respond({
            "/api/ontology/object-types": { objectTypes: OBJECT_TYPES },
            "/api/ontology/actions": { actions: [] },
            "/api/ontology/objects/Mission%20Run/7/links/run_of": {
                link: { name: "run_of", direction: "forward", fromType: "Mission Run", toType: "Mission" },
                objects: [{ id: 3, name: "Nightly ingest" }],
                complete: false,
                note: "More objects may be related than are listed here.",
            },
            "/api/ontology/objects/Mission%20Run": { objects: [{ id: 7, name: "first attempt", status: "failed" }] },
            "/api/ontology/link-types": { linkTypes: [RUN_OF] },
        });

        const user = userEvent.setup();
        renderPage();

        await user.click(await screen.findByRole("button", { name: /Mission Run/ }));
        await user.click(await screen.findByTitle("Follow first attempt"));
        await user.click(await screen.findByRole("button", { name: /run_of/ }));

        expect(await screen.findByText(/may be incomplete/)).toBeInTheDocument();
    });

    it("shows the server's reason when a link cannot be followed", async () => {
        respond({
            "/api/ontology/object-types": { objectTypes: OBJECT_TYPES },
            "/api/ontology/actions": { actions: [] },
            "/api/ontology/objects/Mission%20Run/7/links/run_of": new Error(
                "Link 'run_of' is backed by stored edges ('materialized'), which traversal does not read yet.",
            ),
            "/api/ontology/objects/Mission%20Run": { objects: [{ id: 7, name: "first attempt", status: "failed" }] },
            "/api/ontology/link-types": { linkTypes: [RUN_OF] },
        });

        const user = userEvent.setup();
        renderPage();

        await user.click(await screen.findByRole("button", { name: /Mission Run/ }));
        await user.click(await screen.findByTitle("Follow first attempt"));
        await user.click(await screen.findByRole("button", { name: /run_of/ }));

        expect(await screen.findByText(/backed by stored edges/)).toBeInTheDocument();
    });
});

/**
 * The governed write path. Its three outcomes have to stay three: an operator told
 * "denied" retries nothing, one told "executed" moves on, and one told "waiting on
 * approval" waits. Collapsing any pair sends them the wrong way.
 */
describe("ActionRow", () => {
    beforeEach(() => {
        apiRequest.mockReset();
    });

    function renderAction() {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
        return render(
            <QueryClientProvider client={client}>
                <ActionRow action={DEFINE_LINK_TYPE as any} />
            </QueryClientProvider>,
        );
    }

    async function fillAndRun(user: ReturnType<typeof userEvent.setup>) {
        await user.click(screen.getByRole("button", { name: "Run" }));
        // By position: the parameter names overlap as substrings (`name` is inside
        // `inverseName`), so an accessible-name regex matches several fields.
        for (const box of screen.getAllByRole("textbox")) await user.type(box, "x");
        await user.click(screen.getByRole("button", { name: /Run define_link_type/ }));
    }

    it("builds a field for every parameter, since all of them are required", async () => {
        const user = userEvent.setup();
        renderAction();
        await user.click(screen.getByRole("button", { name: "Run" }));
        expect(screen.getAllByRole("textbox")).toHaveLength(4);
        expect(screen.getByText(/goes to the governor for a human decision/)).toBeInTheDocument();
    });

    it("reports a pending approval as waiting, not as success or failure", async () => {
        apiRequest.mockResolvedValue({
            json: async () => ({ status: "approval_required", message: "Timed out awaiting a decision.", approvalId: 42 }),
        });
        const user = userEvent.setup();
        renderAction();
        await fillAndRun(user);

        expect(await screen.findByText("waiting on approval")).toBeInTheDocument();
        expect(screen.getByText(/approval #42/)).toBeInTheDocument();
        expect(screen.queryByText("executed")).not.toBeInTheDocument();
        expect(screen.queryByText("denied")).not.toBeInTheDocument();
    });

    it("distinguishes an explicit denial", async () => {
        apiRequest.mockResolvedValue({
            json: async () => ({ status: "denied", message: "Rejected by approver.", approvalId: 7 }),
        });
        const user = userEvent.setup();
        renderAction();
        await fillAndRun(user);

        expect(await screen.findByText("denied")).toBeInTheDocument();
        expect(screen.queryByText("waiting on approval")).not.toBeInTheDocument();
    });

    it("refreshes what can be walked only once a link actually landed", async () => {
        apiRequest.mockResolvedValue({
            json: async () => ({ status: "executed", message: "Action 'define_link_type' executed.", result: { created: true } }),
        });
        const user = userEvent.setup();
        renderAction();
        await fillAndRun(user);

        expect(await screen.findByText("executed")).toBeInTheDocument();
        // The POST plus the two invalidations a landed declaration triggers.
        const [method, url, body] = apiRequest.mock.calls[0];
        expect(method).toBe("POST");
        expect(url).toBe("/api/ontology/actions/define_link_type/execute");
        expect(body).toEqual({ parameters: { sourceType: "x", name: "x", inverseName: "x", sourceProperty: "x" } });
    });

    it("surfaces the server's validation message", async () => {
        apiRequest.mockRejectedValue(new Error("Missing required parameter 'inverseName' for action 'define_link_type'."));
        const user = userEvent.setup();
        renderAction();
        await fillAndRun(user);

        expect(await screen.findByText(/Missing required parameter 'inverseName'/)).toBeInTheDocument();
    });
});
