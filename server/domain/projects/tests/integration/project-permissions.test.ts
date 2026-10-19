/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { configureTestEnvironment } from "../../../../../tests/configure-test-environment.js";

/**
 * Project Spaces permissions (PROJECT_SPACES_DESIGN §8), against a real database.
 *
 * `capRole` is unit-tested for the pure decision; everything here is the half a pure
 * test cannot reach — that the membership rows, the visibility gate and the agent
 * ceiling actually compose into the access a caller gets. Before this suite, §8 was a
 * table and an API nobody had exercised end to end.
 *
 * Runs against the pinned test database. NEVER hardcode a connection string: point
 * TEST_DATABASE_URL at a database whose name carries a distinct `test` segment.
 */

configureTestEnvironment();

const { db } = await import("@server/database_service.js");
const { projectService } = await import("../../core/project.service.js");
const { projects, projectMembers } = await import("@shared/schema/projects.js");
const { orgs, users, userOrgs } = await import("@shared/schema/auth.js");

/**
 * Skip loudly rather than passing vacuously: a suite that silently reports green
 * against a database it never reached is worse than one that is visibly absent.
 */
let reachable = false;
try {
    await db.execute("SELECT 1" as any);
    reachable = true;
} catch (e: any) {
    console.warn(
        `[project-permissions] SKIPPED — no test database reachable (${e?.message ?? e}). `
        + `Set TEST_DATABASE_URL and run npm run test:db:setup.`,
    );
}

const stamp = Date.now();
const AGENT = `ceiling-agent-${stamp}`;

