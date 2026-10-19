import { workspaceResultPayload, digestWorkspaceResultForModel } from './crew-workspace-results.js';
import { isPermissionRequiredPayload } from '@shared/crew-permission.js';
import { MAIL_DOCS_WRITE_NAMES } from '@domain/tools/v1/capabilities/google-mail-docs.js';
import { CALENDAR_WRITE_NAMES } from '@domain/tools/v1/capabilities/google-calendar.js';
/**
 * Crew Tools Service (tier 1 — read-only)
 *
 * Crew agents already declare real tools: `agent_cards.tools` is populated from
 * each agent's job config, so the Security Auditor carries `run_dependency_audit`
 * and `workspace_search`, the Backend Developer carries `github_list_prs`, and so
 * on. Until now the crew ignored all of it, which is why agents speculated and
 * the supervisor kept marking contributions "speculative" — they had no way to
 * check anything.
 *
 * This exposes the READ-ONLY subset of what an agent already declares, so it can
 * cite evidence. Writes are deliberately out of scope: creating a PR or posting
 * to Slack mid-discussion needs an approval gate, which is a separate tier.
 *
 * Classification is DEFAULT-DENY. Only 20 of the ~62 capability modules declare
 * `idempotency` at all, so "not declared as writing" is not evidence of safety.
 * A tool is offered only when it is positively identifiable as a read.
 */

import { zodToJsonSchema } from "zod-to-json-schema";
import { crewRepository } from "./crew-repository.js";
import { scribeConversationIntent } from "@shared/scribe-conversation.js";
import { createLogger } from "@server/utils/logger.js";
import type { AgentCardRecord } from "@shared/schema/agent-cards.js";
import type { ToolDefinition, ToolContext } from "@domain/tools/v1/capabilities/types.js";

import { STUDIO_AGENT_TOOLS, normalizeCrewStudio } from "./crew-studio-tools.js";
import { maybeGateOutboundSend } from "./outbound-send-gate.js";

const logger = createLogger("CrewToolsService");

/**
 * Most tool calls an agent may make in one turn.
 *
 * Six was enough to read a document and touch it once; a real editing pass —
 * get the document, update several nodes, run a critic pass — is eight to ten
 * calls, and hitting the cap mid-edit was how a turn ended having claimed a
 * write that never ran.
 */
export const MAX_TOOL_CALLS_PER_TURN = 12;

/** Tokens that mark a tool as reading. */
const READ_TOKENS = new Set([
    "get", "list", "search", "read", "query", "find", "describe", "discover",
    "fetch", "inspect", "check", "status", "view", "show", "count", "summarize",
    "summarise", "analyze", "analyse", "diff", "history", "details",
]);

/** Tokens that mark a tool as writing or otherwise acting on the world. */
const WRITE_TOKENS = new Set([
    "create", "update", "delete", "write", "post", "send", "publish", "trigger",
    "run", "execute", "provision", "install", "deploy", "modify", "set", "add",
    "remove", "move", "upsert", "launch", "approve", "assign", "close", "merge",
    "start", "stop", "cancel", "kill", "reset", "sync", "import", "export",
    "generate", "build", "apply", "invite", "grant", "revoke",
]);

/**
 * Verbs that bar a tool from auto-admission even when it is annotated
 * read-safe: the annotation proves nothing reached a human pairing it with an
 * agent. Superset of WRITE_TOKENS — `propose`, `record`, `ingest`, `share`,
 * `simulate`, `verify`, `prove`, `synthesize`, `review` and `wait` all claim an
 * act the read-only tiers never perform, so names carrying them stay behind a
 * card declaration or a dedicated service path.
 */
const ACTING_TOKENS = new Set([
    ...WRITE_TOKENS,
    "propose", "record", "ingest", "share", "simulate", "verify", "prove",
    "synthesize", "review", "wait",
]);

/** Side effects that disqualify a tool outright, whatever its name suggests. */
const DISQUALIFYING_SIDE_EFFECTS = new Set([
    "file-system", "email", "webhook", "container", "queue-message",
]);

/**
 * Tier 2 — tools that hand the user a working artifact rather than prose: an
 * intake form, an instant app, a pipeline input form.
 *
 * An explicit allowlist, not a heuristic. These are not reads, so no naming rule
 * can justify them; each was checked to render an ephemeral UI surface with no
 * external side effect. `assemble_instant_app` and friends all declare
 * riskLevel "low".
 *
 * Note what is NOT here: `trigger_pipeline`. Showing the form is tier 2; running
 * the pipeline is a write and belongs behind an approval gate.
 */
export const ARTIFACT_TOOLS = new Set([
    "render_instant_app",
    "assemble_instant_app",
    "render_intake_form",
    "render_app_surface",
    "render_app_catalog",
    "show_pipeline_input_form",
    "generate_image",
    "generate_pdf",
    "generate_excel",
    "generate_word",
    "generate_google_doc",
    "generate_mermaid_diagram",
    "generate_presentation_deck",
    "ai_translate",
    "mount_builder_pod",
    "propose_decision_matrix",
    "ratify_decision",
    "record_commitment",
    "verify_claim",
    "request_governance_approval",
    "pin_forensic_event",
    "dispatch_spatial_squad",
    "mount_scribe_studio",
    "mount_app_studio",
    "mount_form_studio",
    "mount_flow_studio",
    "mount_prediction_studio",
    "mount_signal_studio",
    "mount_project_studio",
    "mount_computer_studio",
    "estimate_trajectory",
    "mount_media_studio",
    "scribe_update_node",
    "scribe_configure_stations",
    "scribe_add_table_of_contents",
    "scribe_import_confluence_page",
    "scribe_fork_branch",
    "scribe_reconcile_continuity",
    "scribe_run_critic_pass",
    "scribe_export_manuscript",
    "start_multistep_run",
    "render_workflow_diagram",
    "resolve_assembly_dag",
    "evaluate_functional_gaps",
    "plan_app_architecture",
    "propose_app_draft",
    "deploy_forged_app",
    "synthesize_fullstack_spec",
    "scaffold_multistep_app",
    "bind_screen_io",
    "preview_screen_flow",
    // Renders a result table, exactly as render_table does. Listed explicitly
    // because the name begins with "run", a write token, so the classifier
    // would otherwise reject it and it would vanish from the offered set
    // despite being allowlisted. Its only write is an execution-history row.
    "run_saved_query",
    // Spatial analytics
    "h3_hexagonal_spatial_evaluate",
    "geofence_spatial_evaluate",
    "geocoding",
    "geo_discovery",
    // Named geographic areas. locate_position_in_regions reports `inside` and
    // `indeterminate` separately on purpose — see spatial-containment.ts.
    "list_spatial_regions",
    "locate_position_in_regions",
    "find_neighbouring_regions",
    // Project-scoped SaaS adapters, rendered as an assembly surface.
    "list_saas_adapters",
    // The project's own files. Retrieval, never prompt-stuffing.
    "search_attachments",
    "list_attachments",
    "get_attachment_text",
    // A drawn process into a buildable draft. Drafts only — deploying still
    // goes through propose_assembly_deployment.
    "synthesize_app_from_process",
    "list_confluence_spaces",
    "list_jira_projects",
    "get_servicenow_schema",
    // Rich-UI data visualization — charts, tables, dashboards
    "render_chart",
    "render_scatter_plot",
    "render_map",
    "render_table",
    "render_performance_scorecard",
    "publish_work_product",
    "render_gate_review",
    "render_list",
    "render_timeline",
    "render_progress",
    "render_tree",
    "render_comparison",
    "render_carousel",
    "get_health_dashboard",
    // Subgraph topological queries
    "query_knowledge_subgraph",
    // User context and synthetic persona reads. Rendered, not narrated — a
    // profile summarised into prose loses the shape the surface is for.
    "get_user_context_graph",
    "get_synthetic_persona",
    "get_user_ocean_profile",
    // Project budget. set_project_budget_cap is listed despite "set" being a
    // write token, for the same reason run_saved_query is above: the classifier
    // would drop it, and its surface is the spend panel it writes back into.
    "get_project_spend",
    "set_project_budget_cap",
]);

/**
 * Presentation tools granted to EVERY crew agent, regardless of what its card
 * declares.
 *
 * The declared `tools` list is a ceiling on an agent's *domain* reach — which
 * repo it can read, which tracker it can query. Rendering a surface is not
 * domain reach; it is how any participant hands something to the user, the same
 * way the copilot has these available to it. Without this, tier 2 would never
 * fire: no synced agent card declares a render tool, because job configs list
 * domain integrations rather than presentation affordances.
 *
 * Kept deliberately small, and limited to tools that are generic rather than
 * bound to a specific org resource — `show_pipeline_input_form` and
 * `render_app_surface` still require an agent to declare them, because they
 * reach for a particular pipeline or app.
 */
