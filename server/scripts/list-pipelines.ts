import { db } from "../database_service.js";
import { pipelines } from "../../shared/schema/index.js";
import { eq, and, or, ilike } from "drizzle-orm";

async function main() {
    console.log("--- FILTERED PIPELINES FOR ORG 291 ---");
    const list = await db.select()
        .from(pipelines)
        .where(and(
            eq(pipelines.organizationId, 291),
            or(
                ilike(pipelines.name, "%triage%"),
                ilike(pipelines.name, "%dispatch%"),
                ilike(pipelines.name, "%service%"),
                ilike(pipelines.name, "%asset%")
            )
        ));
    console.log(JSON.stringify(list.map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
        isActive: p.isActive
    })), null, 2));
}

main().catch(console.error).finally(() => process.exit(0));
