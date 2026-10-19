
import { db } from "../server/database_service.js";
import { missionRuns } from "../shared/schema/index.js";
import { eq, inArray } from "drizzle-orm";

async function main() {
    const runIds = [2078, 2079];
    console.log(`Updating tools for missions: ${runIds.join(', ')}`);

    for (const id of runIds) {
        const [run] = await db.select().from(missionRuns).where(eq(missionRuns.id, id)).limit(1);
        if (run && run.missionContext) {
            const context = run.missionContext as any;
            const newTools = [
                'get_blackboard', 
                'update_blackboard', 
                'file_list', 
                'file_read', 
                'file_write', 
                'google_search', 
                'browse_web',
                'http_request',
                'ai_translate',
                'shell',
                'python',
                'generate_excel'
            ];
            context.allowedTools = newTools;
            
            await db.update(missionRuns)
                .set({ missionContext: context })
                .where(eq(missionRuns.id, id));
            
            console.log(`Updated run ${id} with ${newTools.length} tools`);
        }
    }
    process.exit(0);
}

main().catch(console.error);
