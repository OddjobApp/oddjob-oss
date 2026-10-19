import { eq, or, sql, type SQL } from "drizzle-orm";
import type { OrgContext } from "./auth-context.js";

/**
 * Returns Drizzle SQL conditions for organization-level filtering.
 * @param orgContext the resolved user/org context
 * @param table the Drizzle schema table (must have an `organizationId` column)
 * @param allowGlobal whether to include shared global resources (organizationId IS NULL)
 */
export function getOrgConditions(orgContext: OrgContext, table?: any, allowGlobal: boolean = true): SQL[] {
    // Super admins see everything ONLY if they haven't selected a specific organization context.
    // If an organization is selected, we filter by it to prevent technical clutter in business views.
    if (orgContext.isSuperAdmin && orgContext.organizationId === null) return [];

    if (table) {
        if (orgContext.organizationId !== null) {
            return allowGlobal
                ? [or(eq(table.organizationId, orgContext.organizationId), sql`${table.organizationId} IS NULL`)!]
                : [eq(table.organizationId, orgContext.organizationId)];
        } else {
            return [sql`${table.organizationId} IS NULL`];
        }
    }

    // Fallback if no table is explicitly provided 
    if (orgContext.organizationId !== null) {
        return allowGlobal
            ? [sql`(organization_id = ${orgContext.organizationId} OR organization_id IS NULL)`]
            : [sql`organization_id = ${orgContext.organizationId}`];
    } else {
        return [sql`organization_id IS NULL`];
    }
}

