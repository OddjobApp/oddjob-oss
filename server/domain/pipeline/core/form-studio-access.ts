import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { adminRoles, users } from "@shared/schema/auth.js";
import { hilForms } from "@shared/schema/hil.js";
import { projectResources, projects } from "@shared/schema/projects.js";
import type { OrgContext } from "@server/utils/auth-context.js";
import { ConflictError, NotFoundError } from "@server/utils/errors.js";

/**
 * Forms in Project Spaces.
 *
 * A form belongs to one project: its primary `project_resources` row, which is the
 * organization's default project until it is put in another. In an org-visible
 * project everyone in the organization sees it, as before. In a private project only
 * the project's members and org admins do. For everyone else the form does not exist
 * anywhere in Form Studio: the library, the Studio, its responses, its link settings,
 * and CREW's form tools all read through these checks. A hidden form reads exactly
 * like an absent one, so its existence is not given away.
 *
 * A private project's form also has a members-only link unless its author opens it
 * to anyone, only members fill in its cycle stages, and its name is unique within
 * the project.
 */

const projectCtxOf = (ctx: OrgContext) => ({
    organizationId: ctx.organizationId as number,
    userId: ctx.userId ?? undefined,
    isSuperAdmin: Boolean(ctx.isSuperAdmin),
    isOrgAdmin: Boolean(ctx.isOrgAdmin),
});

export interface FormProject {
    id: number;
    key: string;
    name: string;
    visibility: string;
    isDefault: boolean;
}

/** The form's Project Space, or null when it has none. */
export async function formProjectId(formId: number): Promise<number | null> {
    const { projectService } = await import("@domain/projects/core/project.service.js");
    return projectService.resolveProjectForResource("form", formId);
}

export async function formProject(formId: number): Promise<FormProject | null> {
    const projectId = await formProjectId(formId);
    if (projectId === null) return null;
    const [project] = await db
        .select({ id: projects.id, key: projects.key, name: projects.name, visibility: projects.visibility, isDefault: projects.isDefault })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);
    return project ?? null;
}

/** Refuses, as not found, a form in a private project the caller cannot read. */
export async function assertFormVisible(formId: number, ctx: OrgContext): Promise<void> {
    if (ctx.organizationId == null) return;
    const { projectService } = await import("@domain/projects/core/project.service.js");
    const projectId = await projectService.resolveProjectForResource("form", formId);
    if (projectId === null) return;
    try {
        await projectService.getProject(projectCtxOf(ctx), projectId);
    } catch (error) {
        if (error instanceof NotFoundError) throw new NotFoundError("Form not found.");
        throw error;
    }
}

/** The forms in the caller's organization that sit in private projects the caller cannot read. */
export async function hiddenFormIds(ctx: OrgContext): Promise<Set<number>> {
    const hidden = new Set<number>();
    if (ctx.organizationId == null) return hidden;
    const rows = await db
        .select({ formId: projectResources.resourceId, project: projects })
        .from(projectResources)
        .innerJoin(projects, eq(projects.id, projectResources.projectId))
        .where(and(
            eq(projectResources.resourceType, "form"),
            eq(projectResources.relation, "primary"),
            eq(projects.organizationId, ctx.organizationId),
            eq(projects.visibility, "private"),
        ));
    if (!rows.length) return hidden;

    const { projectService } = await import("@domain/projects/core/project.service.js");
    const readable = new Map<number, boolean>();
    for (const { formId, project } of rows) {
        if (!readable.has(project.id)) readable.set(project.id, (await projectService.roleFor(projectCtxOf(ctx), project)) !== null);
        if (!readable.get(project.id)) hidden.add(formId);
    }
    return hidden;
}

/**
 * Whether a user can read a project: anyone in the organization for an org-visible
 * project; for a private one its members and owner, an admin of this organization,
 * or a super admin.
 */
export async function userCanReadProject(projectId: number, organizationId: number, userId: string): Promise<boolean> {
    const [project] = await db.select().from(projects)
        .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId))).limit(1);
    if (!project) return false;
    if (project.visibility !== "private") return true;
    const [role] = await db.select({ role: adminRoles.role, organizationId: adminRoles.organizationId }).from(adminRoles)
        .where(eq(adminRoles.userId, userId)).limit(1);
    const { projectService } = await import("@domain/projects/core/project.service.js");
    const projectRole = await projectService.roleFor({
        organizationId,
        userId,
        isSuperAdmin: role?.role === "super_admin",
        isOrgAdmin: role?.role === "org_admin" && role.organizationId === organizationId,
    }, project);
    return projectRole !== null;
}

/** Whether a person with this email address, as a user of the platform, can read the project. */
export async function emailCanReadProject(projectId: number, organizationId: number, email: string): Promise<boolean> {
    const matches = await db.select({ id: users.id }).from(users)
        .where(sql`lower(${users.email}) = ${email.trim().toLowerCase()}`);
    for (const user of matches) {
        if (await userCanReadProject(projectId, organizationId, user.id)) return true;
    }
    return false;
}

const nameTaken = (name?: string) => new ConflictError(
    name
        ? `Another form in this project is already called "${name}". Choose a different name.`
        : "Another form in this project already has that name. Choose a different name.",
    { reason: "project_name_taken" },
);

/** Refuses a name another live form in this project already has. Not for a default project, which does not namespace names. */
export async function assertNameFreeInProject(projectId: number, name: string, exceptFormId?: number): Promise<void> {
    const [clash] = await db.select({ id: hilForms.id }).from(hilForms).where(and(
        eq(hilForms.projectId, projectId),
        eq(hilForms.kind, "template"),
        eq(hilForms.isArchived, false),
        eq(hilForms.name, name),
        exceptFormId ? ne(hilForms.id, exceptFormId) : undefined,
    )).limit(1);
    if (clash) throw nameTaken(name);
}

/** The database's unique-name refusal for a form, in words; any other error unchanged. */
export function projectNameConflict(error: unknown, name?: string): unknown {
    const e = error as { code?: string; constraint?: string; message?: string; cause?: { code?: string; constraint?: string } } | null;
    const code = e?.code ?? e?.cause?.code;
    const detail = `${e?.constraint ?? e?.cause?.constraint ?? ""} ${e?.message ?? ""}`;
    return code === "23505" && detail.includes("hil_forms_project_name_unique") ? nameTaken(name) : error;
}

/** A new form starts in the organization's default project, where every unassigned resource lives. */
export async function attachToDefaultProject(formId: number, organizationId: number, userId: string | null): Promise<void> {
    const { projectService } = await import("@domain/projects/core/project.service.js");
    const projectId = await projectService.resolveDefaultProjectId(organizationId);
    if (projectId === null) return;
    await db.insert(projectResources)
        .values({ projectId, resourceType: "form", resourceId: formId, relation: "primary", addedBy: userId })
        .onConflictDoNothing();
    projectService.resourceCache.invalidate("form", formId);
}
