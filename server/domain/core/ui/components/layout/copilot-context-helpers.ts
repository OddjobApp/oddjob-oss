import React from "react";
import {
  AlertTriangle, BookOpen, ClipboardCheck, Compass, FileSearch,
  LayoutTemplate, ListChecks, ShieldCheck, Sparkles, X, Zap, Inbox
} from "lucide-react";
import {
  buildCopilotActionPreview,
  COPILOT_MODE_DETAILS,
  normalizeCopilotMode,
} from "@domain-ui/ai/core/copilot-contract.js";
import type { AssistantInboxItem } from "@domain-ui/core/ui/hooks/use-intervention-engine";
import type {
  ChatMode,
  ModeConfig,
  PageAction,
  Message,
  WorkMemoryItem,
  AssistantUpdateItem,
  ExecutionPreview,
  EvidenceItem,
  AssistantAppResponse,
  CycleStepTransitionPayload,
} from "./copilot-chat-types";

import { generateUUID } from "./use-copilot-conversations.js";

export const WORK_MEMORY_KEY = "oddjob:copilot:work-memory";
export const LAST_CYCLE_CONTEXT_KEY = "oddjob:copilot:last-cycle-context";

export const COPILOT_REQUEST_TIMEOUT_MS = 65000;

export function getCopilotFailureMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error || "Unknown error");
    const normalized = message.toLowerCase();

    if (normalized.includes("aborted") || normalized.includes("timeout")) {
        return "Copilot is taking too long to answer. The agent service may be retrying an AI provider call or waiting on busy workers. Check provider quota and active mission load, then try again.";
    }

    if (
        normalized.includes("spending cap")
        || normalized.includes("resource_exhausted")
        || normalized.includes("quota")
        || normalized.includes("429")
    ) {
        return "Copilot cannot get an AI response right now because the configured provider is over quota or spending cap. Switch the Copilot AI config to an available provider/model or raise the provider spend cap, then try again.";
    }

    if (normalized.includes("rate limit")) {
        return "Copilot is being rate limited by the configured AI provider. Wait for the quota window to reset or switch Copilot to another provider/model.";
    }

    return `Failed to reach the copilot: ${message}`;
}