export const UNIVERSAL_PRESENTATION_TOOLS = [
    "render_app_surface",
    "render_app_catalog",
    "show_pipeline_input_form",
    "search_unified_knowledge",
    // Dataset Analytics & Record Access: discovery, then records, then aggregation.
    // All three are registered in capabilities/dataset-analytics-tools.ts.
    "list_datasets",
    "get_dataset_items",
    "calculate_dataset_metric",
    // An installed app's stored records, for this org only: collections first,
    // then rows. Read-only, like the dataset reads above.
    "read_app_records",
    "read_app_activity",
    // Saved queries: discovery then execution. Both, deliberately — an agent
    // told to run one with no way to see what exists invents a name, which is
    // exactly how the scaffold-pack ids went wrong.
    "list_saved_queries",
    "run_saved_query",
    // Agent Studio: open it on an agent, and draft one from what someone asked for.
    // Drafting writes nothing — the card says what the agent would be able to do, what a
    // run costs and what it still needs, and a person applies it. Applying is not a tool
    // at all: it is reached from the card, so no model can grant an agent a permission.
    "mount_agent_studio",
    "propose_agent",
    // Flow Studio: draft a flow from the jobs this org already has. Writes
    // nothing -- a person presses Create on the card, and that path is not a
    // tool at all, so no model can put a running automation into an org.
    "propose_flow",
    "propose_prediction_job",
    // Running one of this org's pipelines. Writes nothing -- the card is a pending
    // approval, and an org admin approving it is what starts the run.
    "propose_pipeline_run",
    // Asking for a missing integration. Writes nothing — returns a card with
    // the OAuth link; the connector it creates is scoped to this project space.
    "connect_platform",
    // The Ontology: what business objects this org HAS, and what one of them says.
    // Reads only. `ontology_execute_action` is deliberately absent — the service's
    // approval gate governs whether an action runs, which is a different question
    // from whether every agent in a room may reach for one, and that second
    // question deserves its own decision rather than arriving as a side effect of
    // making the ontology readable.
    "ontology_list_object_types",
    "ontology_list_objects",
    "ontology_get_object",
    // What the org's objects can traverse TO. Without this the room can list types
    // and instances but has no way to learn they are related, which is most of what
    // makes an ontology worth querying.
    "ontology_list_link_types",
    // Following one. Read-safe, and without it the room can see that two types are
    // related but never get from one to the other, which is the question a
    // relationship exists to answer.
    "ontology_traverse_link",
    // Declaring a relationship. Admitted as a proposal (tier 3.5), not as a general
    // write: it dispatches through the ontology's own approval gate, so nothing is
    // declared without a human decision. `ontology_execute_action` stays out — the
    // question of whether every agent may reach for ANY action is still separate.
    "ontology_define_link_type",
    "ontology_link_objects",
    "ontology_unlink_objects",
    // System Documentation & Specifications: First-class access to internal architecture and specs
    "list_system_specs",
    "get_system_spec",
    "search_system_docs",
    "search_platform_documentation",
    "get_platform_feature_spec",
    "list_platform_features",
    "read_internal_repo_doc",
    // Platform Operational Patterns: the runbook an agent cites instead of
    // asserting from its own weights. Read-only, and generic rather than bound
    // to an org resource, so it belongs here rather than behind a card.
    "list_platform_patterns",
    "search_platform_patterns",
    "get_platform_pattern",
    // X-Ray System Graph: platform topology and structural relationships
    "list_xray_specs",
    "get_xray_spec",
    "execute_visual_query",
    "list_instant_app_components", // discovery — needed to pick a valid component
    "render_instant_app",
    "assemble_instant_app",
    "render_intake_form",
    "list_document_templates",
    "get_document_template",
    "list_hil_forms",
    "generate_image",
    "generate_pdf",
    "generate_excel",
    "generate_word",
    "generate_google_doc",
    "generate_mermaid_diagram",
    "generate_presentation_deck",
    "ai_translate",
    "mount_builder_pod",
    "propose_decision_matrix",
    "ratify_decision",
    "record_commitment",
    "verify_claim",
    "request_governance_approval",
    "pin_forensic_event",
    "dispatch_spatial_squad",
    "mount_scribe_studio",
    "mount_app_studio",
    // Mounting only. propose_form_change and apply_form_change are deliberately
    // absent: the room's direct path reaches them after deciding a message asks.
    "mount_form_studio",
    "mount_flow_studio",
    "mount_prediction_studio",
    "mount_signal_studio",
    // Agents asked for this by name — invented it, actually — three turns in a
    // row in a room where it didn't exist. A read of what feeds the org has.
    "list_signal_feeds",
    // The proposal half of the contribution seam — the card whose Apply button
    // the room's direct path answers. apply_studio_contribution stays out: it
    // writes the applied marker, and reaching it from the card's message is the
    // only thing that should be able to.
    "propose_studio_contribution",
    "mount_project_studio",
    "mount_computer_studio",
    "estimate_trajectory",
    "mount_media_studio",
    "scribe_update_node",
    "scribe_get_document",
    "scribe_configure_stations",
    "scribe_add_table_of_contents",
    "scribe_fork_branch",
    "scribe_reconcile_continuity",
    "scribe_run_critic_pass",
    "scribe_export_manuscript",
    "start_multistep_run",
    "render_workflow_diagram",
    "resolve_assembly_dag",
    "evaluate_functional_gaps",
    "plan_app_architecture",
    "list_scaffold_packs",
    "discover_capabilities",
    "list_installed_apps",
    "list_pipelines",
    "list_templates",
    "list_pending_cycles",
    "list_available_mcp_capabilities",
    "list_calculation_nodes",
    "update_blackboard",
    "get_blackboard",
    "request_help",
    "request_mcp_tool",
    "propose_mission",
    "propose_mission_synthesis",
    "propose_research_mission",
    "propose_cycle_draft",
    // A Project Studio wave plan saved as a cycle PENDING APPROVAL — nothing
    // runs until an org admin approves it, the same contract as propose_*.
    "commit_project_plan_to_cycle",
    "propose_app_draft",
    "deploy_forged_app",
    "scaffold_multistep_app",
    "bind_screen_io",
    "preview_screen_flow",
    "synthesize_fullstack_spec",
    "propose_scenario_simulation",
    "propose_spatial_analysis",
    "propose_calculation_eval",
    "propose_security_audit",
    "propose_knowledge_ingestion",
    "propose_assembly_deployment",
    // Binding an external resource to this project. A proposal, not a write:
    // it dispatches through the approval gate like the deployment above.
    "propose_adapter_binding",
    // Filing a room's file into the project KB — approved, never inline.
    "propose_attachment_promotion",
    "propose_crew_decision",
    "propose_crew_claim",
    "propose_crew_commitment",
    // Spatial analytics — H3 hex map evaluation and geofence telemetry
    "h3_hexagonal_spatial_evaluate",
    "geofence_spatial_evaluate",
    "geocoding",
    "geo_discovery",
    // Named geographic areas, and locating a measured position among them.
    "list_spatial_regions",
    "locate_position_in_regions",
    "find_neighbouring_regions",
    // What this project is wired into. An org-scoped read that renders a
    // surface, so it belongs here rather than behind an agent card's domain.
    "list_saas_adapters",
    // The project's own files. Retrieval, never prompt-stuffing.
    "search_attachments",
    "list_attachments",
    "get_attachment_text",
    // A drawn process into a buildable draft. Drafts only — deploying still
    // goes through propose_assembly_deployment.
    "synthesize_app_from_process",
    // A URL the human pasted becomes a file the room can read. This is the
    // piece that was missing when an agent narrated "upload_attachment" for
    // five rounds — the tool did not exist, so nothing ever happened.
    "attach_url",
    "list_confluence_spaces",
    "list_jira_projects",
    "get_servicenow_schema",
    // Rich-UI data visualization — charts, tables, lists, dashboards
    "render_chart",
    "render_scatter_plot",
    "render_map",
    "render_table",
    "render_performance_scorecard",
    "publish_work_product",
    "render_gate_review",
    "render_list",
    "render_timeline",
    "render_progress",
    "render_tree",
    "render_comparison",
    "render_carousel",
    "get_health_dashboard",
    // Subgraph topological queries
    "query_knowledge_subgraph",
    // User Context Graph & Synthetic Persona Tools
    "get_user_context_graph",
    "get_synthetic_persona",
    "get_user_ocean_profile",
    // Project Budget & Spend Tools
    "get_project_spend",
    "set_project_budget_cap",
];

/**
 * Tier 3.5 — Governed Proposal Tier.
 * Tools that create non-destructive drafts and proposals requiring explicit
 * human approval before execution. They inherit the requester's permissions and
 * render inline approval cards in CREW Chat.
 */
