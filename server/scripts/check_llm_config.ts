import { db } from "../database_service.js";
import { llmProviders, llmModels, credentials } from "../../shared/schema/index.js";
import { eq, and } from "drizzle-orm";

async function main() {
  const orgId = 291;

  console.log("=== LLM Providers (org 291) ===");
  const providers = await db.select().from(llmProviders).where(eq(llmProviders.organizationId, orgId));
  console.log(JSON.stringify(providers, null, 2));

  console.log("\n=== LLM Models (org 291) ===");
  const models = await db.select().from(llmModels).where(eq(llmModels.organizationId, orgId));
  console.log(JSON.stringify(models, null, 2));

  console.log("\n=== Global LLM Providers (no org) ===");
  const globalProviders = await db.select().from(llmProviders).where(eq(llmProviders.isActive, true));
  for (const p of globalProviders) {
    console.log(`  [${p.id}] ${p.name} (isActive=${p.isActive}, apiKey=${p.apiKey ? p.apiKey.substring(0, 10) + '...' : 'null'})`);
  }

  console.log("\n=== AI Credentials for org 291 ===");
  const creds = await db.select().from(credentials).where(and(
    eq(credentials.type, 'ai_provider'),
    eq(credentials.organizationId, orgId)
  ));
  console.log(JSON.stringify(creds, null, 2));

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
