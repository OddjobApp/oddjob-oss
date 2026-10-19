/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { configureTestEnvironment } from "../../../../../tests/configure-test-environment.js";

/**
 * Phase 8 exit, against a real database: a private Project Space's forms and
 * responses are visible only to its members (and org admins). Outside the project
 * the form is not found anywhere in Form Studio; inside it, the project's Forms tab
 * lists the form, its waiting stages and its recent results.
 */

configureTestEnvironment();

const { db } = await import("@server/database_service.js");
const { approvalRequests, hilForms } = await import("@shared/schema/index.js");
const { projects } = await import("@shared/schema/projects.js");
const { orgs, users, userOrgs } = await import("@shared/schema/auth.js");
const { projectService } = await import("@domain/projects/core/project.service.js");
const { formStudioService: studio } = await import("../../core/form-studio.service.js");
const { formStudioLibrary: library } = await import("../../core/form-studio-library.service.js");
const { projectFormsOverview } = await import("../../core/form-studio-projects.service.js");

let reachable = false;
try {
    await db.execute("SELECT 1" as any);
    reachable = true;
} catch (e: any) {
    console.warn(
        `[form-studio-projects] SKIPPED — no test database reachable (${e?.message ?? e}). `
        + `Set TEST_DATABASE_URL and run npm run test:db:setup.`,
    );
}

const stamp = Date.now();
const definition = {
    fields: [{ key: "score", label: "Score", type: "number", required: true }],
    studio: { version: 2, pages: [{ id: "page_1", title: "Score" }], decisionRules: [{ id: "high", when: "score >= 5", status: "HIGH" }], defaultStatus: "LOW" },
};

