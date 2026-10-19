/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { configureTestEnvironment } from "../../../../../tests/configure-test-environment.js";

/**
 * Creation-time mission attachment + project-filtered workstreams
 * (PROJECT_SPACES_DESIGN §5.4), against a real database.
 *
 * A mission created with project context is filed under that project through
 * `project_resources` (relation "primary"); one created without it, or by a
 * caller without the project's editor role, is not — the attach is best-effort
 * and never blocks creation. `getWorkstreams(orgId, projectId)` then restricts
 * the derived run feed to the missions the junction names, still under the org
 * condition, so a foreign project id yields an empty feed rather than a leak.
 *
 * Runs against the pinned test database. NEVER hardcode a connection string:
 * point TEST_DATABASE_URL at a database whose name carries a distinct `test`
 * segment.
 */

configureTestEnvironment();

const { db } = await import("@server/database_service.js");
const { projectService } = await import("../../core/project.service.js");
const { missionService } = await import("../../../mission/core/mission.service.js");
const { missionQueryService } = await import("../../../mission/core/mission-query.service.js");
const { projects, projectResources } = await import("@shared/schema/projects.js");
const { orgs, users, userOrgs } = await import("@shared/schema/auth.js");
const { missions, missionRuns } = await import("@shared/schema/index.js");

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
        `[mission-attachment] SKIPPED — no test database reachable (${e?.message ?? e}). `
        + `Set TEST_DATABASE_URL and run npm run test:db:setup.`,
    );
}

const stamp = Date.now();

