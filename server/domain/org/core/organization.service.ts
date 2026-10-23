import { db } from "@server/database_service.js";
import { orgs, userOrgs, jobs } from "@shared/schema/index.js";
import { eq, sql, and } from "drizzle-orm";
import { BadRequestError, NotFoundError, ForbiddenError, ValidationError } from "@server/utils/errors.js";
import { requireOrgId, type OrgContext } from "../../../utils/auth-context.js";

/**
 * Who may act on an organization.
 *
 * `isAdmin` means "administers the organization in this context" - an org
 * admin, or an org's API key - not "administers the platform". These methods
 * checked only `isAdmin`, so any org admin or API key could list every tenant
 * and rename or delete any organization by id; the member methods let an
 * isAdmin-but-not-isOrgAdmin context (an API key) manage any org's users,
 * while blocking super admins, who are also org admins of their own org.
 */
function requirePlatformAdmin(context: OrgContext): void {
    if (!context.isSuperAdmin) throw new ForbiddenError("Platform administrator access required");
}

function requireAdminOf(orgId: number, context: OrgContext): void {
    if (context.isSuperAdmin) return;
    if ((context.isAdmin || context.isOrgAdmin) && context.organizationId === orgId) return;
    throw new ForbiddenError("Access denied");
}

export class OrganizationService {
    /**
     * List all organizations with user and job counts.
     * Requires Admin access.
     */
    async listOrganizations(context: OrgContext) {
        if (!context.isSuperAdmin && !(context.isAdmin && context.organizationId != null)) {
            throw new ForbiddenError("Admin access required");
        }

        const allOrgs = context.isSuperAdmin
            ? await db.select().from(orgs).orderBy(orgs.createdAt)
            : await db.select().from(orgs).where(eq(orgs.id, requireOrgId(context))).orderBy(orgs.createdAt);

        // Enrich with stats
        const orgsWithStats = [];
        for (const org of allOrgs) {
            const [userCount] = await db.select({ count: sql<number>`COUNT(*)` })
                .from(userOrgs)
                .where(eq(userOrgs.orgId, org.id));

            const [jobCount] = await db.select({ count: sql<number>`COUNT(*)` })
                .from(jobs)
                .where(eq(jobs.organizationId, org.id));

            orgsWithStats.push({
                ...org,
                userCount: Number(userCount?.count || 0),
                jobCount: Number(jobCount?.count || 0)
            });
        }

        return orgsWithStats;
    }

    /**
     * Get a single organization by ID.
     */
    async getOrganization(id: number, context: OrgContext) {
        requireAdminOf(id, context);

        const [org] = await db.select().from(orgs).where(eq(orgs.id, id)).limit(1);
        if (!org) throw new NotFoundError("Organization not found", "NOT_FOUND", { orgId: id });

        return org;
    }

    /**
     * Create a new organization.
     */
    async createOrganization(data: { name: string; suppressionPolicyId?: number }, context: OrgContext) {
        requirePlatformAdmin(context);

        if (!data.name?.trim()) throw new ValidationError("Organization name is required", { field: 'name' });

        const org = await this.insertOrganizationRecord(db, data);
        await this.seedOrganizationDefaults(org.id, context.userId);
        return org;
    }

    /**
     * The organization row and its default settings, written with `executor` -
     * `db`, or a transaction when the caller provisions more alongside (signup
     * creates the user, the org, the membership and the admin role together).
     * No authorization: callers decide who may provision.
     */
    async insertOrganizationRecord(
        executor: Pick<typeof db, "insert">,
        data: { name: string; suppressionPolicyId?: number | null; companySize?: string; industry?: string },
    ) {
        const [org] = await executor.insert(orgs).values({
            name: data.name.trim(),
            ...(data.companySize ? { companySize: data.companySize } : {}),
            ...(data.industry ? { industry: data.industry } : {}),
            suppressionPolicyId: data.suppressionPolicyId || null
        }).returning();

        // Initialize default organization settings
        const { orgSettings } = await import("@shared/schema/index.js");
        await executor.insert(orgSettings).values({
            organizationId: org.id,
            knowledgeStoreEnabled: true,
            knowledgeGraphEnabled: true,
            psychologistEnabled: true,
            skillImportEnabled: false,
            autoresearchEnabled: true,
            trustgraphEnabled: true,
            mcpHttpEnabled: false
        });
        return org;
    }

