import { describe, it, expect } from "vitest";

/**
 * The project-visibility rule used by /api/apps/fleet-for-copilot.
 *
 * Extracted verbatim from the route so the semantics are pinned. The rule is
 * easy to get wrong in a way that is hard to notice: `agent_deployments.project_id`
 * was added after every existing row was created, so all of them are NULL. A
 * strict `row.projectId === activeProjectId` would empty the entire fleet the
 * moment anyone selected a project, which reads as "no apps installed" rather
 * than as a bug.
 */
const visibleInProject = (activeProjectId: number | null) => (row: any) =>
    activeProjectId == null || row?.projectId == null || row.projectId === activeProjectId;

describe("fleet project visibility", () => {
    const orgGlobal = { slug: "legacy-app", projectId: null };
    const inProject7 = { slug: "alpha", projectId: 7 };
    const inProject9 = { slug: "beta", projectId: 9 };
    const fleet = [orgGlobal, inProject7, inProject9];

    it("shows everything when no project is selected", () => {
        expect(fleet.filter(visibleInProject(null))).toHaveLength(3);
    });

    it("keeps org-global rows visible inside a project", () => {
        // The regression this exists to prevent: pre-existing rows are all NULL.
        const visible = fleet.filter(visibleInProject(7));
        expect(visible).toContainEqual(orgGlobal);
    });

    it("hides rows belonging to a different project", () => {
        const visible = fleet.filter(visibleInProject(7));
        expect(visible).not.toContainEqual(inProject9);
    });

    it("shows the selected project's own rows", () => {
        expect(fleet.filter(visibleInProject(7))).toContainEqual(inProject7);
    });

    it("never returns an empty fleet purely because rows predate the column", () => {
        const legacyOnly = [{ projectId: null }, { projectId: null }];
        expect(legacyOnly.filter(visibleInProject(42))).toHaveLength(2);
    });

    it("tolerates a row with no projectId field at all", () => {
        expect([{ slug: "x" }].filter(visibleInProject(7))).toHaveLength(1);
    });

    it("treats project 0 as a real id, not as absent", () => {
        // Guards against a truthiness check replacing the null comparison.
        expect([{ projectId: 0 }].filter(visibleInProject(7))).toHaveLength(0);
    });
});