export const MODE_CONFIG: Record<ChatMode, ModeConfig> = {
    explain: {
        ...COPILOT_MODE_DETAILS.explain,
        icon: BookOpen,
        badgeClass: "border-sky-500/35 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    },
    plan: {
        ...COPILOT_MODE_DETAILS.plan,
        icon: ListChecks,
        badgeClass: "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    },
    execute: {
        ...COPILOT_MODE_DETAILS.execute,
        icon: Zap,
        badgeClass: "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    },
    audit: {
        ...COPILOT_MODE_DETAILS.audit,
        icon: ShieldCheck,
        badgeClass: "border-violet-500/35 bg-violet-500/10 text-violet-700 dark:text-violet-300",
    },
};

export const CAPABILITIES = [
    { label: "Summarize status", detail: "Turn current page state into an executive brief." },
    { label: "Explain evidence", detail: "Tie answers back to missions, knowledge, datasets, or audit logs." },
    { label: "Plan governed work", detail: "Prepare dry-run steps, tools, targets, and likely approvals." },
    { label: "Render forms", detail: "Collect structured inputs inline when a chat reply would be too vague." },
    { label: "Open apps", detail: "Present published app cards when a task belongs in a dedicated workspace." },
    { label: "Execute safely", detail: "Confirm live actions before side effects are sent to the agent loop." },
    { label: "Audit decisions", detail: "Inspect risks, policy gates, budget, and provenance." },
    { label: "Keep open loops", detail: "Track recent planned or executed work in the sheet." },
];

export const PAGE_ACTIONS: Record<string, PageAction[]> = {
    cycle_detail: [
        { label: "Business summary", mode: "explain", icon: Compass, prompt: "Summarize this cycle for a business stakeholder. Cover status, outcome, budget, timeline, risks, and whether a decision is needed." },
        { label: "Decision needed?", mode: "audit", icon: ClipboardCheck, prompt: "Review this cycle and tell me if any human decision, approval, missing credential, or blocked mission needs attention." },
        { label: "Draft update", mode: "plan", icon: FileSearch, prompt: "Draft a concise stakeholder update for this cycle using current status, risks, next milestone, and business impact." },
    ],
    cycles_list: [
        { label: "Cycle tour", mode: "explain", icon: Sparkles, action: "tutorial", tutorialId: "chain:operator-flight-deck", prompt: "Launch the interactive Cycle simulation and flight deck tour." },
        { label: "Portfolio pulse", mode: "explain", icon: Compass, prompt: "Summarize the current cycle portfolio. Highlight active cycles, pending approvals, spend risk, and urgent follow-ups." },
        { label: "Approval queue", mode: "audit", icon: ClipboardCheck, prompt: "Find cycles that appear to need approval or intervention and explain why." },
        { label: "Prioritize work", mode: "plan", icon: ListChecks, prompt: "Create a prioritized action plan for the current cycle portfolio." },
    ],
    mission_detail: [
        { label: "Mission status", mode: "explain", icon: Compass, prompt: "Explain this mission's current status, blockers, latest agent activity, and next expected outcome." },
        { label: "Inspect blackboard", mode: "audit", icon: ClipboardCheck, prompt: "Audit the mission blackboard and recent guidance for stale assumptions, risks, or missing context." },
        { label: "Next action", mode: "plan", icon: ListChecks, prompt: "Recommend the safest next action for this mission and explain what evidence supports it." },
    ],
    missions: [
        { label: "Mission guide", mode: "explain", icon: Sparkles, action: "tutorial", tutorialId: "create-mission-walkthrough", prompt: "Launch the interactive walkthrough for creating and orchestrating an autonomous mission." },
        { label: "Mission portfolio", mode: "explain", icon: Compass, prompt: "Summarize current missions by status, risk, owner attention, and business outcome." },
        { label: "Launch plan", mode: "plan", icon: ListChecks, prompt: "Help me plan a new governed mission from the current context. Ask only for missing inputs." },
        { label: "Risk audit", mode: "audit", icon: ShieldCheck, prompt: "Audit active missions for budget, policy, approval, or stale-context risks." },
    ],
    job_detail: [
        { label: "Explain configuration", mode: "explain", icon: BookOpen, prompt: "Explain this job's configuration, inputs, outputs, credentials, and downstream effects in plain language." },
        { label: "Diagnose recent runs", mode: "audit", icon: FileSearch, prompt: "Inspect this job's recent runs and identify failures, anomalies, or configuration risks with supporting evidence." },
        { label: "Plan a safe change", mode: "plan", icon: ListChecks, prompt: "Prepare an editable, dry-run plan for improving this job. Show affected fields, dependencies, validation, and rollback." },
    ],
    jobs_list: [
        { label: "Job portfolio", mode: "explain", icon: Compass, prompt: "Summarize jobs by status, type, recent activity, and business purpose." },
        { label: "Find failures", mode: "audit", icon: AlertTriangle, prompt: "Find jobs with recent failures or risky configuration and rank what needs attention." },
        { label: "Recommend automation", mode: "plan", icon: ListChecks, prompt: "Recommend the next useful automation based on existing jobs, gaps, and repeated work." },
    ],
    pipeline_detail: [
        { label: "Workstream status", mode: "explain", icon: Compass, prompt: "Summarize this workstream's configuration, current state, recent executions, and expected outcome." },
        { label: "Investigate failures", mode: "audit", icon: FileSearch, prompt: "Inspect this workstream's recent execution evidence, identify the likely failure point, and distinguish facts from hypotheses." },
        { label: "Recovery plan", mode: "plan", icon: ListChecks, prompt: "Prepare a safe recovery plan for this workstream with editable steps, validation checks, approvals, and rollback." },
    ],
    pipelines_list: [
        { label: "Workstream pulse", mode: "explain", icon: Compass, prompt: "Summarize active workstreams, recent outcomes, failures, and owner attention needed." },
        { label: "Risk audit", mode: "audit", icon: ShieldCheck, prompt: "Audit workstreams for failed runs, stale dependencies, missing credentials, and approval risk." },
        { label: "Prioritize recovery", mode: "plan", icon: ListChecks, prompt: "Rank the safest next actions across current workstreams and explain the evidence behind the order." },
    ],
    appforge: [
        { label: "App Forge track", mode: "explain", icon: Sparkles, action: "tutorial", tutorialId: "chain:developer-forge", prompt: "Launch the interactive App Forge developer track." },
        { label: "Build plan", mode: "plan", icon: ListChecks, prompt: "Create a governed App Forge build plan. Include desired outcome, data sources, integrations, risks, and QA checks." },
        { label: "Debug build", mode: "audit", icon: FileSearch, prompt: "Audit the current App Forge context for likely build, dependency, or deployment issues." },
        { label: "Explain options", mode: "explain", icon: BookOpen, prompt: "Explain the available App Forge options in business terms and recommend the simplest path." },
    ],
    knowledge_store: [
        { label: "Find source", mode: "explain", icon: FileSearch, prompt: "Find the most relevant knowledge sources for the current question and explain confidence." },
        { label: "Gap audit", mode: "audit", icon: ShieldCheck, prompt: "Audit the knowledge context for missing, stale, or contradictory information." },
        { label: "Attach context", mode: "plan", icon: ListChecks, prompt: "Plan which knowledge topics or documents should be attached to the relevant work." },
    ],
    approvals: [
        { label: "Decision brief", mode: "explain", icon: ClipboardCheck, prompt: "Summarize pending approvals in business terms: what is requested, risk, owner, and recommended decision." },
        { label: "Risk audit", mode: "audit", icon: ShieldCheck, prompt: "Audit pending approvals for policy, budget, credential, or data-access risk." },
        { label: "Prepare response", mode: "plan", icon: ListChecks, prompt: "Draft an approval response or rejection rationale based on the available evidence." },
    ],
    assistant: [
        { label: "Render intake form", mode: "plan", icon: ListChecks, prompt: "Create an inline assistant form to collect the missing information needed to continue this work." },
        { label: "Open app surface", mode: "plan", icon: LayoutTemplate, prompt: "Recommend the best published app or workspace for this task and present it as an assistant app card if appropriate." },
        { label: "Triage queue", mode: "audit", icon: ClipboardCheck, prompt: "Audit assistant inbox and live queue signals. Identify what needs a human decision, a form response, or a dedicated app." },
    ],
    connections: [
        { label: "Connection map", mode: "explain", icon: Compass, prompt: "Summarize the current external-system connection surface: credentials, integrations, MCP tokens, SaaS connectors, and any attention needed." },
        { label: "Access audit", mode: "audit", icon: ShieldCheck, prompt: "Audit connection risks across secrets, tokens, OAuth integrations, SaaS sync, and MCP access." },
        { label: "Setup plan", mode: "plan", icon: ListChecks, prompt: "Plan the safest next connection setup, including required secrets, scopes, tests, and rollback checks." },
    ],
    credentials: [
        { label: "Secret inventory", mode: "explain", icon: FileSearch, prompt: "Summarize credential coverage and call out missing or stale secrets that may affect workflows." },
        { label: "Credential audit", mode: "audit", icon: ShieldCheck, prompt: "Audit credentials for rotation risk, missing metadata, unsafe scopes, or broken connections." },
        { label: "Add credential", mode: "plan", icon: ListChecks, prompt: "Help plan a new credential safely, including provider, scopes, storage, test method, and owner." },
    ],
    saas_connectors: [
        { label: "Connector status", mode: "explain", icon: Compass, prompt: "Summarize SaaS connector status, sync health, event workflows, and recent failures." },
        { label: "Sync audit", mode: "audit", icon: ShieldCheck, prompt: "Audit SaaS connector sync settings, OAuth scope risks, stale mappings, and failed workflow triggers." },
        { label: "Configure sync", mode: "plan", icon: ListChecks, prompt: "Plan a SaaS connector sync configuration with platform, fields, event workflows, tests, and monitoring." },
    ],
    platform_maintenance: [
        { label: "Maintenance brief", mode: "explain", icon: Compass, prompt: "Summarize platform maintenance status across snapshots, documentation, software audit, system evolution, autoresearch, and system graph." },
        { label: "Upkeep audit", mode: "audit", icon: ShieldCheck, prompt: "Audit internal platform-care risks: stale snapshots, missing documentation, dependency alerts, evolution drift, and graph blind spots." },
        { label: "Maintenance plan", mode: "plan", icon: ListChecks, prompt: "Create a prioritized maintenance plan for the platform, including evidence to check and safe next actions." },
    ],
    health: [
        { label: "Health brief", mode: "explain", icon: Compass, prompt: "Summarize current platform health across observability, monitoring, alerts, events, pulse, incidents, and infra health. Highlight what is happening, what is broken, and what needs attention." },
        { label: "Triage issues", mode: "audit", icon: AlertTriangle, prompt: "Audit the current Health context for active alerts, incident signals, infrastructure issues, stale telemetry, or missing follow-up." },
        { label: "Response plan", mode: "plan", icon: ListChecks, prompt: "Create a prioritized response plan for the current Health signals, including what to inspect first and which evidence should confirm resolution." },
    ],
    spatial: [
        { label: "Spatial tour", mode: "explain", icon: Sparkles, action: "tutorial", tutorialId: "chain:spatial-operator", prompt: "Launch the interactive Eulerian H3 hexagonal spatial analytics tour." },
        { label: "Grid overview", mode: "explain", icon: Compass, prompt: "Summarize active hexagonal density and regional telemetry across spatial viewports." },
        { label: "Density audit", mode: "audit", icon: ShieldCheck, prompt: "Audit spatial clusters for coverage gaps, asset congestion, or stale telemetry." },
    ],
    dashboard: [
        { label: "Daily brief", mode: "explain", icon: Compass, action: "daily_brief", prompt: "Give me a concise Oddjob daily brief: active work, decisions needed, risks, spend, and recommended next steps." },
        { label: "Platform tour", mode: "explain", icon: Sparkles, action: "tutorial", tutorialId: "chain:executive-overview", prompt: "Launch the interactive S.C.O.R.E. Platform Briefing tour." },
        { label: "Find blockers", mode: "audit", icon: ShieldCheck, prompt: "Look across the current workspace context for blockers, failed runs, missing approvals, or risk signals." },
        { label: "Start work", mode: "plan", icon: ListChecks, prompt: "Help me plan the next governed piece of autonomous work. Suggest the best Oddjob surface to use." },
    ],
};

export const SUB_PAGE_ACTIONS: Record<string, PageAction[]> = {
    feature_documentation: [
        { label: "Explain this module", mode: "explain", icon: BookOpen, prompt: "Explain the feature documentation shown on the active {subPage}. Summarize purpose, architecture, APIs, dependencies, and current status." },
        { label: "Find documentation gaps", mode: "audit", icon: FileSearch, prompt: "Audit the active {subPage} for stale facts, missing flows, undocumented APIs, weak testing coverage, or contradictions with current implementation." },
        { label: "Plan documentation update", mode: "plan", icon: ListChecks, prompt: "Create a focused update plan for the active {subPage}, preserving verified facts and listing the source files that should be checked." },
    ],
    dataset_detail: [
        { label: "Explain this dataset", mode: "explain", icon: Compass, prompt: "Explain {entity} using its schema, provenance, row coverage, intended consumers, and recent activity." },
        { label: "Audit data quality", mode: "audit", icon: ShieldCheck, prompt: "Audit {entity} for missing fields, stale records, schema drift, duplicates, unsafe data, and downstream risk." },
        { label: "Plan dataset work", mode: "plan", icon: ListChecks, prompt: "Plan the safest next improvements for {entity}, including validation, consumers, migration risk, and rollback." },
    ],
    knowledge_search: [
        { label: "Refine search", mode: "plan", icon: FileSearch, prompt: "Refine the current knowledge search into the smallest useful set of queries, filters, and confidence checks." },
        { label: "Explain results", mode: "explain", icon: Compass, prompt: "Explain the current knowledge-search results, rank the strongest sources, and distinguish evidence from inference." },
        { label: "Find coverage gaps", mode: "audit", icon: ShieldCheck, prompt: "Audit the current search results for missing sources, stale evidence, contradictions, and low-confidence matches." },
    ],
    schema_manager: [
        { label: "Explain schemas", mode: "explain", icon: BookOpen, prompt: "Explain the schemas on this sub-page and how their fields, relationships, and consumers fit together." },
        { label: "Audit schema risk", mode: "audit", icon: ShieldCheck, prompt: "Audit current schemas for drift, incompatible changes, missing constraints, and affected consumers." },
        { label: "Plan schema change", mode: "plan", icon: ListChecks, prompt: "Prepare a safe schema-change plan with migrations, compatibility checks, validation, and rollback." },
    ],
    query_builder: [
        { label: "Explain query", mode: "explain", icon: BookOpen, prompt: "Explain the query currently being built, including sources, filters, joins, output shape, and likely cost." },
        { label: "Audit query", mode: "audit", icon: ShieldCheck, prompt: "Audit the current query for correctness, unsafe scope, missing filters, expensive operations, and ambiguous results." },
        { label: "Improve query", mode: "plan", icon: ListChecks, prompt: "Plan a clearer and safer version of the current query and state how to validate its results." },
    ],
    knowledge_maturity: [
        { label: "Maturity brief", mode: "explain", icon: Compass, prompt: "Summarize the current knowledge-maturity signals, strongest areas, weakest areas, and business impact." },
        { label: "Audit low utility", mode: "audit", icon: ShieldCheck, prompt: "Audit knowledge maturity for stale, contradictory, orphaned, or low-utility nodes and explain confidence." },
        { label: "Improvement plan", mode: "plan", icon: ListChecks, prompt: "Create a prioritized knowledge-maturity improvement plan with measurable validation checks." },
    ],
    ontology_explorer: [
        { label: "Explain ontology", mode: "explain", icon: BookOpen, prompt: "Explain the ontology currently in view, its major entity types, relationships, and operational use." },
        { label: "Audit ontology", mode: "audit", icon: ShieldCheck, prompt: "Audit the ontology for ambiguous concepts, duplicate entities, missing relationships, and unsafe assumptions." },
        { label: "Plan extension", mode: "plan", icon: ListChecks, prompt: "Plan a governed ontology extension with affected entities, mappings, validation, and migration steps." },
    ],
    pipeline_execution_detail: [
        { label: "Execution summary", mode: "explain", icon: Compass, prompt: "Summarize {entity} step by step, including outcome, duration, inputs, outputs, and evidence." },
        { label: "Diagnose execution", mode: "audit", icon: FileSearch, prompt: "Diagnose {entity} for the first failing or anomalous step and distinguish the root cause from downstream symptoms." },
        { label: "Recovery plan", mode: "plan", icon: ListChecks, prompt: "Prepare a safe recovery plan for {entity}, including retry conditions, verification, approvals, and rollback." },
    ],
    pipeline_executions: [
        { label: "Execution pulse", mode: "explain", icon: Compass, prompt: "Summarize recent executions for {entity}, highlighting outcomes, latency, failures, and changes over time." },
        { label: "Find anomalies", mode: "audit", icon: FileSearch, prompt: "Audit recent executions for {entity} and rank anomalies or repeated failure patterns." },
        { label: "Stabilization plan", mode: "plan", icon: ListChecks, prompt: "Create a prioritized stabilization plan for the execution history on this sub-page." },
    ],
    credential_detail: [
        { label: "Credential status", mode: "explain", icon: Compass, prompt: "Explain {entity} status, provider, scope, consumers, rotation state, and recent validation evidence without exposing secret values." },
        { label: "Credential risk", mode: "audit", icon: ShieldCheck, prompt: "Audit {entity} for unsafe scope, expiration, rotation, broken consumers, missing metadata, or failed validation without revealing secrets." },
        { label: "Rotation plan", mode: "plan", icon: ListChecks, prompt: "Prepare a zero-downtime rotation and verification plan for {entity}." },
    ],
    component_catalog: [
        { label: "Find a component", mode: "explain", icon: FileSearch, prompt: "Recommend the registered components best suited to the current task and explain their supported interactions." },
        { label: "Audit component coverage", mode: "audit", icon: ShieldCheck, prompt: "Audit the component catalog for missing capabilities, duplicates, weak mobile behavior, or undocumented constraints." },
        { label: "Plan component reuse", mode: "plan", icon: ListChecks, prompt: "Plan a solution using existing registered components before proposing a new component." },
    ],
    system_graph: [
        { label: "Explain this graph", mode: "explain", icon: Compass, prompt: "Explain the visible system-graph context, important dependencies, and likely impact paths." },
        { label: "Dependency audit", mode: "audit", icon: ShieldCheck, prompt: "Audit the system graph for critical dependencies, orphaned nodes, circular relationships, and blind spots." },
        { label: "Change impact plan", mode: "plan", icon: ListChecks, prompt: "Plan a safe change-impact investigation using the current system-graph context." },
    ],
    autoresearch: [
        { label: "Research brief", mode: "explain", icon: Compass, prompt: "Summarize current autoresearch findings, evidence, candidate improvements, and decisions needed." },
        { label: "Audit findings", mode: "audit", icon: ShieldCheck, prompt: "Audit autoresearch findings for weak evidence, unsafe proposals, duplication, and missing verification." },
        { label: "Plan next experiment", mode: "plan", icon: ListChecks, prompt: "Plan the next safe autoresearch experiment with hypothesis, evidence, success criteria, and rollback." },
    ],
    assistant_workbench: [
        { label: "Triage attention", mode: "audit", icon: ClipboardCheck, prompt: "Triage the current Assistant Workbench queue and rank decisions, failures, and open loops needing attention." },
        { label: "Resume work", mode: "plan", icon: ListChecks, prompt: "Identify the most useful open work item to resume and prepare the next safe step." },
        { label: "Explain activity", mode: "explain", icon: Compass, prompt: "Explain recent Assistant Workbench activity and how it relates to current missions, decisions, and workstreams." },
    ],
    infrastructure_health: [
        { label: "Infrastructure brief", mode: "explain", icon: Compass, prompt: "Summarize current infrastructure health, dependencies, resource pressure, and user impact." },
        { label: "Triage failures", mode: "audit", icon: AlertTriangle, prompt: "Audit infrastructure-health evidence for active failures, cascading dependencies, stale telemetry, and likely root causes." },
        { label: "Response plan", mode: "plan", icon: ListChecks, prompt: "Create a safe infrastructure response plan ordered by impact, reversibility, and verification." },
    ],
};

export const PAGE_LABELS: Record<string, string> = {
    cycle_detail: "Cycle detail",
    cycles_list: "Cycle portfolio",
    mission_detail: "Mission detail",
    missions: "Mission portfolio",
    job_detail: "Job detail",
    jobs_list: "Jobs",
    pipeline_detail: "Pipeline detail",
    pipelines_list: "Pipelines",
    knowledge_graph: "Knowledge graph",
    knowledge_store: "Knowledge",
    datasets: "Datasets",
    approvals: "Decision inbox",
    connections: "Connections",
    credentials: "Credentials",
    saas_connectors: "SaaS connectors",
    platform_maintenance: "Platform maintenance",
    health: "System health",
    schedules: "Schedules",
    settings: "Settings",
    app_arsenal: "App Arsenal",
    appforge: "App Forge",
    assistant: "Assistant",
    dashboard: "Dashboard",
};

export function makeWelcome(): Message {
    return {
        id: "welcome",
        role: "agent",
        content: "I’m identifying what you’re working on from the current screen and recent activity.",
        timestamp: Date.now(),
        mode: "explain",
    };
}

export function buildIntentWelcomeContent(
    page: string,
    actions: PageAction[],
    signal?: {
        title: string;
        description: string;
        confidence?: number;
    } | null,
    subPageLabel?: string,
): string {
    const screen = subPageLabel || PAGE_LABELS[page] || page.replace(/_/g, " ");
    if (signal) {
        const confidence = typeof signal.confidence === "number"
            ? ` **${Math.round(signal.confidence * 100)}% confidence**`
            : "";
        const choices = actions.slice(0, 3).map(action => action.label.toLowerCase()).join(", ");
        return `**Likely intent:** ${signal.title}${confidence}\n\n${signal.description}\n\nShould I continue with that, or would you prefer ${choices}?`;
    }

    const choices = actions.slice(0, 3).map(action => `**${action.label}**`).join(", ");
    return `You’re working in **${screen}**. Are you here to ${choices}?`;
}

export function derivePage(location: string): string {
    if (location.match(/^\/operations\/cycles\/\d+/)) return "cycle_detail";
    if (location === "/operations/cycles") return "cycles_list";
    if (location.match(/^\/missions\/\d+/)) return "mission_detail";
    if (location.includes("/missions")) return "missions";
    if (location.match(/^\/jobs\/\d+/)) return "job_detail";
    if (location === "/jobs") return "jobs_list";
    if (location.match(/^\/(?:pipelines|operations\/workstreams)\/\d+/)) return "pipeline_detail";
    if (location === "/pipelines" || location === "/operations/workstreams") return "pipelines_list";
    if (location.includes("/knowledge/graph")) return "knowledge_graph";
    if (location.includes("/knowledge")) return "knowledge_store";
    if (location.includes("/assistant")) return "assistant";
    if (location.includes("/datasets")) return "datasets";
    if (location.includes("/approvals") || location.includes("/control/decisions")) return "approvals";
    if (location.includes("/connections/saas") || location.includes("/saas")) return "saas_connectors";
    if (location.includes("/platform-maintenance") || location.includes("/snapshots")) return "platform_maintenance";
    if (
        location.includes("/health") ||
        location.includes("/observability") ||
        location.includes("/monitoring") ||
        location.includes("/alerts") ||
        location.includes("/events") ||
        location.includes("/pulse") ||
        location.includes("/admin/events") ||
        location.includes("/admin/alerts") ||
        location.includes("/admin/diagnoses") ||
        location.includes("/admin/infra-health")
    ) return "health";
    if (location.includes("/schedules")) return "schedules";
    if (location.includes("/alerts") || location.includes("/monitoring")) return "monitoring";
    if (location.includes("/settings")) return "settings";
    if (location.includes("/connections/credentials") || location.includes("/credentials")) return "credentials";
    if (location.includes("/connections")) return "connections";
    if (location.includes("/armory/apps")) return "app_arsenal";
    if (location.includes("/armory/forge") || location.includes("/app-forge") || location.includes("/appforge") || location === "/forge") return "appforge";
    if (location.includes("/armory/x-ray")) return "system_xray";
    if (location.includes("/armory/identity-bridge")) return "identity_bridge";
    if (location.includes("/armory")) return "armory";
    return "dashboard";
}

export interface CopilotSubPageContext {
    key: string;
    label: string;
    pathname: string;
    section?: string;
    tab?: string;
    entityType?: string;
    entityId?: string;
}

export interface CopilotSelectedUiContext {
    elementLabel?: string;
    elementRole?: string;
    selectedText?: string;
    entityType?: string;
    entityId?: string;
}

export function captureSelectedUiContext(): CopilotSelectedUiContext | null {
    if (typeof document === "undefined") return null;
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Focusing the Assistant composer must not replace the context captured from
    // the underlying product screen.
    if (activeElement?.closest("[role='dialog']")) return null;
    const contextualElement = activeElement?.closest<HTMLElement>(
        "[data-entity-id], [data-row-id], [data-node-id], [aria-selected='true'], [role='tab']",
    ) || activeElement;
    const selection = window.getSelection?.()?.toString().trim().slice(0, 240) || undefined;
    const elementLabel = contextualElement
        ? (
            contextualElement.getAttribute("aria-label")
            || contextualElement.getAttribute("title")
            || contextualElement.dataset.label
            || contextualElement.textContent?.trim().replace(/\s+/g, " ").slice(0, 120)
        )
        : undefined;
    const entityId = contextualElement?.dataset.entityId
        || contextualElement?.dataset.rowId
        || contextualElement?.dataset.nodeId;
    const entityType = contextualElement?.dataset.entityType
        || (contextualElement?.dataset.rowId ? "row" : contextualElement?.dataset.nodeId ? "node" : undefined);
    const result = {
        elementLabel: elementLabel || undefined,
        elementRole: contextualElement
            ? (contextualElement.getAttribute("role") || contextualElement.tagName.toLowerCase())
            : undefined,
        selectedText: selection,
        entityType,
        entityId,
    };
    return Object.values(result).some(Boolean) ? result : null;
}

export const SUB_PAGE_LABELS: Array<[RegExp, string, string]> = [
    [/^\/knowledge\/store\b/, "knowledge_store", "Knowledge store"],
    [/^\/knowledge\/datasets\/[^/]+\b/, "dataset_detail", "Dataset detail"],
    [/^\/knowledge\/datasets\b/, "knowledge_datasets", "Knowledge datasets"],
    [/^\/knowledge\/fine-tuning\/datasets\/[^/]+\b/, "fine_tuning_dataset_detail", "Fine-tuning dataset detail"],
    [/^\/knowledge\/fine-tuning\/datasets\b/, "fine_tuning_datasets", "Fine-tuning datasets"],
    [/^\/knowledge\/fine-tuning\b/, "fine_tuning", "Fine-tuning"],
    [/^\/knowledge\/search\b/, "knowledge_search", "Knowledge search"],
    [/^\/knowledge\/schemas\b/, "schema_manager", "Schema manager"],
    [/^\/knowledge\/query-builder\b/, "query_builder", "Query builder"],
    [/^\/knowledge\/compare-runs\b/, "run_comparison", "Run comparison"],
    [/^\/knowledge\/garden\b/, "knowledge_garden", "Knowledge garden"],
    [/^\/knowledge\/maturity\b/, "knowledge_maturity", "Knowledge maturity"],
    [/^\/knowledge\/document-templates\b/, "document_templates", "Document templates"],
    [/^\/knowledge\/status\b/, "knowledge_status", "Knowledge status"],
    [/^\/knowledge\/ontology\b/, "ontology_explorer", "Ontology explorer"],
    [/^\/pipelines\/[^/]+\/executions\/[^/]+\b/, "pipeline_execution_detail", "Pipeline execution detail"],
    [/^\/pipelines\/[^/]+\/executions\b/, "pipeline_executions", "Pipeline executions"],
    [/^\/operations\/workstreams\/new\b/, "new_workstream", "New workstream"],
    [/^\/platform-maintenance\/documentation\b/, "feature_documentation", "Feature documentation"],
    [/^\/platform-maintenance\/components\b/, "component_catalog", "Component catalog"],
    [/^\/platform-maintenance\/system-graph\b/, "system_graph", "System graph"],
    [/^\/platform-maintenance\/autoresearch\b/, "autoresearch", "Autoresearch"],
    [/^\/connections\/credentials\/[^/]+\b/, "credential_detail", "Credential detail"],
    [/^\/connections\/credentials\b/, "connection_credentials", "Connection credentials"],
    [/^\/connections\/saas\b/, "saas_connections", "SaaS connections"],
    [/^\/assistant\/workbench\b/, "assistant_workbench", "Assistant workbench"],
    [/^\/control\/decisions\b/, "decision_inbox", "Decision inbox"],
    [/^\/admin\/infra-health\b/, "infrastructure_health", "Infrastructure health"],
    [/^\/admin\/diagnoses\b/, "incident_diagnoses", "Incident diagnoses"],
    [/^\/admin\/events\b/, "system_events", "System events"],
    [/^\/admin\/alerts\b/, "system_alerts", "System alerts"],
];

export function deriveSubPageContext(location: string): CopilotSubPageContext {
    const [rawPathname, rawQuery = ""] = String(location || "/dashboard").split("?", 2);
    const pathname = rawPathname || "/dashboard";
    const matched = SUB_PAGE_LABELS.find(([pattern]) => pattern.test(pathname));
    const segments = pathname.split("/").filter(Boolean);
    const fallbackSegment = segments.length > 1 && !/^\d+$/.test(segments[segments.length - 1])
        ? segments[segments.length - 1]
        : undefined;
    const key = matched?.[1] || fallbackSegment?.replace(/-/g, "_") || derivePage(pathname);
    const label = matched?.[2]
        || fallbackSegment?.replace(/[-_]+/g, " ").replace(/\b\w/g, character => character.toUpperCase())
        || PAGE_LABELS[derivePage(pathname)]
        || "Current page";
    const params = new URLSearchParams(rawQuery);
    const tab = params.get("tab") || params.get("view") || undefined;
    const entityMatch = pathname.match(/\/(cycles|missions|jobs|pipelines|workstreams|datasets|credentials)\/([^/]+)/);

    return {
        key,
        label: tab ? `${label} · ${tab.replace(/[-_]+/g, " ")}` : label,
        pathname,
        section: segments[0],
        tab,
        entityType: entityMatch?.[1],
        entityId: entityMatch?.[2],
    };
}

export function deriveCycleId(location: string): number | null {
    const match = location.match(/^\/operations\/cycles\/(\d+)/);
    if (!match?.[1]) return null;
    const id = Number(match[1]);
    return Number.isFinite(id) ? id : null;
}

export function makeCycleTransitionUpdate(
    eventType: string,
    payload: CycleStepTransitionPayload,
    activeCycleId: number,
    location: string
): AssistantUpdateItem {
    const stepLabel = payload.stepCode || (payload.stepOrder ? `Step ${payload.stepOrder}` : "Cycle step");
    const durationLabel = typeof payload.durationMs === "number" && payload.durationMs > 0
        ? `${Math.round(payload.durationMs).toLocaleString()} ms`
        : undefined;

    if (eventType === "cycle.step_started") {
        return {
            id: generateUUID(),
            kind: "cycle",
            title: `${stepLabel} started`,
            description: payload.agentId ? `Agent: ${payload.agentId}` : undefined,
            timestamp: Date.now(),
            evidence: [
                { label: `Cycle ${activeCycleId}`, source: "Live cycle event stream", href: location },
                { label: stepLabel, source: eventType },
            ],
        };
    }

    if (eventType === "cycle.step_completed") {
        return {
            id: generateUUID(),
            kind: "cycle",
            title: `${stepLabel} completed`,
            description: [payload.agentId ? `Agent: ${payload.agentId}` : null, durationLabel ? `Duration: ${durationLabel}` : null].filter(Boolean).join(" · ") || undefined,
            timestamp: Date.now(),
            tone: "success",
            evidence: [
                { label: `Cycle ${activeCycleId}`, source: "Live cycle event stream", href: location },
                { label: stepLabel, source: eventType },
            ],
        };
    }

    return {
        id: generateUUID(),
        kind: "cycle",
        title: `${stepLabel} failed`,
        description: [payload.agentId ? `Agent: ${payload.agentId}` : null, durationLabel ? `Duration: ${durationLabel}` : null, payload.error || null].filter(Boolean).join(" · ") || undefined,
        timestamp: Date.now(),
        tone: "danger",
        evidence: [
            { label: `Cycle ${activeCycleId}`, source: "Live cycle event stream", href: location },
            { label: stepLabel, source: eventType },
        ],
    };
}

export function contextualizeSubPageAction(action: PageAction, subPage: CopilotSubPageContext): PageAction {
    const entity = subPage.entityType && subPage.entityId
        ? `${subPage.entityType.replace(/[-_]+/g, " ")} #${subPage.entityId}`
        : subPage.label;
    return {
        ...action,
        prompt: action.prompt
            .replaceAll("{subPage}", subPage.label)
            .replaceAll("{entity}", entity),
    };
}

export function getPageActions(page: string, subPage?: CopilotSubPageContext): PageAction[] {
    // Narrow on `subPage` itself: deriving the lookup first leaves it possibly
    // undefined inside the callback below.
    if (subPage) {
        const subPageActions = SUB_PAGE_ACTIONS[subPage.key];
        if (subPageActions && subPageActions.length > 0) {
            return subPageActions.map(action => contextualizeSubPageAction(action, subPage));
        }
    }
    return PAGE_ACTIONS[page] ?? PAGE_ACTIONS.dashboard;
}

export function getCopilotContextSummary(
    page: string,
    location: string,
    mode: ChatMode,
    organizationId?: number | null,
    subPage: CopilotSubPageContext = deriveSubPageContext(location),
    selectedUi?: CopilotSelectedUiContext | null,
): Array<{ label: string; detail: string }> {
    const objectId = location.match(/\/(?:cycles|missions|jobs|pipelines)\/(\d+)/)?.[1];
    const scope = PAGE_LABELS[page] || page.replace(/_/g, " ");
    return [
        { label: organizationId != null ? `Org ${organizationId}` : "Current organization", detail: "Tenant scope" },
        { label: objectId ? `${scope} #${objectId}` : scope, detail: location },
        { label: subPage.label, detail: subPage.entityId ? `${subPage.entityType} #${subPage.entityId}` : "Active sub-page" },
        ...(selectedUi?.elementLabel
            ? [{ label: selectedUi.elementLabel, detail: selectedUi.entityId ? `${selectedUi.entityType || "entity"} #${selectedUi.entityId}` : "Selected UI context" }]
            : []),
        { label: COPILOT_MODE_DETAILS[mode].label, detail: COPILOT_MODE_DETAILS[mode].description },
    ];
}

export function getActionRationale(action: PageAction, page: string): string {
    if (action.rationale) return action.rationale;
    const scope = PAGE_LABELS[page] || "this screen";
    if (action.mode === "audit") return `Review risks and evidence from ${scope}.`;
    if (action.mode === "plan") return `Prepare a dry-run plan using ${scope} context.`;
    if (action.mode === "execute") return "Preview a governed action before changing live state.";
    return `Explain the current ${scope.toLowerCase()} state.`;
}

export function buildEphemeralCopilotContext(
    active: {
        id: string;
        title: string;
        description: string;
        priority: string;
        confidence?: number;
        vector?: string;
        context?: Record<string, any>;
    } | null,
    inbox: AssistantInboxItem[],
    cycleUpdates: AssistantUpdateItem[],
) {
    const compactIntervention = active ? {
        id: active.id,
        title: active.title.slice(0, 160),
        description: active.description.slice(0, 500),
        priority: active.priority,
        confidence: active.confidence,
        vector: active.vector,
        context: active.context && typeof active.context === "object"
            ? Object.fromEntries(Object.entries(active.context).slice(0, 8))
            : undefined,
    } : null;

    return {
        source: "ephemeral_event_engine",
        generatedAt: new Date().toISOString(),
        activeIntervention: compactIntervention,
        recentSignals: inbox
            .filter(item => item.outcome === "unread")
            .slice(0, 3)
            .map(item => ({
                id: item.id,
                title: item.title.slice(0, 160),
                priority: item.priority,
                confidence: item.confidence,
                receivedAt: item.receivedAt,
            })),
        workstreamEvents: cycleUpdates.slice(0, 5).map(item => ({
            kind: item.kind,
            title: item.title.slice(0, 160),
            description: item.description?.slice(0, 300),
            timestamp: item.timestamp,
            tone: item.tone,
        })),
    };
}

export function getEvidenceForPage(page: string, location: string): EvidenceItem[] {
    if (page === "cycle_detail") {
        const id = location.match(/\/operations\/cycles\/(\d+)/)?.[1];
        return [
            { label: id ? `Cycle ${id}` : "Cycle detail", source: "Operational cycle record", href: location },
            { label: "Telemetry", source: "Cycle runs and outcome metrics" },
            { label: "Governance", source: "Budget, approvals, and audit state" },
        ];
    }
    if (page === "mission_detail") {
        const id = location.match(/\/missions\/(\d+)/)?.[1];
        return [
            { label: id ? `Mission ${id}` : "Mission detail", source: "Mission record", href: location },
            { label: "Blackboard", source: "Shared mission memory" },
            { label: "Timeline", source: "Recent mission events" },
        ];
    }
    if (page.includes("knowledge")) {
        return [
            { label: "Knowledge Store", source: "Documents, topics, and graph context", href: location },
            { label: "RAG", source: "Retrieved knowledge snippets" },
        ];
    }
    if (page === "approvals") {
        return [
            { label: "Decision Inbox", source: "Pending human approvals", href: location },
            { label: "Policy", source: "Governance rules and risk labels" },
        ];
    }
    if (page === "connections" || page === "credentials" || page === "saas_connectors") {
        return [
            { label: "Connections", source: "Credentials, integrations, MCP tokens, and SaaS sync", href: location },
            { label: "Access surface", source: "Secrets, OAuth scopes, external systems, and token state" },
        ];
    }
    if (page === "platform_maintenance") {
        return [
            { label: "Platform Maintenance", source: "Snapshots, documentation, software audit, evolution, autoresearch, and system graph", href: location },
            { label: "Internal upkeep", source: "Recovery points, dependency health, self-documentation, and topology signals" },
        ];
    }
    if (page === "health") {
        return [
            { label: "Health", source: "Observability, monitoring, alerts, events, pulse, incidents, and infra health", href: location },
            { label: "Attention signals", source: "Telemetry, active issues, incident diagnoses, and infrastructure checks" },
        ];
    }
    return [
        { label: "Current page", source: page.replace(/_/g, " "), href: location },
        { label: "Oddjob context", source: "Available platform tools and workspace state" },
    ];
}

export function loadWorkMemory(): WorkMemoryItem[] {
    try {
        const parsed = JSON.parse(localStorage.getItem(WORK_MEMORY_KEY) || "[]");
        return Array.isArray(parsed) ? parsed.slice(0, 8) : [];
    } catch {
        return [];
    }
}

export function saveWorkMemory(items: WorkMemoryItem[]) {
    localStorage.setItem(WORK_MEMORY_KEY, JSON.stringify(items.slice(0, 8)));
}

export function formatAssistantInboxAge(ts: number) {
    const diff = Math.max(0, Date.now() - ts);
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

export function assistantInboxPriorityClass(priority: AssistantInboxItem["priority"]) {
    if (priority === "critical") return "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-200";
    if (priority === "high") return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200";
    if (priority === "medium") return "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-200";
    return "border-foreground/10 bg-foreground/5 text-foreground";
}

export function assistantInboxOutcomeClass(outcome: AssistantInboxItem["outcome"]) {
    if (outcome === "accepted") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200";
    if (outcome === "expired") return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200";
    if (outcome === "dismissed" || outcome === "ignored") return "border-border/30 bg-muted/10 text-foreground";
    return "border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-200";
}

export function makeExecutionPreview(prompt: string, page: string): ExecutionPreview {
    return {
        id: generateUUID(),
        prompt,
        ...buildCopilotActionPreview(prompt, { page }),
    };
}


export function deriveCycleIdFromEvidence(evidence?: EvidenceItem[]): number | null {
    if (!Array.isArray(evidence)) return null;
    for (const item of evidence) {
        const hrefId = item.href ? deriveCycleId(item.href) : null;
        if (hrefId) return hrefId;
        const match = item.label.match(/\bCycle\s+(\d+)\b/i);
        if (match?.[1]) {
            const id = Number(match[1]);
            if (Number.isFinite(id)) return id;
        }
    }
    return null;
}

export function loadLastCycleContext(): { id: number; href: string; updatedAt: number } | null {
    if (typeof window === "undefined") return null;
    try {
        const raw = window.localStorage.getItem(LAST_CYCLE_CONTEXT_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        const id = Number(parsed?.id);
        if (!Number.isFinite(id)) return null;
        return {
            id,
            href: typeof parsed?.href === "string" ? parsed.href : `/operations/cycles/${id}`,
            updatedAt: Number(parsed?.updatedAt) || 0,
        };
    } catch {
        return null;
    }
}

export function saveLastCycleContext(id: number, href: string) {
    if (typeof window === "undefined" || !Number.isFinite(id)) return;
    try {
        window.localStorage.setItem(LAST_CYCLE_CONTEXT_KEY, JSON.stringify({
            id,
            href,
            updatedAt: Date.now(),
        }));
    } catch {
        // Ignore storage failures; the assistant can still fall back to current route context.
    }
}

export function buildLocalAppLaunchResponse(text: string, currentLocation?: string, contextCycleId?: number | null): AssistantAppResponse | null {
    const normalized = text.toLowerCase();
    // "instant app(s)" is a distinct feature — live-rendered packaged UI blocks via
    // the render_instant_app / list_instant_app_components tools — NOT the App Arsenal
    // / workbench launcher. Defer to the server so the agent routes to those tools
    // instead of collapsing "what instant apps can you render?" to the catalog card.
    if (/\binstant\s+apps?\b/.test(normalized)) return null;
    const wantsAppSurface = /\b(open|launch|start|show|go to|find|search|recommend|suggest|use|where|app|apps|workbench|workspace)\b/.test(normalized);
    if (!wantsAppSurface) return null;

    const cycleId = deriveCycleId(currentLocation ?? "") ?? contextCycleId ?? null;

    // Narrow "generic workbench" detection: the user is referring to THIS cycle's
    // workbench, not naming a specific app. The old broad test (any "workbench"/
    // "workspace") wrongly swallowed named-app requests like "Budgetmaster
    // workbench" and collapsed them to the current cycle's Universal Studio.
    // A specific noun before "workbench" must NOT match here — those defer to the
    // server's app resolver, which launches the actual app (verified: the server
    // resolves "Launch Budgetmaster app/workbench" to a direct launch card in
    // ~0.1s, whereas the client can only guess).
    const wantsGenericCycleWorkbench =
        /\b(agent\s+workbench|cycle\s+app\s+manager|cycle\s+workbench)\b/.test(normalized) ||
        /\b(the|this|that|my|our|current)\s+(agent\s+)?(workbench|workspace)\b/.test(normalized) ||
        /^\s*(open|launch|show|go\s*to)?\s*(the\s+)?(agent\s+)?workbench\s*$/.test(normalized);

    // A specifically-named marketplace app must win over the generic
    // cycle-workbench fallback below. contextCycleId falls back to the persisted
    // last-cycle id, so a cycle is almost always "in context" — without this
    // guard every "launch the <X> workbench" request collapses to Universal
    // Studio regardless of which app was actually requested.
    const wantsSdlc = /\b(sdlc|software development lifecycle|hybrid)\b/.test(normalized);
    const wantsCodegen = /\b(autonomous|codegen|code generation|code\s*gen)\b/.test(normalized);
    // Codegen wins the shared "pipeline" keyword — "codegen pipeline workbench"
    // is the codegen app, not the sales pipeline. The Sales branch is checked
    // first textually, so exclude codegen here rather than reordering blocks.
    const wantsSales = !wantsCodegen && /\b(sales|pipeline|opportunit(y|ies)|revenue)\b/.test(normalized);
    const wantsSpecificApp = wantsSdlc || wantsSales || wantsCodegen;

    if (wantsGenericCycleWorkbench && cycleId && !wantsSpecificApp) {
        const wantsDecisionControl = /\b(decision|approval|governance|control)\b/.test(normalized);
        if (wantsDecisionControl) {
            return {
                type: "assistant_app",
                title: "Decision Control",
                description: "Open the decision and approval control surface for this cycle.",
                href: `/operations/workbenches/decision-control/${cycleId}`,
                source: "app",
                actionLabel: "Open decision control",
                cycleName: `Cycle ${cycleId}`,
            };
        }

        return {
            type: "assistant_app",
            title: "Universal Studio",
            description: "Open the cycle-scoped agent workbench for mission execution, context, and app step configuration.",
            href: `/operations/workbenches/universal-studio/${cycleId}`,
            source: "app",
            actionLabel: "Open agent workbench",
            cycleName: `Cycle ${cycleId}`,
        };
    }

    if (wantsGenericCycleWorkbench && /\bagent\s+workbench\b/.test(normalized)) {
        return {
            type: "assistant_app",
            title: "Cycle Agent Workbench",
            description: "Choose a cycle, then open its cycle-scoped agent workbench.",
            href: "/operations/cycles",
            source: "app",
            actionLabel: "Select cycle",
        };
    }

    if (wantsSdlc) {
        return {
            type: "assistant_app",
            title: "SDLC Workbench",
            description: "Open the hybrid SDLC workbench with step-aware routing, decisions, and evidence views.",
            slug: "sdlc-workbench",
            href: "/armory/apps?search=sdlc-workbench",
            source: "app",
            actionLabel: "Find SDLC app",
            blueprint: "sdlc-workbench",
            cycleName: "Oddjob Enterprise Hybrid AI SDLC",
        };
    }

    if (wantsSales) {
        return {
            type: "assistant_app",
            title: "Sales Opportunity Workbench",
            description: "Open the revenue cockpit for pipeline windows, opportunity review, forecast gates, and risk alerts.",
            slug: "sales-opportunity-workbench",
            href: "/armory/apps?search=sales-opportunity-workbench",
            source: "app",
            actionLabel: "Find Sales app",
            blueprint: "sales-opportunity-workbench",
            cycleName: "Sales Opportunity Pipeline",
        };
    }

    if (wantsCodegen) {
        return {
            type: "assistant_app",
            title: "Codegen Pipeline Workbench",
            description: "Open the autonomous code-generation cockpit for session launch, phase evidence, metrics, and quality gates.",
            slug: "codegen-pipeline-workbench",
            href: "/armory/apps?search=codegen-pipeline-workbench",
            source: "app",
            actionLabel: "Find Codegen app",
            blueprint: "codegen-pipeline-workbench",
            cycleName: "Autonomous Code Generation Pipeline",
        };
    }

    // Only return the generic App Arsenal catalog card for a genuine BROWSE
    // request ("show me the apps", "app catalog", "app arsenal"). A specific
    // named-app launch ("Launch Budgetmaster app", "open IT Ticketing portal")
    // must NOT collapse to the catalog here — returning null defers it to the
    // server's app-presentation fast-path, which resolves the actual installed
    // app to a direct launch card (~0.1s). The previous broad test matched any
    // "app"/"workbench" keyword, so every named launch became the catalog.
    const wantsCatalogBrowse =
        /\b(app\s+arsenal|arsenal|app\s+catalog|app\s+marketplace|marketplace|app\s+store|app\s+gallery)\b/.test(normalized) ||
        /\b(browse|list|see|view|show|find|explore|what|which|all|available|installed)\b[^.!?\n]*\bapps\b/.test(normalized) ||
        /\bapps\b[^.!?\n]*\b(available|installed|catalog|list|do we have|are there)\b/.test(normalized);

    if (wantsCatalogBrowse) {
        return {
            type: "assistant_app",
            title: "App Arsenal",
            description: "Browse installed and available Oddjob apps, launch deployed workbenches, or open app configuration.",
            href: "/armory/apps",
            source: "app",
            actionLabel: "Find apps",
        };
    }

    // Anything else that mentions an app/workbench but names a specific target
    // defers to the server so the real app resolves and launches.
    return null;
}
