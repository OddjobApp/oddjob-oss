export const COPILOT_MODES = ["explain", "plan", "execute", "audit"] as const;

export type CopilotMode = typeof COPILOT_MODES[number];
export type CopilotRisk = "low" | "medium" | "high";

export interface CopilotEvidenceItem {
    label: string;
    source: string;
    href?: string;
}

export interface CopilotActionPreview {
    summary: string;
    risk: CopilotRisk;
    targets: string[];
    likelyTools: string[];
    requiresApproval: boolean;
}

export interface CopilotContextLike {
    page?: string;
    subPage?: {
        key?: string;
        label?: string;
        pathname?: string;
        section?: string;
        tab?: string;
        entityType?: string;
        entityId?: string;
    };
    currentUrl?: string;
    screenContext?: {
        page?: string;
        currentRoute?: string;
        subPage?: CopilotContextLike["subPage"];
    };
    missionId?: number | string | null;
    jobId?: number | string | null;
    appSlug?: string | null;
    provenanceHint?: CopilotEvidenceItem[];
}

export const COPILOT_MODE_DETAILS: Record<CopilotMode, { label: string; description: string }> = {
    explain: {
        label: "Explain",
        description: "Translate platform state into plain business language.",
    },
    plan: {
        label: "Plan",
        description: "Build a dry-run plan before touching live systems.",
    },
    execute: {
        label: "Execute",
        description: "Perform confirmed live actions with governance checks.",
    },
    audit: {
        label: "Audit",
        description: "Review evidence, risks, policy gates, and traceability.",
    },
};

// Bug fix (Bug 3 + Bug 4): Added infrastructure/destructive verbs (deploy, build, restart, etc.).
// These were absent from HIGH_RISK_ACTION_PATTERN so "deploy the app" was rated low risk.
const HIGH_RISK_ACTION_PATTERN = /delete|abort|terminate|approve|launch|trigger|run|write|update|sync|send|deploy|build|rebuild|restart|stop|publish/i;
const MEDIUM_RISK_ACTION_PATTERN = /create|resume|pause|export/i;

// Bug fix (Bug 3): replaced [\s\S]* (greedy, crosses sentence/line boundaries) with [^.!?\n]* so
// the anchor verb and the target noun must appear in the *same* clause.
const APP_PRESENTATION_PATTERN = /\b(list|show|find|open|launch|render|present|display|retrieve|get|resolve)\b[^.!?\n]*\b(app|apps|application|applications|app catalog|installed applications|workbench|workbenches|workspace|workspaces|assistant app|app card|app surface|href|url)\b/i;
const SIDE_EFFECTING_LAUNCH_PATTERN = /\b(launch|trigger|run|start|execute|deploy|publish)\b[^.!?\n]*\b(mission|pipeline|job|cycle|deployment|container|build|forge|workflow)\b/i;

// Bug fix (Bug 3 continued): Even with per-clause anchoring, APP_PRESENTATION_PATTERN can match
// the *second* clause of a multi-sentence message while a destructive verb sits in the *first*
// clause (e.g. "Delete the mission. Show me the apps."). This pattern rejects messages containing
// any destructive verb anywhere in the string, so the whole message is treated as side-effecting.
const DESTRUCTIVE_CLAUSE_PATTERN = /\b(delete|abort|terminate|approve|trigger|kill|remove|drop|purge)\b/i;

// Bug fix (Bug 4): Catches infrastructure operations targeting an app itself ("deploy the app",
// "build the app", "restart the app") which are side-effecting even though
// APP_PRESENTATION_PATTERN would also match on the word 'app'.
// Note: plain "launch the app" / "open the app" deliberately does NOT match here
// because those verbs are absent — they are handled as read-only presentation.
const INFRA_APP_OP_PATTERN = /\b(deploy|build|rebuild|restart|stop|terminate|start|publish)\b[^.!?\n]*\b(app|application)\b/i;