describe.skipIf(!reachable)("Project permissions (§8)", () => {
    let orgId: number;
    let ownerId: string;
    let outsiderId: string;

    /** ctx factories, so each test reads as "who is asking". */
    const asOwner = () => ({ organizationId: orgId, userId: ownerId });
    const asOutsider = () => ({ organizationId: orgId, userId: outsiderId });
    const asOrgAdmin = () => ({ organizationId: orgId, userId: outsiderId, isOrgAdmin: true });
    const asAgent = (userId?: string) => ({ organizationId: orgId, userId, agentId: AGENT });

    let openProject: any;
    let privateProject: any;

    beforeAll(async () => {
        const [org] = await db
            .insert(orgs)
            .values({ name: `Project Perms ${stamp}`, slug: `project-perms-${stamp}` } as any)
            .returning();
        orgId = org.id;

        const [owner] = await db
            .insert(users)
            .values({
                username: `perm_owner_${stamp}`,
                password: "not-a-real-password",
                email: `owner_${stamp}@example.test`,
                firstName: "Olive",
                lastName: "Owner",
            } as any)
            .returning();
        const [outsider] = await db
            .insert(users)
            .values({
                username: `perm_outsider_${stamp}`,
                password: "not-a-real-password",
                email: `outsider_${stamp}@example.test`,
            } as any)
            .returning();
        ownerId = owner.id;
        outsiderId = outsider.id;

        await db.insert(userOrgs).values([
            { userId: ownerId, orgId },
            { userId: outsiderId, orgId },
        ] as any);

        openProject = await projectService.createProject(asOwner(), {
            name: `Open ${stamp}`,
            visibility: "org",
        } as any);
        privateProject = await projectService.createProject(asOwner(), {
            name: `Private ${stamp}`,
            visibility: "private",
        } as any);
    });

    afterAll(async () => {
        // project_members and project_resources cascade from projects; projects and
        // user_orgs cascade from the org.
        if (orgId) {
            await db.delete(projects).where(eq(projects.organizationId, orgId)).catch(() => {});
            await db.delete(orgs).where(eq(orgs.id, orgId)).catch(() => {});
        }
        for (const id of [ownerId, outsiderId]) {
            if (id) await db.delete(users).where(eq(users.id, id)).catch(() => {});
        }
    });

    describe("visibility", () => {
        it("makes the creator an owner, so a private project is not invisible to its author", async () => {
            expect(await projectService.roleFor(asOwner(), privateProject)).toBe("owner");
        });

        it("lets any org member read an org-visible project without a membership row", async () => {
            // §8: project roles are ADDITIVE. Read access here is the org's, not the
            // project's, and a role only adds the ability to change things.
            const seen = await projectService.getProject(asOutsider(), openProject.key);
            expect(seen.id).toBe(openProject.id);
            expect(await projectService.roleFor(asOutsider(), openProject)).toBeNull();
        });

        it("hides a private project from a non-member, as absent rather than forbidden", async () => {
            await expect(projectService.getProject(asOutsider(), privateProject.key)).rejects.toThrow(
                /not found/i,
            );
            const listed = await projectService.listProjects(asOutsider());
            expect(listed.map((p) => p.id)).not.toContain(privateProject.id);
        });

        it("still shows a private project to an org admin", async () => {
            const seen = await projectService.getProject(asOrgAdmin(), privateProject.key);
            expect(seen.id).toBe(privateProject.id);
        });
    });

    describe("granting a role", () => {
        it("opens a private project to the person it was granted to", async () => {
            await projectService.addMember(asOwner(), privateProject.key, {
                principalType: "user",
                principalId: outsiderId,
                role: "viewer",
            });

            const seen = await projectService.getProject(asOutsider(), privateProject.key);
            expect(seen.id).toBe(privateProject.id);
            expect(await projectService.roleFor(asOutsider(), privateProject)).toBe("viewer");
            expect((await projectService.listProjects(asOutsider())).map((p) => p.id))
                .toContain(privateProject.id);
        });

        it("grants sight without granting change — a viewer still cannot edit", async () => {
            await expect(
                projectService.updateProject(asOutsider(), privateProject.key, { name: "Renamed by a viewer" }),
            ).rejects.toThrow(/requires the 'editor' role/);
        });

        it("upserts rather than duplicating, so re-adding is how a role is changed", async () => {
            await projectService.addMember(asOwner(), privateProject.key, {
                principalType: "user",
                principalId: outsiderId,
                role: "editor",
            });
            expect(await projectService.roleFor(asOutsider(), privateProject)).toBe("editor");

            const rows = await db
                .select()
                .from(projectMembers)
                .where(eq(projectMembers.projectId, privateProject.id));
            expect(rows.filter((r) => r.principalId === outsiderId)).toHaveLength(1);
        });

        it("refuses to leave a project with no owner", async () => {
            await expect(
                projectService.removeMember(asOwner(), privateProject.key, "user", ownerId),
            ).rejects.toThrow(/no owner/i);
        });
    });

    describe("member listing", () => {
        it("resolves user principals to accounts instead of showing raw ids", async () => {
            const members = await projectService.listMembers(asOwner(), privateProject.key);
            const owner = members.find((m) => m.principalId === ownerId);
            expect(owner?.displayName).toBe("Olive Owner");
            expect(owner?.secondary).toContain("@example.test");
            expect(owner?.isProjectOwner).toBe(true);
        });

        it("offers only principals who are not already members", async () => {
            const candidates = await projectService.listMemberCandidates(asOwner(), privateProject.key);
            const offered = candidates.users.map((u) => u.principalId);
            expect(offered).not.toContain(ownerId);
            expect(offered).not.toContain(outsiderId);
        });

        it("does not show the roster to someone who could not grant a role anyway", async () => {
            await expect(
                projectService.listMemberCandidates(asOutsider(), privateProject.key),
            ).rejects.toThrow(/requires the 'owner' role/);
        });
    });

    describe("agent ceiling (§6.4 blast radius)", () => {
        it("leaves an UNGOVERNED agent reaching everything it could before", async () => {
            // No grants anywhere: this is every agent in the system today, which is what
            // makes the mechanism free to turn on.
            expect(await projectService.isGovernedAgent(asAgent(ownerId))).toBe(false);
            const seen = await projectService.getProject(asAgent(ownerId), openProject.key);
            expect(seen.id).toBe(openProject.id);
        });

        it("confines the agent to its grants the moment it is given one", async () => {
            await projectService.addMember(asOwner(), openProject.key, {
                principalType: "agent",
                principalId: AGENT,
                role: "viewer",
            });

            expect(await projectService.isGovernedAgent(asAgent(ownerId))).toBe(true);
            // Granted project: still reachable...
            expect((await projectService.getProject(asAgent(ownerId), openProject.key)).id)
                .toBe(openProject.id);
            // ...everything else is not, even though the human it acts for owns it.
            await expect(projectService.getProject(asAgent(ownerId), privateProject.key))
                .rejects.toThrow(/not found/i);
            expect((await projectService.listProjects(asAgent(ownerId))).map((p) => p.id))
                .toEqual([openProject.id]);
        });

        it("caps the role even when the agent acts for an org admin", async () => {
            // The whole point: an agent runs on someone's authority, so a ceiling that
            // did not bind an admin would not bind anything.
            expect(await projectService.roleFor({ ...asAgent(outsiderId), isOrgAdmin: true }, openProject))
                .toBe("viewer");
            await expect(
                projectService.updateProject(
                    { ...asAgent(outsiderId), isOrgAdmin: true },
                    openProject.key,
                    { name: "Renamed by a capped agent" },
                ),
            ).rejects.toThrow(/requires the 'editor' role/);
        });

        it("releases the agent again when the grant is revoked", async () => {
            await projectService.removeMember(asOwner(), openProject.key, "agent", AGENT);
            expect(await projectService.isGovernedAgent(asAgent(ownerId))).toBe(false);
            expect((await projectService.getProject(asAgent(ownerId), privateProject.key)).id)
                .toBe(privateProject.id);
        });
    });

    describe("settings writes", () => {
        it("sends archiving to the endpoint that checks for open cycles first", async () => {
            await expect(
                projectService.updateProject(asOwner(), openProject.key, { status: "archived" } as any),
            ).rejects.toThrow(/use the archive endpoint/i);
        });

        it("reserves a visibility change for an owner", async () => {
            // The outsider is an editor on the private project by now — enough to rename
            // it, deliberately not enough to expose it to the whole org.
            await expect(
                projectService.updateProject(asOutsider(), privateProject.key, { visibility: "org" } as any),
            ).rejects.toThrow(/requires the 'owner' role/);
        });

        it("archives and restores, clearing the tombstone on the way back", async () => {
            const archived = await projectService.archiveProject(asOwner(), openProject.key);
            expect(archived.status).toBe("archived");
            expect(archived.archivedAt).toBeTruthy();

            const restored = await projectService.updateProject(asOwner(), openProject.key, {
                status: "active",
            } as any);
            expect(restored.status).toBe("active");
            expect(restored.archivedAt).toBeNull();
        });
    });

    /**
     * The gap a reader-gated writer falls into: read access is much wider than
     * write access, so "getProject succeeded" is never authorization to change
     * anything. The project file editor asks this question directly.
     */
    describe("assertCanEdit", () => {
        it("refuses an org member who has no role on an org-visible project", async () => {
            // The same caller CAN read it — that is the whole point of the gap.
            const seen = await projectService.getProject(asOutsider(), openProject.key);
            expect(seen.id).toBe(openProject.id);

            await expect(projectService.assertCanEdit(asOutsider(), openProject)).rejects.toThrow(
                /requires the 'editor' role/,
            );
        });

        it("admits the owner", async () => {
            await expect(projectService.assertCanEdit(asOwner(), openProject)).resolves.toBeUndefined();
        });

        it("admits an editor on a private project, and refuses a viewer", async () => {
            await projectService.addMember(asOwner(), privateProject.key, {
                principalType: "user",
                principalId: outsiderId,
                role: "editor",
            });
            await expect(
                projectService.assertCanEdit(asOutsider(), privateProject),
            ).resolves.toBeUndefined();

            await projectService.addMember(asOwner(), privateProject.key, {
                principalType: "user",
                principalId: outsiderId,
                role: "viewer",
            });
            await expect(projectService.assertCanEdit(asOutsider(), privateProject)).rejects.toThrow(
                /requires the 'editor' role/,
            );
        });
    });
});
