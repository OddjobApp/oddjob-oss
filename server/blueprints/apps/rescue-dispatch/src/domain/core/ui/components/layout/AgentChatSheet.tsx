import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@domain-ui/core/ui/components/ui/sheet";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import {
    AlertTriangle,
    BookOpen,
    Boxes,
    CheckCircle2,
    ClipboardCheck,
    Compass,
    FileSearch,
    GripVertical,
    ListChecks,
    Play,
    Send,
    ShieldCheck,
    Sparkles,
    Trash2,
    Zap,
} from "lucide-react";
import { useLocation } from "wouter";
import { useOrgContextOptional } from "@domain-ui/core/ui/hooks/use-org-context";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import {
    buildCopilotActionPreview,
    COPILOT_MODE_DETAILS,
    COPILOT_MODES,
    normalizeCopilotMode,
    type CopilotActionPreview,
    type CopilotEvidenceItem,
    type CopilotMode,
} from "@domain-ui/ai/core/copilot-contract.js";

const MIN_WIDTH = 360;
const MAX_WIDTH = 980;
const DEFAULT_WIDTH = 480;
const WORK_MEMORY_KEY = "oddjob:copilot:work-memory";

type ChatMode = CopilotMode;
type EvidenceItem = CopilotEvidenceItem;

interface Message {
    id: string;
    role: "user" | "agent";
    content: string;
    timestamp: number;
    mode?: ChatMode;
    evidence?: EvidenceItem[];
}

interface WorkMemoryItem {
    id: string;
    title: string;
    status: "previewed" | "executed" | "planned";
    mode: ChatMode;
    createdAt: number;
}

interface ExecutionPreview extends CopilotActionPreview {
    id: string;
    prompt: string;
}

interface PageAction {
    label: string;
    prompt: string;
    mode: ChatMode;
    icon: React.ElementType;
}

interface ModeConfig {
    label: string;
    description: string;
    icon: React.ElementType;
    badgeClass: string;
}

interface AgentChatSheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    initialPrompt?: string;
    initialContext?: Record<string, any>;
}

const MODE_CONFIG: Record<ChatMode, ModeConfig> = {
    explain: {
        ...COPILOT_MODE_DETAILS.explain,
        icon: BookOpen,
        badgeClass: "border-sky-500/35 bg-sky-500/10 text-sky-300",
    },
    plan: {
        ...COPILOT_MODE_DETAILS.plan,
        icon: ListChecks,
        badgeClass: "border-amber-500/35 bg-amber-500/10 text-amber-300",
    },
    execute: {
        ...COPILOT_MODE_DETAILS.execute,
        icon: Zap,
        badgeClass: "border-emerald-500/35 bg-emerald-500/10 text-emerald-300",
    },
    audit: {
        ...COPILOT_MODE_DETAILS.audit,
        icon: ShieldCheck,
        badgeClass: "border-violet-500/35 bg-violet-500/10 text-violet-300",
    },
};

const CAPABILITIES = [
    { label: "Summarize status", detail: "Turn current page state into an executive brief." },
    { label: "Explain evidence", detail: "Tie answers back to missions, knowledge, datasets, or audit logs." },
    { label: "Plan governed work", detail: "Prepare dry-run steps, tools, targets, and likely approvals." },
    { label: "Execute safely", detail: "Confirm live actions before side effects are sent to the agent loop." },
    { label: "Audit decisions", detail: "Inspect risks, policy gates, budget, and provenance." },
    { label: "Keep open loops", detail: "Track recent planned or executed work in the sheet." },
];

