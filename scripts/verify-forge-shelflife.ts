import { forgeMemoryService } from "../server/domain/apps/core/forge-memory.service.js";

async function verifyForge() {
    console.log("🔍 VERIFYING App Forge Knowledge Engine...");
    
    const appType = "smart-inventory";
    const orgContext = { organizationId: 1 } as any;

    try {
        const patterns = await forgeMemoryService.queryPatterns(appType, orgContext);
        
        console.log(`\nFound ${patterns.length} patterns for type: ${appType}`);
        
        if (patterns.length > 0) {
            console.log("✅ SUCCESS: Pattern retrieved!");
            patterns.forEach((p, i) => {
                console.log(`   [${i+1}] Name: ${p.appType}`);
                console.log(`       Description: ${p.description}`);
            });
        } else {
            console.error("❌ FAILURE: No patterns found. Training may have failed or indexing is slow.");
            process.exit(1);
        }
    } catch (err) {
        console.error("❌ ERROR during verification:", err);
        process.exit(1);
    }
}

verifyForge().catch(console.error);
