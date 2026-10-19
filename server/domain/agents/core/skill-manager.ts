import { ToolDefinition } from "../../tools/v1/capabilities/types.js";
import { Skill } from "@shared/schema/index.js";
import { z } from "zod";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("SkillManager");

export type SkillCategory =
    | "knowledge"
    | "operations"
    | "files"
    | "web"
    | "data"
    | "utility";

export class SkillManager {
    private static CATEGORY_KEYWORDS: Record<SkillCategory, string[]> = {
        knowledge: ["confluence", "jira", "kb", "knowledge", "wiki", "search_knowledge", "explore_relationships", "entity", "relationship", "concept", "roadmap", "migration", "github", "repository", "pull_request", "pr", "sharepoint"],
        operations: ["pipeline", "job", "workflow", "trigger", "mission", "platform", "deploy", "forge", "build", "scaffold", "blueprint", "circuit", "breaker", "incident", "alert", "pagerduty", "datadog"],
        files: ["file", "read_file", "write_file", "upload", "download", "pdf", "csv", "json"],
        web: ["browse", "url", "http", "website", "connector", "saas", "external", "api", "integration", "trycua"],
        data: ["sql", "dataset", "query", "database", "table", "row", "analytics", "stats", "metrics"],
        utility: ["calculator", "translate", "python", "script", "math", "convert", "date", "time"]
    };

    /**
     * Compiled matcher per keyword. Built once, then reused — pruneTools runs on
     * every agent iteration.
     */
    private static keywordMatchers = new Map<string, RegExp>();

    /**
     * Does `text` contain `keyword` as a word?
     *
     * This used to be `text.includes(keyword)`, which made category activation
     * close to arbitrary: the two-letter keyword "pr" fired on "approve",
     * "improve", "project" and "process", "row" fired on "browsing", "time" on
     * "estimate", and "api" on "capital". Matching on word boundaries fixes
     * that, but a bare `\b` swings too far the other way — "files" would stop
     * matching "file" — so simple English inflections are folded in.
     *
     * Deliberately not a stemmer. It covers the inflections that actually occur
     * in these keyword lists (plurals, -ing/-ed, and consonant+y -> -ies);
     * anything more irregular belongs in CATEGORY_KEYWORDS as its own entry.
     */
    private static matchesKeyword(text: string, keyword: string): boolean {
        let matcher = this.keywordMatchers.get(keyword);
        if (!matcher) {
            const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const forms = new Set<string>([keyword]);
            if (keyword.endsWith("e")) {
                // browse -> browses, browsed, browsing
                const stem = keyword.slice(0, -1);
                forms.add(`${keyword}s`).add(`${keyword}d`).add(`${stem}ing`).add(`${stem}ed`);
            } else if (/[^aeiou]y$/.test(keyword)) {
                // query -> queries, querying, queried
                const stem = keyword.slice(0, -1);
                forms.add(`${stem}ies`).add(`${stem}ied`).add(`${keyword}ing`);
            } else {
                // file -> files; pipeline -> pipelines; deploy -> deploying
                forms.add(`${keyword}s`).add(`${keyword}es`).add(`${keyword}ing`).add(`${keyword}ed`);
            }
            const alternatives = [...forms].map(escape).join("|");
            matcher = new RegExp(`\\b(?:${alternatives})\\b`, "i");
            this.keywordMatchers.set(keyword, matcher);
        }
        return matcher.test(text);
    }

    /**
     * Determines which tool categories are relevant based on the goal.
     * In a production environment, this could involve a small classifier LLM.
     */
    static identifyRelevantSkills(goal: string, history: any[] = []): SkillCategory[] {
        // Only parse current goal and the last user message to prevent assistant responses
        // from bloating active categories.
        const userMsgs = (history || []).filter(h => h.role === 'user' || h.type === 'user');
        const lastUserMsg = userMsgs.length > 0 ? userMsgs[userMsgs.length - 1].content : "";
        const text = (goal + " " + lastUserMsg).toLowerCase();
        const relevant: SkillCategory[] = [];

        for (const [category, keywords] of Object.entries(this.CATEGORY_KEYWORDS)) {
            if (keywords.some(k => this.matchesKeyword(text, k))) {
                relevant.push(category as SkillCategory);
            }
        }

        // Always include knowledge and utility as base skills if it's an ambiguous prompt
        if (relevant.length === 0) {
            return ["knowledge", "utility"];
        }

        return relevant;
    }