const PAGE_ACTIONS: Record<string, PageAction[]> = {
    cycle_detail: [
        { label: "Business summary", mode: "explain", icon: Compass, prompt: "Summarize this cycle for a business stakeholder. Cover status, outcome, budget, timeline, risks, and whether a decision is needed." },
        { label: "Decision needed?", mode: "audit", icon: ClipboardCheck, prompt: "Review this cycle and tell me if any human decision, approval, missing credential, or blocked mission needs attention." },
        { label: "Draft update", mode: "plan", icon: FileSearch, prompt: "Draft a concise stakeholder update for this cycle using current status, risks, next milestone, and business impact." },
    ],
    cycles_list: [
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
        { label: "Mission portfolio", mode: "explain", icon: Compass, prompt: "Summarize current missions by status, risk, owner attention, and business outcome." },
        { label: "Launch plan", mode: "plan", icon: ListChecks, prompt: "Help me plan a new governed mission from the current context. Ask only for missing inputs." },
        { label: "Risk audit", mode: "audit", icon: ShieldCheck, prompt: "Audit active missions for budget, policy, approval, or stale-context risks." },
    ],
    appforge: [
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
    dashboard: [
        { label: "Daily brief", mode: "explain", icon: Compass, prompt: "Give me a concise Oddjob daily brief: active work, decisions needed, risks, spend, and recommended next steps." },
        { label: "Find blockers", mode: "audit", icon: ShieldCheck, prompt: "Look across the current workspace context for blockers, failed runs, missing approvals, or risk signals." },
        { label: "Start work", mode: "plan", icon: ListChecks, prompt: "Help me plan the next governed piece of autonomous work. Suggest the best Oddjob surface to use." },
    ],
};

function makeWelcome(): Message {
    return {
        id: "welcome",
        role: "agent",
        content: "Hello. I'm the **Oddjob Copilot**. I can explain what is happening, plan governed work, audit evidence, and execute confirmed actions. I default to safe modes and will ask before live side effects.",
        timestamp: Date.now(),
        mode: "explain",
    };
}

function derivePage(location: string): string {
    if (location.match(/^\/operations\/cycles\/\d+/)) return "cycle_detail";
    if (location === "/operations/cycles") return "cycles_list";
    if (location.match(/^\/missions\/\d+/)) return "mission_detail";
    if (location.includes("/missions")) return "missions";
    if (location.match(/^\/jobs\/\d+/)) return "job_detail";
    if (location === "/jobs") return "jobs_list";
    if (location.match(/^\/pipelines\/\d+/)) return "pipeline_detail";
    if (location === "/pipelines") return "pipelines_list";
    if (location.includes("/knowledge/graph")) return "knowledge_graph";
    if (location.includes("/knowledge")) return "knowledge_store";
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

function getPageActions(page: string): PageAction[] {
    return PAGE_ACTIONS[page] ?? PAGE_ACTIONS.dashboard;
}

function getEvidenceForPage(page: string, location: string): EvidenceItem[] {
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

function loadWorkMemory(): WorkMemoryItem[] {
    try {
        const parsed = JSON.parse(localStorage.getItem(WORK_MEMORY_KEY) || "[]");
        return Array.isArray(parsed) ? parsed.slice(0, 8) : [];
    } catch {
        return [];
    }
}

function saveWorkMemory(items: WorkMemoryItem[]) {
    localStorage.setItem(WORK_MEMORY_KEY, JSON.stringify(items.slice(0, 8)));
}

function makeExecutionPreview(prompt: string, page: string): ExecutionPreview {
    return {
        id: crypto.randomUUID(),
        prompt,
        ...buildCopilotActionPreview(prompt, { page }),
    };
}

export function AgentChatSheet({ open, onOpenChange, initialPrompt, initialContext }: AgentChatSheetProps) {
    const [messages, setMessages] = useState<Message[]>(() => [makeWelcome()]);
    const [input, setInput] = useState("");
    const [isTyping, setIsTyping] = useState(false);
    const [mode, setMode] = useState<ChatMode>("explain");
    const [sessionId] = useState(() => crypto.randomUUID());
    const [panelWidth, setPanelWidth] = useState(DEFAULT_WIDTH);
    const [showCapabilities, setShowCapabilities] = useState(false);
    const [pendingExecution, setPendingExecution] = useState<ExecutionPreview | null>(null);
    const [workMemory, setWorkMemory] = useState<WorkMemoryItem[]>(() => loadWorkMemory());
    const scrollRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const didAutoSend = useRef(false);
    const isDragging = useRef(false);
    const dragStartX = useRef(0);
    const dragStartWidth = useRef(DEFAULT_WIDTH);
    const [location] = useLocation();
    const orgCtx = useOrgContextOptional();
    const activeOrgId = orgCtx?.selectedOrgId ?? null;

    const page = useMemo(() => derivePage(location), [location]);
    const pageActions = useMemo(() => getPageActions(page), [page]);
    const pageEvidence = useMemo(() => getEvidenceForPage(page, location), [page, location]);
    const modeMeta = MODE_CONFIG[mode];

    const updateWorkMemory = useCallback((item: WorkMemoryItem) => {
        setWorkMemory(prev => {
            const next = [item, ...prev.filter(existing => existing.id !== item.id)].slice(0, 8);
            saveWorkMemory(next);
            return next;
        });
    }, []);

    const onHandleMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        isDragging.current = true;
        dragStartX.current = e.clientX;
        dragStartWidth.current = panelWidth;
        document.body.style.cursor = "ew-resize";
        document.body.style.userSelect = "none";
    }, [panelWidth]);

    useEffect(() => {
        const onMouseMove = (e: MouseEvent) => {
            if (!isDragging.current) return;
            const delta = dragStartX.current - e.clientX;
            const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragStartWidth.current + delta));
            setPanelWidth(next);
        };
        const onMouseUp = () => {
            if (!isDragging.current) return;
            isDragging.current = false;
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
        };
        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
        return () => {
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);
        };
    }, []);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages, isTyping, pendingExecution]);

    useEffect(() => {
        if (open) {
            setTimeout(() => textareaRef.current?.focus(), 150);
        }
    }, [open]);

    const sendMessage = useCallback(async (text: string, options?: { confirmedExecution?: boolean; overrideMode?: ChatMode }) => {
        const textToSend = text.trim();
        if (!textToSend || isTyping) return;

        const effectiveMode = options?.overrideMode ?? mode;
        if (effectiveMode === "execute" && !options?.confirmedExecution) {
            const preview = makeExecutionPreview(textToSend, page);
            setPendingExecution(preview);
            updateWorkMemory({
                id: preview.id,
                title: textToSend.slice(0, 90),
                status: "previewed",
                mode: "execute",
                createdAt: Date.now(),
            });
            return;
        }

        const userMsg: Message = {
            id: crypto.randomUUID(),
            role: "user",
            content: textToSend,
            timestamp: Date.now(),
            mode: effectiveMode,
        };

        setPendingExecution(null);
        setMessages(prev => [...prev, userMsg]);
        setInput("");
        setIsTyping(true);

        const agentMsgId = crypto.randomUUID();
        const agentMsgTimestamp = Date.now();

        try {
            const conversationHistory = messages
                .filter(m => m.role !== "agent" || m.id !== "welcome")
                .slice(-10)
                .map(m => ({ role: m.role === "agent" ? "assistant" : "user", content: m.content }));

            // Scope the copilot to the org the user is actively viewing. The backend
            // honors ?organizationId for super-admins; without it the copilot falls
            // back to the user's defaultOrgId (e.g. org 1) and answers about the
            // wrong tenant.
            const chatUrl = activeOrgId != null
                ? `/api/agent/chat?organizationId=${activeOrgId}`
                : "/api/agent/chat";

            const res = await fetch(chatUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                    message: textToSend,
                    context: {
                        ...initialContext,
                        page,
                        currentUrl: location,
                        mode: effectiveMode,
                        audience: "business",
                        sessionId,
                        history: conversationHistory,
                        confirmedExecution: options?.confirmedExecution === true,
                        provenanceHint: pageEvidence,
                    },
                }),
            });

            if (!res.ok) {
                try {
                    const errorData = await res.json();
                    throw new Error(errorData.error || `HTTP ${res.status}`);
                } catch (e: any) {
                    throw new Error(e.message || `HTTP ${res.status}`);
                }
            }

            const data = await res.json();
            const response = data.response || data.reply || data.message || "No response received.";
            const metadata = data.metadata || {};
            const evidence = Array.isArray(metadata.evidence) && metadata.evidence.length > 0
                ? metadata.evidence
                : pageEvidence;

            setMessages(prev => [...prev, {
                id: agentMsgId,
                role: "agent",
                content: response,
                timestamp: agentMsgTimestamp,
                mode: effectiveMode,
                evidence,
            }]);

            if (effectiveMode === "execute") {
                updateWorkMemory({
                    id: crypto.randomUUID(),
                    title: textToSend.slice(0, 90),
                    status: "executed",
                    mode: "execute",
                    createdAt: Date.now(),
                });
            } else if (effectiveMode === "plan") {
                updateWorkMemory({
                    id: crypto.randomUUID(),
                    title: textToSend.slice(0, 90),
                    status: "planned",
                    mode: "plan",
                    createdAt: Date.now(),
                });
            }
        } catch (err: any) {
            setMessages(prev => [...prev, {
                id: agentMsgId,
                role: "agent",
                content: `Failed to reach the copilot: ${err.message || "Unknown error"}`,
                timestamp: agentMsgTimestamp,
                mode: effectiveMode,
                evidence: pageEvidence,
            }]);
        } finally {
            setIsTyping(false);
        }
    }, [isTyping, location, mode, page, pageEvidence, sessionId, initialContext, messages, updateWorkMemory, activeOrgId]);

    useEffect(() => {
        if (open && initialPrompt && !didAutoSend.current) {
            didAutoSend.current = true;
            const requestedMode = normalizeCopilotMode(initialContext?.mode);
            setMode(requestedMode);
            sendMessage(initialPrompt, { overrideMode: requestedMode });
        }
        if (!open) {
            didAutoSend.current = false;
        }
    }, [open, initialPrompt, initialContext, sendMessage]);

    const handleAction = (action: PageAction) => {
        setMode(action.mode);
        sendMessage(action.prompt, { overrideMode: action.mode });
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendMessage(input);
        }
    };

    const clearChat = () => {
        setMessages([makeWelcome()]);
        setPendingExecution(null);
        didAutoSend.current = false;
    };

    const clearWorkMemory = () => {
        setWorkMemory([]);
        saveWorkMemory([]);
    };

    const confirmExecution = () => {
        if (!pendingExecution) return;
        sendMessage(pendingExecution.prompt, { confirmedExecution: true, overrideMode: "execute" });
    };

    const ModeIcon = modeMeta.icon;

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent
                side="right"
                className="p-0 border-l border-white/10 bg-slate-950/95 text-white overflow-hidden flex flex-col"
                style={{ width: `${panelWidth}px`, maxWidth: `${panelWidth}px` }}
            >
                <div
                    onMouseDown={onHandleMouseDown}
                    className="absolute left-0 top-0 h-full w-3 flex items-center justify-center cursor-ew-resize z-10 group select-none"
                    title="Drag to resize"
                >
                    <div className="w-1 h-12 rounded-full bg-white/10 group-hover:bg-indigo-500/60 group-active:bg-indigo-400 transition-colors flex flex-col items-center justify-center gap-0.5">
                        <GripVertical className="h-3 w-3 text-white/20 group-hover:text-indigo-300 transition-colors" />
                    </div>
                </div>

                <SheetHeader className="px-5 py-4 bg-slate-950 border-b border-white/10 flex-shrink-0">
                    <div className="flex items-start justify-between gap-4 pr-8">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2.5">
                                <div className="p-1.5 rounded-lg bg-indigo-600 shadow-[0_0_16px_rgba(79,70,229,0.35)]">
                                    <Sparkles className="h-4 w-4 text-white" />
                                </div>
                                <SheetTitle className="text-base font-bold tracking-tight text-white">
                                    Oddjob Copilot
                                </SheetTitle>
                                <Badge variant="outline" className={cn("text-[9px] h-5 px-1.5 uppercase", modeMeta.badgeClass)}>
                                    <ModeIcon className="mr-1 h-3 w-3" />
                                    {modeMeta.label}
                                </Badge>
                            </div>
                            <p className="text-[11px] text-slate-500 mt-1">
                                Context: {page.replace(/_/g, " ")}. {modeMeta.description}
                            </p>
                        </div>
                        <button
                            onClick={clearChat}
                            className="p-1.5 rounded-md text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors"
                            title="Clear conversation"
                        >
                            <Trash2 className="h-3.5 w-3.5" />
                        </button>
                    </div>

                    <div className="mt-4 grid grid-cols-4 gap-1 rounded-xl border border-white/10 bg-slate-900/70 p-1">
                        {COPILOT_MODES.map(key => {
                            const cfg = MODE_CONFIG[key];
                            const Icon = cfg.icon;
                            return (
                                <button
                                    key={key}
                                    onClick={() => setMode(key)}
                                    className={cn(
                                        "flex min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[10px] font-bold uppercase tracking-wider transition-colors",
                                        mode === key ? "bg-white/10 text-white" : "text-slate-500 hover:bg-white/5 hover:text-slate-300"
                                    )}
                                    title={cfg.description}
                                >
                                    <Icon className="h-3.5 w-3.5 shrink-0" />
                                    <span className="truncate">{cfg.label}</span>
                                </button>
                            );
                        })}
                    </div>
                </SheetHeader>

                <div className="border-b border-white/10 bg-slate-950 px-4 py-3">
                    <div className="grid gap-2 sm:grid-cols-3">
                        {pageActions.map(action => {
                            const Icon = action.icon;
                            return (
                                <button
                                    key={action.label}
                                    onClick={() => handleAction(action)}
                                    disabled={isTyping}
                                    className="group flex min-h-[72px] flex-col items-start justify-between rounded-xl border border-white/10 bg-slate-900/60 p-3 text-left transition-colors hover:border-indigo-400/40 hover:bg-indigo-500/10 disabled:opacity-50"
                                >
                                    <Icon className="h-4 w-4 text-indigo-300" />
                                    <span className="text-xs font-bold text-slate-100 group-hover:text-white">{action.label}</span>
                                </button>
                            );
                        })}
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                        <button
                            className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 hover:text-slate-300"
                            onClick={() => setShowCapabilities(v => !v)}
                        >
                            <Boxes className="h-3 w-3" />
                            What I can do here
                        </button>
                        {workMemory.length > 0 && (
                            <button
                                className="text-[10px] font-bold uppercase tracking-wider text-slate-600 hover:text-slate-300"
                                onClick={clearWorkMemory}
                            >
                                Clear open loops
                            </button>
                        )}
                    </div>
                    {showCapabilities && (
                        <div className="mt-3 grid gap-2 rounded-xl border border-white/10 bg-black/25 p-3">
                            {CAPABILITIES.map(item => (
                                <div key={item.label} className="flex gap-2">
                                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                                    <div>
                                        <p className="text-[11px] font-bold text-slate-200">{item.label}</p>
                                        <p className="text-[10px] leading-relaxed text-slate-500">{item.detail}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="flex-1 overflow-y-auto px-4 py-3" ref={scrollRef}>
                    <div className="space-y-3 pb-3">
                        {workMemory.length > 0 && (
                            <div className="rounded-xl border border-white/10 bg-slate-900/50 p-3">
                                <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                    <ClipboardCheck className="h-3 w-3" />
                                    Open work
                                </div>
                                <div className="space-y-2">
                                    {workMemory.slice(0, 3).map(item => (
                                        <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg bg-black/20 px-2.5 py-2">
                                            <div className="min-w-0">
                                                <p className="truncate text-[11px] font-medium text-slate-200">{item.title}</p>
                                                <p className="text-[9px] uppercase tracking-wider text-slate-600">{item.mode} - {item.status}</p>
                                            </div>
                                            <Badge variant="outline" className="h-5 border-white/10 text-[9px] text-slate-500">
                                                {new Date(item.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                            </Badge>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {messages.map(msg => {
                            const msgMode = msg.mode ? MODE_CONFIG[msg.mode] : undefined;
                            return (
                                <div key={msg.id} className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}>
                                    <div className={cn(
                                        "max-w-[90%] rounded-xl px-3.5 py-2.5 text-sm",
                                        msg.role === "user"
                                            ? "bg-indigo-600 text-white ml-6"
                                            : "bg-slate-800/80 border border-white/10 text-slate-200 mr-6"
                                    )}>
                                        {msg.role === "agent" && (
                                            <div className="mb-1 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-indigo-400">
                                                <Sparkles className="h-2.5 w-2.5" />
                                                Copilot
                                                {msgMode && <span className="text-slate-600">/ {msgMode.label}</span>}
                                            </div>
                                        )}
                                        <div className={cn(
                                            "prose prose-sm max-w-none leading-relaxed",
                                            msg.role === "user"
                                                ? "prose-invert"
                                                : "prose-invert prose-p:text-slate-200 prose-headings:text-white prose-code:text-indigo-300 prose-pre:bg-slate-900 prose-pre:border prose-pre:border-white/10"
                                        )}>
                                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                                {msg.content}
                                            </ReactMarkdown>
                                        </div>
                                        {msg.role === "agent" && msg.evidence && msg.evidence.length > 0 && (
                                            <div className="mt-3 flex flex-wrap gap-1.5 border-t border-white/10 pt-2">
                                                {msg.evidence.slice(0, 4).map((item, index) => (
                                                    <span
                                                        key={`${item.label}-${index}`}
                                                        className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[9px] font-medium text-slate-400"
                                                        title={item.source}
                                                    >
                                                        {item.label}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                        <div className={cn(
                                            "text-[9px] mt-1.5 font-medium",
                                            msg.role === "user" ? "text-indigo-200/60 text-right" : "text-slate-600"
                                        )}>
                                            {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}

                        {pendingExecution && (
                            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-amber-100">
                                <div className="flex items-start gap-3">
                                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                                    <div className="min-w-0 flex-1">
                                        <p className="text-xs font-bold uppercase tracking-wider">Confirm live execution</p>
                                        <p className="mt-1 text-sm text-amber-100/85">{pendingExecution.summary}</p>
                                        <div className="mt-3 grid gap-2 text-[11px] sm:grid-cols-2">
                                            <div>
                                                <p className="font-bold uppercase tracking-wider text-amber-300/80">Targets</p>
                                                <p className="mt-1 text-amber-100/75">{pendingExecution.targets.join(", ") || "Current context"}</p>
                                            </div>
                                            <div>
                                                <p className="font-bold uppercase tracking-wider text-amber-300/80">Tools</p>
                                                <p className="mt-1 text-amber-100/75">{pendingExecution.likelyTools.join(", ")}</p>
                                            </div>
                                        </div>
                                        <div className="mt-3 flex flex-wrap gap-1.5">
                                            <Badge variant="outline" className="border-amber-400/30 bg-amber-400/10 text-[10px] text-amber-100">
                                                Risk: {pendingExecution.risk}
                                            </Badge>
                                            {pendingExecution.requiresApproval && (
                                                <Badge variant="outline" className="border-red-400/30 bg-red-400/10 text-[10px] text-red-100">
                                                    Approval may be required
                                                </Badge>
                                            )}
                                        </div>
                                        <div className="mt-4 flex gap-2">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-8 text-xs text-amber-100 hover:bg-amber-400/10"
                                                onClick={() => setPendingExecution(null)}
                                            >
                                                Cancel
                                            </Button>
                                            <Button
                                                size="sm"
                                                className="h-8 bg-emerald-600 text-xs hover:bg-emerald-500"
                                                onClick={confirmExecution}
                                            >
                                                <Play className="mr-1.5 h-3.5 w-3.5" />
                                                Confirm and execute
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {isTyping && (
                            <div className="flex justify-start">
                                <div className="bg-slate-800/80 border border-white/10 rounded-xl px-3.5 py-2.5 mr-6 flex items-center gap-2">
                                    <div className="flex gap-1">
                                        <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
                                        <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
                                        <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" />
                                    </div>
                                    <span className="text-slate-500 text-xs">Thinking...</span>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <div className="px-4 py-3 border-t border-white/10 bg-slate-900/60 flex-shrink-0">
                    <div className="flex gap-2 items-end">
                        <Textarea
                            ref={textareaRef}
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder={mode === "execute" ? "Describe the live action to preview..." : `Ask in ${modeMeta.label.toLowerCase()} mode...`}
                            className="flex-1 min-h-[44px] max-h-[140px] resize-none bg-slate-800/60 border-white/10 text-slate-100 placeholder:text-slate-600 focus-visible:ring-indigo-500/50 text-sm rounded-xl"
                            rows={1}
                            disabled={isTyping}
                        />
                        <Button
                            size="icon"
                            onClick={() => sendMessage(input)}
                            disabled={isTyping || !input.trim()}
                            className={cn(
                                "h-11 w-11 shrink-0 rounded-xl disabled:opacity-40",
                                mode === "execute" ? "bg-emerald-600 hover:bg-emerald-500" : "bg-indigo-600 hover:bg-indigo-500"
                            )}
                            title={mode === "execute" ? "Preview live execution" : "Send to copilot"}
                        >
                            <Send className="h-4 w-4" />
                        </Button>
                    </div>
                    <p className="text-[9px] text-slate-600 mt-1.5 text-center">
                        Enter to send. Shift+Enter for a new line. Execute mode previews live actions before they run.
                    </p>
                </div>
            </SheetContent>
        </Sheet>
    );
}
