/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { configureTestEnvironment } from "../../../../../tests/configure-test-environment.js";

/**
 * Forms in private Project Spaces, against a real database:
 *  - a form's link is for the project's members unless its author opens it to anyone;
 *  - a cycle stage is not asked of an internal person outside the project;
 *  - a form's name is unique within its project, but not across the organization;
 *  - existing forms are put in the organization's default project;
 *  - the document picker lists the form's project documents first.
 */

configureTestEnvironment();

const { db } = await import("@server/database_service.js");
const { approvalRequests, hilForms, knowledgeDocuments, otpCodes } = await import("@shared/schema/index.js");
const { projects, projectResources } = await import("@shared/schema/projects.js");
const { orgs, users, userOrgs } = await import("@shared/schema/auth.js");
const { projectService } = await import("@domain/projects/core/project.service.js");
const { backfillOrg } = await import("@domain/projects/core/project-backfill.service.js");
const { formStudioService: studio } = await import("../../core/form-studio.service.js");
const { openFormStage } = await import("../../core/form-studio-stage-requests.service.js");
const access = await import("../../core/form-studio-access.js");
const { successionForm } = await import("@shared/form-studio-stages.fixture.js");

let reachable = false;
try {
    await db.execute("SELECT 1" as any);
    reachable = true;
} catch (e: any) {
    console.warn(
        `[form-studio-project-access] SKIPPED — no test database reachable (${e?.message ?? e}). `
        + `Set TEST_DATABASE_URL and run npm run test:db:setup.`,
    );
}

const stamp = Date.now();
const email = (role: string) => `access_${role}_${stamp}@example.test`;
const scored = {
    fields: [{ key: "score", label: "Score", type: "number", required: true }],
    studio: { version: 2, pages: [{ id: "page_1", title: "Score" }] },
};

