import path from "node:path";
import fs from "node:fs/promises";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("UIRegistry");
const UI_COMPONENTS_ROOT = path.resolve("server/domain/core/ui/components/ui");
const PACKAGED_BLOCKS_ROOT = path.resolve("server/domain/core/ui/components/packaged");
const BLOCK_REGISTRY_PATH = path.resolve("server/domain/apps/core/block-registry.json");

export interface UIComponentManifest {
    name: string;
    importPath: string;
    category: string;
    description?: string;
}

export interface PackagedBlockEntry {
    id: string;
    name: string;
    description: string;
    importPath: string;
    category: string;
    props: Record<string, string>;
    selfWires: string[];
    tags: string[];
}

export const uiRegistryService = {
    /**
     * Scans the core UI library and returns a manifest for AI consumption.
     * Includes platform blocks from /packaged/ with their prop schemas.
     */
    async getUIPaletteManifest(): Promise<Record<string, string[] | PackagedBlockEntry[]>> {
        const manifest: Record<string, string[] | PackagedBlockEntry[]> = {
            "Layout": [],
            "Data Visualization": [],
            "Interactive": [],
            "Inputs": [],
            "Feedback": [],
            "Misc": []
        };

        try {
            const files = await fs.readdir(UI_COMPONENTS_ROOT);
            for (const file of files) {
                if (!file.endsWith(".tsx") || file === "index.tsx") continue;
                
                const name = path.basename(file, ".tsx");
                const category = this.categorizeComponent(name);
                (manifest[category] as string[]).push(name);
            }
        } catch (err: any) {
            logger.error(`Failed to scan UI components: ${err.message}`);
        }

        // Add CopilotKit Primitives (Static list as they are external)
        manifest["AI & Copilot"] = ["CopilotKit", "CopilotPopup", "CopilotSidebar", "CopilotChat", "CopilotTextarea"];

        // Add Advanced HIL & Workflow Components (from shared directory)
        manifest["Advanced Workflow & HIL"] = ["FormRenderer", "MarkdownEditor"];

        // Add Platform-Wired Blocks from block-registry.json
        manifest["Platform Blocks (Self-Wiring)"] = await this.getPackagedBlockManifest();

        return manifest;
    },

    /**
     * Reads block-registry.json and enriches entries with import paths.
     * Falls back to scanning /packaged/ directory if registry is unavailable.
     */
    async getPackagedBlockManifest(): Promise<PackagedBlockEntry[]> {
        try {
            const raw = await fs.readFile(BLOCK_REGISTRY_PATH, "utf-8");
            const registry = JSON.parse(raw);
            return (registry.blocks || []).map((block: any) => ({
                id: block.id,
                name: block.name,
                description: block.description,
                importPath: `@domain-ui/packaged/${block.id}`,
                category: block.category,
                props: block.props || {},
                selfWires: block.premium_features || [],
                tags: Array.isArray(block.tags) ? block.tags : [],
            }));
        } catch {
            try {
                const files = await fs.readdir(PACKAGED_BLOCKS_ROOT);
                return files
                    .filter(f => f.endsWith(".tsx") && f !== "index.tsx")
                    .map(f => {
                        const name = path.basename(f, ".tsx");
                        return {
                            id: name,
                            name,
                            description: `Pre-assembled platform block: ${name}`,
                            importPath: `@domain-ui/packaged/${name}`,
                            category: "packaged",
                            props: {},
                            selfWires: [],
                            tags: [],
                        };
                    });
            } catch (err: any) {
                logger.error(`Failed to scan packaged blocks: ${err.message}`);
                return [];
            }
        }
    },

    /**
     * Heuristic categorization based on component names.
     */
    categorizeComponent(name: string): string {
        const n = name.toLowerCase();
        if (n.includes("card") || n.includes("accordion") || n.includes("tabs") || n.includes("sheet") || n.includes("sidebar") || n.includes("resizable") || n.includes("scroll-area") || n.includes("separator")) {
            return "Layout";
        }
        if (n.includes("chart") || n.includes("stat") || n.includes("table") || n.includes("progress") || n.includes("calendar") || n.includes("carousel")) {
            return "Data Visualization";
        }
        if (n.includes("dialog") || n.includes("popover") || n.includes("command") || n.includes("menu") || n.includes("drawer") || n.includes("tooltip") || n.includes("hover-card") || n.includes("menubar")) {
            return "Interactive";
        }
        if (n.includes("button") || n.includes("input") || n.includes("select") || n.includes("checkbox") || n.includes("switch") || n.includes("slider") || n.includes("radio") || n.includes("form") || n.includes("label") || n.includes("textarea") || n.includes("toggle") || n.includes("otp")) {
            return "Inputs";
        }
        if (n.includes("toast") || n.includes("alert") || n.includes("skeleton") || n.includes("badge") || n.includes("avatar")) {
            return "Feedback";
        }
        return "Misc";
    }
};
