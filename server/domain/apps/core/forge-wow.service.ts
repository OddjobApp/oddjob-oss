/**
 * Platform blocks that satisfy underlying WOW deficiency checks.
 * If any of these imports appear in the generated files, the corresponding
 * raw-pattern checks are skipped — the block already provides the capability.
 */
const PLATFORM_BLOCK_SATISFIERS: Record<string, string[]> = {
    // recharts check satisfied by chart/dashboard blocks
    recharts:  ["PlatformDatasetChartBlock", "IndustrialDashboardHero", "PlatformDatasetTableBlock"],
    // table check satisfied by any table/CRUD/missions block
    table:     ["PlatformDatasetTableBlock", "PlatformMissionsBlock", "MissionControlTable"],
    // loading check satisfied by any platform block (they all have internal skeletons)
    loading:   ["PlatformDatasetTableBlock", "PlatformAgentChatBlock", "PlatformMissionsBlock",
                 "PlatformMissionLogBlock", "PlatformPipelineTriggerBlock", "PlatformDatasetChartBlock",
                 "PlatformFormBlock", "PlatformKnowledgeSearchBlock", "PlatformJobRunnerBlock",
                 "PlatformHILApprovalBlock", "PlatformPipelineStatusBlock"],
};

/**
 * Returns true if any satisfying block is imported in the generated content.
 */
function blockSatisfies(allContent: string, checkKey: keyof typeof PLATFORM_BLOCK_SATISFIERS): boolean {
    return PLATFORM_BLOCK_SATISFIERS[checkKey].some(block => allContent.includes(block));
}

/**
 * Service responsible for validating that AI-generated apps meet 
 * high-fidelity aesthetic and functional standards.
 */
export const forgeWowService = {
    /**
     * WOW Requirements Validator
     *
     * Scans generated files for the presence of mandatory richness markers.
     * Platform block imports satisfy the corresponding raw-pattern checks —
     * a block-assembled app will never fail for missing recharts/Table/loading.
     * Returns a list of human-readable deficiency descriptions.
     */
    validateWowRequirements(
        files: Record<string, string>,
        description: string
    ): string[] {
        const allContent = Object.values(files).join("\n");
        const deficiencies: string[] = [];

        // Must have at least one page
        if (!files["pages/index.tsx"]) {
            deficiencies.push("Missing pages/index.tsx — main page is required.");
        }

        // Must have framer-motion if there are tsx pages
        const hasTsxPages = Object.keys(files).some(k => k.endsWith(".tsx") && k.startsWith("pages/"));
        if (hasTsxPages && !allContent.includes("framer-motion")) {
            deficiencies.push("No framer-motion animations found. Add motion.div entrance animations to at least 2 sections.");
        }

        // Must have lucide-react icons if there are tsx pages
        if (hasTsxPages && !allContent.includes("lucide-react")) {
            deficiencies.push("No lucide-react icons found. Use lucide-react for all visual indicators and buttons.");
        }

        // If the description suggests data/analytics, must have recharts OR a chart platform block
        const dataKeywords = /dashboard|analytics|chart|graph|metrics|stats|data|report|monitor|track|trend/i;
        if (dataKeywords.test(description) && !allContent.includes("recharts") && !blockSatisfies(allContent, "recharts")) {
            deficiencies.push("Description mentions data visualization but no recharts imports or chart platform block found. Use LineChart, BarChart, AreaChart, PieChart from 'recharts', or PlatformDatasetChartBlock.");
        }

        // If the description suggests tables or lists, should have DataTable, Table, or a table platform block
        const tableKeywords = /table|list|records|entries|items|users|products|orders|inventory/i;
        if (tableKeywords.test(description) && !allContent.includes("DataTable") && !allContent.includes("<Table") && !blockSatisfies(allContent, "table")) {
            deficiencies.push("Description mentions tabular data but no DataTable, Table, or dataset platform block found. Use PlatformDatasetTableBlock or DataTable from Oddjob UI.");
        }

        // Must have loading states — satisfied by platform blocks (they include internal skeletons)
        if (hasTsxPages && !allContent.includes("loading") && !allContent.includes("skeleton") && !allContent.includes("animate-pulse") && !blockSatisfies(allContent, "loading")) {
            deficiencies.push("No loading state found. Add animate-pulse skeleton placeholders or use a platform block that includes built-in loading states.");
        }

        // Must have error telemetry relay
        if (!files["pages/api/report-error.ts"]) {
            deficiencies.push("Missing pages/api/report-error.ts error relay — required for debug agent functionality.");
        }

        return deficiencies;
    },

    /**
     * Calculates a numerical WOW score (0-100).
     */
    calculateWowScore(
        files: Record<string, string>,
        description: string
    ): number {
        const deficiencies = this.validateWowRequirements(files, description);
        const maxScore = 100;
        const penaltyPerDeficiency = 15;
        
        // Base score starts at 100
        let score = maxScore - (deficiencies.length * penaltyPerDeficiency);
        
        // Bonus for high-end markers
        const allContent = Object.values(files).join("\n");
        if (allContent.includes("backdrop-blur")) score += 5; // Glassmorphism bonus
        if (allContent.includes("bg-gradient")) score += 5;   // Aesthetic bonus
        if (allContent.includes("AnimatePresence")) score += 5; // Advanced motion bonus
        if (allContent.includes("@domain-ui/packaged")) score += 10; // Packaged Block bonus (Assembly)

        return Math.min(Math.max(score, 0), 100);
    }
};