export const PROPOSAL_TOOLS = new Set([
    'propose_financial_snapshot',
    'quickbooks_propose_invoice',
    'amazon_propose_purchase',
    'amazon_build_cart',
    'youtube_reply_comment',
    'propose_app_action',
    ...CALENDAR_WRITE_NAMES,
    ...MAIL_DOCS_WRITE_NAMES,
    "propose_agent",
    "propose_flow",
    "propose_prediction_job",
    // Approval starts the run (pipeline-run-proposals.ts).
    "propose_pipeline_run",
    "propose_mission",
    "propose_mission_synthesis",
    "propose_research_mission",
    "propose_cycle_draft",
    // Saves a pending_approval cycle; approval is what starts it.
    "commit_project_plan_to_cycle",
    "propose_scenario_simulation",
    "propose_spatial_analysis",
    "propose_calculation_eval",
    "propose_security_audit",
    "propose_knowledge_ingestion",
    "propose_assembly_deployment",
    "propose_crew_decision",
    "propose_crew_claim",
    "propose_crew_commitment",
    // A reviewed email or Slack send — the draft renders as a confirmation
    // card and nothing is delivered until a human approves it.
    "propose_outbound_message",
    // A suggestion for a live studio, rendered as a card — nothing is written
    // until the card's Apply message reaches the room's direct path.
    "propose_studio_contribution",
    // Writes only behind decisionRouter — the declaration does not land unless a
    // human approves it, which is the same contract as the propose_* tools.
    "ontology_define_link_type",
    "ontology_link_objects",
    "ontology_unlink_objects",
    // A booking draft: nothing drives the desktop browser until the card is
    // approved, and the approved task itself stops at the payment step.
    "flighthub_propose_booking",
]);

/**
 * Tier 3 — Collaboration, input requests, and shared working memory.
 */
export const COLLABORATION_TOOLS = new Set([
    "request_human_input",
    "request_mcp_tool",
    "update_blackboard",
    "get_blackboard",
    "request_help",
    // Pulling a file the human named into the room IS human input — the URL
    // stands in for the upload the UI does not give a speaker. The write it
    // makes is a room-scoped attachment row behind the egress firewall.
    "attach_url",
]);

const HUMAN_INPUT_TOOLS = COLLABORATION_TOOLS;

/**
 * Tier 4 — looking something up when the room does not already know it.
 *
 * Granted to EVERY agent, on the same reasoning as the presentation tools: the
 * declared `tools` list is a ceiling on an agent's DOMAIN reach — which repo it
 * reads, which tracker it queries. None of these touch an org resource, so the
 * ceiling has nothing to say about them, and no synced agent card declares them
 * because job configs list domain integrations.
 *
 * Ordered as an escalation, which is how `propose_research_mission` already
 * describes itself ("use this ONLY after search_unified_knowledge — and web
 * search where available — returned nothing useful"). Until now the crew was the
 * reason that parenthetical read "where available": it had no web access at all,
 * so an agent that could not answer had nothing left but to speculate, which is
 * exactly what the supervisor kept marking speculative.
 *
 * Two of these cannot pass the name heuristic — `browse_web` has no read verb
 * and `propose_research_mission` reads as neither — so they are admitted here
 * explicitly rather than by loosening READ_TOKENS, which would let unrelated
 * tools in through the same gap.
 *
 * `propose_research_mission` proposes; it does not run. Approval is a human's,
 * and the mission executes behind that gate — so it is admissible for the same
 * reason `request_human_input` is.
 */
export const RESEARCH_TOOLS = [
    "search_system_docs",       // authoritative platform & architecture specs
    "get_system_spec",          // retrieve full architecture/module specification
    "list_system_specs",        // enumerate available platform specifications
    "search_platform_documentation", // live feature specs & capability catalog
    "get_platform_feature_spec",// domain module feature spec
    "read_internal_repo_doc",   // direct repo docs/ reader
    "list_datasets",            // list available structured datasets
    "get_dataset_items",        // retrieve records from a dataset
    "calculate_dataset_metric", // compute averages, sums, medians over dataset records
    "search_unified_knowledge", // local knowledge first — cheapest, and org-specific
    "discover_capabilities",    // platform & mission capability discovery
    "google_search",            // then the open web
    "browse_web",               // then a specific page (EgressFirewall-guarded)
    "http_query",               // then live API query via governed connector
    "propose_research_mission", // and if none of it answered: propose real work
] as const;

const RESEARCH_TOOL_SET = new Set<string>(RESEARCH_TOOLS);

/**
 * Tier 4a — looking at the organization's desktop without touching it.
 *
 * Granted universally so any speaker can read the screen a computer task left
 * behind. Each is admitted by classifyReadOnly on its own declaration
 * (`read-safe`, or a read verb for `list_skills`) — nothing here is smuggled
 * past the classifier. Acting on the desktop (click, type, run_task,
 * create_session) stays behind the card's declared `tools` ceiling.
 */
export const COMPUTER_OBSERVATION_TOOLS = [
    "trycua_teach_task",        // opens the teaching UI; records nothing by itself
    "trycua_screenshot",
    "trycua_observe",
    "trycua_find_element",
    "trycua_dom_extract",
    "trycua_list_skills",
] as const;

/**
 * Tier 4b — what the platform knows about ITSELF.
 *
 * Asked for a status brief on Oddjob — active missions, job health, spend,
 * alerts — the crew had `search_unified_knowledge` and nothing else, so it
 * searched the knowledge base for operational facts that do not live there,
 * found nothing, and reported that nothing existed. The data was always
 * available; no agent could reach it, because these tools sit in the registry
 * but were named by no agent card and by neither universal list.
 *
 * Granted universally on the same reasoning as RESEARCH_TOOLS: the card's
 * `tools` ceiling governs an agent's DOMAIN reach (which repo, which tracker),
 * and none of these touch a third-party resource. Every one is a read, scoped
 * to the caller's organization by its own ToolContext, and each passes
 * classifyReadOnly on its own name — so they are admitted here as "read-verb",
 * not smuggled past the classifier.
 *
 * Writes stay out: nothing here starts, retries, cancels or approves anything.
 */
export const PLATFORM_STATUS_TOOLS = [
    'get_crew_readiness',
    // Missions and their runs — "what is this organization working on"
    "list_missions",
    "list_mission_runs",
    // Operational health
    "get_system_health",
    "get_health_triage_brief",
    "list_jobs",
    "list_failed_jobs",
    "list_recent_executions",
    // Attention and risk
    "list_alerts",
    "list_pending_interventions",
    // Cost KPIs (get_project_spend is already granted for a single project)
    "get_cost_analysis",
    // Knowledge coverage KPI
    "get_graph_statistics",
    // What is coming up
    "list_scheduled_jobs",
    "get_upcoming_scheduled_runs",
] as const;

/**
 * Whether a tool result is actually a failure wearing a success.
 *
 * executeToolCalls only marks ok:false when execute() THROWS. The v1 capability
 * layer does not throw: 85 sites return `Error <verb>: <message>` and 51 return
 * JSON with a top-level `error`, all of which are ordinary string returns and so
 * were recorded ok:true. A crew room therefore reported writes that never
 * happened — scribe_update_node came back {ok:true, ms:3} against a node id the
 * model had invented, and every guard that keys off `ok` (including the one that
 * is supposed to tell the author their edit was not saved) was reading a lie.
 *
 * Returns the message when the output matches either convention, else null.
 * Recognition is deliberately narrow: the JSON form is unambiguous, and the
 * prose form must start with "Error" AND carry a colon in its first 120
 * characters, so a document that merely opens with the word is not swallowed.
 * A false positive costs an incorrect label; the output still reaches the model
 * verbatim either way.
 */
export function classifyToolFailure(output: string): string | null {
    const text = output.trim();
    if (!text) return null;

    if (text.startsWith("{")) {
        try {
            const parsed = JSON.parse(text) as Record<string, unknown>;
            if (typeof parsed?.error === "string" && parsed.error.trim()) {
                return parsed.error.trim();
            }
        } catch {
            // Not JSON after all; fall through to the prose form.
        }
        return null;
    }

    if (/^Error\b/.test(text) && text.slice(0, 120).includes(":")) {
        return text.split(/\r?\n/)[0].trim();
    }
    return null;
}

/**
 * Tools whose output is evidence the agent has to reason over, not just a
 * surface for the human.
 *
 * The artifact branch below replaces a rich payload with "it is already
 * displayed — do not repeat its contents", which is right for a chart and wrong
 * for a lookup: list_attachments answered with an assistant_table naming the one
 * file in the room, the agent was handed the do-not-repeat line instead of the
 * rows, and it told the author there were no attachments. It was not ignoring
 * the upload; it was never shown it.
 *
 * These still render. They just also reach the model, as a readable digest
 * rather than the raw envelope — the envelope is what used to get echoed into
 * prose, and that is the leak the suppression exists to prevent.
 */
export const RETRIEVAL_TOOLS = new Set([
    "list_attachments",
    "search_attachments",
    "get_attachment_text",
]);

