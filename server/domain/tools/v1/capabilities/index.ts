import { z } from "zod";
import type { ToolDefinition } from "./types.js";
export type { ToolDefinition };

import { CORE_TOOLS } from "./core.js";
import { FILE_TOOLS } from "./files.js";
import { WEB_TOOLS } from "./web.js";
import { DATA_TOOLS } from "./data.js";
import { APP_RECORDS_TOOLS } from "./app-records-tools.js";
import { DATASET_ANALYTICS_TOOLS } from "./dataset-analytics-tools.js";
import { PLATFORM_DOCS_TOOLS, SYSTEM_DOCS_TOOLS } from "./platform-docs-tools.js";
import { PIPELINE_TOOLS } from "./pipelines.js";
import { KNOWLEDGE_TOOLS } from "./knowledge.js";
import { CONFLUENCE_TOOLS } from "./confluence.js";
import { GENERATION_TOOLS } from "./generation.js";
import { SYSTEM_TOOLS } from "./system.js";
import { SAAS_TOOLS } from "./saas.js";
import { SAAS_DISCOVERY_TOOLS } from "./saas-discovery.js";
import { CONNECTOR_TOOLS } from "./connector-tools.js";
import { ATTACHMENT_TOOLS } from "./attachment-tools.js";
import { search_unified_knowledge } from "./search-core.js";
import { PLATFORM_STRUCTURE_TOOLS } from "./platform-structure.js";
import { MISSION_TOOLS } from "./missions.js";
import { RESCUE_TOOLS } from "./rescue.js";
import { VIDEO_TOOLS } from "./video.js";
import { DELEGATION_TOOLS } from "./delegation.js";
import { DISCOVERY_TOOLS } from "./discovery.js";
import { CAPABILITY_DISCOVERY_TOOLS } from "./capability-discovery.js";
import { USER_MEMORY_TOOLS } from "./user-memory-tools.js";
import { USER_CONTEXT_TOOLS } from "./user-context-tools.js";
import { PROJECT_BUDGET_TOOLS } from "./project-budget-tools.js";
import { RENDER_TOOLS } from "./render-tools.js";
import { missionResearchTool } from "./mission-research.js";
import { APP_FORGE_TOOLS } from "./app-forge-tools.js";
import { GITHUB_TOOLS } from "./github.js";
import { CLOUD_TOOLS } from "./cloud.js";
import { MICROSOFT365_TOOLS } from "./microsoft365.js";
import { MONITORING_TOOLS } from "./monitoring.js";
import { NOTION_TOOLS } from "./notion.js";
import { SALESFORCE_TOOLS } from "./salesforce.js";
import { ZENDESK_TOOLS } from "./zendesk.js";
import { SERVICENOW_TOOLS } from "./servicenow.js";
import { GOOGLE_WORKSPACE_TOOLS } from "./google-workspace.js";
import { YOUTUBE_TOOLS } from './youtube.js';
import { AMAZON_TOOLS } from './amazon.js';
import { QUICKBOOKS_TOOLS } from './quickbooks.js';
import { GRANOLA_TOOLS } from './granola.js';
import { FLIGHTHUB_TOOLS } from './flighthub.js';
import { WEBHOOK_TOOLS } from "./webhook.js";
import { LINEAR_TOOLS } from "./linear.js";
import { HUBSPOT_TOOLS } from "./hubspot.js";
import { STRIPE_TOOLS } from "./stripe.js";
import { TWILIO_TOOLS } from "./twilio.js";
import { AIRTABLE_TOOLS } from "./airtable.js";
import { PDF_EXTRACT_TOOLS } from "./pdf-extract.js";
import { ANALYTICS_DB_TOOLS } from "./analytics-db.js";
import { ADMIN_PERSONALITY_TOOLS } from "./admin-personality-tools.js";
import { AGENTMAIL_TOOLS } from "./agentmail.js";
import { GMS_TOOLS } from "./gms.js";
import { TRYCUA_TOOLS } from "./trycua-computer-use.js";
import { VISION_TOOLS } from "./multimodal-vision.js";
import { XRAY_TOOLS } from "./xray-tools.js";
import { GIT_WORKSPACE_TOOLS } from "./git-workspace.js";
import { SDLC_TOOLS } from "./sdlc-agent-tools.js";
import { SELF_MODIFICATION_TOOLS } from "./self-modification.js";
import { ONTOLOGY_TOOLS } from "./ontology-tools.js";
import { CYCLE_TOOLS } from "./cycles.js";
import { INSTANT_APP_TOOLS } from "./instant-app-tools.js";
import { SPATIAL_TOOLS } from "./spatial-tools.js";
import { TOM_TOOLS } from "./tom-tools.js";
import { HIL_TOOLS } from "./hil-tools.js";
import { FORM_STUDIO_TOOLS } from "./form-studio-tools.js";
import { FLOW_STUDIO_TOOLS } from "./flow-studio-tools.js";
import { PREDICTION_STUDIO_TOOLS } from "./prediction-studio-tools.js";
import { AGENT_STUDIO_TOOLS } from "./agent-studio-tools.js";
import { CALCULATION_TOOLS } from "./calculation-tools.js";
import { FINANCIAL_FORECAST_TOOLS } from './financial-forecast-tools.js';
import { FINANCIAL_SNAPSHOT_TOOLS } from './financial-snapshot-tools.js';
import { ASSEMBLY_TOOLS } from "./assembly-tools.js";
import { CREW_TASK_PROPOSAL_TOOLS } from "./crew-task-proposal-tools.js";
import { QUERY_TOOLS } from "./query-tools.js";
import { GRAPH_TOOLS } from "./graph-tools.js";
import { SCRIBE_TOOLS } from "./scribe.js";
import { CREW_RAIL_TOOLS } from "./crew-rail-tools.js";
import { SECURITY_AUDIT_TOOLS } from "./security-audit-tools.js";
import { COMPETITIVE_INTEL_TOOLS } from "./competitive-intel-tools.js";
import { REVENUE_RECOGNITION_TOOLS } from "./revenue-recognition-tools.js";
import { CHAOS_DRILL_TOOLS } from "./chaos-drill-tools.js";
import { FORMAL_VERIFICATION_TOOLS } from "./formal-verification-tools.js";
import { SEEDANCE_TOOLS } from "./seedance.js";
import { VIDEO_ASSEMBLY_TOOLS } from "./video-assembly.js";
import { MEDIA_STUDIO_CHANGE_TOOLS } from "./media-studio-change-tools.js";
import { AUTONOMOUS_MISSION_TOOLS } from "./autonomous-mission-tools.js";
import { CONSENSUS_TOOLS } from "./consensus-tools.js";
import { STUDIO_CRUD_TOOLS } from "./studio-crud-tools.js";
import { STUDIO_CONTRIBUTION_TOOLS } from "./studio-contribution-tools.js";


