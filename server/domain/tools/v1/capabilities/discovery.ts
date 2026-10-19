import { z } from "zod";
import { db } from "../../../../database_service.js";
import { mcpServers, alerts, rescueSessions } from "@shared/schema/index.js";
import { eq, and, sql, ilike, or, desc } from "drizzle-orm";
import type { ToolDefinition } from "./index.js";

export const DISCOVERY_TOOLS: Record<string, ToolDefinition> = {
    list_available_mcp_capabilities: {
        name: "list_available_mcp_capabilities",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "Discover Capabilities",
        group: "System Management",
        description: "Browse available but currently inactive MCP tools. Use this to identify if the system has capabilities you need that aren't yet enabled.",
        parameters: z.object({
            search: z.string().optional().describe("Search keywords for tools (e.g., 'jira', 'salesforce')"),
        }),
        execute: async ({ search }, context) => {
            try {
                const orgId = context?.organizationId || null;
                const conditions = [eq(mcpServers.status, 'inactive')];
                if (orgId) {
                    conditions.push(eq(mcpServers.organizationId, orgId));
                }

                if (search) {
                    conditions.push(or(
                        ilike(mcpServers.name, `%${search}%`),
                        ilike(mcpServers.description, `%${search}%`)
                    ) as any);
                }

                const inactiveServers = await db.select({
                    id: mcpServers.id,
                    name: mcpServers.name,
                    description: mcpServers.description,
                })
                .from(mcpServers)
                .where(and(...conditions));

                if (inactiveServers.length === 0) {
                    return "No inactive MCP capabilities found matching your search.";
                }

                return `The following capabilities are available but INACTIVE. You can request activation using 'request_mcp_tool':\n\n` + 
                       inactiveServers.map(s => `- **${s.name}**: ${s.description || 'No description'}`).join("\n");
            } catch (e: any) {
                return `Error searching capabilities: ${e.message}`;
            }
        }
    },
    request_mcp_tool: {
        name: "request_mcp_tool",

        idempotency: "idempotent",
        label: "Request Tool Activation",
        group: "System Management",
        description: "Request an administrator to enable a specific MCP server to help fulfill the current mission.",
        parameters: z.object({
            toolName: z.string().describe("The name of the tool or server to enable"),
            reason: z.string().describe("Explanation for why this tool is critical for the mission success"),
        }),
        execute: async ({ toolName, reason }, context) => {
            try {
                const orgId = context?.organizationId || null;
                
                // Create a Rescue Session for the Decision Inbox (Strategic Intervention)
                await db.insert(rescueSessions).values({
                    organizationId: orgId,
                    missionId: context.missionId,
                    missionRunId: context.missionRunId,
                    status: "REQUESTED",
                    serviceType: "tool_discovery",
                    userLocation: { lat: 0, lng: 0, resolvedBy: "manual" },
                    triageSummary: `Capability Gap: Agent requires "${toolName}" to proceed.`,
                    recoveryOptions: [
                        {
                            id: `approve_${toolName}_${Date.now()}`,
                            label: `Enroll ${toolName}`,
                            description: `Authorize and enable "${toolName}" capability for this session.`,
                            successProbability: 0.98,
                            actionType: "approve_tool" as any,
                            params: { toolName, missionRunId: context.missionRunId }
                        },
                        {
                            id: `reject_${toolName}_${Date.now()}`,
                            label: "Deny Access",
                            description: "Explicitly reject tool activation. Agent must pivot strategy.",
                            successProbability: 0.3,
                            actionType: "reject_tool" as any,
                            params: { toolName, missionRunId: context.missionRunId }
                        }
                    ],
                    metadata: { 
                        toolName, 
                        reason, 
                        agentId: context.agentId,
                        requestedAt: new Date().toISOString()
                    }
                } as any);

                return `SUCCESS: Activation request for "${toolName}" has been routed to the Decision Inbox for administrator approval.`;
            } catch (e: any) {
                return `Error sending tool request: ${e.message}`;
            }
        }
    },
    list_pending_interventions: {
        name: "list_pending_interventions",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "Decision Inbox",
        group: "System Management",
        description: "List all active Human-In-The-Loop (HIL) requests and pending interventions. Use this to identify why a mission might be waiting for user input.",
        parameters: z.object({
            limit: z.number().optional().default(10),
        }),
        execute: async ({ limit }, context) => {
            try {
                const orgId = context?.organizationId || null;
                const conditions = [or(eq(rescueSessions.status as any, 'REQUESTED'), eq(rescueSessions.status as any, 'ACTIVE'))];
                
                if (orgId) {
                    conditions.push(eq(rescueSessions.organizationId, orgId));
                }

                const sessions = await db.select({
                    id: rescueSessions.id,
                    status: rescueSessions.status,
                    serviceType: rescueSessions.serviceType,
                    triageSummary: rescueSessions.triageSummary,
                    missionId: rescueSessions.missionId,
                    missionRunId: rescueSessions.missionRunId,
                    createdAt: rescueSessions.createdAt
                })
                .from(rescueSessions)
                .where(and(...conditions as any))
                .orderBy(desc(rescueSessions.createdAt))
                .limit(limit);

                if (sessions.length === 0) {
                    return "No pending human interventions or HIL requests found.";
                }

                return `The following interventions are pending in the Decision Inbox:\n\n` + 
                       sessions.map(s => `- [ID: ${s.id}] **${s.serviceType}**: ${s.triageSummary} (Status: ${s.status}, Mission: ${s.missionId})`).join("\n");
            } catch (e: any) {
                return `Error listing interventions: ${e.message}`;
            }
        }
    },
    launch_score_tutorial: {
        name: "launch_score_tutorial",
        idempotency: "read-safe",
        label: "Launch Guided Tutorial",
        group: "Tutorials & Onboarding",
        // The ids quoted below are asserted to resolve by
        // client/src/lib/tutorial-drift.test.ts. An id named here that the
        // tutorial engine cannot resolve reaches the user as a "Start
        // Walkthrough" button that warns to the console and does nothing --
        // which is what the previous examples ('operations-hub',
        // 'decision-inbox', 'analytics-engine', 'score-full-tour') all did.
        description: "Launch an interactive, step-by-step UI walkthrough on screen for the user (e.g. 'chain:operator-flight-deck', 'chain:developer-forge', 'chain:full-platform-immersion').",
        parameters: z.object({
            trackId: z.string().describe("The tutorial to launch: 'chain:operator-flight-deck' for operations, 'chain:enterprise-architect' for governance and approvals, 'chain:developer-forge' for app building, 'chain:spatial-operator' for telemetry and spatial analytics, 'chain:full-platform-immersion' for the complete tour, or 'platform-score-tour' for a short overview."),
            reason: z.string().optional().describe("Why this tutorial is being launched for the user"),
        }),
        execute: async ({ trackId, reason }, context) => {
            return JSON.stringify({
                type: "launch_tutorial",
                trackId,
                title: `Guided Walkthrough: ${trackId}`,
                description: reason || `Interactive guided tour of ${trackId}.`,
            });
        }
    }
};