/**
 * A rich payload rendered as plain lines for the model to read.
 *
 * Never returns JSON: an agent that sees an envelope tends to paste it.
 */
export function digestArtifactForModel(payload: Record<string, unknown>): string {
    const MAX_ROWS = 30;
    const title = typeof payload.title === "string" ? payload.title : "Result";
    const description = typeof payload.description === "string" ? payload.description : "";
    const lines: string[] = [description ? `${title} (${description})` : title];

    const columns = Array.isArray(payload.columns) ? payload.columns : [];
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    if (rows.length) {
        const keys = columns
            .map((c: any) => (c && typeof c.key === "string" ? c.key : null))
            .filter((k: unknown): k is string => typeof k === "string");
        for (const row of rows.slice(0, MAX_ROWS)) {
            const r = row as Record<string, unknown>;
            const cells = (keys.length ? keys : Object.keys(r)).map((k) => `${k}: ${String(r[k] ?? "")}`);
            lines.push(`- ${cells.join(", ")}`);
        }
        if (rows.length > MAX_ROWS) lines.push(`- ...and ${rows.length - MAX_ROWS} more`);
        return lines.join("\n");
    }

    const items = Array.isArray(payload.items) ? payload.items : [];
    if (items.length) {
        for (const item of items.slice(0, MAX_ROWS)) {
            lines.push(`- ${typeof item === "string" ? item : JSON.stringify(item)}`);
        }
        return lines.join("\n");
    }

    if (typeof payload.content === "string" && payload.content.trim()) {
        lines.push(payload.content.trim());
        return lines.join("\n");
    }

    lines.push("(no rows)");
    return lines.join("\n");
}
/**
 * Payload types the client already knows how to render (mirrors
 * RICH_RESPONSE_TYPES in agent-orchestrator). A tool returning one of these is
 * producing an artifact, not text.
 *
 * This set is the ONLY thing standing between a rendered surface and a raw JSON
 * envelope in the transcript: detectArtifact returns null for anything absent,
 * and the turn then carries the envelope through as prose. Every one of the
 * eight Rich-UI types below was emitted by a tool in ARTIFACT_TOOLS — and
 * granted to every agent via UNIVERSAL_PRESENTATION_TOOLS — while missing here,
 * so render_table, render_tree, run_saved_query and the rest leaked their
 * payloads verbatim into the room.
 *
 * Adding a type here is only half a fix. The client must have a branch for it in
 * AgentChatPanel's artifact map, because the fallback branch requires a `module`
 * on the payload and returns null without one — so a type listed here but not
 * rendered there disappears silently, which is worse than the leak. Keep the two
 * lists in step: server-side detection, client-side branch.
 */
export const RICH_PAYLOAD_TYPES = new Set([
    "agent_studio_pod",
    "agent_change_proposal",
    "input_request",
    "mode_switch_request",
    "assistant_form",
    "assistant_app",
    "instant_app",
    "instant_app_surface",
    "launch_tutorial",
    "workflow_diagram",
    "builder_pod",
    "scribe_foundry_pod",
    "app_studio_pod",
    "form_studio_pod",
    "media_studio_pod",
    "form_change_proposal",
    "form_create_proposal",
    "flow_studio_pod",
    "flow_create_proposal",
    "flow_created",
    "prediction_studio_pod",
    "signal_studio_pod",
    "project_studio_pod",
    "computer_use_studio_pod",
    "prediction_model_proposal",
    "prediction_inference_result",
    "media_change_proposal",
    "media_story_proposal",
    "media_style_bible_proposal",
    "media_config_surface",
    "forge_confirmation_card",
    "crew_decision_matrix_pod",
    "decision_ratification",
    "crew_decision",
    "commitment_contract",
    "crew_commitment",
    "claim_verification",
    "crew_claim",
    "governance_blast_radius",
    "governance_checkpoint",
    "crew_governance_gate_pod",
    "crew_forensic_timeline_pod",
    "gap_remediation",
    "mission_proposal",
    "approval_request",
    "cycle_proposal",
    "presentation_deck",
    "assistant_image",
    "document_deliverable",
    // Rich-UI renderers (render-tools.ts, plus run_saved_query in query-tools.ts).
    "assistant_table",
    "performance_scorecard",
    "crew_work_product",
    "gate_review",
    "assistant_chart",
    "assistant_map",
    "map",
    "assistant_kpi_summary",
    "assistant_metric_card",
    "assistant_list",
    "assistant_timeline",
    "assistant_progress",
    "assistant_tree",
    "assistant_comparison",
    "assistant_app_catalog",
    "assistant_carousel",
    "ontology_object_types",
    "ontology_objects",
    "ontology_object",
    "ontology_link_types",
    "ontology_traversal",
    // Project-scoped SaaS adapters — Jira projects, Confluence spaces, Slack.
    "saas_adapters",
    // What this project COULD bind, listed off the connected site. A selectable
    // list, not assembly pieces — an unbound space is not part of the assembly.
    "saas_discovered_resources",
    // connect_platform's card — an OAuth link a person clicks to bind a
    // connection to this project space.
    "connection_request",
    // Granola matches in a room: no meeting data, listed only in the asker's browser.
    "granola_private_results",
    // Subgraph summary
    "graph_subgraph_summary",
    // Deployed application artifact
    "app_deployed",
    // Agent studio contributions (propose_studio_contribution / apply_studio_contribution)
    "studio_contribution_proposal",
    "studio_contribution_applied",
]);

export type CrewToolReason =
    | "studio-resource"
    | "declared-agent-tool"
    | "universal-presentation"
    | "declared-read-safe"
    | "read-verb"
    | "artifact"
    | "human-input"
    | "research"
    | "proposal";

export interface ResolvedCrewTool {
    definition: ToolDefinition;
    /** Why it was admitted — surfaced in logs so the allowlist stays auditable. */
    reason: CrewToolReason;
}

/**
 * The reasons that admitted a tool purely because it reads.
 *
 * `artifact` and `human-input` are excluded on purpose even though they are
 * admitted as read-only: they mount a surface for the user, and two surfaces
 * appearing in a nondeterministic order is a visible change. `proposal` writes a
 * row, and `declared-agent-tool` is an unlocked write of any kind.
 */
const CONCURRENCY_SAFE_REASONS: ReadonlySet<CrewToolReason> = new Set<CrewToolReason>([
    "declared-read-safe",
    "read-verb",
    "research",
]);

/**
 * Splits one turn's tool calls into batches that may run together.
 *
 * A run of adjacent read-only calls becomes one batch; anything else is a batch
 * of its own, so writes stay serialized and every call keeps its declared
 * position. An agent that asks for three lookups pays for the slowest rather
 * than the sum — the common case, since these are network calls and a turn may
 * carry up to MAX_TOOL_CALLS_PER_TURN of them.
 *
 * A name that is not in `available` is treated as unsafe: it cannot be
 * classified, and `execute` will refuse it anyway.
 */
export function batchConcurrentToolCalls<T extends { name: string }>(
    calls: T[],
    available: ResolvedCrewTool[],
): T[][] {
    const reasonByName = new Map(available.map((t) => [t.definition.name, t.reason]));
    const isSafe = (call: T): boolean => {
        const reason = reasonByName.get(call.name);
        return reason !== undefined && CONCURRENCY_SAFE_REASONS.has(reason);
    };

    const batches: T[][] = [];
    for (const call of calls) {
        const openBatch = batches[batches.length - 1];
        if (isSafe(call) && openBatch && isSafe(openBatch[0])) {
            openBatch.push(call);
        } else {
            batches.push([call]);
        }
    }
    return batches;
}

/** A renderable surface an agent produced during its turn. */
export interface CrewArtifact {
    tool: string;
    payload: Record<string, unknown>;
}

/**
 * Extracts the outermost balanced JSON object from a string.
 *
 * A balanced scan, never a regex: a lazy `\{[\s\S]*?\}` truncates these
 * envelopes at the first NESTED brace, which previously left the payload's tail
 * on screen as prose.
 */
export function extractBalancedJson(raw: string): string | null {
    const start = raw.indexOf("{");
    if (start === -1) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < raw.length; i++) {
        const ch = raw[i];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (ch === "\\") {
            escaped = true;
            continue;
        }
        if (ch === '"') {
            inString = !inString;
            continue;
        }
        if (inString) continue;

        if (ch === "{") depth++;
        else if (ch === "}") {
            depth--;
            if (depth === 0) return raw.slice(start, i + 1);
        }
    }
    return null;
}

