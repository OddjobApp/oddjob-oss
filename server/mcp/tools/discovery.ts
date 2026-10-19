/**
 * Discovery Tool Definitions
 */
export const discoveryToolDefinitions = [
    {
        name: "discover_capabilities",
        description:
            "Semantically discover organization-scoped Oddjob capability contracts and available mission capabilities for a natural-language goal. Returns names, versions, inputs, guardrails, risk, and relevance where available.",
        inputSchema: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description: "The outcome or operational goal to match against available capabilities.",
                },
                limit: {
                    type: "number",
                    description: "Maximum number of mission and capability results to return (default 15).",
                    minimum: 1,
                    maximum: 50,
                },
            },
            required: ["query"],
        },
    },
    {
        name: "discover_capability_proposals",
        description:
            "List organization-scoped Evolution capability proposals. Results are explicitly non-executable and pending human review or promotion.",
        inputSchema: {
            type: "object",
            properties: {
                query: { type: "string", description: "Optional capability gap or outcome to match." },
                limit: { type: "number", description: "Maximum proposals to return.", minimum: 1, maximum: 50 },
            },
        },
    },
    {
        name: "list_available_mcp_capabilities",
        description: "Browse available but currently inactive MCP tools. Use this to identify if the system has capabilities you need that aren't yet enabled.",
        inputSchema: {
            type: "object",
            properties: {
                search: {
                    type: "string",
                    description: "Search keywords for tools (e.g., 'jira', 'salesforce')"
                }
            }
        }
    },
    {
        name: "request_mcp_tool",
        description: "Request an administrator to enable a specific MCP server to help fulfill the current mission.",
        inputSchema: {
            type: "object",
            properties: {
                toolName: {
                    type: "string",
                    description: "The name of the tool or server to enable"
                },
                reason: {
                    type: "string",
                    description: "Explanation for why this tool is critical for the mission success"
                }
            },
            required: ["toolName", "reason"]
        }
    }
];

