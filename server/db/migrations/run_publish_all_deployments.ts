import { db } from "../../database_service.js";
import { appDeployments } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function publishAllDeployments() {
    try {
        const result = await db.update(appDeployments)
            .set({ isPublished: true, status: "active" })
            .where(eq(appDeployments.isPublished, false))
            .returning({ id: appDeployments.id, slug: appDeployments.publicSlug });

        console.log(`Updated ${result.length} app deployments to isPublished=true, status='active':`);
        for (const item of result) {
            console.log(`- #${item.id} (${item.slug})`);
        }
    } catch (err) {
        console.error("Migration error:", err);
    } finally {
        process.exit(0);
    }
}

publishAllDeployments();