/** Reads a renderable artifact out of a tool's output, if it produced one. */
export function detectArtifact(toolName: string, output: string): CrewArtifact | null {
    if (!output.includes('"type"')) {
        return null;
    }

    const json = extractBalancedJson(output);
    if (!json) return null;

    try {
        const parsed = JSON.parse(json) as Record<string, unknown>;
        if (typeof parsed?.type === "string" && RICH_PAYLOAD_TYPES.has(parsed.type)) {
            return { tool: toolName, payload: parsed };
        }
    } catch {
        // Not JSON, or truncated — treat as ordinary text.
    }
    return null;
}

/** Turn ontology read results into first-class room surfaces without changing
 * the capability's general-purpose JSON contract. */
export function detectOntologyArtifact(toolName: string, output: string): CrewArtifact | null {
    const typeByTool: Record<string, string> = {
        ontology_list_object_types: "ontology_object_types",
        ontology_list_objects: "ontology_objects",
        ontology_get_object: "ontology_object",
        ontology_list_link_types: "ontology_link_types",
        ontology_traverse_link: "ontology_traversal",
    };
    const type = typeByTool[toolName];
    if (!type) return null;
    try {
        const data = JSON.parse(output);
        const count = Array.isArray(data) ? data.length : Array.isArray(data?.objects) ? data.objects.length : 1;
        return {
            tool: toolName,
            payload: {
                type,
                title: type === "ontology_object_types" ? "Ontology Object Types"
                    : type === "ontology_link_types" ? "Ontology Relationships"
                    : type === "ontology_traversal" ? "Related Objects"
                    : type === "ontology_objects" ? "Ontology Objects"
                    : "Ontology Object",
                data,
                count,
            },
        };
    } catch {
        return null;
    }
}

/**
 * Turns a successful `request_human_input` result into a renderable artifact.
 *
 * The capability returns a plain envelope ({success, formId, requestId, schema})
 * — no `type`, so detectArtifact dropped it, the "waiting on a person" banner
 * (GATE_ARTIFACT_TOOLS) never saw an artifact, and the raw JSON was handed to
 * the model, which pasted it into the room. Wrapping it here keeps the
 * capability's contract unchanged for pipelines and MCP while the room renders
 * the actual form.
 */
export function detectHumanInputArtifact(toolName: string, output: string): CrewArtifact | null {
    if (toolName !== "request_human_input") return null;
    try {
        const parsed = JSON.parse(output);
        if (parsed?.success !== true || parsed?.requestId == null) return null;
        return {
            tool: toolName,
            payload: {
                type: "input_request",
                title: typeof parsed.name === "string" ? parsed.name : "Input requested",
                description: typeof parsed.message === "string" ? parsed.message : "",
                requestId: parsed.requestId,
                formId: parsed.formId ?? null,
                schema: parsed.schema && typeof parsed.schema === "object" ? parsed.schema : { fields: [] },
            },
        };
    } catch {
        return null;
    }
}

/**
 * Keys a provider function-declaration schema may contain.
 *
 * Gemini does NOT accept general JSON Schema — it takes a restricted OpenAPI 3.0
 * subset and hard-fails the whole request on anything else. zodToJsonSchema
 * emits `additionalProperties`, `exclusiveMinimum`, `$schema` and union types as
 * a matter of course, each of which produces:
 *   400 Invalid JSON payload ... Unknown name "additionalProperties"
 * So the converted schema is whitelisted down rather than blacklisted, which
 * would need updating every time a new Zod construct appears.
 */
const SCHEMA_ALLOWED_KEYS = new Set([
    "type", "description", "enum", "items", "properties", "required",
    "minItems", "maxItems", "nullable",
]);

/**
 * Reduces a JSON Schema to the subset providers accept for function calling.
 * Recursive, and deliberately lossy — validation still happens server-side
 * against the real Zod schema before a tool runs.
 */
export function sanitizeSchema(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        return { type: "string" };
    }

    const src = input as Record<string, unknown>;
    const out: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(src)) {
        if (!SCHEMA_ALLOWED_KEYS.has(key)) continue;

        if (key === "type") {
            // Union types (`["number","string"]`) are rejected; collapse to the
            // first concrete type and mark nullable if null was one of them.
            if (Array.isArray(value)) {
                const types = value.filter((t): t is string => typeof t === "string");
                const concrete = types.find((t) => t !== "null");
                if (types.includes("null")) out.nullable = true;
                out.type = concrete ?? "string";
            } else if (typeof value === "string") {
                out.type = value;
            }
            continue;
        }

        if (key === "properties" && value && typeof value === "object") {
            const props: Record<string, unknown> = {};
            for (const [name, sub] of Object.entries(value as Record<string, unknown>)) {
                props[name] = sanitizeSchema(sub);
            }
            out.properties = props;
            continue;
        }

        if (key === "items") {
            out.items = sanitizeSchema(value);
            continue;
        }

        if (key === "required" && Array.isArray(value)) {
            out.required = value.filter((r): r is string => typeof r === "string");
            continue;
        }

        out[key] = value;
    }

    // A property bag with no declared type confuses the provider.
    if (!out.type) out.type = out.properties ? "object" : "string";

    // Gemini rejects `type: "array"` with no `items` ("missing field") — a
    // z.array(z.any())-style schema produces exactly that shape. Fall back to
    // permissive string items; real validation still happens against Zod.
    if (out.type === "array" && !out.items) out.items = { type: "string" };

    // `required` naming a property that did not survive sanitising is rejected.
    if (Array.isArray(out.required) && out.properties) {
        const known = new Set(Object.keys(out.properties as Record<string, unknown>));
        out.required = (out.required as string[]).filter((r) => known.has(r));
        if ((out.required as string[]).length === 0) delete out.required;
    } else if (out.required && !out.properties) {
        delete out.required;
    }

    return out;
}

export interface ToolCallRecord {
    name: string;
    ok: boolean;
    ms: number;
    error?: string;
    /**
     * What the call produced, in one line — a label list or a lead line, never
     * raw JSON. Written for the ledger (crew_claims) and the supervisor's
     * transcript; the model still reads the full output separately.
     */
    digest?: string;
}

/**
 * Reduces a tool's capped output to a one-line digest.
 *
 * Truthful or absent: when the output is JSON, the digest is a label pulled
 * from its own naming fields or a count of its items — never a summary the
 * output did not contain. Prose yields its first non-empty line.
 */
export function digestToolOutput(output: string): string | undefined {
    const text = output.trim();
    if (!text) return undefined;

    let line: string | undefined;
    if (text.startsWith("{") || text.startsWith("[")) {
        try {
            const parsed = JSON.parse(text) as unknown;
            if (Array.isArray(parsed)) {
                const labels = labelsOf(parsed);
                line = `${parsed.length} item${parsed.length === 1 ? "" : "s"}` +
                    (labels.length ? `: ${labels.slice(0, 5).join(", ")}` : "");
            } else if (parsed && typeof parsed === "object") {
                const rec = parsed as Record<string, unknown>;
                for (const key of ["title", "name", "fileName", "message", "summary", "url"]) {
                    const v = rec[key];
                    if (typeof v === "string" && v.trim()) { line = v.trim(); break; }
                }
                if (!line) {
                    for (const key of ["items", "results", "rows", "attachments", "feeds", "entries"]) {
                        const v = rec[key];
                        if (Array.isArray(v)) {
                            const labels = labelsOf(v);
                            line = `${v.length} item${v.length === 1 ? "" : "s"}` +
                                (labels.length ? `: ${labels.slice(0, 5).join(", ")}` : "");
                            break;
                        }
                    }
                }
            }
        } catch {
            line = undefined;
        }
        line ??= "ok";
    } else {
        line = text.split(/\r?\n/).find((l) => l.trim().length > 0);
    }

    const collapsed = (line ?? "").replace(/\s+/g, " ").trim();
    if (!collapsed) return undefined;
    return collapsed.length > 160 ? collapsed.slice(0, 157) + "…" : collapsed;
}

/** Most characters a single tool result may inject into the prompt. */
export const MAX_TOOL_OUTPUT_CHARS = 4000;

