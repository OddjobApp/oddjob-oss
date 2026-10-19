/**
 * Oddjob MCP Server - App Forge Tools
 *
 * Exposes app scaffolding and build hardening capabilities
 * through the Model Context Protocol.
 */

// Tool definitions for MCP
export const appForgeToolDefinitions = [
    {
        name: "forge_app",
        description: "Scaffold a new mini-app from a blueprint template. Creates a Next.js application with the specified architecture, registers it in the app registry, and starts the build process. Returns a jobId to monitor the forge progress.",
        inputSchema: {
            type: "object" as const,
            properties: {
                blueprint: {
                    type: "string",
                    description: "Blueprint slug (e.g., 'chat-assistant', 'analytics-dashboard', 'crm-tracker', 'api-monitor')",
                },
                name: {
                    type: "string",
                    description: "Display name for the app",
                },
                slug: {
                    type: "string",
                    description: "URL-safe slug for the app (lowercase, alphanumeric with hyphens)",
                },
                description: {
                    type: "string",
                    description: "Short description of what the app does",
                },
                systemPrompt: {
                    type: "string",
                    description: "Optional: Additional system prompt to guide the AI code generation",
                },
                parentAppSlug: {
                    type: "string",
                    description: "Optional: The slug of the parent app that triggered this recursive forge request",
                },
                forgeDepth: {
                    type: "integer",
                    description: "Optional: The current recursive depth of the forge chain (defaults to 0 or parent+1)",
                },
            },
            required: ["blueprint", "name", "slug", "description"],
        },
    },
    {
        name: "list_blueprints",
        description: "List all available blueprint templates for app scaffolding. Returns a list of blueprint slugs, names, and descriptions that can be used with the forge_app tool.",
        inputSchema: {
            type: "object" as const,
            properties: {},
            required: [],
        },
    },
    {
        name: "get_forge_status",
        description: "Check the real-time status of an ongoing or completed app forge job. Use this to monitor progress after calling forge_app.",
        inputSchema: {
            type: "object" as const,
            properties: {
                jobId: {
                    type: "string",
                    description: "The job ID returned by forge_app",
                },
            },
            required: ["jobId"],
        },
    },
    {
        name: "forge_sanitize_deps",
        description: "Remove AI-hallucinated or unsafe dependencies from a forge workspace's package.json. Uses the blueprint as the source-of-truth allowlist. Call this after AI codegen and before Docker build.",
        inputSchema: {
            type: "object" as const,
            properties: {
                slug: {
                    type: "string",
                    description: "The app slug/folder name in the forge workspace",
                },
                blueprintSlug: {
                    type: "string",
                    description: "The blueprint slug used to scaffold this app",
                },
            },
            required: ["slug", "blueprintSlug"],
        },
    },
    {
        name: "forge_inject_build_config",
        description: "Inject required build configuration into a forge workspace: next.config.js (with ignoreBuildErrors), tsconfig.json (with path aliases), src/lib/utils.ts (cn helper), and copies domain UI components/hooks. Call this before Docker build.",
        inputSchema: {
            type: "object" as const,
            properties: {
                slug: {
                    type: "string",
                    description: "The app slug/folder name in the forge workspace",
                },
                blueprintSlug: {
                    type: "string",
                    description: "The blueprint slug used to scaffold this app",
                },
            },
            required: ["slug", "blueprintSlug"],
        },
    },
    {
        name: "forge_validate_workspace",
        description: "Pre-flight validation of a forge workspace before Docker build. Checks for required files (package.json, Dockerfile, next.config.js, tsconfig.json, src/lib/utils.ts, pages/index.tsx), build scripts, core dependencies, and ignoreBuildErrors config. Returns a list of issues if any are found.",
        inputSchema: {
            type: "object" as const,
            properties: {
                slug: {
                    type: "string",
                    description: "The app slug/folder name in the forge workspace",
                },
            },
            required: ["slug"],
        },
    },
    {
        name: "forge_check_readiness",
        description: "Run the App Forge readiness gate for a registered app. Checks registry, org scoping, deployment, workspace files, build artifact, runtime instance, platform token, and optionally probes the runtime URL.",
        inputSchema: {
            type: "object" as const,
            properties: {
                appId: {
                    type: "number",
                    description: "Numeric app ID to check",
                },
                probeRuntime: {
                    type: "boolean",
                    description: "Optional: perform a live HTTP probe of the runtime URL",
                },
            },
            required: ["appId"],
        },
    },
    {
        name: "forge_edit_file",
        description: "Edit or create a file in the forge workspace. Useful for making targeted code changes to an existing forged app.",
        inputSchema: {
            type: "object" as const,
            properties: {
                slug: {
                    type: "string",
                    description: "The app slug/folder name",
                },
                filePath: {
                    type: "string",
                    description: "Relative path within the app folder (e.g., 'pages/index.tsx', 'components/Header.tsx')",
                },
                content: {
                    type: "string",
                    description: "Full content of the file to write",
                },
            },
            required: ["slug", "filePath", "content"],
        },
    },
    {
        name: "forge_npm_command",
        description: "Run an npm command (install, build, test) in the forge workspace. Useful for installing dependencies or building the app after making changes.",
        inputSchema: {
            type: "object" as const,
            properties: {
                slug: {
                    type: "string",
                    description: "The app slug/folder name",
                },
                command: {
                    type: "string",
                    description: "The npm subcommand (e.g., 'install', 'run build', 'test')",
                },
            },
            required: ["slug", "command"],
        },
    },
    {
        name: "studio_list_files",
        description: "List the file tree of a forged app's workspace. Skips node_modules, .next, dist, and .git. Returns a nested tree of files and directories with sizes and extensions. Useful for understanding an app's scaffold before making targeted edits.",
        inputSchema: {
            type: "object" as const,
            properties: {
                slug: {
                    type: "string",
                    description: "The app slug (e.g., 'my-dashboard')",
                },
            },
            required: ["slug"],
        },
    },
    {
        name: "studio_read_file",
        description: "Read the content of a specific file from a forged app's workspace. Use studio_list_files first to discover available paths. Returns raw file content as a string.",
        inputSchema: {
            type: "object" as const,
            properties: {
                slug: {
                    type: "string",
                    description: "The app slug",
                },
                filePath: {
                    type: "string",
                    description: "Relative file path within the workspace (e.g., 'pages/index.tsx')",
                },
            },
            required: ["slug", "filePath"],
        },
    },
    {
        name: "studio_enhance_app",
        description: "Apply AI-generated code changes to a forged app, then rebuild and restart its container. Provide a natural language instruction describing the desired change (e.g., 'Add a dark mode toggle to the header', 'Change the font to Inter'). Returns the number of files written and success status.",
        inputSchema: {
            type: "object" as const,
            properties: {
                appId: {
                    type: "number",
                    description: "The numeric app ID (use list_blueprints or get_forge_status to find this)",
                },
                instruction: {
                    type: "string",
                    description: "Natural language description of the change to apply",
                },
            },
            required: ["appId", "instruction"],
        },
    },
    {
        name: "studio_plan_enhancement",
        description: "Preview an App Builder change before writing files. Returns likely touched files, risk level, and guard checks for a natural language enhancement request.",
        inputSchema: {
            type: "object" as const,
            properties: {
                appId: {
                    type: "number",
                    description: "The numeric app ID",
                },
                instruction: {
                    type: "string",
                    description: "Natural language description of the desired change",
                },
                scopePath: {
                    type: "string",
                    description: "Optional relative scope path for shared-server workbenches",
                },
            },
            required: ["appId", "instruction"],
        },
    },
    {
        name: "search_hil_context",
        description: "Search past Human-in-the-Loop (HIL) decisions for relevant context. Useful for understanding previous approval patterns and decisions.",
        inputSchema: {
            type: "object" as const,
            properties: {
                query: {
                    type: "string",
                    description: "Search query for HIL decisions",
                },
                limit: {
                    type: "number",
                    description: "Maximum number of results to return (default: 10)",
                },
            },
            required: ["query"],
        },
    },
    {
        name: "get_blueprint_spec",
        description: "Retrieve the technical specification of a blueprint, including its core files, available components, and platform constraints. Use this before coding to ensure compatibility with the selected architecture (e.g. Next.js vs React Native).",
        inputSchema: {
            type: "object" as const,
            properties: {
                blueprintSlug: {
                    type: "string",
                    description: "The slug of the blueprint to inspect (e.g. 'react-native')",
                },
            },
            required: ["blueprintSlug"],
        },
    },
];
