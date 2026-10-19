import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Locks the scope-resolution precedence from PROJECT_SPACES_DESIGN §6.1:
 *
 *   explicit query param -> header -> session -> org default
 *
 * The last step is what makes adding this middleware to an existing route a no-op:
 * a caller that names no project still lands in the org default and behaves exactly
 * as it did before.
 *
 * Resolution runs through ProjectService.getProject rather than a raw table read, so
 * §8's read gate applies to scope as well: this scope reaches RAG retrieval and the
 * capability prior, and a project you cannot open must not become the context the
 * copilot answers from. Those cases are covered at the foot of this file.
 */

const orgContext = {
    userId: "user-1",
    organizationId: 7,
    isAdmin: false,
    isSuperAdmin: false,
    isOrgAdmin: false,
};

/** Rows the fake project table answers with, keyed by id and by key. */
const PROJECTS: Array<{
    id: number;
    key: string;
    organizationId: number;
    visibility?: "org" | "private";
    members?: string[];
}> = [
    { id: 10, key: "rescue-dispatch", organizationId: 7 },
    { id: 11, key: "trust-quality", organizationId: 7 },
    { id: 12, key: "session-project", organizationId: 7 },
    { id: 13, key: "board-only", organizationId: 7, visibility: "private", members: ["user-2"] },
    { id: 14, key: "my-private", organizationId: 7, visibility: "private", members: ["user-1"] },
    { id: 99, key: "other-org", organizationId: 8 },
];

vi.mock("../../../../utils/auth-context.js", () => ({
    getUserOrgContext: async () => orgContext,
}));

const ensureDefaultProject = vi.fn(async () => ({ id: 1, key: "org-default" }));

/**
 * Stands in for the real service. `getProject` reproduces the two rules the middleware
 * depends on — org scoping and the private-project read gate — and throws the same
 * NotFound for "absent" and "not yours to see", which is what stops key probing from
 * enumerating private projects.
 */
const getProject = vi.fn(async (ctx: any, idOrKey: number | string) => {
    const numeric = Number(idOrKey);
    const byId = Number.isInteger(numeric) && String(idOrKey).trim() === String(numeric);
    const match = PROJECTS.find(
        (p) => p.organizationId === ctx.organizationId && (byId ? p.id === numeric : p.key === String(idOrKey)),
    );
    if (!match) throw new Error(`Project '${idOrKey}' not found.`);
    if (match.visibility === "private" && !(match.members ?? []).includes(ctx.userId)) {
        throw new Error(`Project '${idOrKey}' not found.`);
    }
    return { id: match.id, key: match.key };
});

const isGovernedAgent = vi.fn(async (ctx: any) => ctx.agentId === "governed-agent");
const listProjects = vi.fn(async () => [{ id: 11, key: "trust-quality" }]);

vi.mock("../../core/project.service.js", () => ({
    projectService: {
        get ensureDefaultProject() {
            return ensureDefaultProject;
        },
        get getProject() {
            return getProject;
        },
        get isGovernedAgent() {
            return isGovernedAgent;
        },
        get listProjects() {
            return listProjects;
        },
    },
}));

const { resolveProjectScope, setSessionProject } = await import("@server/middleware/project-scope.js");

function makeReq(overrides: any = {}) {
    return {
        query: {},
        headers: {},
        session: {},
        path: "/api/test",
        ...overrides,
    } as any;
}

beforeEach(() => {
    ensureDefaultProject.mockClear();
    getProject.mockClear();
    isGovernedAgent.mockClear();
    listProjects.mockClear();
});