function compact<T>(items: Array<T | null | undefined | false>): T[] {
    return items.filter(Boolean) as T[];
}

function uniq(items: string[]): string[] {
    return Array.from(new Set(items));
}

function formatContextLabel(value: unknown, fallback: string): string {
    const text = String(value || fallback).trim();
    return text.replace(/_/g, " ");
}

export function normalizeCopilotMode(mode?: string | null): CopilotMode {
    if (mode === "execute") return "execute";
    if (mode === "audit") return "audit";
    if (mode === "explain") return "explain";
    return "plan";
}

export function getCopilotAudienceStyle(audience?: string | null): string {
    if (audience !== "business") return "";
    return "\n\nBUSINESS USER STYLE: Lead with outcomes, status, decisions needed, risk, spend, timeline, and evidence. Translate internal tool names and traces into plain language unless the user asks for implementation detail.";
}

export function isExplicitExternalResearchRequest(message: string): boolean {
    const text = String(message || "").trim();
    if (!text) return false;
    const hasUrl = /https?:\/\/[^\s]+/i.test(text);
    const hasResearchIntent = /\b(research|investigate|look\s+up|browse|read|summarize|analy[sz]e|review|check)\b/i.test(text);
    const externalSubject = /\b(web|website|url|article|page|site|online|internet|company|competitor|market)\b/i.test(text);
    return (hasUrl && hasResearchIntent) || (hasResearchIntent && externalSubject);
}

export function isExplicitAssistantFormRequest(message: string): boolean {
    const text = String(message || "").trim();
    if (!text) return false;
    return (
        /\b(?:create|build|render|show|make|generate)\b[^.!?\n]{0,80}\b(?:inline\s+)?(?:assistant\s+)?(?:intake\s+)?form\b/i.test(text)
        || /\b(?:inline\s+)?assistant\s+form\b/i.test(text)
    );
}

// Shared guidance appended to every read-only mode. The Copilot has full write
// capability via MCP tools (create/update/delete jobs, pipelines, entities;
// add_dataset_items; etc.) — but only in Execute mode, which is user-confirmed.
// In read-only modes it must NOT tell the user a change is impossible ("as an AI
// I cannot modify jobs"): the capability exists, it just needs their approval.
const WRITE_REQUEST_GUIDANCE =
    "\n\nIF THE USER ASKS YOU TO CHANGE SOMETHING (create/update/delete a job, pipeline, entity, or write data to a dataset): do NOT reply that you are unable to or that it requires a developer. You CAN do it — those write tools are simply gated to Execute mode for safety. Confirm what you'll change, then call `request_execute_mode` to ask the user to approve switching to Execute mode, and perform the change there. To route a job's output into a dataset, set the job's `outputDatasetId` via `update_job` (it is a top-level job field, NOT part of `config`).";

// Teaches the Copilot the intake-form capability. Applies in EVERY mode because
// rendering a form is presentation (no side effect). Without this the model tends
// to ask the user to type the fields in prose, or wanders into proposing a new
// mission, instead of loading the form the platform already has.
const INTAKE_FORM_GUIDANCE =
    "\n\nFILING A BUG REPORT / SUBMITTING AN INTAKE: When the user wants to file a bug report, open a ticket, or submit a request, the platform usually already has a form for it — a `form_agent` job whose schema defines the fields. Load that INTERACTIVE form; do NOT list the fields in prose, ask the user to paste details in a format, or propose creating a new mission. For common intakes (e.g. \"file a bug report\") the form loads automatically; otherwise render one with `render_intake_form`. When the user submits, the values are saved as a row in that form's configured dataset — bug reports go to the \"Identified Bugs\" dataset. If the user instead gives you the bug details directly in chat, you can record them yourself by adding a row to that dataset with `add_dataset_items` (Execute mode).";