describe.skipIf(!reachable)("Mission project attachment (§5.4)", () => {
    let orgId: number;
    let ownerId: string;
    let outsiderId: string;
    let openProject: any;
    let privateProject: any;
    const missionIds: number[] = [];

    const asOwner = () => ({ organizationId: orgId, userId: ownerId });
    const asOutsider = () => ({ organizationId: orgId, userId: outsiderId });

    beforeAll(async () => {
        const [org] = await db
            .insert(orgs)
            .values({ name: `Mission Attach ${stamp}`, slug: `mission-attach-${stamp}` } as any)
            .returning();
        orgId = org.id;

        const [owner] = await db
            .insert(users)
            .values({
                username: `attach_owner_${stamp}`,
                password: "not-a-real-password",
                email: `attach_owner_${stamp}@example.test`,
            } as any)
            .returning();
        const [outsider] = await db
            .insert(users)
            .values({
                username: `attach_outsider_${stamp}`,
                password: "not-a-real-password",
                email: `attach_outsider_${stamp}@example.test`,
            } as any)
            .returning();
        ownerId = owner.id;
        outsiderId = outsider.id;

        await db.insert(userOrgs).values([
            { userId: ownerId, orgId },
            { userId: outsiderId, orgId },
        ] as any);

        openProject = await projectService.createProject(asOwner(), {
            name: `Attach Open ${stamp}`,
            visibility: "org",
        } as any);
        privateProject = await projectService.createProject(asOwner(), {
            name: `Attach Private ${stamp}`,
            visibility: "private",
        } as any);
    });

    afterAll(async () => {
        // project_resources and project_members cascade from projects; missions
        // and user_orgs cascade from the org.
        for (const id of missionIds) {
            await db.delete(missions).where(eq(missions.id, id)).catch(() => {});
        }
        if (orgId) {
            await db.delete(projects).where(eq(projects.organizationId, orgId)).catch(() => {});
            await db.delete(orgs).where(eq(orgs.id, orgId)).catch(() => {});
        }
        for (const id of [ownerId, outsiderId]) {
            if (id) await db.delete(users).where(eq(users.id, id)).catch(() => {});
        }
    });

    describe("createMission with project context", () => {
        it("files a mission under the project it was created in", async () => {
            const mission = await missionService.createMission({
                name: `Attached ${stamp}`,
                objective: "filed under the project",
                organizationId: orgId,
                projectId: openProject.id,
            } as any, ownerId);
            missionIds.push(mission.id);

            const [row] = await db
                .select()
                .from(projectResources)
                .where(and(
                    eq(projectResources.projectId, openProject.id),
                    eq(projectResources.resourceType, "mission"),
                    eq(projectResources.resourceId, mission.id),
                ));
            expect(row).toBeDefined();
            expect(row.relation).toBe("primary");
            expect(await projectService.resolveProjectForResource("mission", mission.id)).toBe(openProject.id);
        });

        it("creates the mission but leaves it unfiled when the caller cannot edit the project", async () => {
            // The junction write is the permission boundary, not creation itself:
            // a non-member of a private project still gets their mission — it just
            // is not filed where they asked.
            const mission = await missionService.createMission({
                name: `Unfiled ${stamp}`,
                objective: "caller lacks editor role",
                organizationId: orgId,
                projectId: privateProject.id,
            } as any, outsiderId);
            missionIds.push(mission.id);

            const rows = await db
                .select()
                .from(projectResources)
                .where(and(
                    eq(projectResources.resourceType, "mission"),
                    eq(projectResources.resourceId, mission.id),
                ));
            expect(rows).toHaveLength(0);
        });

        it("accepts a project key as well as an id", async () => {
            const mission = await missionService.createMission({
                name: `Keyed ${stamp}`,
                objective: "attached by project key",
                organizationId: orgId,
                projectKey: openProject.key,
            } as any, ownerId);
            missionIds.push(mission.id);

            expect(await projectService.resolveProjectForResource("mission", mission.id)).toBe(openProject.id);
        });

        it("leaves a mission without project context where the fallback would", async () => {
            const mission = await missionService.createMission({
                name: `Default-scoped ${stamp}`,
                objective: "no project context",
                organizationId: orgId,
            } as any, ownerId);
            missionIds.push(mission.id);

            const rows = await db
                .select()
                .from(projectResources)
                .where(and(
                    eq(projectResources.resourceType, "mission"),
                    eq(projectResources.resourceId, mission.id),
                ));
            expect(rows).toHaveLength(0);
        });
    });

    describe("project-filtered workstreams", () => {
        let filedMission: any;
        let unfiledMission: any;

        beforeAll(async () => {
            filedMission = await missionService.createMission({
                name: `WS Filed ${stamp}`,
                objective: "workstream source, filed",
                organizationId: orgId,
                projectId: openProject.id,
            } as any, ownerId);
            unfiledMission = await missionService.createMission({
                name: `WS Unfiled ${stamp}`,
                objective: "workstream source, unfiled",
                organizationId: orgId,
            } as any, ownerId);
            missionIds.push(filedMission.id, unfiledMission.id);

            for (const [mission, name] of [
                [filedMission, `Run filed ${stamp}`],
                [unfiledMission, `Run unfiled ${stamp}`],
            ] as const) {
                await db.insert(missionRuns).values({
                    missionId: mission.id,
                    organizationId: orgId,
                    name,
                    status: "active",
                    createdBy: ownerId,
                } as any);
            }
        });

        it("returns every org run when no project filter is given", async () => {
            const feed = await missionQueryService.getWorkstreams(orgId);
            const names = feed.map((w: any) => w.name);
            expect(names).toContain(`Run filed ${stamp}`);
            expect(names).toContain(`Run unfiled ${stamp}`);
        });

        it("returns only the project's missions when filtered", async () => {
            const feed = await missionQueryService.getWorkstreams(orgId, openProject.id);
            const names = feed.map((w: any) => w.name);
            expect(names).toContain(`Run filed ${stamp}`);
            expect(names).not.toContain(`Run unfiled ${stamp}`);
        });

        it("cannot leak another organization's missions through a foreign project id", async () => {
            const [otherOrg] = await db
                .insert(orgs)
                .values({ name: `Foreign ${stamp}`, slug: `foreign-${stamp}` } as any)
                .returning();
            try {
                const feed = await missionQueryService.getWorkstreams(orgId, privateProject.id);
                expect(feed.map((w: any) => w.name)).toHaveLength(0);

                // Even a real project id from another org intersects with the org
                // condition to nothing.
                const foreign = await projectService.createProject(
                    { organizationId: otherOrg.id, userId: ownerId },
                    { name: `Foreign Proj ${stamp}`, visibility: "org" } as any,
                );
                const foreignFeed = await missionQueryService.getWorkstreams(orgId, foreign.id);
                expect(foreignFeed.map((w: any) => w.name)).toHaveLength(0);
            } finally {
                await db.delete(orgs).where(eq(orgs.id, otherOrg.id)).catch(() => {});
            }
        });
    });
});