    /**
     * Best-effort defaults for a new organization: ontology types and agent
     * cards. Run after the organization is committed; a seeding failure never
     * undoes or blocks provisioning.
     */
    async seedOrganizationDefaults(organizationId: number, userId: string) {
        // Seed the default Ontology Object Types (Mission/Job/Pipeline/Dataset).
        try {
            const { ontologyService } = await import("@domain/knowledge/core/ontology.service.js");
            await ontologyService.seedDefaultObjectTypes({ organizationId, userId });
            // After the types: a link can only be declared once both of its ends exist.
            await ontologyService.seedDefaultLinkTypes({ organizationId, userId });
        } catch (err) {
            console.warn(`[OrganizationService] Failed to seed default ontology types for org ${organizationId}:`, err);
        }

        // Seed default Agent Cards (Coder, Analyst, Media Creator) for the Intent Router.
        try {
            const { seedProvisioningService } = await import("@domain/agent-cards/core/seed-provisioning.service.js");
            await seedProvisioningService.seedForOrganization(organizationId);
        } catch (err) {
            console.warn(`[OrganizationService] Failed to seed default agent cards for org ${organizationId}:`, err);
        }
    }

    /**
     * Update an organization.
     */
    async updateOrganization(
        id: number,
        data: { name?: string; suppressionPolicyId?: number | null; timezone?: string | null },
        context: OrgContext
    ) {
        requireAdminOf(id, context);

        // Reject an unusable zone rather than storing it: a bad IANA id would
        // silently fall back to the browser everywhere it is consumed, which
        // looks identical to "not configured" and is impossible to debug.
        if (data.timezone != null && data.timezone !== "") {
            try {
                new Intl.DateTimeFormat("en-US", { timeZone: data.timezone });
            } catch {
                throw new BadRequestError(
                    `Invalid timezone "${data.timezone}". Expected an IANA identifier such as "America/Los_Angeles".`
                );
            }
        }

        const [updated] = await db.update(orgs)
            .set({
                ...(data.name && { name: data.name.trim() }),
                // Only touch these when the caller actually supplied them.
                // suppressionPolicyId was previously set unconditionally, so a
                // rename — which sends only `name` — silently cleared the org's
                // suppression policy.
                ...(data.suppressionPolicyId !== undefined && {
                    suppressionPolicyId: data.suppressionPolicyId || null,
                }),
                // An empty string means "clear it"; undefined means "leave it".
                ...(data.timezone !== undefined && {
                    timezone: data.timezone ? data.timezone.trim() : null,
                }),
            })
            .where(eq(orgs.id, id))
            .returning();

        if (!updated) throw new NotFoundError("Organization not found", "NOT_FOUND", { orgId: id });

        return updated;
    }

    /**
     * Delete an organization.
     */
    async deleteOrganization(id: number, context: OrgContext) {
        requirePlatformAdmin(context);

        // Check for existing users
        const [userCount] = await db.select({ count: sql<number>`COUNT(*)` })
            .from(userOrgs)
            .where(eq(userOrgs.orgId, id));

        if (Number(userCount?.count || 0) > 0) throw new BadRequestError("Cannot delete organization with users.");

        await db.delete(orgs).where(eq(orgs.id, id));
    }

    /**
     * List users in an organization.
     */
    async listOrganizationUsers(orgId: number, context: OrgContext) {
        requireAdminOf(orgId, context);

        const { users } = await import("@shared/schema/index.js");

        const orgUsers = await db.select({
            userId: userOrgs.userId,
            username: users.username,
            email: users.email,
            firstName: users.firstName,
            lastName: users.lastName
        })
            .from(userOrgs)
            .innerJoin(users, eq(userOrgs.userId, users.id))
            .where(eq(userOrgs.orgId, orgId));

        return orgUsers;
    }

    /**
     * Add a user to an organization.
     */
    async addUserToOrganization(orgId: number, userId: string, context: OrgContext) {
        requireAdminOf(orgId, context);

        const { users } = await import("@shared/schema/index.js");

        const [existing] = await db.select().from(userOrgs)
            .where(and(eq(userOrgs.userId, userId), eq(userOrgs.orgId, orgId)))
            .limit(1);

        if (existing) throw new BadRequestError("User already in organization");

        await db.insert(userOrgs).values({ userId, orgId });

        // Update default org if not set
        const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
        if (user && !user.defaultOrgId) {
            await db.update(users).set({ defaultOrgId: orgId }).where(eq(users.id, userId));
        }
    }

    /**
     * Remove a user from an organization.
     */
    async removeUserFromOrganization(orgId: number, userId: string, context: OrgContext) {
        requireAdminOf(orgId, context);

        await db.delete(userOrgs)
            .where(and(eq(userOrgs.userId, userId), eq(userOrgs.orgId, orgId)));
    }
}

export const organizationService = new OrganizationService();