export function getCopilotModeInstruction(mode?: string | null): string {
    const normalized = normalizeCopilotMode(mode);
    if (normalized === "execute") {
        return "\n\nCRITICAL: You are in EXECUTE MODE. Perform confirmed live actions directly, respect governance constraints, and notify the user of results. If an action is risky, summarize what happened and what audit trail or approval applies." + INTAKE_FORM_GUIDANCE;
    }
    if (normalized === "audit") {
        return "\n\nCRITICAL: You are in AUDIT MODE. Do not perform side effects. Use read-only tools to inspect evidence, risk, policy gates, budget, approvals, provenance, stale assumptions, and missing context. Return findings with severity and recommended next action." + WRITE_REQUEST_GUIDANCE + INTAKE_FORM_GUIDANCE;
    }
    if (normalized === "explain") {
        return "\n\nCRITICAL: You are in EXPLAIN MODE. Do not perform side effects. Use read-only tools when useful, then explain the current state in concise business language with evidence and confidence." + WRITE_REQUEST_GUIDANCE + INTAKE_FORM_GUIDANCE;
    }
    return "\n\nCRITICAL: You are in PLAN MODE. All actions with side-effects will be SIMULATED. You are encouraged to use READ-ONLY tools (like `list_datasets`, `query_dataset`, `search_knowledge_graph`, and `search_documents`) to gather information while building your plan. When ready to execute side-effects, propose switching to live execution." + WRITE_REQUEST_GUIDANCE + INTAKE_FORM_GUIDANCE;
}

export function isReadOnlyAppPresentationRequest(message: string): boolean {
    const text = message.trim();
    if (!text) return false;
    // "instant app(s)" and workspace rail studios (form studio, scribe studio, app studio)
    // are live in-chat features and rail tools, NOT the App Arsenal / published-app presenter.
    // Let them fall through to the agent loop/rail router so the appropriate tools are invoked.
    if (/\b(?:instant\s+apps?|form\s+studio|form\s+builder|scribe\s+studio|scribe\s+foundry|app\s+studio)\b/i.test(text)) return false;
    return (
        APP_PRESENTATION_PATTERN.test(text) &&
        !SIDE_EFFECTING_LAUNCH_PATTERN.test(text) &&
        // Bug fix (Bug 4): infrastructure ops on 'app' (deploy/build/restart) are side-effecting.
        !INFRA_APP_OP_PATTERN.test(text) &&
        // Bug fix (Bug 3): reject any message that contains a destructive verb *anywhere*,
        // even if the destructive verb is in a different clause than the app-presentation clause.
        // e.g. "Delete the mission. Show me the apps." — APP_PRESENTATION_PATTERN matches the
        // second clause, but DESTRUCTIVE_CLAUSE_PATTERN catches the first.
        !DESTRUCTIVE_CLAUSE_PATTERN.test(text)
    );
}

