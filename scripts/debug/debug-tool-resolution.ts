
import { promptService } from '../../server/domain/ai/core/prompt-service.js';
import { AGENT_TOOLS, normalizeToolName } from '../../server/domain/tools/v1/tool-registry.service.js';
import { SkillManager } from '../../server/domain/agents/core/skill-manager.js';

async function test() {
    console.log("=== Agent Tool Resolution Test ===");
    const goal = "What do you know about precondition errors?";

    // 1. Get raw string names from prompt service
    const allowedToolNames = promptService.getTools(true);
    console.log(`- Phase 1: promptService.getTools(true) returned ${allowedToolNames.length} names.`);

    // 2. Resolve to definitions
    const allTools = allowedToolNames
        .map((name: string) => {
            const normalized = normalizeToolName(name);
            const tool = AGENT_TOOLS[normalized];
            if (!tool) {
                console.warn(`  [Warning] Tool NOT FOUND: ${name} (Normalized: ${normalized})`);
            }
            return tool;
        })
        .filter(Boolean);
    console.log(`- Phase 2: Resolved to ${allTools.length} tool definitions.`);

    // 3. Prune based on goal
    const pruned = SkillManager.pruneTools(goal, [], allTools as any);
    console.log(`- Phase 3: SkillManager.pruneTools returned ${pruned.length} tools.`);

    const hasUnifiedSearch = pruned.some((t: any) => t.name === 'search_unified_knowledge');
    console.log(`- Unified Search Present: ${hasUnifiedSearch ? "YES" : "NO"}`);

    if (hasUnifiedSearch) {
        console.log("\nSUCCESS: The agent will have access to unified search for this query.");
    } else {
        console.error("\nFAILURE: Unified search is MISSING from the pruned list.");
        process.exit(1);
    }
}

test().catch(err => {
    console.error(err);
    process.exit(1);
});
