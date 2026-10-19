/**
 * Scope authorization for X-Ray prefetch manifests.
 *
 * Extracted from prefetch-manifest.route.ts. The check lived in a helper inside
 * the route file and reached for db through dynamic imports, which kept it out of
 * lint:arch's single-line pattern without making it any less of a route-level
 * database access.
 */
import { eq } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { apps } from "@shared/schema/index.js";

export const xrayScopeAccessService = {
    /**
     * True when the org may read this scope.
     * "oddjob" is the platform scope and is open to any authenticated user;
     * an app scope requires the app to be shared (null org) or owned by the org.
     */
    async verifyScopeAccess(scope: string, organizationId: number, isSuperAdmin?: boolean): Promise<boolean> {
        if (scope === "oddjob") return true;
        if (isSuperAdmin) return true;

        const [app] = await db
            .select({ id: apps.id, organizationId: apps.organizationId })
            .from(apps)
            .where(eq(apps.slug, scope))
            .limit(1);

        if (!app) return false;
        if (app.organizationId === null) return true; // shared/public app
        return app.organizationId === organizationId;
    },
};