// Deterministic instant-app fast-path detector. Returns the requested block
// phrase for an EXPLICIT single-block "render X as an instant app" request, or
// null. When non-null the copilot renders render_instant_app directly (no agent
// loop, no model tool-selection) — instant apps then render in <1s on ANY backend
// (cloud, local Ollama, or Mock), instead of relying on a possibly-weak/slow model
// to pick the tool. Multi-block / "dashboard" / "assemble" phrasing returns null so
// those fall through to the loop's assemble_instant_app.
const INSTANT_APP_MULTI_HINT = /\b(assemble|combine|compose|dashboard|multiple\s+blocks?|several\s+blocks?|surface\s+with)\b/i;
// Requests for calculators, converters, and custom-logic tools CANNOT be served by
// instant-app blocks (which are pre-built, backend-wired). These must fall through
// to App Forge or the agent loop to generate custom code.
const INSTANT_APP_CUSTOM_LOGIC_HINT = /\b(calculator|converter|estimator|simulator|planner|budgeting|mortgage|loan|tip|bmi|tax|interest|compound|amortization|currency\s+convert)/i;
export function extractInstantAppRenderRequest(message: string): string | null {
    const text = (message || "").trim();
    if (!text) return null;
    if (!/\binstant\s+app\b/i.test(text)) return null;
    // Multi-block requests belong to the agent loop (assemble_instant_app).
    if (INSTANT_APP_MULTI_HINT.test(text)) return null;
    // Calculator/converter/estimator requests need custom code (App Forge), not a pre-built block.
    if (INSTANT_APP_CUSTOM_LOGIC_HINT.test(text)) return null;

    // Capture the block phrase from the common phrasings:
    //  "render the X as an instant app", "show me the X instant app",
    //  "instant app for/of/showing X".
    let phrase: string | null = null;
    const verbFirst = text.match(/\b(?:render|show|display|open|build|create|generate|give|make|bring\s+up|pull\s+up|want|need)\b[^.!?\n]*?\b(?:me\s+)?(?:the\s+|a\s+|an\s+)?([a-z0-9][\w -]*?)\s+(?:as\s+(?:an?\s+)?)?instant\s+app/i);
    const appFirst = text.match(/\binstant\s+app\b\s*(?:for|of|showing|with|to\s+show|that\s+shows)\s+(?:the\s+|a\s+|an\s+)?([a-z0-9][\w -]*)/i);
    phrase = (verbFirst?.[1] || appFirst?.[1] || "").trim();

    if (!phrase) return null;
    // Strip a trailing purpose/relative clause the noun phrase may have absorbed
    // ("... table so I can see missions" -> "... table").
    phrase = phrase.replace(/\s+(?:so|to|that|which|for|because|and)\b.*$/i, "").trim();
    // Strip trailing filler nouns that aren't part of a block name.
    phrase = phrase.replace(/\s+(?:view|screen|page|component|block|widget|panel)$/i, "").trim();
    phrase = phrase.replace(/^(?:the|a|an)\s+/i, "").trim();
    if (phrase.length < 2 || phrase.length > 60) return null;
    return phrase;
}

// Curated dashboard presets: theme -> ordered block names that exist in the
// component index. assemble_instant_app fuzzy-matches each and silently skips any
// that aren't renderable, so a composition degrades gracefully if the index drifts.
// Order matters — more specific themes first; operations is the broad catch-all.
// NOTE: prefer SELF-WIRING blocks ("Platform*" / "(Self-Wiring)" in the index) —
// they fetch their own data and render live with no props. Non-self-wiring blocks
// (Metric Grid, Status Timeline) need props the fast-path can't supply and would
// show a "needs live data" fallback tile in a composed dashboard.
// Prefer self-wiring LIST/overview blocks (fetch a collection, no selected entity)
// so every tile populates in the copilot chat via the embedded API bridge
// (/api/oddjob/{missions,pipelines,datasets}). Per-entity blocks (Mission Log,
// Knowledge-Driven Mission) fetch /api/oddjob/missions/:id/* and would render an
// error tile with an undefined id when no mission is selected, so they're avoided.
// Blocks here are verified SELF-WIRING (fetch + no required props) AND confirmed to
// render clean live in-chat. Note: self-wiring alone is not sufficient — some
// self-wiring blocks (Platform Job Runner, HIL Approval, …) still have runtime
// render bugs (unguarded access on fetched data) and are kept out until fixed.
// Never add prop-requiring blocks (Dataset Chart, Agent Swarm, Knowledge Graph
// Explorer, NLQ, Mission Log) — they need config/entity props and throw prop-free.
const DASHBOARD_PRESETS: Array<{ test: RegExp; title: string; blocks: string[] }> = [
    { test: /\b(weather|forecast|climate)\b/i, title: "Weather Dashboard", blocks: ["Metric Grid", "Industrial Dashboard Hero"] },
    { test: /\bpipelines?\b/i, title: "Pipeline Dashboard", blocks: ["Platform Pipeline Status", "Platform Pipeline Trigger", "Platform Job Runner"] },
    { test: /\b(agents?|swarm)\b/i, title: "Agent Dashboard", blocks: ["Multi-Agent Orchestration", "Platform Missions Table", "Platform Pipeline Status"] },
    { test: /\bknowledge\b/i, title: "Knowledge Dashboard", blocks: ["Platform Dataset Table", "Platform Missions Table", "Platform Pipeline Status"] },
    { test: /\b(datasets?|analytics?|data)\b/i, title: "Data Dashboard", blocks: ["Platform Dataset Table", "Platform Missions Table", "Platform Pipeline Status"] },
    { test: /\bmissions?\b/i, title: "Mission Dashboard", blocks: ["Platform Missions Table", "Platform Pipeline Status", "Platform Dataset Table"] },
    { test: /\b(operations?|ops|command|overview)\b/i, title: "Operations Dashboard", blocks: ["Platform Missions Table", "Platform Pipeline Status", "Platform Job Runner", "Platform Dataset Table"] },
];
const DEFAULT_DASHBOARD = { title: "Instant Dashboard", blocks: ["Platform Missions Table", "Platform Pipeline Status", "Platform Dataset Table"] };

