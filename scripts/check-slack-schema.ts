import { db } from "../server/database_service.js";
import { sql } from "drizzle-orm";

async function check() {
    try {
        const result = await db.execute(sql.raw("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'slack_notifications' ORDER BY ordinal_position"));
        const rows = (result as any).rows || result;
        console.log("slack_notifications columns:");
        rows.forEach((r: any) => console.log("  " + r.column_name + " (" + r.data_type + ")"));
        if (rows.length === 0) console.log("  TABLE DOES NOT EXIST or HAS NO COLUMNS");
    } catch(e: any) {
        console.log("Error:", e.message);
    }

    // Also check the server log for the notification route error
    try {
        const { slackNotifications } = await import("@shared/schema/index.js");
        const notifications = await db.select().from(slackNotifications).limit(1);
        console.log("\nDirect query result:", JSON.stringify(notifications));
    } catch(e: any) {
        console.log("\nDirect query error:", e.message.substring(0, 200));
    }

    process.exit(0);
}
check();
