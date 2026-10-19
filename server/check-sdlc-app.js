import { db } from "./database_service.js";
import { apps } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function checkApp() {
  try {
    const result = await db.select().from(apps).where(eq(apps.slug, 'sdlc-workbench'));
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkApp();