export interface InstantAppAssembleRequest { blocks: string[]; layout: "grid" | "stack"; title: string; }

// Deterministic multi-block fast-path detector (companion to
// extractInstantAppRenderRequest). Returns the block list + layout + title for a
// "assemble/build a dashboard" or "instant app with X and Y" request, else null.
// Mode A: explicitly named blocks ("... with X, Y and Z"). Mode B: a themed
// dashboard preset. When non-null the copilot calls assemble_instant_app directly
// (no agent loop), so dashboards compose in <2s on ANY backend.
export function extractInstantAppAssembleRequest(message: string): InstantAppAssembleRequest | null {
    const text = (message || "").trim();
    if (!text) return null;
    const hasInstantApp = /\binstant\s+app\b/i.test(text);
    const hasDashboard = /\bdashboard\b/i.test(text);
    const hasComposeVerb = /\b(assemble|compose|combine|put\s+together|build|create|make|generate|show|render|give\s+me|need|want)\b/i.test(text);
    const layout: "grid" | "stack" = /\b(stack|stacked|vertical|column)\b/i.test(text) ? "stack" : "grid";
    const presetFor = (t: string) => DASHBOARD_PRESETS.find((p) => p.test.test(t));

    // Mode A candidate: explicitly named blocks — "... with/containing X, Y and Z".
    const listMatch = text.match(/\b(?:with|containing|including|combining|comprising|consisting\s+of)\s+(.+?)(?:\s+(?:so|to|that|which|for|because)\b.*)?$/i);
    const namedBlocks = listMatch
        ? listMatch[1]
            .split(/\s*,\s*|\s+and\s+|\s*&\s*|\s*\+\s*/i)
            .map((s) => s.replace(/\binstant\s+apps?\b/ig, "").trim())
            .map((s) => s.replace(/^(?:a|an|the)\s+/i, "").trim())
            .map((s) => s.replace(/\s+(?:block|widget|panel|component|section)$/i, "").trim())
            .filter((s) => s.length >= 2 && s.length <= 40 && !/^dashboards?$/i.test(s))
        : [];

    // Fire on clear multi-block/dashboard intent: an instant-app mention with a
    // compose hint / "dashboard" / an explicit ≥2 block list, OR "dashboard" + a
    // compose verb. Avoids hijacking "open the X dashboard" navigation (no instant-app
    // mention, no compose verb) and single-block renders (handled by the render fast-path).
    const fire =
        (hasInstantApp && (INSTANT_APP_MULTI_HINT.test(text) || hasDashboard || namedBlocks.length >= 2)) ||
        (hasDashboard && hasComposeVerb);
    if (!fire) return null;

    // Mode A: use the explicitly named blocks when there are at least two.
    if (namedBlocks.length >= 2) {
        return { blocks: namedBlocks.slice(0, 6), layout, title: presetFor(text)?.title || "Instant Dashboard" };
    }

    // Mode B: themed preset (or a sensible default dashboard).
    const preset = presetFor(text) || DEFAULT_DASHBOARD;
    return { blocks: preset.blocks, layout, title: preset.title };
}