import { mcpClientService } from "../../../integrations/core/mcp-client.service.js";
import { toolRegistry } from "../../core/tool-registry.js";

// Lazy-load launch tools to avoid circular imports.
// No top-level await: this module is sometimes pulled in through a require() chain,
// where esbuild/tsx transforms it as CJS and top-level await is unsupported there.
let LAUNCH_TOOLS: Record<string, any> = {};
void import("./launch-tools.js")
    .then(({ launchToolDefinitions }) => {
        LAUNCH_TOOLS = launchToolDefinitions;
        toolRegistry.registerTools(LAUNCH_TOOLS as any);
    })
    .catch(() => { /* launch-tools may not exist in all environments */ });

// Initial registration of static tools
const registerStaticTools = () => {
    toolRegistry.registerTools({
        ...CORE_TOOLS,
        ...FILE_TOOLS,
        ...WEB_TOOLS,
        ...DATA_TOOLS,
        ...DATASET_ANALYTICS_TOOLS,
        ...APP_RECORDS_TOOLS,
        ...PLATFORM_DOCS_TOOLS,
        ...SYSTEM_DOCS_TOOLS,
        ...PIPELINE_TOOLS,
        ...KNOWLEDGE_TOOLS,
        ...CONFLUENCE_TOOLS,
        ...GENERATION_TOOLS,
        ...SYSTEM_TOOLS,
        ...SAAS_TOOLS,
        ...SAAS_DISCOVERY_TOOLS,
        ...CONNECTOR_TOOLS,
        ...ATTACHMENT_TOOLS,
        search_unified_knowledge,
        ...PLATFORM_STRUCTURE_TOOLS,
        ...MISSION_TOOLS,
        ...RESCUE_TOOLS,
        ...VIDEO_TOOLS,
        ...DELEGATION_TOOLS,
        ...DISCOVERY_TOOLS,
        ...CAPABILITY_DISCOVERY_TOOLS,
        ...USER_MEMORY_TOOLS,
        ...USER_CONTEXT_TOOLS,
        ...PROJECT_BUDGET_TOOLS,
        ...RENDER_TOOLS,
        ...APP_FORGE_TOOLS,
        ...GITHUB_TOOLS,
        ...CLOUD_TOOLS,
        ...MICROSOFT365_TOOLS,
        ...MONITORING_TOOLS,
        ...NOTION_TOOLS,
        ...SALESFORCE_TOOLS,
        ...ZENDESK_TOOLS,
        ...SERVICENOW_TOOLS,
        ...GOOGLE_WORKSPACE_TOOLS,
        ...YOUTUBE_TOOLS,
        ...AMAZON_TOOLS,
        ...FLIGHTHUB_TOOLS,
        ...QUICKBOOKS_TOOLS,
        ...GRANOLA_TOOLS,
        ...WEBHOOK_TOOLS,
        ...LINEAR_TOOLS,
        ...HUBSPOT_TOOLS,
        ...STRIPE_TOOLS,
        ...TWILIO_TOOLS,
        ...AIRTABLE_TOOLS,
        ...PDF_EXTRACT_TOOLS,
        ...ANALYTICS_DB_TOOLS,
        ...ADMIN_PERSONALITY_TOOLS,
        ...AGENTMAIL_TOOLS,
        ...GMS_TOOLS,
        ...TRYCUA_TOOLS,
        ...VISION_TOOLS,
        ...XRAY_TOOLS,
        ...GIT_WORKSPACE_TOOLS,
        ...SDLC_TOOLS,
        ...SELF_MODIFICATION_TOOLS,
        ...ONTOLOGY_TOOLS,
        ...CYCLE_TOOLS,
        ...INSTANT_APP_TOOLS,
        ...SPATIAL_TOOLS,
        ...TOM_TOOLS,
        ...HIL_TOOLS,
        ...FORM_STUDIO_TOOLS,
        ...FLOW_STUDIO_TOOLS,
        ...PREDICTION_STUDIO_TOOLS,
        ...AGENT_STUDIO_TOOLS,
        ...CALCULATION_TOOLS,
        ...FINANCIAL_FORECAST_TOOLS,
        ...FINANCIAL_SNAPSHOT_TOOLS,
        ...ASSEMBLY_TOOLS,
        ...CREW_TASK_PROPOSAL_TOOLS,
        ...QUERY_TOOLS,
        ...GRAPH_TOOLS,
        ...SCRIBE_TOOLS,
        ...CREW_RAIL_TOOLS,
        ...SECURITY_AUDIT_TOOLS,
        ...COMPETITIVE_INTEL_TOOLS,
        ...REVENUE_RECOGNITION_TOOLS,
        ...CHAOS_DRILL_TOOLS,
        ...FORMAL_VERIFICATION_TOOLS,
        ...SEEDANCE_TOOLS,
        ...VIDEO_ASSEMBLY_TOOLS,
        ...MEDIA_STUDIO_CHANGE_TOOLS,
        ...AUTONOMOUS_MISSION_TOOLS,
        ...CONSENSUS_TOOLS,
        ...STUDIO_CONTRIBUTION_TOOLS,
        ...STUDIO_CRUD_TOOLS,
        ...LAUNCH_TOOLS,
    } as any);
};