/** The last http(s) URL in a text, trailing sentence punctuation stripped. */
function lastUrlIn(text: string): string | null {
    const urls = text.match(/https?:\/\/[^\s"')\]]+/g) ?? [];
    return urls.length ? urls[urls.length - 1].replace(/[.,;:!?]+$/, "") : null;
}

/**
 * One line naming the declared parameters — a validation error that says
 * "url: Required" tells the model what went wrong but not what to send;
 * the declared shape is the information it was missing.
 */
function describeParameters(schema: unknown): string {
    // z.preprocess and friends wrap the object in ZodEffects, which has no
    // `.shape` — unwrap until the real object is reached or give up.
    let current: any = schema;
    for (let i = 0; i < 4 && current && typeof current === "object" && !current.shape; i++) {
        current = current._def?.schema ?? current._def?.innerType ?? current.innerType?.() ?? null;
    }
    const shape = current?.shape ?? {};
    const parts: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
        const def = (value as any)?._def ?? {};
        const typeName = String(def.typeName ?? "").replace(/^Zod/, "").toLowerCase() || "value";
        const optional =
            typeof (value as any)?.isOptional === "function" ? (value as any).isOptional() : false;
        parts.push(`${key}: ${typeName}${optional ? " (optional)" : " (required)"}`);
    }
    return parts.length ? ` Declared parameters: ${parts.join(", ")}.` : "";
}

/** Stable arg fingerprint for the per-turn duplicate-failure cache. */
function canonicalArgs(args: Record<string, unknown>): string {
    return Object.keys(args ?? {})
        .sort()
        .map((k) => `${k}=${JSON.stringify(args[k])}`)
        .join(",");
}

/**
 * A short human-readable label for each dropped item, using whichever naming
 * field the payload happens to carry. Anything unlabelable is left out rather
 * than represented by a stringified object.
 */
function labelsOf(items: unknown[]): string[] {
    const labels: string[] = [];
    for (const item of items) {
        if (typeof item === "string") {
            labels.push(item);
            continue;
        }
        if (!item || typeof item !== "object") continue;
        const rec = item as Record<string, unknown>;
        const label = ["title", "name", "label", "slug", "id"]
            .map((k) => rec[k])
            .find((v) => typeof v === "string" && v.trim().length > 0);
        if (label) labels.push(String(label));
    }
    return labels;
}

/**
 * Caps a tool result WITHOUT lying about it.
 *
 * The previous `output.slice(0, 4000)` was silent, and silence is the whole
 * problem: `list_installed_apps` returns ~20,000 characters for a 57-app
 * catalogue, so the agent was handed roughly the first seven entries, cut
 * mid-object into invalid JSON, with nothing to indicate the rest existed. It
 * then told the user those seven were the catalogue. It was not summarising —
 * it was reporting faithfully on a payload that had been truncated behind its
 * back.
 *
 * Two rules:
 *
 *  1. A truncated list stays VALID JSON, trimmed by whole items rather than by
 *     character, so the agent can still read every field of what it does get.
 *  2. The result always CARRIES its own truncation notice, with the true total.
 *     An agent that can see it is looking at 7 of 57 can say so, and can offer
 *     to narrow the search. One that cannot, cannot.
 */
export function capToolOutput(output: string, limit = MAX_TOOL_OUTPUT_CHARS): string {
    if (output.length <= limit) return output;

    // Structured results: drop whole items and say how many were dropped.
    try {
        const parsed = JSON.parse(output);
        const key = ["items", "apps", "results", "data", "entries"].find(
            (k) => Array.isArray((parsed as Record<string, unknown>)?.[k]),
        );
        const list: unknown[] | null = Array.isArray(parsed)
            ? parsed
            : key
              ? ((parsed as Record<string, unknown>)[key] as unknown[])
              : null;

        if (list && list.length > 0) {
            const total = list.length;
            // Largest prefix of whole items that still fits, keeping room for the
            // notice itself. Linear from the top: results are ordered by
            // relevance, so the front of the list is the part worth keeping.
            let kept = total;
            let serialised = output;
            while (kept > 1) {
                kept = Math.max(1, Math.floor(kept * 0.7));
                const shrunk = Array.isArray(parsed)
                    ? list.slice(0, kept)
                    : { ...(parsed as object), [key as string]: list.slice(0, kept) };
                serialised = JSON.stringify({
                    ...(Array.isArray(shrunk) ? { items: shrunk } : shrunk),
                    _truncated: {
                        shown: kept,
                        total,
                        // The names of everything dropped, without the bulky
                        // fields that caused the overflow. Detail for a few,
                        // awareness of all — so "what apps are there?" can be
                        // answered completely even when the full records cannot
                        // fit. Several of these tools take no arguments, so the
                        // agent cannot ask for page two; if it does not carry
                        // the rest here, the rest are simply invisible.
                        alsoAvailable: labelsOf(list.slice(kept)),
                        note:
                            `Only ${kept} of ${total} results are shown in full. The remaining ` +
                            `${total - kept} are named in alsoAvailable. Tell the user the true ` +
                            `total (${total}) — never present these ${kept} as the complete set — ` +
                            `and name any from alsoAvailable that fit what they asked for.`,
                    },
                });
                if (serialised.length <= limit) return serialised;
            }
            return serialised;
        }
    } catch {
        // Not JSON — fall through to the text path.
    }

    // Unstructured: cut, but say so.
    const omitted = output.length - limit;
    return (
        output.slice(0, limit) +
        `\n\n[TRUNCATED: ${omitted} more characters were cut from this result. ` +
        `Do not present what you see as complete; say the result was truncated.]`
    );
}

/**
 * Formats a tool output for insertion into prompt messages.
 * When the tool has produced a rich visual surface (like a WorkspaceResultPayload
 * or assistant_table), this replaces multi-thousand-character raw JSON envelopes
 * with a concise evidence digest, maximizing the intelligence token budget.
 */
export function compactToolOutputForPrompt(
    toolName: string,
    output: string,
    artifact?: { tool: string; payload: Record<string, unknown> } | null,
): string {
    if (artifact?.payload && (artifact.payload as any).type === "google_workspace_results") {
        return digestWorkspaceResultForModel(artifact.payload as any);
    }
    if (artifact?.payload && (artifact.payload as any).type === "assistant_table") {
        return digestArtifactForModel(artifact.payload);
    }
    return capToolOutput(output);
}


/** Splits a tool name into comparable tokens (`mcp:github/get_file` → github, get, file). */
function tokenize(name: string): string[] {
    return name
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
}

/**
 * Decides whether a tool is safe to offer in a discussion.
 *
 * Order matters: disqualifiers are checked before any positive signal, so an
 * explicit `read-safe` annotation cannot override an admin gate or a
 * file-system side effect.
 */
export function classifyReadOnly(def: ToolDefinition): ResolvedCrewTool["reason"] | null {
    if (def.adminOnly || def.superAdminOnly) return null;
    if (def.riskLevel === "high") return null;

    // Tier 2: renders a surface for the user. Checked before side effects
    // because these legitimately touch the database to look up a component or
    // pipeline definition — the output is still an ephemeral UI, not a write.
    if (ARTIFACT_TOOLS.has(def.name)) return "artifact";

    // Tier 3: the explicitly-authorised write. Checked here for the same reason
    // as tier 2 — it touches the database, and no heuristic would ever admit it.
    if (HUMAN_INPUT_TOOLS.has(def.name)) return "human-input";

    // Tier 3.5: Governed proposals (Draft creation behind Human Approval Gate)
    if (PROPOSAL_TOOLS.has(def.name)) return "proposal";

    // Tier 4: lookup. Checked before the side-effect and name rules for the same
    // reason as tiers 2 and 3 — these make network calls or write a proposal row,
    // so no heuristic would admit them, and each was checked individually above.
    if (RESEARCH_TOOL_SET.has(def.name)) return "research";

    if (def.sideEffects?.some((s) => DISQUALIFYING_SIDE_EFFECTS.has(s))) return null;

    // Positively declared by the tool author — the strongest signal available.
    if (def.idempotency === "read-safe") return "declared-read-safe";

    // Anything the author marked as non-idempotent acts on the world.
    if (def.idempotency === "none") return null;

    // Fall back to the name. Requires a read verb AND no write verb, so
    // `run_dependency_audit` is excluded despite "audit": "run" is ambiguous and
    // default-deny wins. Annotating it `idempotency: "read-safe"` opts it in.
    const tokens = tokenize(def.name);
    if (tokens.some((t) => WRITE_TOKENS.has(t))) return null;
    if (tokens.some((t) => READ_TOKENS.has(t))) return "read-verb";

    return null;
}

export const COMMUNICATION_TOOLS = [
    'quickbooks_propose_invoice',
    'flighthub_propose_booking',
    'amazon_propose_purchase',
    'amazon_build_cart',
    ...CALENDAR_WRITE_NAMES,
    ...MAIL_DOCS_WRITE_NAMES,
    "gmail_send",
    "send_agentmail",
    "send_email",
    "reply_agentmail",
    "list_agentmail_threads",
    "get_agentmail_thread",
    // A reviewed-send draft, not a send — offered alongside the direct senders
    // so an agent can put a message behind the confirmation card.
    "propose_outbound_message",
];

export class CrewToolsService {
    private declarationCache = new Map<string, Record<string, unknown>>();

    /**
     * Resolve declared tools, shared discovery, and the active studio's curated
     * editing tools. Studio reach never confers the caller's admin privileges.
     */
    async resolveForCard(card: AgentCardRecord, studio?: string | null): Promise<ResolvedCrewTool[]> {
        const studioTools = STUDIO_AGENT_TOOLS[normalizeCrewStudio(studio) ?? ""] ?? [];
        const cardTools = (card.tools ?? []).filter((t) => typeof t === "string");
        // Presentation and communication tools are additive, so an agent that declares nothing can
        // still hand the user a surface or transmit messages.
        const declared = [
            ...new Set([
                ...cardTools,
                ...studioTools,
                ...UNIVERSAL_PRESENTATION_TOOLS,
                ...RESEARCH_TOOLS,
                ...COMPUTER_OBSERVATION_TOOLS,
                ...PLATFORM_STATUS_TOOLS,
                ...COMMUNICATION_TOOLS,
            ]),
        ];

        let registry: Record<string, ToolDefinition>;
        try {
            const { getAgentTools } = await import("@domain/tools/v1/capabilities/index.js");
            registry = getAgentTools();
        } catch (err) {
            logger.warn(
                `Tool registry unavailable: ${err instanceof Error ? err.message : String(err)}`,
            );
            return [];
        }

        const resolved: ResolvedCrewTool[] = [];
        const rejected: string[] = [];

        for (const name of declared) {
            const def = registry[name];
            if (!def) continue; // declared but not implemented — nothing to offer

            const readReason = classifyReadOnly(def);
            const isExplicitCardTool = cardTools.includes(name);

            if (readReason) {
                resolved.push({ definition: def, reason: readReason });
            } else if (studioTools.includes(name)) {
                // Studio reach does not confer user privileges.
                const definition = { ...def, execute: async (params: any, context: ToolContext) => {
                    if (def.superAdminOnly) throw new Error('Super-admin tools are not available through Studio grants');
                    if (def.adminOnly) {
                        const { canManageOrganization } = await import('@server/utils/auth-context.js');
                        if (!context.userId || !context.organizationId || !await canManageOrganization(context.userId, context.organizationId)) {
                            throw new Error('Organization management permission is required for this Studio operation');
                        }
                        return def.execute(params, { ...context, isAdmin: true, isOrgAdmin: true, isSuperAdmin: false });
                    }
                    return def.execute(params, context);
                } };
                resolved.push({ definition, reason: 'studio-resource' });
            } else if (isExplicitCardTool || COMMUNICATION_TOOLS.includes(name) || UNIVERSAL_PRESENTATION_TOOLS.includes(name)) {
                // Permissions released: explicitly assigned agent tools, universal presentation tools, and communication tools are fully unlocked in CREW Room
                resolved.push({ definition: def, reason: UNIVERSAL_PRESENTATION_TOOLS.includes(name) ? "universal-presentation" : "declared-agent-tool" });
            } else {
                rejected.push(name);
            }
        }

        /*
         * Every other read in the registry. The declared list is a ceiling on an
         * agent's DOMAIN reach — writes and acting tools — not on its ability to
         * look something up, the same reasoning that admits RESEARCH_TOOLS to
         * every card. Without this pass a read only reaches an agent if a card
         * happened to name it, and synced cards name job-config integrations, not
         * the 160+ read-safe capabilities the platform actually has — so the room
         * could not query Jira, GitHub, datasets or the workspace even though the
         * tools existed and passed the classifier.
         *
         * A stronger name gate than classifyReadOnly's own is applied because the
         * `read-safe` annotation short-circuits the name heuristic and trusts the
         * author: tools like `update_document_ast`, `record_audit_ledger_proof`,
         * `ingest_market_signals` and the `propose_media_*`/`propose_form_*`
         * drafts are read-safe-annotated but act, and must stay behind a card
         * declaration or their dedicated direct paths. `propose` is not a
         * WRITE_TOKEN — proposals enter through PROPOSAL_TOOLS deliberately —
         * so it and its neighbours are denied here explicitly.
         */
        const autoAdmitted: string[] = [];
        for (const [name, def] of Object.entries(registry)) {
            if (resolved.some((r) => r.definition.name === name)) continue;
            const reason = classifyReadOnly(def);
            if (!reason) continue;
            if (tokenize(name).some((t) => ACTING_TOKENS.has(t))) continue;
            resolved.push({ definition: def, reason });
            autoAdmitted.push(name);
        }

        if (resolved.length > 0 || rejected.length > 0) {
            const researchTools = resolved.filter(r => r.reason === "research");
            logger.info(
                `"${card.name}" tools — offered (${resolved.length}): ${resolved.map((r) => `${r.definition.name} (${r.reason})`).join(", ") || "none"}` +
                    (rejected.length > 0 ? `; withheld: ${rejected.join(", ")}` : "") +
                    (autoAdmitted.length > 0 ? `; auto-admitted (${autoAdmitted.length}): ${autoAdmitted.join(", ")}` : "") +
                    (researchTools.length > 0 ? `; RESEARCH TOOLS AVAILABLE: ${researchTools.map(r => r.definition.name).join(", ")}` : ""),
            );
        }

        return resolved;
    }

    /**
     * Converts tools into provider function declarations. Memoized by tool name
     * to eliminate repetitive schema parsing on every turn.
     */
    toFunctionDeclarations(tools: ResolvedCrewTool[]): Array<Record<string, unknown>> {
        return tools.map(({ definition }) => {
            const cached = this.declarationCache.get(definition.name);
            if (cached) return cached;

            let parameters: Record<string, unknown>;
            try {
                const raw = zodToJsonSchema(definition.parameters as never, {
                    $refStrategy: "none",
                });
                parameters = sanitizeSchema(raw);
            } catch {
                parameters = { type: "object", properties: {} };
            }

            // A function declaration must present an object parameter bag.
            if (parameters.type !== "object") {
                parameters = { type: "object", properties: {} };
            }

            const decl = {
                name: definition.name,
                description: definition.description,
                inputSchema: parameters,
                parameters,
            };
            this.declarationCache.set(definition.name, decl);
            return decl;
        });
    }

    /**
     * Executes one tool call.
     */
    async execute(
        toolName: string,
        args: Record<string, unknown>,
        allowed: ResolvedCrewTool[],
        context: ToolContext,
    ): Promise<{ record: ToolCallRecord; output: string; artifact: CrewArtifact | null }> {
        const started = Date.now();
        const match = allowed.find((t) => t.definition.name === toolName);

        if (!match) {
            return {
                record: { name: toolName, ok: false, ms: 0, error: "not permitted" },
                output: `Error: tool '${toolName}' is not available to you.`,
                artifact: null,
            };
        }

        try {
            let sanitizedArgs = { ...(args ?? {}) };
            if (context.sessionKey && typeof context.organizationId === "number") {
                const room = await crewRepository.findSession(context.organizationId, String(context.sessionKey));
                if (room?.interrupting || room?.cycleContext?.authoringPaused) {
                    throw new Error(room?.cycleContext?.authoringPaused
                        ? "The author paused this work. No further tools were started."
                        : "The user stopped this round. No further tools were started.");
                }
                if (room && typeof context.authoringUserTurnId === "number") {
                    const latest = await crewRepository.latestUserTurnId(context.organizationId, room.id);
                    if (latest && latest > context.authoringUserTurnId) throw new Error("A newer user instruction superseded this operation. Read the current document and follow the latest request.");
                }
            }
            if (scribeConversationIntent(String(context.named?.message ?? "")) === "review"
                && (toolName.startsWith("scribe_") || toolName === "mount_scribe_studio")
                && !["scribe_get_document", "scribe_run_critic_pass"].includes(toolName)) {
                throw new Error("This is a review-only request. Return findings and proposed changes without editing the manuscript.");
            }

            // Auto-remediation for search/lookup tools missing query or topic
            if (!sanitizedArgs.query || typeof sanitizedArgs.query !== "string" || sanitizedArgs.query.trim() === "") {
                if (toolName.includes("search") || toolName.includes("query") || toolName.includes("lookup")) {
                    sanitizedArgs.query = (context as any)?.named?.message || "platform";
                }
            }
            // A tool that takes a URL the caller omitted gets one from the
            // conversation. browse_web used to fail "url: Required" twice a
            // turn while the address sat in text the model already had — the
            // user's message first (it is authoritative), then the draft the
            // agent just wrote (it names a URL in prose, then calls the tool
            // without passing it), then recent turns. Fill it here instead of
            // spending a repair pass on it.
            {
                const shape = (match.definition.parameters as any)?.shape ?? (match.definition.parameters as any)?._def?.schema?.shape ?? {};
                const wantsUrl = ["url", "source", "endpoint", "uri"].some((k) => k in shape);
                if (wantsUrl) {
                    const named = (context as any)?.named ?? {};
                    const url =
                        lastUrlIn(String(named.message ?? "")) ??
                        lastUrlIn(String(named.lastDraft ?? "")) ??
                        lastUrlIn(String(named.priorText ?? ""));
                    if (url) {
                        // Only params the schema actually declares — never invent
                        // a key the tool does not take.
                        for (const key of ["url", "source", "endpoint", "uri"] as const) {
                            if (!(key in shape)) continue;
                            const v = sanitizedArgs[key];
                            if (typeof v !== "string" || !/^https?:\/\//.test(v)) {
                                sanitizedArgs[key] = url;
                            }
                        }
                    }
                }
            }
            if (toolName === "mount_builder_pod" && typeof sanitizedArgs === "object" && sanitizedArgs !== null && (sanitizedArgs as any).podComponent) {
                if (!(sanitizedArgs as any).stageId) {
                    (sanitizedArgs as any).stageId = "stage-intake";
                }
            }
            if (toolName === "assemble_instant_app" && typeof sanitizedArgs === "object" && sanitizedArgs !== null) {
                const s = sanitizedArgs as any;
                if (!s.blocks && (s.components || s.items || s.widgets || s.elements || s.sections || s.cards)) {
                    s.blocks = s.components || s.items || s.widgets || s.elements || s.sections || s.cards;
                }
                if (!s.blocks && (s.component || s.name || s.componentName || s.module)) {
                    s.blocks = [{ component: s.component || s.name || s.componentName || s.module, props: s.props, span: s.span }];
                }
                if (!s.blocks || !Array.isArray(s.blocks) || s.blocks.length === 0) {
                    const msg = String((context as any)?.named?.message ?? "");
                    const draft = String((context as any)?.named?.lastDraft ?? "");
                    const combined = `${msg} ${draft} ${s.title ?? ""} ${s.note ?? ""}`.toLowerCase();
                    if (/\b(weather|forecast|climate)\b/i.test(combined)) {
                        s.blocks = [
                            { component: "Metric Grid" },
                            { component: "Industrial Dashboard Hero" },
                        ];
                    }
                }
            }
            if (toolName === "render_instant_app" && typeof sanitizedArgs === "object" && sanitizedArgs !== null) {
                const s = sanitizedArgs as any;
                if (!s.component && (s.name || s.componentName || s.module)) {
                    s.component = s.name || s.componentName || s.module;
                }
            }






            // Identical call, identical failure. Three browse_web calls burned
            // a turn in crew-1790715777859-69qaluh because the model does not
            // remember it already sent the same shape — the executor does.
            // Scoped to this turn via the shared context; only failures are
            // cached, since a successful call may legitimately repeat.
            const callCache: Map<string, { record: ToolCallRecord; output: string }> =
                ((context as any).__callCache ??= new Map());
            const callKey = `${toolName}::${canonicalArgs(sanitizedArgs)}`;
            const priorFailure = callCache.get(callKey);
            if (priorFailure) {
                return {
                    record: {
                        name: toolName,
                        ok: false,
                        ms: 0,
                        error: `repeat of an identical call that already failed — ${priorFailure.record.error}`,
                    },
                    output:
                        `'${toolName}' was already called with identical arguments this turn and failed: ${priorFailure.record.error}. ` +
                        `Change the arguments or stop calling it — repeating the same call cannot succeed.`,
                    artifact: null,
                };
            }

            let parsed = match.definition.parameters.safeParse(sanitizedArgs);

            if (!parsed.success) {
                const ms = Date.now() - started;
                // Hand back WHAT was wrong. This used to say only "incomplete —
                // please specify valid inputs", which tells the model nothing it
                // did not already believe, so it re-sent the same shape and the
                // round was spent narrating the failure ("I attempted to render
                // the form, but the tool call was incomplete"). The zod issues
                // name the offending path and the accepted values, which is the
                // difference between a retry and a guess.
                const issues = parsed.error.issues
                    .slice(0, 8)
                    .map((i) => {
                        const at = i.path.length ? i.path.join(".") : "(root)";
                        const opts = (i as any).options
                            ? ` — allowed: ${(i as any).options.join(", ")}`
                            : "";
                        return `${at}: ${i.message}${opts}`;
                    })
                    .join("; ");

                // The received key list is the difference between diagnosing a
                // model that omitted `fields` and one that nested them under
                // `schema` — both previously surfaced as "fields: Required"
                // with no way to tell which.
                const receivedKeys = Object.keys(sanitizedArgs).slice(0, 20).join(", ") || "none";
                logger.warn(`Tool '${toolName}' rejected invalid arguments — ${issues} (received keys: ${receivedKeys})`);

                const failure = {
                    record: { name: toolName, ok: false, ms, error: `invalid arguments — ${issues}` } as ToolCallRecord,
                    output:
                        `The arguments for '${toolName}' failed validation: ${issues}. ` +
                        `Received keys: ${receivedKeys}.` +
                        describeParameters(match.definition.parameters) +
                        ` Correct those fields and call it again — do not describe the failure to the user.`,
                };
                callCache.set(callKey, failure);
                return { ...failure, artifact: null };
            }

            // Outbound send interception. propose_outbound_message is the
            // review path an agent chooses; this gate is the enforcement for
            // the ones it didn't — a send whose situation warrants review
            // becomes a pending confirmation card instead of a delivery.
            const gated = await maybeGateOutboundSend(toolName, parsed.data, context, started);
            if (gated) {
                return gated;
            }

            const result = await match.definition.execute(parsed.data, context);
            const ms = Date.now() - started;
            let output =
                typeof result === "string" ? result : JSON.stringify(result ?? null);

            // CREW messages are text-only. Keep the vision/accessibility evidence,
            // not base64 that consumes the output budget and is invisible to the model.
            if (toolName.startsWith("trycua_")) {
                try {
                    const parsedOutput = JSON.parse(output);
                    if (parsedOutput && typeof parsedOutput.screenshotDataUrl === "string") {
                        delete parsedOutput.screenshotDataUrl;
                        output = JSON.stringify(parsedOutput);
                    }
                } catch { /* Plain-text tool failures are classified below. */ }
            }

            // A capability that caught its own error and returned the message is
            // reporting a failure, not a result. See classifyToolFailure.
            const failure = classifyToolFailure(output);
            if (failure) {
                logger.warn(`Tool '${toolName}' reported failure after ${ms}ms: ${failure}`);
                const failed = {
                    record: { name: toolName, ok: false, ms, error: failure.slice(0, 200) } as ToolCallRecord,
                    output: capToolOutput(output),
                };
                callCache.set(callKey, failed);
                return { ...failed, artifact: null };
            }

            // Tier 2: the tool rendered a surface. The raw envelope must NOT go
            // back to the model as text — it would echo the JSON into its prose,
            // which is exactly how payload fragments used to land on screen. Tell
            // it the artifact exists and let the client render the payload.
            let workspacePayload = null;
            try { workspacePayload = workspaceResultPayload(toolName, JSON.parse(output), parsed.data, String(context.message ?? '')); } catch { if (toolName === 'gdrive_read_file') workspacePayload = workspaceResultPayload(toolName, output, parsed.data); }
            if (workspacePayload) return { record: { name: toolName, ok: true, ms }, output: capToolOutput(output), artifact: { tool: toolName, payload: { ...workspacePayload } } };
            const artifact = detectArtifact(toolName, output) ?? detectOntologyArtifact(toolName, output) ?? detectHumanInputArtifact(toolName, output);
            if (artifact) {
                // A lookup the agent has to reason over still renders, but it must
                // also reach the model — as lines, never as the envelope.
                if (RETRIEVAL_TOOLS.has(toolName)) {
                    return {
                        record: { name: toolName, ok: true, ms },
                        output: capToolOutput(digestArtifactForModel(artifact.payload)),
                        artifact,
                    };
                }
                return {
                    record: { name: toolName, ok: true, ms },
                    output:
                        `Rendered a "${artifact.payload.type}" surface for the user` +
                        `${artifact.payload.title ? ` titled "${artifact.payload.title}"` : ""}. ` +
                        `It is already displayed — describe what it is for in one line; do not repeat its contents.`,
                    artifact,
                };
            }

            return {
                record: { name: toolName, ok: true, ms },
                output: capToolOutput(output),
                artifact: null,
            };
        } catch (err) {
            const ms = Date.now() - started;
            const message = err instanceof Error ? err.message : String(err);
            logger.warn(`Tool '${toolName}' failed after ${ms}ms: ${message}`);
            // A refusal that says what would allow the call (PermissionRequiredError)
            // renders as a card with the steps. Still a failure: nothing was read.
            const permission = (err as { permission?: unknown } | null)?.permission;
            if (isPermissionRequiredPayload(permission)) {
                return {
                    record: { name: toolName, ok: false, ms, error: message.slice(0, 200) },
                    output:
                        `Error: '${toolName}' was refused: ${message.slice(0, 300)} ` +
                        `A card already shows the person what access is missing and how to get it. ` +
                        `Say in one sentence that the access is missing; do not list the steps or retry.`,
                    artifact: { tool: toolName, payload: { ...permission } },
                };
            }
            return {
                record: { name: toolName, ok: false, ms, error: message.slice(0, 200) },
                output: `Error: '${toolName}' failed: ${message.slice(0, 300)}`,
                artifact: null,
            };
        }
    }
}

export const crewToolsService = new CrewToolsService();