describe("resolveProjectScope precedence", () => {
    it("prefers an explicit ?projectId over everything else", async () => {
        const req = makeReq({
            query: { projectId: "10" },
            headers: { "x-project-id": "11" },
            session: { activeProjectId: 12 },
        });
        const scope = await resolveProjectScope(req);
        expect(scope).toEqual({ id: 10, key: "rescue-dispatch" });
        expect(ensureDefaultProject).not.toHaveBeenCalled();
    });

    it("accepts ?projectKey as the explicit form", async () => {
        const scope = await resolveProjectScope(makeReq({ query: { projectKey: "trust-quality" } }));
        expect(scope).toEqual({ id: 11, key: "trust-quality" });
    });

    it("falls to the header when no query parameter is present", async () => {
        const req = makeReq({
            headers: { "x-project-id": "11" },
            session: { activeProjectId: 12 },
        });
        expect(await resolveProjectScope(req)).toEqual({ id: 11, key: "trust-quality" });
    });

    it("falls to the session when neither query nor header is present", async () => {
        const req = makeReq({ session: { activeProjectId: 12 } });
        expect(await resolveProjectScope(req)).toEqual({ id: 12, key: "session-project" });
        expect(ensureDefaultProject).not.toHaveBeenCalled();
    });

    it("falls to the org default when nothing names a project", async () => {
        expect(await resolveProjectScope(makeReq())).toEqual({ id: 1, key: "org-default" });
        expect(ensureDefaultProject).toHaveBeenCalledTimes(1);
    });

    it("falls through a stale session pointer instead of failing the request", async () => {
        // e.g. the project was archived, or the user switched orgs.
        const req = makeReq({ session: { activeProjectId: 4242 } });
        expect(await resolveProjectScope(req)).toEqual({ id: 1, key: "org-default" });
    });

    it("refuses an explicitly named project that does not exist in this org", async () => {
        // Silently substituting the default here would hide a real caller bug.
        await expect(resolveProjectScope(makeReq({ query: { projectId: "4242" } }))).rejects.toThrow(
            /does not exist in this organization/,
        );
    });

    it("cannot be pointed at another org's project", async () => {
        // Project 99 exists, but belongs to org 8 while the session resolves org 7.
        await expect(resolveProjectScope(makeReq({ query: { projectId: "99" } }))).rejects.toThrow(
            /does not exist in this organization/,
        );
    });

    it("returns null instead of inventing a default when useDefault is false", async () => {
        expect(await resolveProjectScope(makeReq(), { useDefault: false })).toBeNull();
        expect(ensureDefaultProject).not.toHaveBeenCalled();
    });

    it("ignores a non-numeric or non-positive projectId", async () => {
        // Garbage in the query string is not an explicit selection, so it must not
        // short-circuit to the error branch — it falls through to the default.
        expect(await resolveProjectScope(makeReq({ query: { projectId: "abc" } }))).toEqual({
            id: 1,
            key: "org-default",
        });
    });
});

describe("resolveProjectScope read gate (§8)", () => {
    it("refuses to scope a caller to a private project they are not a member of", async () => {
        // Without this, ?projectKey= was a way around the read gate that /api/projects
        // enforces — and project scope decides what RAG retrieval reads back.
        await expect(
            resolveProjectScope(makeReq({ query: { projectKey: "board-only" } })),
        ).rejects.toThrow(/does not exist in this organization/);
    });

    it("reports an invisible project exactly as it reports an absent one", async () => {
        // Distinguishable errors would turn key probing into an enumeration oracle, so
        // the two must differ only in the key the caller already supplied.
        const message = async (key: string) =>
            resolveProjectScope(makeReq({ query: { projectKey: key } }))
                .then(() => "resolved")
                .catch((e) => ({ name: e.constructor.name, text: e.message.replace(key, "<key>") }));

        expect(await message("board-only")).toEqual(await message("no-such-key"));
    });

    it("still scopes a member to their own private project", async () => {
        expect(await resolveProjectScope(makeReq({ query: { projectKey: "my-private" } }))).toEqual({
            id: 14,
            key: "my-private",
        });
    });

    it("applies the gate to the header form too", async () => {
        await expect(
            resolveProjectScope(makeReq({ headers: { "x-project-key": "board-only" } })),
        ).rejects.toThrow(/does not exist in this organization/);
    });

    it("falls through to the default when a session pointer becomes unreadable", async () => {
        // Membership revoked after the switcher set it — a stale pointer, not an error.
        expect(await resolveProjectScope(makeReq({ session: { activeProjectId: 13 } }))).toEqual({
            id: 1,
            key: "org-default",
        });
    });
});

describe("resolveProjectScope with an agent principal (§8 blast radius)", () => {
    it("lands a governed agent in its own project rather than the org default", async () => {
        const scope = await resolveProjectScope(makeReq({ headers: { "x-agent-id": "governed-agent" } }));
        expect(scope).toEqual({ id: 11, key: "trust-quality" });
        expect(ensureDefaultProject).not.toHaveBeenCalled();
    });

    it("gives a governed agent with no grants no scope at all", async () => {
        listProjects.mockResolvedValueOnce([]);
        expect(await resolveProjectScope(makeReq({ headers: { "x-agent-id": "governed-agent" } }))).toBeNull();
    });

    it("leaves an ungoverned agent on the existing default path", async () => {
        const scope = await resolveProjectScope(makeReq({ headers: { "x-agent-id": "some-other-agent" } }));
        expect(scope).toEqual({ id: 1, key: "org-default" });
    });

    it("passes the declared agent principal down to the service", async () => {
        await resolveProjectScope(makeReq({
            query: { projectKey: "rescue-dispatch" },
            headers: { "x-agent-id": "governed-agent" },
        }));
        expect(getProject).toHaveBeenCalledWith(
            expect.objectContaining({ agentId: "governed-agent", organizationId: 7 }),
            "rescue-dispatch",
        );
    });
});

describe("setSessionProject", () => {
    it("sets and clears the active project on the session", () => {
        const req = makeReq();
        setSessionProject(req, 10);
        expect(req.session.activeProjectId).toBe(10);
        setSessionProject(req, null);
        expect(req.session.activeProjectId).toBeUndefined();
    });

    it("is a no-op without a session rather than throwing", () => {
        expect(() => setSessionProject(makeReq({ session: undefined }), 10)).not.toThrow();
    });
});
