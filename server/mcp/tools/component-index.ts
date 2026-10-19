/**
 * Component Index Tool Definitions
 * 
 * MCP tools for the self-assembler to query the component index
 * and find reusable components during code generation.
 */

export const componentIndexToolDefinitions = [
    {
        name: "search_components",
        description:
            "Search the component index for reusable components based on category, domain, framework, or natural language query. Returns component definitions, effectiveness scores, and usage patterns that can be referenced during code generation.",
        inputSchema: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description: "Natural language search query (e.g., 'data table with pagination', 'approval form', 'dashboard layout').",
                },
                category: {
                    type: "string",
                    enum: ["ui_component", "layout_pattern", "workflow", "data_integration", "blueprint", "code_pattern", "test_pattern"],
                    description: "Filter by component category.",
                },
                domain: {
                    type: "string",
                    enum: ["general", "devops", "security", "finance", "support", "hr", "sales", "custom"],
                    description: "Filter by domain.",
                },
                framework: {
                    type: "string",
                    enum: ["react", "vue", "svelte", "vanilla", "nodejs", "python", "typescript"],
                    description: "Filter by framework.",
                },
                minEffectiveness: {
                    type: "number",
                    description: "Minimum effectiveness score (0-5).",
                    minimum: 0,
                    maximum: 5,
                },
                limit: {
                    type: "number",
                    description: "Maximum number of results to return (default 10).",
                    minimum: 1,
                    maximum: 50,
                },
            },
        },
    },
    {
        name: "get_component",
        description:
            "Get detailed information about a specific component by its ID or slug. Returns the full component definition including code, props schema, examples, dependencies, and usage context.",
        inputSchema: {
            type: "object",
            properties: {
                id: {
                    type: "string",
                    description: "Component ID (UUID).",
                },
                slug: {
                    type: "string",
                    description: "Component slug (alternative to ID).",
                },
            },
            required: [],
        },
    },
    {
        name: "suggest_components",
        description:
            "Suggest components based on a natural language description of what needs to be built. Uses semantic matching to find the most relevant components from the index.",
        inputSchema: {
            type: "object",
            properties: {
                description: {
                    type: "string",
                    description: "Description of what needs to be built (e.g., 'I need to build a dashboard for monitoring server health').",
                },
                framework: {
                    type: "string",
                    enum: ["react", "vue", "svelte", "vanilla", "nodejs", "python", "typescript"],
                    description: "Target framework for the suggestion.",
                },
                limit: {
                    type: "number",
                    description: "Maximum number of suggestions to return (default 5).",
                    minimum: 1,
                    maximum: 20,
                },
            },
            required: ["description"],
        },
    },
    {
        name: "log_component_usage",
        description:
            "Log when a component is used during code generation. This tracks usage for effectiveness scoring and helps improve the component index over time.",
        inputSchema: {
            type: "object",
            properties: {
                componentId: {
                    type: "string",
                    description: "Component ID that was used.",
                },
                sessionId: {
                    type: "string",
                    description: "SDLC pipeline session ID.",
                },
                context: {
                    type: "object",
                    description: "Context of how the component was used.",
                },
                propsUsed: {
                    type: "object",
                    description: "Props that were configured for this usage.",
                },
                generatedCode: {
                    type: "string",
                    description: "The code that was generated using this component.",
                },
            },
            required: ["componentId", "sessionId", "context"],
        },
    },
];