describe.skipIf(!reachable)("Forms in Project Spaces", () => {
    let orgId: number;
    let ownerId: string, memberId: string, outsiderId: string;
    let privateProject: any, openProject: any;
    let privateForm: any, openForm: any;

    const studioCtx = (userId: string, extra: Record<string, unknown> = {}) =>
        ({ organizationId: orgId, userId, isAdmin: false, isSuperAdmin: false, isOrgAdmin: false, ...extra }) as any;
    const projectCtx = (userId: string, extra: Record<string, unknown> = {}) => ({ organizationId: orgId, userId, ...extra });

    beforeAll(async () => {
        const [org] = await db.insert(orgs).values({ name: `Project forms ${stamp}`, slug: `project-forms-${stamp}` } as any).returning();
        orgId = org.id;
        const people = await db.insert(users).values(["owner", "member", "outsider"].map((role) => ({
            username: `forms_${role}_${stamp}`, password: "not-a-real-password", email: `forms_${role}_${stamp}@example.test`,
        })) as any).returning();
        [ownerId, memberId, outsiderId] = people.map((person: any) => person.id);
        await db.insert(userOrgs).values(people.map((person: any) => ({ userId: person.id, orgId })) as any);

        privateProject = await projectService.createProject(projectCtx(ownerId), { name: `Succession ${stamp}`, visibility: "private" } as any);
        openProject = await projectService.createProject(projectCtx(ownerId), { name: `Pulse ${stamp}`, visibility: "org" } as any);
        await projectService.addMember(projectCtx(ownerId), privateProject.key, { principalType: "user", principalId: memberId, role: "editor" });

        privateForm = await studio.create("Succession review", studioCtx(ownerId), { schema: definition });
        openForm = await studio.create("Pulse survey", studioCtx(ownerId), { schema: definition });
        await projectService.attachResource(projectCtx(ownerId), privateProject.id, "form", privateForm.id);
        await projectService.attachResource(projectCtx(ownerId), openProject.id, "form", openForm.id);

        const { href } = await studio.publish(privateForm.id, 0, studioCtx(ownerId));
        // A private project's link is for its members.
        await studio.submit(href.split("/").pop()!, 0, { score: 7 }, { email: `forms_member_${stamp}@example.test` });
    });

    afterAll(async () => {
        if (!orgId) return;
        await db.delete(approvalRequests).where(eq(approvalRequests.organizationId, orgId));
        await db.delete(hilForms).where(eq(hilForms.organizationId, orgId));
        await db.delete(projects).where(eq(projects.organizationId, orgId)).catch(() => {});
        await db.delete(orgs).where(eq(orgs.id, orgId)).catch(() => {});
        await db.delete(users).where(inArray(users.id, [ownerId, memberId, outsiderId].filter(Boolean))).catch(() => {});
    });

    it("hides a private project's form and its responses from everyone outside the project", async () => {
        const outsider = studioCtx(outsiderId);
        const listed = (await library.list(outsider)).map((row) => row.id);
        expect(listed).not.toContain(privateForm.id);
        expect(listed).toContain(openForm.id);

        await expect(studio.get(privateForm.id, outsider)).rejects.toThrow("Form not found.");
        await expect(studio.responses(privateForm.id, outsider)).rejects.toThrow("Form not found.");
        await expect(studio.save(privateForm.id, 0, { name: "Renamed" }, outsider)).rejects.toThrow("Form not found.");
        await expect(studio.rotateLink(privateForm.id, outsider)).rejects.toThrow("Form not found.");
        await expect(library.usage(privateForm.id, outsider)).rejects.toThrow("Form not found.");
        await expect(projectService.getProject(projectCtx(outsiderId), privateProject.key)).rejects.toThrow(/not found/i);
    });

    it("shows it to the project's members and to org admins", async () => {
        expect((await library.list(studioCtx(memberId))).map((row) => row.id)).toContain(privateForm.id);
        expect((await studio.get(privateForm.id, studioCtx(memberId))).name).toBe("Succession review");
        expect(await studio.responses(privateForm.id, studioCtx(memberId))).toHaveLength(1);
        expect((await studio.get(privateForm.id, studioCtx(outsiderId, { isOrgAdmin: true }))).id).toBe(privateForm.id);
    });

    it("lists the project's forms, waiting stages and recent results on its Forms tab", async () => {
        const [stage] = await db.insert(approvalRequests).values({
            executionId: String(1_800_000_000 + (stamp % 1000)), approverType: "internal", approverEmail: `forms_member_${stamp}@example.test`,
            status: "pending", token: `form-stage-${randomUUID()}`, organizationId: orgId,
            modifiedOutput: { kind: "form_stage", formId: privateForm.id, formName: "Succession review", responseId: 1, stageId: "hr", stageTitle: "HR data", releaseNumber: 1 },
        } as any).returning();

        const overview = await projectFormsOverview(studioCtx(memberId), privateProject.id);
        expect(overview.forms.map((form) => form.id)).toEqual([privateForm.id]);
        expect(overview.waitingStages).toEqual([expect.objectContaining({ approvalId: stage.id, formId: privateForm.id, stageTitle: "HR data" })]);
        expect(overview.recentResults).toEqual([expect.objectContaining({ formId: privateForm.id, formName: "Succession review", status: "HIGH", releaseNumber: 1 })]);
        expect(overview.responseDatasets).toEqual([]);
    });

    it("attaches only this organization's forms, and only forms the caller can already see", async () => {
        await expect(projectService.attachResource(projectCtx(ownerId), openProject.id, "form", 2_000_000_000)).rejects.toThrow("Form 2000000000 not found.");
        // An editor of the open project cannot pull a form out of a private project they are not in.
        await projectService.addMember(projectCtx(ownerId), openProject.key, { principalType: "user", principalId: outsiderId, role: "editor" });
        await expect(projectService.attachResource(projectCtx(outsiderId), openProject.id, "form", privateForm.id)).rejects.toThrow(`Form ${privateForm.id} not found.`);
        expect(await projectService.resolveProjectForResource("form", privateForm.id)).toBe(privateProject.id);
    });
});
