import "dotenv/config";
import { db } from "../database_service.js";
import { users } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function main() {
  const u = await db.select({ id: users.id, orgId: users.defaultOrgId }).from(users).where(eq(users.email, "admin@example.com"));
  console.log("Admin user:", u);
  process.exit(0);
}
main().catch(console.error);