registerStaticTools();

let cachedTools: Record<string, ToolDefinition> | null = null;
let lastMcpVersion = 0;


export const getAgentTools = (forceRefresh = false): Record<string, ToolDefinition> => {
    const currentMcpTools = mcpClientService.getAllTools();
    const currentMcpCount = currentMcpTools.length;

    if (!forceRefresh && cachedTools && lastMcpVersion === currentMcpCount) {
        return cachedTools;
    }

    const tools = toolRegistry.getAllTools();


    // Dynamically merge connected MCP tools
    try {
        for (const tool of currentMcpTools) {
            tools[tool.name] = tool;
        }
    } catch (e) {
        console.warn("[Agent Tools] Failed to merge MCP tools:", e);
    }

    cachedTools = tools;
    lastMcpVersion = currentMcpCount;
    return tools;
};

export const AGENT_TOOLS = getAgentTools();

/**
 * Registry sanity audit. Every advertised tool must be executable via the
 * generic dispatch path (handleToolCall's registry fallthrough): it needs an
 * `execute` function and a parseable (zod) `parameters` schema, or
 * `executeTool` throws at call time. Returns the offenders so a startup warn
 * and a CI test can catch a malformed tool at build time instead of at runtime.
 */
export function auditToolRegistrySanity(): { missingExecute: string[]; badSchema: string[] } {
    const tools = getAgentTools(true);
    const missingExecute: string[] = [];
    const badSchema: string[] = [];
    for (const [name, tool] of Object.entries(tools)) {
        if (typeof (tool as any)?.execute !== "function") missingExecute.push(name);
        const params = (tool as any)?.parameters;
        if (!params || typeof params.safeParse !== "function") badSchema.push(name);
    }
    if (missingExecute.length || badSchema.length) {
        console.warn(
            `[ToolRegistry] sanity: ${missingExecute.length} tool(s) missing execute` +
            `${missingExecute.length ? ` [${missingExecute.slice(0, 20).join(", ")}]` : ""}; ` +
            `${badSchema.length} tool(s) with a non-parseable schema` +
            `${badSchema.length ? ` [${badSchema.slice(0, 20).join(", ")}]` : ""}`
        );
    }
    return { missingExecute, badSchema };
}


