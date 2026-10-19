import { z } from "zod";
import type { ToolDefinition } from "./types.js";
import { sdlcToolStubs } from "./sdlc-tools.js";

/**
 * Agent-callable wrappers around sdlcToolStubs.
 *
 * These SDLC capabilities (Jira, Confluence, CI / test execution, DB migrations,
 * deploy) are implemented in sdlc-tools.ts with graceful local-artifact
 * fallbacks, but were never registered in AGENT_TOOLS. As a result, SDLC cycle
 * agents that listed them (e.g. the QA "End-to-End Test Suite Auditor" with
 * execute_playwright_test / jira_create_bug / run_dependency_audit) resolved to
 * ZERO usable tools — so their autonomous missions could never take an action
 * and never completed. Registering them makes those agents functional; the
 * underlying stubs degrade gracefully when external SaaS is absent.
 *
 * generate_image and github_create_pr are intentionally omitted — they already
 * resolve via other tool groups, and we don't want to clobber those.
 */

const run = (method: string) => async (params: any, context: any) => {
    const result = await (sdlcToolStubs as any)[method]({ ...params, orgId: context?.organizationId ?? undefined });
    return typeof result === "string" ? result : JSON.stringify(result);
};

/**
 * `idempotency` is a required argument rather than a default, because these
 * eighteen tools are not alike: some search, most of them file a ticket,
 * publish a page, apply a migration or deploy. A factory default would have
 * given all of them one answer, and the permissive answer would make a
 * side-effecting tool implicitly available to every agent and eligible to run
 * concurrently with others.
 *
 * read-safe = reads or computes, changes nothing. idempotent = has effects, but
 * running it twice leaves the same world (a test run). none = a repeat is a
 * second ticket, a second page, a second deploy.
 */
const def = (
    name: string,
    description: string,
    parameters: z.ZodTypeAny,
    method: string,
    idempotency: ToolDefinition["idempotency"],
): ToolDefinition => ({
    name,
    description,
    group: "SDLC",
    parameters,
    idempotency,
    execute: run(method),
});

export const SDLC_TOOLS: Record<string, ToolDefinition> = {
    jira_jql_search: def("jira_jql_search", "Search Jira issues with a JQL query. Returns matching issues (empty when Jira is not configured).", z.object({ jql: z.string().describe("JQL query"), fields: z.array(z.string()).optional(), limit: z.number().int().positive().optional() }), "jiraJqlSearch", "read-safe"),
    jira_create_sprint: def("jira_create_sprint", "Create a Jira sprint (records a local backlog artifact when Jira is not configured).", z.object({ name: z.string(), boardId: z.number().optional(), startDate: z.string().optional(), endDate: z.string().optional() }), "jiraCreateSprint", "none"),
    jira_create_epic_and_stories: def("jira_create_epic_and_stories", "Create a Jira epic with child user stories (persists to the knowledge base when Jira is not configured).", z.object({ epicName: z.string(), stories: z.array(z.object({ summary: z.string(), description: z.string().optional() })), projectKey: z.string().optional() }), "jiraCreateEpicAndStories", "none"),
    jira_create_bug: def("jira_create_bug", "File a Jira bug ticket (persists locally when Jira is not configured).", z.object({ summary: z.string(), description: z.string(), priority: z.string().optional(), projectKey: z.string().optional() }), "jiraCreateBug", "none"),
    confluence_read: def("confluence_read", "Read a Confluence page by id (or its local knowledge-base equivalent).", z.object({ pageId: z.string() }), "confluenceRead", "read-safe"),
    confluence_publish: def("confluence_publish", "Publish or update a Confluence page (falls back to the knowledge base when Confluence is not configured).", z.object({ title: z.string(), content: z.string(), space: z.string().optional(), pageId: z.string().optional(), parentPageId: z.string().optional() }), "confluencePublish", "none"),
    slack_post_message: def("slack_post_message", "Post a message to a Slack channel (no-op record when Slack is not configured).", z.object({ channel: z.string(), message: z.string() }), "slackPostMessage", "none"),
    execute_playwright_test: def("execute_playwright_test", "Run a Playwright end-to-end test suite and return pass/fail results.", z.object({ testPath: z.string().describe("Path to the test/spec to run") }), "executePlaywrightTest", "idempotent"),
    execute_unit_tests: def("execute_unit_tests", "Run the unit test suite and return results.", z.object({ path: z.string().optional(), suite: z.string().optional(), watch: z.boolean().optional() }), "executeUnitTests", "idempotent"),
    run_dependency_audit: def("run_dependency_audit", "Run a dependency vulnerability audit on the project.", z.object({ path: z.string().describe("Project path to audit") }), "runDependencyAudit", "idempotent"),
    db_generate_migration: def("db_generate_migration", "Generate a database migration from a natural-language description.", z.object({ description: z.string(), type: z.string() }), "dbGenerateMigration", "none"),
    db_apply_migration: def("db_apply_migration", "Apply a previously generated database migration.", z.object({ migrationId: z.string() }), "dbApplyMigration", "none"),
    aws_deploy: def("aws_deploy", "Deploy a service to an environment (simulated when no cloud is configured).", z.object({ environment: z.string(), service: z.string() }), "awsDeploy", "none"),
    trigger_hil_approval: def("trigger_hil_approval", "Trigger a human-in-the-loop approval form for a decision gate.", z.object({ formId: z.string(), data: z.record(z.any()) }), "triggerHilApproval", "none"),
    knowledge_graph_query: def("knowledge_graph_query", "Query the org knowledge graph for related context.", z.object({ query: z.string(), limit: z.number().int().positive().optional() }), "knowledgeGraphQuery", "read-safe"),
    generate_mermaid: def("generate_mermaid", "Generate a Mermaid diagram of the given type from content.", z.object({ diagramType: z.string(), content: z.string() }), "generateMermaid", "read-safe"),
    oddjob_prediction_windowing: def("oddjob_prediction_windowing", "Forecast the given metrics over a horizon window.", z.object({ horizon: z.number(), metrics: z.array(z.string()) }), "oddjobPredictionWindowing", "read-safe"),
    invoke_lsp: def("invoke_lsp", "Invoke a language-server method for code intelligence.", z.object({ method: z.string(), params: z.record(z.any()) }), "invokeLsp", "none"),
};