describe.skipIf(!reachable)("Private Project Space forms", () => {
    let orgId: number;
    let ownerId: string, memberId: string, outsiderId: string;
    let privateProject: any;
    let form: any;
    let token: string;

    const studioCtx = (userId: string) => ({ organizationId: orgId, userId, isAdmin: false, isSuperAdmin: false, isOrgAdmin: false }) as any;
    const projectCtx = (userId: string) => ({ organizationId: orgId, userId });
    const tokens: string[] = [];

    async function formInProject(name: string, schema: unknown = scored) {
        const created = await studio.create(name, studioCtx(ownerId), { schema });
        await projectService.attachResource(projectCtx(ownerId), privateProject.id, "form", created.id);
        return created;
    }

    beforeAll(async () => {
        const [org] = await db.insert(orgs).values({ name: `Project access ${stamp}`, slug: `project-access-${stamp}` } as any).returning();
        orgId = org.id;
        const people = await db.insert(users).values(["owner", "member", "outsider"].map((role) => ({
            username: `access_${role}_${stamp}`, password: "not-a-real-password", email: email(role),
        })) as any).returning();
        [ownerId, memberId, outsiderId] = people.map((person: any) => person.id);
        await db.insert(userOrgs).values(people.map((person: any) => ({ userId: person.id, orgId })) as any);

        privateProject = await projectService.createProject(projectCtx(ownerId), { name: `Board ${stamp}`, visibility: "private" } as any);
        await projectService.addMember(projectCtx(ownerId), privateProject.key, { principalType: "user", principalId: memberId, role: "viewer" });

        form = await formInProject("Board pulse");
        const { href } = await studio.publish(form.id, 0, studioCtx(ownerId));
        token = href.split("/").pop()!;
        tokens.push(token);
    });

    afterAll(async () => {
        if (!orgId) return;
        await db.delete(approvalRequests).where(eq(approvalRequests.organizationId, orgId));
        for (const t of tokens) await db.delete(otpCodes).where(eq(otpCodes.executionId, `form_link:${t}`));
        await db.delete(knowledgeDocuments).where(eq(knowledgeDocuments.organizationId, orgId));
        await db.delete(hilForms).where(eq(hilForms.organizationId, orgId));
        await db.delete(projects).where(eq(projects.organizationId, orgId)).catch(() => {});
        await db.execute(sql`delete from knowledge_topics where organization_id = ${orgId}`).catch(() => undefined);
        await db.delete(orgs).where(eq(orgs.id, orgId)).catch(() => {});
        await db.delete(users).where(inArray(users.id, [ownerId, memberId, outsiderId].filter(Boolean))).catch(() => {});
    });

    it("gives a private project's form a members-only link, sending a code only to a member's email", async () => {
        const opened = await studio.published(token);
        expect(opened.access).toEqual({ membersOnly: true, projectId: privateProject.id, projectName: privateProject.name });
        expect(opened.security.requireOtp).toBe(false);
        expect(await studio.linkAccess(form.id, studioCtx(ownerId))).toEqual({
            project: { key: privateProject.key, name: privateProject.name, visibility: "private" }, chosen: null, audience: "project_members",
        });

        const codesFor = async (address: string) => db.select().from(otpCodes).where(and(eq(otpCodes.executionId, `form_link:${token}`), eq(otpCodes.email, address)));
        expect(await studio.requestLinkCode(token, email("outsider"))).toEqual({ status: "sent", membersOnly: true });
        expect(await codesFor(email("outsider"))).toEqual([]);
        expect(await studio.requestLinkCode(token, email("member"))).toEqual({ status: "sent", membersOnly: true });
        expect(await codesFor(email("member"))).toHaveLength(1);

        await expect(studio.submit(token, 0, { score: 4 }, null)).rejects.toThrow(`Only members of ${privateProject.name} can answer this form.`);
        await expect(studio.submit(token, 0, { score: 4 }, { email: email("outsider") })).rejects.toThrow(/Only members of/);
        expect((await studio.submit(token, 0, { score: 4 }, { email: email("member") })).id).toBeGreaterThan(0);
    });

    it("lets the author open the link to anyone, and return it to members only", async () => {
        await studio.setLinkSecurity(form.id, { requireOtp: false, tokenExpirationHours: null, audience: "anyone" }, studioCtx(ownerId));
        expect((await studio.published(token)).access.membersOnly).toBe(false);
        expect((await studio.linkAccess(form.id, studioCtx(ownerId))).audience).toBe("anyone");
        expect((await studio.submit(token, 0, { score: 2 }, null)).id).toBeGreaterThan(0);

        // Leaving the audience out keeps it; null returns it to the default.
        await studio.setLinkSecurity(form.id, { requireOtp: true, tokenExpirationHours: null }, studioCtx(ownerId));
        expect((await studio.published(token)).access.membersOnly).toBe(false);
        await studio.setLinkSecurity(form.id, { requireOtp: false, tokenExpirationHours: null, audience: null }, studioCtx(ownerId));
        expect((await studio.published(token)).access.membersOnly).toBe(true);
    });

    it("turns away a member removed from the project", async () => {
        await projectService.removeMember(projectCtx(ownerId), privateProject.key, "user", memberId);
        await expect(studio.submit(token, 0, { score: 3 }, { email: email("member") })).rejects.toThrow(/Only members of/);
        expect(await access.emailCanReadProject(privateProject.id, orgId, email("owner"))).toBe(true);
        await projectService.addMember(projectCtx(ownerId), privateProject.key, { principalType: "user", principalId: memberId, role: "viewer" });
    });

    it("does not ask an internal person outside a private project for a stage, but still asks members and external people", async () => {
        const staged = await formInProject("Succession review", successionForm());
        await studio.publish(staged.id, 0, studioCtx(ownerId));
        const open = (approvers: any[], n: number) => openFormStage({
            organizationId: orgId, formId: staged.id, stageId: "candidate", approvers, jobId: 0, pipelineName: "Succession cycle",
            stepExecutionId: 1_700_000_000 + (stamp % 100_000) + n,
        });

        expect(await open([{ type: "internal", id: outsiderId }, { type: "internal", id: memberId }], 1)).toEqual({
            kind: "failed",
            error: `"Candidate self-assessment" belongs to the private project ${privateProject.name}, and ${email("outsider")} is not a member. Add them to the project, or name members on the step.`,
        });
        expect(await open([{ type: "internal", id: memberId }], 2)).toMatchObject({ kind: "waiting" });
        expect(await open([{ type: "external", email: "candidate@example.com" }], 3)).toMatchObject({ kind: "waiting" });
    });

    it("keeps a form's name unique within its project, but not across the organization", async () => {
        const first = await formInProject("Quarterly review");
        const twin = await studio.create("Quarterly review", studioCtx(ownerId), { schema: scored });
        await expect(projectService.attachResource(projectCtx(ownerId), privateProject.id, "form", twin.id))
            .rejects.toThrow(`Another form in project '${privateProject.key}' already has this form's name. Rename one of them first.`);
        expect(await projectService.resolveProjectForResource("form", twin.id)).toBeNull();
        expect((await db.select().from(hilForms).where(eq(hilForms.id, first.id)))[0].projectId).toBe(privateProject.id);

        await expect(access.assertNameFreeInProject(privateProject.id, "Quarterly review")).rejects.toThrow('Another form in this project is already called "Quarterly review".');
        await access.assertNameFreeInProject(privateProject.id, "Quarterly review", first.id);

        const other = await formInProject("Annual review");
        const renamed = await studio.save(other.id, 0, { name: "Quarterly review" }, studioCtx(ownerId)).catch((error) => access.projectNameConflict(error, "Quarterly review"));
        expect(renamed).toBeInstanceOf(Error);
        expect((renamed as Error).message).toBe('Another form in this project is already called "Quarterly review". Choose a different name.');
    });

    it("puts existing forms in the default project without namespacing their names", async () => {
        const a = await studio.create(`Legacy intake ${stamp}`, studioCtx(ownerId), { schema: scored });
        const b = await studio.create(`Legacy intake ${stamp}`, studioCtx(ownerId), { schema: scored });
        const report = await backfillOrg(orgId, { userId: ownerId });
        expect(report.attached.form).toBeGreaterThanOrEqual(2);
        for (const created of [a, b]) {
            expect(await projectService.resolveProjectForResource("form", created.id)).toBe(report.defaultProjectId);
            expect((await db.select().from(hilForms).where(eq(hilForms.id, created.id)))[0].projectId).toBeNull();
        }
        // A form already in a project stays there.
        expect(await projectService.resolveProjectForResource("form", form.id)).toBe(privateProject.id);
        const homes = await db.select().from(projectResources).where(and(eq(projectResources.resourceType, "form"), eq(projectResources.resourceId, form.id)));
        expect(homes).toHaveLength(1);
    });

    it("lists the form's project documents first in the document picker", async () => {
        await db.insert(knowledgeDocuments).values([
            { title: `Handbook ${stamp}`, organizationId: orgId, sourceType: "upload" },
            { title: `Board charter ${stamp}`, organizationId: orgId, sourceType: "upload", projectId: privateProject.id },
        ] as any);
        const sources = await studio.sources(String(stamp), studioCtx(memberId), { formId: form.id });
        expect(sources.map((source: any) => [source.title, source.inProject])).toEqual([
            [`Board charter ${stamp}`, true],
            [`Handbook ${stamp}`, false],
        ]);
        await expect(studio.sources(String(stamp), studioCtx(outsiderId), { formId: form.id })).rejects.toThrow("Form not found.");
        expect((await db.select().from(knowledgeDocuments).where(like(knowledgeDocuments.title, `%${stamp}`))).length).toBe(2);
    });
});
