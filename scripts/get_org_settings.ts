
import { db } from "../server/database_service.js";
import { orgSettings } from "../shared/schema/auth.js";
import { eq } from "drizzle-orm";

async function main() {
    const [settings] = await db.select().from(orgSettings).where(eq(orgSettings.organizationId, 1)).limit(1);
    console.log('ORG_SETTINGS:', JSON.stringify(settings, null, 2));
    process.exit(0);
}

main().catch(console.error);