    /**
     * Tools that survive pruning regardless of the goal, because a run that
     * needs one and cannot see it fails with a confusing "tool not found"
     * rather than degrading.
     *
     * The delegation entries matter most. They declare no `group`, so
     * getToolCategory files them under "utility" — a category that only
     * activates on maths/time words or a fully ambiguous goal. Until this list
     * named them, delegation was pruned out of most runs before the model ever
     * saw it. The list previously named `spawn_sub_mission`, `blackboard_read`
     * and `blackboard_write`, none of which are registered tools, so the
     * protection it claimed to give had never applied to anything.
     */
    private static readonly ESSENTIAL_TOOLS = new Set<string>([
        'bug_report', 'help', 'current_time',
        'file_read', 'read_file', 'file_list', 'list_files',
        'google_search', 'search_unified_knowledge', 'browse_web',
        // Pipeline & execution tools — must never be pruned
        'trigger_pipeline', 'show_pipeline_input_form', 'list_pipelines',
        'get_pipeline_details', 'get_pipeline_status', 'resolve_intent_to_pipeline',
        // Dataset tools — frequently needed cross-category
        'list_datasets', 'query_dataset', 'get_dataset_details',
        // Core job tools
        'list_jobs', 'get_job_details',
        // Delegation tools — the real ones, as registered by DELEGATION_TOOLS
        'delegate_task', 'request_help', 'review_bids', 'accept_bid',
    ]);

    /**
     * Filters the provided tools to only include those matching the identified skills.
     */
    static pruneTools(goal: string, history: any[], allTools: ToolDefinition[]): ToolDefinition[] {
        const activeSkills = this.identifyRelevantSkills(goal, history);

        // Define tool -> category mapping
        const getToolCategory = (tool: ToolDefinition): SkillCategory => {
            const name = tool.name.toLowerCase();
            const group = tool.group?.toLowerCase() || "";
            
            if (group.includes("knowledge") || group.includes("confluence") || group.includes("documentation") || name.includes("search") || name.includes("confluence") || name.includes("knowledge")) return "knowledge";
            if (group.includes("pipeline") || group.includes("mission") || group.includes("system")) return "operations";
            if (group.includes("file") || name.includes("file")) return "files";
            if (group.includes("web") || group.includes("saas") || name.includes("http") || name.includes("browse") || name.includes("trycua")) return "web";
            if (group.includes("data") || name.includes("sql") || name.includes("dataset")) return "data";
            return "utility";
        };

        const result = allTools.filter(tool => {
            if (SkillManager.ESSENTIAL_TOOLS.has(tool.name)) return true;

            const category = getToolCategory(tool);
            return activeSkills.includes(category);
        });

        logger.debug(
            `Kept ${result.length}/${allTools.length} tools for categories [${activeSkills.join(", ")}]`
        );

        return result;
    }

    /**
     * Filters the provided jobs to only include those matching the identified skills.
     */
    static pruneJobs(goal: string, history: any[], allJobs: any[]): any[] {
        const activeSkills = this.identifyRelevantSkills(goal, history);

        const getJobCategory = (job: any): SkillCategory => {
            const type = job.type?.toLowerCase() || "";
            const tool = job.tool?.toLowerCase() || "";
            const name = job.name?.toLowerCase() || "";

            if (name.includes("search") || tool.includes("knowledge") || tool.includes("confluence")) return "knowledge";
            if (type === "supervisor" || type.includes("pipeline") || name.includes("system")) return "operations";
            if (tool.includes("file")) return "files";
            if (tool.includes("web") || tool.includes("http") || tool.includes("saas")) return "web";
            if (tool.includes("sql") || tool.includes("data") || name.includes("dataset")) return "data";
            return "utility";
        };

        return allJobs.filter(job => {
            // Always keep supervisor agents
            if (job.type === 'supervisor') return true;

            const category = getJobCategory(job);
            return activeSkills.includes(category);
        });
    }

    /**
     * Filters dynamic skills based on the identified categories.
     */
    static pruneDynamicSkills(goal: string, history: any[], allSkills: Skill[]): Skill[] {
        const activeSkills = this.identifyRelevantSkills(goal, history);
        
        return allSkills.filter(skill => {
            const text = (skill.name + " " + (skill.description || "")).toLowerCase();
            
            // Check if skill matches any active category keywords
            return activeSkills.some(category => {
                const keywords = this.CATEGORY_KEYWORDS[category];
                return keywords.some(k => this.matchesKeyword(text, k));
            });
        });
    }

    /**
     * Converts a database Skill into a ToolDefinition for the agent.
     */
    static mapSkillToToolDefinition(skill: Skill): ToolDefinition {
        return {
            name: skill.name,
            description: skill.description || `Dynamic skill: ${skill.name}`,
            parameters: z.object({
                args: z.record(z.any()).describe("Arguments for the dynamic skill execution")
            }),
            execute: async (params: any, context?: any) => {
                const { skillService } = await import("./skill-service.js");
                return await skillService.executeSkill(skill.id, params.args || {});
            },
            group: "dynamic_skills",
            label: `Skill: ${skill.name}`
        };
    }
}


