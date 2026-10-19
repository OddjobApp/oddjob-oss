import { forgeMemoryService } from "../server/domain/apps/core/forge-memory.service.js";
import fs from "node:fs/promises";
import path from "node:path";

async function teachForge() {
    const projectRoot = process.cwd();
    const workspacePath = path.join(projectRoot, "storage", "forge-workspace", "shelflife5");
    const files: Record<string, string> = {};
    
    console.log(`Reading prototype from: ${workspacePath}`);
    
    // Read the prototype files
    const indexContent = await fs.readFile(path.join(workspacePath, "pages", "index.tsx"), "utf-8");
    const layoutContent = await fs.readFile(path.join(workspacePath, "components", "Layout.tsx"), "utf-8");
    
    files["pages/index.tsx"] = indexContent;
    files["components/Layout.tsx"] = layoutContent;

    const appType = "smart-inventory";
    const description = "Streamlined food waste reduction app with expiry heat maps and category toggles.";
    
    console.log("Teaching App Forge the 'ShelfLife' pattern...");
    
    // We mock the org context for the training
    // We'll use the System Org if possible or org 1
    const orgContext = { organizationId: 1, userId: "system-teacher" } as any;

    try {
        await forgeMemoryService.learnPattern(
            "shelflife-golden",
            appType,
            description,
            files,
            orgContext
        );
        console.log("SUCCESS: Memory training complete.");
    } catch (err) {
        console.error("FAILED to teach forge:", err);
    }
}

teachForge().catch(console.error);