export function buildCopilotActionPreview(message: string, context?: CopilotContextLike): CopilotActionPreview {
    const lower = message.toLowerCase();
    const page = formatContextLabel(context?.page || context?.screenContext?.page, "current context");
    const isReadOnlyAppPresentation = isReadOnlyAppPresentationRequest(message);

    // Bug fix (precedence): HIGH_RISK_ACTION_PATTERN is checked first, but isReadOnlyAppPresentation
    // intentionally overrides it to 'low' for pure UI presentation requests (e.g. "launch the app"
    // just opens a URL — no side effects). Without this override, every "launch the [app]" message
    // would be rated high-risk and block the read-only fast-path. Infrastructure ops on apps
    // ("deploy the app", "build the app") are already excluded from isReadOnlyAppPresentation
    // by INFRA_APP_OP_PATTERN, so they correctly remain high-risk here.
    const risk: CopilotRisk = HIGH_RISK_ACTION_PATTERN.test(lower) && !isReadOnlyAppPresentation
        ? "high"
        : isReadOnlyAppPresentation
        ? "low"
        : MEDIUM_RISK_ACTION_PATTERN.test(lower)
            ? "medium"
            : "low";

    const targets = compact<string>([
        page,
        context?.missionId ? `Mission ${context.missionId}` : null,
        context?.jobId ? `Job ${context.jobId}` : null,
        context?.appSlug ? `App ${context.appSlug}` : null,
        lower.includes("pipeline") ? "Pipeline runner" : null,
        lower.includes("mission") ? "Mission workspace" : null,
        lower.includes("cycle") ? "Cycle operations" : null,
        lower.includes("knowledge") ? "Knowledge store" : null,
    ]);

    const likelyTools = compact<string>([
        lower.includes("approve") || lower.includes("decision") ? "approval tools" : null,
        lower.includes("pipeline") || lower.includes("run") ? "pipeline tools" : null,
        lower.includes("mission") ? "mission tools" : null,
        lower.includes("knowledge") || lower.includes("document") ? "knowledge tools" : null,
        isReadOnlyAppPresentation ? "app catalog tools" : null,
        isReadOnlyAppPresentation ? "app card renderer" : null,
        "governed agent loop",
    ]);

    return {
        summary: isReadOnlyAppPresentation
            ? "App catalog and app card rendering are read-only presentation actions."
            : "Live execution requires confirmation before Oddjob changes system state.",
        risk,
        targets: uniq(targets).slice(0, 6),
        likelyTools: uniq(likelyTools).slice(0, 6),
        requiresApproval: !isReadOnlyAppPresentation && risk !== "low",
    };
}

export function deriveCopilotEvidence(
    context: CopilotContextLike | undefined,
    scope?: string,
    missionId?: number | string | null,
): CopilotEvidenceItem[] {
    if (Array.isArray(context?.provenanceHint) && context.provenanceHint.length > 0) {
        return context.provenanceHint.slice(0, 6);
    }

    const page = formatContextLabel(context?.page || context?.screenContext?.page, "Current page");
    return compact<CopilotEvidenceItem>([
        { label: page, source: "Current Oddjob screen", href: context?.currentUrl },
        scope ? { label: scope, source: "Copilot context scope" } : null,
        missionId ? { label: `Mission ${missionId}`, source: "Mission blackboard and timeline" } : null,
        context?.jobId ? { label: `Job ${context.jobId}`, source: "Agent job configuration" } : null,
        context?.appSlug ? { label: context.appSlug, source: "Forged app context" } : null,
    ]).slice(0, 6);
}
