import { db } from "../database_service.js";
import { apps } from "../../shared/schema/index.js";
import { eq, and } from "drizzle-orm";

async function diversify() {
    console.log("Starting app name diversification...");
    
    const allApps = await db.select().from(apps).where(eq(apps.name, "Service Dispatch"));
    
    const creativeNames = [
        "Strategic Ops Center",
        "Neural Task Orchestrator",
        "Digital Logistics Grid",
        "Knowledge Harvester",
        "Forensic Audit Stream",
        "Dynamic Resource Planner",
        "Velocity Mission Suite",
        "Autonomous Agent Hub",
        "Cognitive Data Bridge",
        "Industrial Logic Ignite"
    ];

    for (let i = 0; i < allApps.length; i++) {
        const app = allApps[i];
        const newName = creativeNames[i % creativeNames.length] + (i >= creativeNames.length ? ` ${Math.floor(i / creativeNames.length) + 1}` : "");
        
        await db.update(apps)
            .set({ name: newName })
            .where(eq(apps.id, app.id));
        
        console.log(`Renamed app ${app.id}: "Service Dispatch" -> "${newName}"`);
    }

    console.log("Diversification complete.");
}

diversify().catch(console.error);
