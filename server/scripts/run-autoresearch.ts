import { adminService } from '../domain/admin/admin.service.js';
import { db } from '../database_service.js';
import { orgs } from '../../shared/schema/index.js';

async function syncAllOrgs() {
    console.log("==========================================");
    console.log(`[${new Date().toISOString()}] Initiating Neural Core Sync`);
    console.log("==========================================");
    
    try {
        // Fetch all active organizations
        const allOrgs = await db.select({ id: orgs.id, name: orgs.name }).from(orgs);
        
        let totalTriggered = 0;
        
        for (const org of allOrgs) {
            console.log(`Scanning Org: ${org.name} (ID: ${org.id})...`);
            const result = await adminService.syncNeuralCore(org.id);
            console.log(`  -> ${result.message}`);
            if (result.candidatesTriggered > 0) {
                totalTriggered += result.candidatesTriggered;
            }
        }
        
        console.log("==========================================");
        console.log(`Sync Complete. Total new shadow experiments launched: ${totalTriggered}`);
        
    } catch (e) {
        console.error("Critical Failure during Neural Core Sync:", e);
        process.exit(1);
    }
    process.exit(0);
}

syncAllOrgs();
