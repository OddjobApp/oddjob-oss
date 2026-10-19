
import { db } from "@server/database_service.js";
import { missions, missionRuns } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { MissionWaveBlueprintSchema } from "../utils/mission-types.js";
import { MissionHistoryRAGService } from "./mission-history-rag.service.js";
import { systemAiService } from "../../ai/core/system-ai.service.js";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";
import { FORGE_STRATEGIST_PROMPT, ROLLING_WAVE_ARCHITECT_PROMPT } from "./prompts.js";
import { AGENT_TOOLS } from "../../tools/v1/capabilities/index.js";
import { mcpClientService } from "../../integrations/core/mcp-client.service.js";

const logger = createLogger("MissionStrategicPlanner");

// Org-storage file tools. For codegen missions these are removed from the
// planner's menu so it can't pick file_read (which reads empty org storage) —
// file ops route to the workspace_* tools instead, which resolve to the repo.
export const STORAGE_FILE_TOOLS = ["file_read", "file_write", "file_list"];

/** True when a cycle is the autonomous code-generation pipeline (by name/slug). */
export function isCodegenCycle(name?: string | null, slug?: string | null): boolean {
    return /autonomous[-_ ]?code[-_ ]?generation|codegen/i.test(`${name ?? ""} ${slug ?? ""}`);
}

// Appended to the planner prompt for codegen missions so the LLM operates on the
// real repository at the workspace root via the workspace_* tools.
export const CODEGEN_WORKSPACE_DIRECTIVE =
    "\n\nCODEGEN WORKSPACE DIRECTIVE: This mission operates on a real Git repository " +
    "mounted at the workspace root. Use ONLY the workspace_* tools for code/file " +
    "operations — workspace_list_files to explore, workspace_read_file to read, " +
    "workspace_run_command to build/test/lint, workspace_write_file to edit. Do NOT " +
    "use org-storage file tools. All paths are relative to the repository root.";

