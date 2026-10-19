import { GetAssistantInfoInput, UpdateAssistantSettingsInput, ResyncSystemGraphInput } from "../tools/system.js";
import { db } from "../../database_service.js";
import { systemSettings } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { assertOrgId } from "@server/utils/auth-context.js";
import {
    successResponse, 
    createHandlerWrapper,
    type ToolContext 
} from "./utils.js";

// Type for assistant info response
interface AssistantInfo {
    name: string;
    provider: string;
    model: string;
    maxIterations: number;
}

// Type for system settings data
interface SystemSettingsData {
    aiDefaults?: {
        copilot?: AssistantInfo;
    };
}

export const handleGetAssistantInfo = createHandlerWrapper(
    async (args: unknown, _context?: ToolContext) => {
        GetAssistantInfoInput.parse(args);

        const [settings] = await db
            .select()
            .from(systemSettings)
            .where(eq(systemSettings.key, "global"));

        const settingsData = (settings?.settingsData || {}) as SystemSettingsData;
        const assistantInfo: AssistantInfo = settingsData.aiDefaults?.copilot || {
            name: "Oddjob Assistant",
            provider: "google",
            model: "gemini-pro",
            maxIterations: 10
        };

        return successResponse(assistantInfo, "Retrieved Oddjob Assistant information");
    }
);

export const handleUpdateAssistantSettings = createHandlerWrapper(
    async (args: unknown, _context?: ToolContext) => {
        const input = UpdateAssistantSettingsInput.parse(args);

        const [settings] = await db
            .select()
            .from(systemSettings)
            .where(eq(systemSettings.key, "global"));

        if (!settings) {
            throw new Error("System settings not initialized");
        }

        const settingsData = (settings.settingsData || {}) as SystemSettingsData;
        const newData: SystemSettingsData = { ...settingsData };
        
        if (!newData.aiDefaults) newData.aiDefaults = {};
        if (!newData.aiDefaults.copilot) {
            newData.aiDefaults.copilot = {
                name: "Oddjob Assistant",
                provider: "google",
                model: "gemini-pro",
                maxIterations: 10
            };
        }

        if (input.maxIterations !== undefined) {
            newData.aiDefaults.copilot.maxIterations = input.maxIterations;
        }

        await db
            .update(systemSettings)
            .set({ settingsData: newData, updatedAt: new Date() })
            .where(eq(systemSettings.key, "global"));

        return successResponse(newData.aiDefaults.copilot, "Updated Oddjob Assistant settings");
    },
    { requireAdmin: true }
);

export const handleResyncSystemGraph = createHandlerWrapper(
    async (args: unknown, _context?: ToolContext) => {
        const input = ResyncSystemGraphInput.parse(args);
        const orgId = assertOrgId(input.organizationId);

        const { spawn } = await import("child_process");
        const path = await import("path");
        const fs = await import("fs/promises");

        // Use the configured python path if available, or default to python
        const pythonPath = process.env.PYTHON_PATH || "python";
        const scriptPath = path.resolve(process.cwd(), "scripts/python/system_ingestion.py");

        // Check if script exists
        try {
            await fs.access(scriptPath);
        } catch {
            throw new Error(`Ingestion script not found at ${scriptPath}`);
        }

        console.log(`[MCP] Manually triggering System Graph Resync for Org ${orgId}...`);
        
        // Spawn background process
        const ingestionProcess = spawn(pythonPath, [scriptPath, "--org", String(orgId)], {
            stdio: 'inherit',
            detached: true
        });

        ingestionProcess.unref();

        return successResponse({
            status: "started",
            script: "system_ingestion.py",
            organizationId: orgId,
            pid: ingestionProcess.pid
        }, "System Graph resync initiated in the background. It may take a few minutes to complete.");
    },
    { requireSuperAdmin: true }
);