export class MissionStrategicPlannerService {
    /**
     * Generates a new wave blueprint for a mission run.
     */
    static async plan(missionRunId: number, orgId: number | null): Promise<any> {
        const [run] = await db.select().from(missionRuns).where(eq(missionRuns.id, missionRunId)).limit(1);
        if (!run?.missionId) throw new Error("Run not found or has no mission");

        const [mission] = await db.select().from(missions).where(eq(missions.id, run.missionId)).limit(1);
        if (!mission) throw new Error("Mission not found");

        const isForge = mission.objective?.includes("Agentic App Forge") || (mission.blackboard as any)?.isForge;

        // Codegen missions operate on a real Git repository (the workspace), not org
        // storage. Detect them via their parent cycle and drop the storage file tools
        // so the planner routes file ops to the workspace_* tools (which resolve to the
        // repo root). Without this the planner picks file_read and every read misses.
        // Scoped to codegen missions only — all other missions are unaffected.
        let isCodegen = false;
        if (run.cycleId) {
            try {
                const { operationalCycles } = await import("@shared/schema/index.js");
                const [cyc] = await db.select({ name: operationalCycles.name, meta: operationalCycles.metadata })
                    .from(operationalCycles).where(eq(operationalCycles.id, run.cycleId)).limit(1);
                const meta = (cyc?.meta as any) || {};
                isCodegen = isCodegenCycle(cyc?.name, meta?.uiMetadata?.slug ?? meta?.sourceCycleSlug);
            } catch (e) {
                logger.warn(`[StrategicPlanner] Codegen cycle detection failed for run ${missionRunId}: ${e}`);
            }
        }

        const toolDefs = Object.values(AGENT_TOOLS)
            .filter(t => !(isCodegen && STORAGE_FILE_TOOLS.includes(t.name)));
        const allTools = [
            ...toolDefs.map(t => `- ${t.name}: ${t.description}`),
            ...mcpClientService.getAllTools().map(t => `- ${t.name}: ${t.description}`)
        ].join('\n');

        const aiConfig = await systemAiService.getAiConfig('copilot', orgId ?? undefined);
        if (!aiConfig) throw new Error("AI Configuration missing");

        const client = AIClientFactory.getClient(aiConfig as any);
        let systemPrompt = isForge ? FORGE_STRATEGIST_PROMPT : ROLLING_WAVE_ARCHITECT_PROMPT;
        systemPrompt = systemPrompt.replace("{{tools}}", allTools);
        if (isCodegen) systemPrompt += CODEGEN_WORKSPACE_DIRECTIVE;

        // Ingest and append active HIL form library schemas into the system prompt context
        try {
            const { hilForms } = await import("@shared/schema/index.js");
            const { and: allOf, isNull } = await import("drizzle-orm");
            // This run's organization only, and templates only. It selected every
            // active form in every organization, so one tenant's planner prompt
            // listed another tenant's form names and field schemas.
            const activeForms = await db
                .select({ id: hilForms.id, name: hilForms.name, description: hilForms.description, schema: hilForms.schema })
                .from(hilForms)
                .where(allOf(
                    eq(hilForms.status, "active"),
                    eq(hilForms.kind, "template"),
                    eq(hilForms.isArchived, false),
                    orgId != null ? eq(hilForms.organizationId, orgId) : isNull(hilForms.organizationId),
                ));

            const formsContext = activeForms.length > 0
                ? activeForms.map(f => `- [FormRef: "${f.name}"] Description: ${f.description || 'No description'}. Fields: ${JSON.stringify((f.schema as any)?.fields || [])}`).join('\n')
                : "No active HIL forms available.";

            systemPrompt += `\n\nAVAILABLE HIL FORMS (You can trigger these using the request_human_input tool by matching the fields schema below):\n${formsContext}`;
        } catch (formErr) {
            logger.warn(`[StrategicPlanner] Failed to retrieve active forms for prompt context: ${formErr}`);
        }

        // Ingest SaaS Schema Snapshots (e.g., Jira custom fields)
        try {
            const { saasSchemaSnapshots, saasConnectors } = await import("@shared/schema/index.js");
            const { inArray, desc } = await import("drizzle-orm");
            
            let query = db.select({
                platform: saasSchemaSnapshots.platform,
                name: saasSchemaSnapshots.name,
                fields: saasSchemaSnapshots.fields,
                version: saasSchemaSnapshots.version
            }).from(saasSchemaSnapshots) as any; // Cast to any to allow dynamic where
            
            if (orgId) {
                const orgConnectors = await db.select({ id: saasConnectors.id })
                    .from(saasConnectors)
                    .where(eq(saasConnectors.orgId, orgId));
                
                if (orgConnectors.length > 0) {
                    query = query.where(inArray(saasSchemaSnapshots.connectorId, orgConnectors.map(c => c.id)));
                } else {
                    query = query.where(eq(saasSchemaSnapshots.id, -1));
                }
            }
            
            const snapshots = await query.orderBy(desc(saasSchemaSnapshots.version));
            
            const latestSnapshots: any[] = [];
            const seen = new Set();
            for (const s of snapshots) {
                const key = `${s.platform}:${s.name}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    latestSnapshots.push(s);
                }
            }

            if (latestSnapshots.length > 0) {
                const schemaContext = latestSnapshots.map(s => 
                    `- [Platform: ${s.platform}, Entity: ${s.name}] Fields: ${JSON.stringify(s.fields)}`
                ).join('\n');
                
                systemPrompt += `\n\nEXTERNAL SAAS SCHEMAS (Use these custom fields when interacting with external systems or generating payloads):\n${schemaContext}`;
            }
        } catch (schemaErr) {
            logger.warn(`[StrategicPlanner] Failed to retrieve SaaS schemas for prompt context: ${schemaErr}`);
        }

        // MACH 4: Semantic Recall
        const relevantHistory = await MissionHistoryRAGService.retrieveRelevantHistory(missionRunId, mission.objective || "");
        const historyContext = relevantHistory.length > 0 
            ? `SEMANTIC RECALL (Relevant Past Events):\n${relevantHistory.join('\n')}` 
            : "";

        // MACH 5: Objective-to-Template Routing
        const { MissionTemplateService } = await import("./mission-template.service.js");
        const templateContent = await MissionTemplateService.resolveTemplateForObjective(mission.objective || "", orgId);
        const templateContext = templateContent 
            ? `\n\nOUTPUT STRUCTURE TEMPLATE (Follow this format for your report):\n${templateContent}` 
            : "";

        // MACH 6: DPO (Direct Preference Optimization) Alignment
        let dpoContext = "";
        try {
            const { searchService } = await import("@domain/knowledge/core/search/search-service.js");
            const dpoResults = await searchService.executeHybridSearch(
                `user feedback preferences for: ${mission.objective}`,
                orgId,
                { maxResults: 2 }
            );
            const dpoFiltered = dpoResults.filter(r => r.type === 'document' || r.type === 'mission');
            if (dpoFiltered.length > 0) {
                dpoContext = `\n\nDPO PREFERENCES (Direct User Feedback on Prior Alignments):\n${dpoFiltered.map(r => r.description).join('\n')}`;
            }
        } catch(e) {
            logger.warn(`[StrategicPlanner] DPO Context retrieval failed: ${e}`);
        }

        const context = (run.missionContext as any) || {};
        const pendingAttachments = context.pendingAttachments || [];
        const aiAttachments: any[] = [];

        // Process vision attachments if any — one bad attachment must not abort the whole plan call
        if (pendingAttachments.length > 0) {
            const { getFileCache } = await import("../../auth/core/embed-profile-cache.js");
            for (const att of pendingAttachments) {
                try {
                    const fileData = await getFileCache(att.id);
                    if (fileData && fileData.type === "image") {
                        const base64Data = fileData.content.startsWith("data:")
                            ? fileData.content
                            : `data:${fileData.metadata?.mimeType || 'image/jpeg'};base64,${fileData.content}`;

                        aiAttachments.push({
                            type: 'image_url',
                            url: base64Data,
                            detail: 'auto'
                        });
                    }
                } catch (attErr: any) {
                    logger.warn(`[StrategicPlanner] Failed to load attachment ${att.id}: ${attErr.message}. Skipping.`);
                }
            }
        }

        const timeoutMs = aiConfig.timeoutMs || 120000;
        // MACH 6: Execute with timeout to prevent worker hangs (local models can be slow)
        const result = await Promise.race([
            client.execute({
                model: aiConfig.model,
                systemPrompt,
                userPrompt: `OBJECTIVE: ${mission.objective}\n\nBLACKBOARD: ${JSON.stringify(mission.blackboard)}\n\nCONTEXT COMMAND: ${context.lastUserCommand || 'None'}\n\n${historyContext}${templateContext}${dpoContext}\n\nRECENT HISTORY:\n${JSON.stringify((run.dynamicTrace as any[] || []).slice(-5), null, 2)}\n\nPlan the next construction wave.`,
                requestType: "json",
                attachments: aiAttachments.length > 0 ? aiAttachments : undefined
            } as any, undefined, aiConfig.apiKey ?? ""),
            new Promise<any>((_, reject) => setTimeout(() => reject(new Error(`Strategic Planning Timed Out (${timeoutMs / 1000}s limit reached)`)), timeoutMs))
        ]);

        if (!result.success || !result.output) throw new Error(result.error || "AI Planning failed");

        let blueprintRaw: any;
        if (typeof result.output === "string") {
            const cleaned = result.output.replace(/```json/g, "").replace(/```/g, "").trim();
            try {
                blueprintRaw = JSON.parse(cleaned);
            } catch (parseErr: any) {
                logger.error(`[StrategicPlanner] AI output is not valid JSON: ${parseErr.message}. First 500 chars: ${cleaned.slice(0, 500)}`);
                throw new Error(`Blueprint JSON parsing failed: ${parseErr.message}`);
            }
        } else {
            blueprintRaw = result.output;
        }
        const blueprintParsed = MissionWaveBlueprintSchema.safeParse(blueprintRaw);
        
        if (!blueprintParsed.success) {
            throw new Error(`Blueprint validation failed: ${blueprintParsed.error.message}`);
        }

        return blueprintParsed.data;
    }
}
