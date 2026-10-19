import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { InFlightRun } from "@domain/mission/core/in-flight-runs";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@domain-ui/core/ui/components/ui/sheet";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { InstantAppRenderer } from "@domain-ui/core/ui/components/shared/InstantAppRenderer";
import { InstantAppSurface } from "@domain-ui/core/ui/components/shared/InstantAppSurface";
import { apiRequest } from "@/lib/queryClient";
import { normalizeAssistantAppHref } from "@/lib/assistant-app-href";
import {
    AlertTriangle,
    Activity,
    BookOpen,
    Boxes,
    CheckCircle2,
    ClipboardCheck,
    Compass,
    ExternalLink,
    FileSearch,
    GripVertical,
    LayoutTemplate,
    ListChecks,
    Pause,
    Play,
    Send,
    ShieldCheck,
    Sparkles,
    FolderKanban,
    Trash2,
    Wand2,
    X,
    Zap,
    Inbox,
    MessageSquare,
    ChevronRight,
    Paperclip,
    Loader2,
    Maximize2,
    Minimize2,
    ThumbsUp,
    ThumbsDown,
    Users,
} from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from '@domain-ui/auth/ui/modules/auth/hooks/use-auth';
import { conversationStorageKey, generateUUID, useCopilotConversations } from './use-copilot-conversations';
import { useActiveProject } from "@/modules/projects/hooks/use-projects";
import { getEntryForUrl } from '@/lib/spa-utils';
import { actionReceipt, safeReceiptHref } from '@shared/copilot-action-receipt';
import { useOrgContextOptional } from "@domain-ui/core/ui/hooks/use-org-context";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MermaidRenderer } from "../../../../admin/ui/modules/admin/components/MermaidRenderer";
import { cn } from "@/lib/utils";
import { startTutorial } from "@/lib/tutorial-engine";
import { crewHandoffStorageKey, type CopilotCrewHandoff } from "@/lib/copilot-crew-handoff";
import type { FormSchema } from "@domain-ui/core/ui/components/shared/FormRenderer";
import { fractionDigitsFor } from "@domain-ui/core/ui/components/shared/fraction-digits";
import { StudioForm } from "@/modules/forms/StudioForm";
import { AssistantApprovals } from "./AssistantApprovals";
import { AgentInputForm, parseAgentResponse, type InputRequest } from "@domain-ui/ai/ui/modules/agent-ai";
import { useInterventionEngine, type AssistantInboxItem } from "@domain-ui/core/ui/hooks/use-intervention-engine";
import {
    buildCopilotActionPreview,
    COPILOT_MODE_DETAILS,
    COPILOT_MODES,
    normalizeCopilotMode,
    type CopilotActionPreview,
    type CopilotEvidenceItem,
    type CopilotMode,
} from "@domain-ui/ai/core/copilot-contract.js";
import type {
    ChatMode,
    EvidenceItem,
    UploadedAttachment,
    WorkMemoryItem,
    CycleStepTransitionPayload,
    AssistantUpdateItem,
    ExecutionPreview,
    AssistantFormResponse,
    AssistantAppResponse,
    ModeSwitchRequest,
    AssistantInstantAppResponse,
    AssistantInstantAppSurfaceResponse,
    AssistantRichResponse,
    PageAction,
    ModeConfig,
    AgentChatSheetProps,
    CopilotSubPageContext,
    CopilotSelectedUiContext,
    Message,
} from "./copilot-chat-types";
import {
    findBalancedJsonSpans,
    RICH_RESPONSE_TYPES,
    extractJsonPayloadWithSpan,
    extractJsonPayload,
    stripInternalScaffolding,
    stripRichPayloadFromProse,
    parseAssistantRichResponse,
    parseSubmissionEcho,
    humanizeFieldKey,
    formatSubmittedValue,
} from "./copilot-response-parser";
import {
    COPILOT_REQUEST_TIMEOUT_MS,
    getCopilotFailureMessage,
    MODE_CONFIG,
    CAPABILITIES,
    PAGE_ACTIONS,
    SUB_PAGE_ACTIONS,
    PAGE_LABELS,
    SUB_PAGE_LABELS,
    makeWelcome,
    buildIntentWelcomeContent,
    derivePage,
    captureSelectedUiContext,
    deriveSubPageContext,
    deriveCycleId,
    makeCycleTransitionUpdate,
    contextualizeSubPageAction,
    getPageActions,
    getCopilotContextSummary,
    getActionRationale,
    buildEphemeralCopilotContext,
    getEvidenceForPage,
    loadWorkMemory,
    saveWorkMemory,
    formatAssistantInboxAge,
    assistantInboxPriorityClass,
    assistantInboxOutcomeClass,
    makeExecutionPreview,
    deriveCycleIdFromEvidence,
    loadLastCycleContext,
    saveLastCycleContext,
    buildLocalAppLaunchResponse,
    WORK_MEMORY_KEY,
    LAST_CYCLE_CONTEXT_KEY,
} from "./copilot-context-helpers";
import { AssistantAppCard, isInternalAppRoute } from "./AssistantAppCard";
import { SubmittedRichSummary } from "./SubmittedRichSummary";

export {
    buildEphemeralCopilotContext,
    buildIntentWelcomeContent,
    captureSelectedUiContext,
    derivePage,
    deriveSubPageContext,
    getCopilotContextSummary,
    getPageActions,
    parseAssistantRichResponse,
    stripRichPayloadFromProse,
    stripInternalScaffolding,
    parseSubmissionEcho,
    humanizeFieldKey,
    formatSubmittedValue,
    type CopilotSubPageContext,
    type CopilotSelectedUiContext,
};


const MIN_WIDTH = 360;
const MAX_WIDTH = 980;
const DEFAULT_WIDTH = 480;
export function AgentChatSheet(props: AgentChatSheetProps) {
    const { user } = useAuth();
    const org = useOrgContextOptional();
    const { data: activeProjectData } = useActiveProject(org?.selectedOrgId);
    const userId = user?.id != null ? String(user.id) : "anonymous";
    const storageKey = conversationStorageKey(userId, org?.selectedOrgId ?? null, activeProjectData?.project?.key ?? null);
    return <ScopedAgentChatSheet {...props} storageKey={storageKey} activeProjectName={activeProjectData?.project?.name ?? null} />;
}

function ScopedAgentChatSheet({
    open,
    onOpenChange,
    initialPrompt,
    initialContext,
    assistRequestId,
    storageKey,
    activeProjectName,
}: AgentChatSheetProps & { storageKey: string; activeProjectName?: string | null }) {
    const conversation = useCopilotConversations(storageKey);
    const { setMessages, setInput, setMode, setContext: setContextChoice, setSubmitted: setSubmittedRichResponses } = conversation;
    const { messages, input, mode, context: contextChoice, submitted: rawSubmitted, id: sessionId } = conversation.current;
    const submittedRichResponses = rawSubmitted || {};
    useEffect(() => { if (!messages.length) setMessages([makeWelcome()]); }, [sessionId, messages.length, setMessages]);
    const [attachments, setAttachments] = useState<UploadedAttachment[]>([]);
    const [feedbackMap, setFeedbackMap] = useState<Record<string, "up" | "down">>({});
    const { toast } = useToast();

    const handleMessageFeedback = useCallback(async (msgId: string, isPositive: boolean) => {
        const message = messages.find(item => item.id === msgId);
        if (!message?.serverMessageId) return;
        try {
            await apiRequest("POST", `/api/agent/feedback/${message.serverMessageId}`, {
                rating: isPositive ? 1 : -1,
            });
            setFeedbackMap(prev => ({ ...prev, [msgId]: isPositive ? "up" : "down" }));
            toast({
                title: "Feedback saved for this response",
            });
        } catch {
            toast({ title: 'Feedback was not saved', description: 'Please try again.', variant: 'destructive' });
        }
    }, [messages, toast]);
    const [isUploading, setIsUploading] = useState(false);
    const [attachmentError, setAttachmentError] = useState<string | null>(null);
    const selectedUiContext = contextChoice.selectionMode === 'excluded' ? null : contextChoice.selection;
    const setSelectedUiContext = useCallback((selection: CopilotSelectedUiContext | null) => setContextChoice(previous => ({ ...previous, selection })), [setContextChoice]);
    const [isTyping, setIsTyping] = useState(false);
    // Live progress label driven by SSE `status` events during the agent loop
    // (e.g. "Using search_knowledge_graph…"). Falls back to "Thinking…".
    const [typingStatus, setTypingStatus] = useState<string | null>(null);
    const [panelWidth, setPanelWidth] = useState(DEFAULT_WIDTH);
    const [isHalfScreen, setIsHalfScreen] = useState(false);
    const [view, setView] = useState<"chat" | "updates" | "approvals" | "missions">("chat");
    const [steerInput, setSteerInput] = useState("");
    const {
        active,
        queueLength,
        assistantInbox,
        acceptInboxItem,
        clearAssistantInbox,
        accept,
    } = useInterventionEngine();
    const [updatesFilter, setUpdatesFilter] = useState<"all" | "decisions" | "cycles" | "suggestions" | "system">("all");

    // When an approval carries out a resumed Copilot action (see
    // approval.service.resumeApprovedAssistantAction), surface the resumed
    // agent's outcome live in the chat thread instead of only on the next reload.
    const handleResumedOutcome = useCallback((payload: { outcome: string; tool?: string }) => {
        if (!payload?.outcome) return;
        setMessages(prev => [...prev, {
            id: generateUUID(),
            role: "agent",
            content: payload.outcome,
            timestamp: Date.now(),
            mode: "execute",
        }]);
        setView("chat");
    }, []);

    // activeProjectName is provided by AgentChatSheet via useActiveProject.

    const { data: pendingApprovalsData } = useQuery<any[]>({ queryKey: ["/api/approvals"] });
    const { data: pendingRescueData } = useQuery<any[]>({ queryKey: ["/api/rescue/sessions"] });
    const pendingRescueCount = Array.isArray(pendingRescueData)
        ? pendingRescueData.filter(r => r.status === "REQUESTED" && r.recoveryOptions?.length > 0).length
        : 0;
    const pendingApprovalsCount = Array.isArray(pendingApprovalsData) ? pendingApprovalsData.length : 0;
    const pendingCount = pendingApprovalsCount + pendingRescueCount;

    const orgCtx = useOrgContextOptional();
    const activeOrgId = orgCtx?.selectedOrgId ?? null;
    const { data: missionsData, refetch: refetchMissions, isPending: missionsPending, isError: missionsError } = useQuery<InFlightRun[]>({
        queryKey: [`/api/mission-runs/in-flight?orgId=${activeOrgId}`],
        enabled: open && activeOrgId != null,
        refetchInterval: view === "missions" ? 5000 : 15000,
    });
    const activeMissions = useMemo(() => {
        if (!Array.isArray(missionsData)) return [];
        return missionsData;
    }, [missionsData]);
    const activeMissionsCount = activeMissions.filter(m => m.status === "active" && !m.stale).length;

    const handlePauseMission = async (missionId: number) => {
        try {
            await apiRequest("POST", `/api/mission-runs/${missionId}/pause?orgId=${activeOrgId}`);
            toast({ title: "Mission Paused", description: `Mission #${missionId} paused at checkpoint.` });
            refetchMissions();
        } catch (err: any) {
            toast({ title: "Pause Failed", description: err.message || "Failed to pause mission", variant: "destructive" });
        }
    };

    const handleTerminateRun = async (runId: number) => {
        try {
            await apiRequest("POST", `/api/mission-runs/${runId}/terminate?orgId=${activeOrgId}`);
            toast({ title: "Mission run stopped" });
            refetchMissions();
        } catch (err: any) {
            toast({ title: "Stop Failed", description: err.message, variant: "destructive" });
        }
    };

    const handleResumeMission = async (missionId: number) => {
        try {
            await apiRequest("POST", `/api/mission-runs/${missionId}/resume?orgId=${activeOrgId}`);
            toast({ title: "Mission Resumed", description: `Mission #${missionId} resumed execution.` });
            refetchMissions();
        } catch (err: any) {
            toast({ title: "Resume Failed", description: err.message || "Failed to resume mission", variant: "destructive" });
        }
    };

    const handleSendMissionSteer = async (missionId: number) => {
        if (!steerInput.trim()) return;
        const text = steerInput.trim();
        setSteerInput("");
        try {
            await apiRequest("POST", `/api/missions/${missionId}/chat?orgId=${activeOrgId}`, { message: `[MID-FLIGHT STEER] ${text}` });
            toast({ title: "Steering Directive Sent", description: `Directive dispatched to Mission #${missionId}.` });
            refetchMissions();
        } catch (err: any) {
            toast({ title: "Steering Failed", description: err.message || "Failed to deliver directive", variant: "destructive" });
        }
    };
    const [showCapabilities, setShowCapabilities] = useState(false);
    const [pendingExecution, setPendingExecution] = useState<ExecutionPreview | null>(null);
    const [workMemory, setWorkMemory] = useState<WorkMemoryItem[]>([]);
    const [cycleUpdates, setCycleUpdates] = useState<AssistantUpdateItem[]>([]);
    const scrollRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const didAutoSend = useRef(false);
    const lastAutoSentRequestId = useRef<number | undefined>(undefined);
    const isDragging = useRef(false);
    const dragStartX = useRef(0);
    const dragStartWidth = useRef(DEFAULT_WIDTH);
    const [browserLocation, setLocation] = useLocation();
    const location = contextChoice.pageMode === 'excluded' ? '' : contextChoice.pageMode === 'pinned' ? contextChoice.pinnedUrl ?? browserLocation : browserLocation;

    const uploadAttachments = useCallback(async (files: FileList | null) => {
        if (!files?.length) return;
        const remaining = Math.max(0, 5 - attachments.length);
        const selected = Array.from(files).slice(0, remaining);
        if (selected.length === 0) {
            setAttachmentError("Copilot accepts up to 5 attachments per message.");
            return;
        }
        const oversized = selected.find(file => file.size > 10 * 1024 * 1024);
        if (oversized) {
            setAttachmentError(`${oversized.name} exceeds the 10 MB attachment limit.`);
            return;
        }

        setIsUploading(true);
        setAttachmentError(null);
        try {
            const body = new FormData();
            selected.forEach(file => body.append("files", file));
            const uploadUrl = activeOrgId != null
                ? `/api/agent/upload?orgId=${activeOrgId}`
                : "/api/agent/upload";
            const response = await fetch(uploadUrl, {
                method: "POST",
                credentials: "include",
                body,
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(result?.error || result?.message || `Upload failed (HTTP ${response.status})`);
            }
            const uploaded = Array.isArray(result?.files) ? result.files : [];
            setAttachments(previous => [...previous, ...uploaded].slice(0, 5));
        } catch (error: any) {
            setAttachmentError(error?.message || "Attachment upload failed.");
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    }, [activeOrgId, attachments.length]);

    const page = useMemo(() => derivePage(location), [location]);
    const subPage = useMemo(() => deriveSubPageContext(location), [location]);
    const activeCycleId = useMemo(() => deriveCycleId(location), [location]);
    const pageActions = useMemo(() => getPageActions(page, subPage), [page, subPage]);
    const pageEvidence = useMemo(() => location ? getEvidenceForPage(page, location) : [], [page, location]);
    const contextSummary = useMemo(
        () => getCopilotContextSummary(page, location, mode, activeOrgId, subPage, selectedUiContext),
        [activeOrgId, location, mode, page, selectedUiContext, subPage],
    );
    const ephemeralContext = useMemo(
        () => buildEphemeralCopilotContext(active, assistantInbox, cycleUpdates),
        [active, assistantInbox, cycleUpdates],
    );
    const modeMeta = MODE_CONFIG[mode];
    const moveDiscussionToCrew = useCallback(() => {
        const firstUserMessage = messages.findIndex(message => message.role === "user");
        if (firstUserMessage < 0) {
            toast({
                title: "Nothing to move yet",
                description: "Start a Copilot discussion before moving it to CREW Chat.",
                variant: "destructive",
            });
            return;
        }

        const roomKey = `copilot-${new Date().toISOString().replace(/[:.]/g, "-")}`;
        const handoff: CopilotCrewHandoff = {
            source: "copilot",
            createdAt: Date.now(),
            projectName: activeProjectName,
            page,
            mode,
            messages: messages.slice(firstUserMessage).map(message => ({
                role: message.role,
                content: message.content,
            })),
        };
        sessionStorage.setItem(crewHandoffStorageKey(roomKey), JSON.stringify(handoff));
        onOpenChange(false);
        const destination = `/workspace/chat/${encodeURIComponent(roomKey)}`;
        if (getEntryForUrl(browserLocation) !== getEntryForUrl(destination)) window.location.assign(destination);
        else setLocation(destination);
    }, [activeProjectName, browserLocation, messages, mode, onOpenChange, page, setLocation, toast]);
    const announcedCycleTransitions = useRef<Set<string>>(new Set());
    const filteredAssistantInbox = useMemo(() => {
        if (updatesFilter !== "all" && updatesFilter !== "suggestions") return [];
        return assistantInbox;
    }, [assistantInbox, updatesFilter]);
    const unreadAssistantInboxCount = assistantInbox.filter(item => item.outcome === "unread").length;
    const updatesCount = pendingCount + unreadAssistantInboxCount + cycleUpdates.length;

    useEffect(() => {
        if (!open || contextChoice.selectionMode !== 'follow' || typeof document === "undefined") return;
        const refreshSelectedContext = () => {
            const next = captureSelectedUiContext();
            if (next) setSelectedUiContext(next);
        };
        refreshSelectedContext();
        document.addEventListener("focusin", refreshSelectedContext);
        document.addEventListener("selectionchange", refreshSelectedContext);
        return () => {
            document.removeEventListener("focusin", refreshSelectedContext);
            document.removeEventListener("selectionchange", refreshSelectedContext);
        };
    }, [open, contextChoice.selectionMode, setSelectedUiContext]);

    useEffect(() => {
        if (contextChoice.selectionMode === 'follow') setSelectedUiContext(null);
    }, [browserLocation, contextChoice.selectionMode, setSelectedUiContext]);

    useEffect(() => {
        if (!open) return;
        setMessages(previous => {
            if (previous.length !== 1 || previous[0]?.id !== "welcome") return previous;
            const content = buildIntentWelcomeContent(page, pageActions, active, subPage.label);
            if (previous[0].content === content) return previous;
            return [{ ...previous[0], content, timestamp: Date.now() }];
        });
    }, [active, open, page, pageActions, subPage.label]);

    useEffect(() => {
        if (activeCycleId) {
            saveLastCycleContext(activeCycleId, location);
        }
    }, [activeCycleId, location]);

    useEffect(() => {
        if (!open) return;
        if (initialContext?.assistantView === "approvals") {
            setView("approvals");
        } else if (initialContext?.assistantView === "updates" || initialContext?.assistantView === "inbox") {
            setView("updates");
        } else if (initialContext?.assistantView === "missions") {
            setView("missions");
        } else if (initialContext?.assistantView === "chat") {
            setView("chat");
        }
    }, [open, initialContext?.assistantView]);

    useEffect(() => {
        if (!activeCycleId) {
            announcedCycleTransitions.current.clear();
            return;
        }

        const eventSource = new EventSource(`/api/cycles/${activeCycleId}/events`, { withCredentials: true });
        const transitionTypes = ["cycle.step_started", "cycle.step_completed", "cycle.step_failed"] as const;

        const handleTransition = (event: MessageEvent<string>) => {
            try {
                const payload = JSON.parse(event.data) as CycleStepTransitionPayload;
                const transitionKey = [
                    event.type,
                    payload.cycleId,
                    payload.stepId ?? payload.stepCode ?? payload.stepOrder ?? "step",
                    payload.status ?? "",
                    payload.error ?? "",
                    Math.round(payload.durationMs ?? 0),
                ].join(":");

                if (announcedCycleTransitions.current.has(transitionKey)) return;
                announcedCycleTransitions.current.add(transitionKey);
                if (announcedCycleTransitions.current.size > 100) {
                    announcedCycleTransitions.current = new Set(Array.from(announcedCycleTransitions.current).slice(-80));
                }

                const update = makeCycleTransitionUpdate(event.type, payload, activeCycleId, location);
                setCycleUpdates(prev => [update, ...prev].slice(0, 20));
            } catch (err) {
                console.warn("[AgentChatSheet] Failed to parse cycle transition event", err);
            }
        };

        transitionTypes.forEach(type => eventSource.addEventListener(type, handleTransition));

        return () => {
            transitionTypes.forEach(type => eventSource.removeEventListener(type, handleTransition));
            eventSource.close();
        };
    }, [activeCycleId, location]);

    const updateWorkMemory = useCallback((item: WorkMemoryItem) => {
        setWorkMemory(prev => {
            const next = [item, ...prev.filter(existing => existing.id !== item.id)].slice(0, 8);
            return next;
        });
    }, []);

    const onHandleMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        isDragging.current = true;
        dragStartX.current = e.clientX;
        dragStartWidth.current = isHalfScreen ? window.innerWidth / 2 : panelWidth;
        setIsHalfScreen(false);
        document.body.style.cursor = "ew-resize";
        document.body.style.userSelect = "none";
    }, [isHalfScreen, panelWidth]);

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
        const attachmentsToSend = [...attachments];
        const textToSend = text.trim() || (attachmentsToSend.length > 0 ? "Please analyze the attached files." : "");
        if (!textToSend || isTyping) return;

        const contextCycleId =
            activeCycleId
            ?? deriveCycleIdFromEvidence(pageEvidence)
            ?? null;

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
            id: generateUUID(),
            role: "user",
            content: textToSend,
            timestamp: Date.now(),
            mode: effectiveMode,
            attachments: attachmentsToSend,
        };

        setPendingExecution(null);
        setMessages(prev => [...prev, userMsg]);
        setInput("");
        setAttachments([]);
        setAttachmentError(null);
        setIsTyping(true);

        const agentMsgId = generateUUID();
        const agentMsgTimestamp = Date.now();
        let completedReceipt: Message['receipt'];
        const localAppLaunch = attachmentsToSend.length === 0
            ? buildLocalAppLaunchResponse(textToSend, location, contextCycleId)
            : null;

        if (localAppLaunch) {
            setMessages(prev => [...prev, {
                id: agentMsgId,
                role: "agent",
                content: JSON.stringify(localAppLaunch),
                timestamp: agentMsgTimestamp,
                mode: effectiveMode,
                evidence: pageEvidence,
            }]);
            setIsTyping(false);
            return;
        }

        try {
            const abortController = new AbortController();
            const timeoutId = window.setTimeout(() => abortController.abort(), COPILOT_REQUEST_TIMEOUT_MS);
            const conversationHistory = messages
                .filter(m => m.role !== "agent" || m.id !== "welcome")
                .slice(-10)
                .map(m => ({ role: m.role === "agent" ? "assistant" : "user", content: m.content }));

            // Scope the copilot to the org the user is actively viewing. The backend
            // honors ?orgId for super-admins; without it the copilot falls
            // back to the user's defaultOrgId (e.g. org 1) and answers about the
            // wrong tenant.
            const chatUrl = activeOrgId != null
                ? `/api/agent/chat?orgId=${activeOrgId}`
                : "/api/agent/chat";

            const requestInit: RequestInit = {
                method: "POST",
                // Ask for SSE; the server streams when it can and falls back to JSON otherwise.
                headers: { "Content-Type": "application/json", "Accept": "text/event-stream" },
                credentials: "include",
                signal: abortController.signal,
                body: JSON.stringify({
                    message: textToSend,
                    attachments: attachmentsToSend,
                    context: {
                        ...(contextChoice.pageMode === 'follow' ? initialContext : {}),
                        page,
                        subPage,
                        selectedUiContext,
                        selectedText: selectedUiContext?.selectedText,
                        ui_context: selectedUiContext ? {
                            element_label: selectedUiContext.elementLabel,
                            element_role: selectedUiContext.elementRole,
                            entity_type: selectedUiContext.entityType,
                            entity_id: selectedUiContext.entityId,
                            selected_text: selectedUiContext.selectedText,
                        } : undefined,
                        currentUrl: location,
                        screenContext: {
                            ...(contextChoice.pageMode === 'follow' ? initialContext?.screenContext || {} : {}),
                            page,
                            subPage,
                            currentRoute: location,
                        },
                        mode: effectiveMode,
                        audience: "business",
                        sessionId,
                        history: conversationHistory,
                        confirmedExecution: options?.confirmedExecution === true,
                        provenanceHint: pageEvidence,
                        ephemeralContext,
                    },
                }),
            };

            let res: Response;
            try {
                res = await fetch(chatUrl, requestInit);
            } finally {
                // Headers have arrived — stop the connect-timeout so a long stream isn't aborted mid-answer.
                window.clearTimeout(timeoutId);
            }

            if (!res.ok) {
                let errorMessage = `HTTP ${res.status}`;
                try {
                    const errorData = await res.json();
                    errorMessage = errorData.error || errorData.message || errorMessage;
                } catch {
                    // Keep the HTTP status fallback when the response is not JSON.
                }
                throw new Error(errorMessage);
            }

            // Normalise a raw response value into a render-safe string.
            const toRenderableResponse = (raw: any, isRich: boolean): string =>
                isRich && typeof raw === "string"
                    ? raw
                    : (typeof raw === "string" ? raw : JSON.stringify(raw));

            // Append (or replace) the agent bubble for this turn. Idempotent on agentMsgId
            // so a `final` followed by a `meta` update doesn't duplicate the message.
            const upsertAgentMessage = (patch: Partial<Message>) => {
                setMessages(prev => {
                    const idx = prev.findIndex(m => m.id === agentMsgId);
                    if (idx === -1) {
                        return [...prev, {
                            id: agentMsgId,
                            role: "agent",
                            content: "",
                            timestamp: agentMsgTimestamp,
                            mode: effectiveMode,
                            evidence: pageEvidence,
                            ...patch,
                        } as Message];
                    }
                    const next = [...prev];
                    next[idx] = { ...next[idx], ...patch };
                    return next;
                });
            };

            const contentType = res.headers.get("content-type") || "";
            if (contentType.includes("text/event-stream") && res.body) {
                // ── SSE path ──────────────────────────────────────────────────
                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let buffer = "";
                let renderedFinal = false;
                let streamError: string | null = null;
                let streamedContent = ""; // accumulates `token` deltas for live rendering

                const handleEvent = (eventName: string, dataStr: string) => {
                    let payload: any = {};
                    try { payload = dataStr ? JSON.parse(dataStr) : {}; } catch { return; }
                    if (eventName === "status") {
                        if (typeof payload.label === "string") setTypingStatus(payload.label);
                    } else if (eventName === "token") {
                        // Real token stream (e.g. conversational fast-path): append and render live.
                        if (typeof payload.delta === "string" && payload.delta.length > 0) {
                            streamedContent += payload.delta;
                            setTypingStatus(null);
                            upsertAgentMessage({ content: streamedContent });
                        }
                    } else if (eventName === "final") {
                        if (payload.error && !payload.response) { streamError = payload.error; return; }
                        const isRich = payload._richResponse === true || (
                            typeof payload.response === "string" && (
                                payload.response.includes('"type":"assistant_app"') ||
                                payload.response.includes('"type":"assistant_form"') ||
                                payload.response.includes('"type":"instant_app"') ||
                                payload.response.includes('"type":"instant_app_surface"') ||
                                payload.response.includes('"type":"input_request"') ||
                                payload.response.includes('"type":"mode_switch_request"') ||
                                payload.response.includes('"type":"intent_clarification"')
                            )
                        );
                        const evidence = Array.isArray(payload.metadata?.evidence) && payload.metadata.evidence.length > 0
                            ? payload.metadata.evidence
                            : pageEvidence;
                        upsertAgentMessage({
                            content: toRenderableResponse(payload.response ?? "No response received.", isRich),
                            evidence,
                            receipt: effectiveMode === 'execute' ? (completedReceipt = actionReceipt(payload.metadata?.toolReceipts ?? [], Boolean(payload.error))) : undefined,
                        });
                        renderedFinal = true;
                        setTypingStatus(null);
                    } else if (eventName === "meta") {
                        if (typeof payload.messageId === "number") upsertAgentMessage({ serverMessageId: payload.messageId });
                    }
                };

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });
                    // SSE frames are separated by a blank line.
                    let sep: number;
                    while ((sep = buffer.indexOf("\n\n")) !== -1) {
                        const frame = buffer.slice(0, sep);
                        buffer = buffer.slice(sep + 2);
                        if (frame.startsWith(":")) continue; // keepalive comment
                        let eventName = "message";
                        const dataLines: string[] = [];
                        for (const line of frame.split("\n")) {
                            if (line.startsWith("event:")) eventName = line.slice(6).trim();
                            else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
                        }
                        handleEvent(eventName, dataLines.join("\n"));
                    }
                }

                if (streamError && !renderedFinal) throw new Error(streamError);
                if (!renderedFinal) throw new Error('The response ended before completion could be confirmed.');
            } else {
                // ── JSON fallback (embed/legacy servers, or negotiation declined) ──
                const data = await res.json();
                if (data?.error && !data?.response) {
                    throw new Error(data.error);
                }
                const rawResponse = data.response || data.reply || data.message || "No response received.";
                const response = toRenderableResponse(rawResponse, data._richResponse === true);
                const metadata = data.metadata || {};
                const evidence = Array.isArray(metadata.evidence) && metadata.evidence.length > 0
                    ? metadata.evidence
                    : pageEvidence;
                upsertAgentMessage({
                    content: response,
                    evidence,
                    receipt: effectiveMode === 'execute' ? (completedReceipt = actionReceipt(metadata.toolReceipts ?? [], Boolean(data.error))) : undefined,
                    ...(typeof data.messageId === "number" ? { serverMessageId: data.messageId } : {}),
                });
            }

            if (effectiveMode === "execute" && completedReceipt?.status === 'completed') {
                updateWorkMemory({
                    id: generateUUID(),
                    title: textToSend.slice(0, 90),
                    status: "executed",
                    mode: "execute",
                    createdAt: Date.now(),
                });
            } else if (effectiveMode === "plan") {
                updateWorkMemory({
                    id: generateUUID(),
                    title: textToSend.slice(0, 90),
                    status: "planned",
                    mode: "plan",
                    createdAt: Date.now(),
                });
            }
        } catch (err: any) {
            const fallbackAppLaunch = attachmentsToSend.length === 0
                ? buildLocalAppLaunchResponse(textToSend, location, contextCycleId)
                : null;
            if (fallbackAppLaunch) {
                setMessages(prev => [...prev, {
                    id: agentMsgId,
                    role: "agent",
                    content: JSON.stringify(fallbackAppLaunch),
                    timestamp: agentMsgTimestamp,
                    mode: effectiveMode,
                    evidence: pageEvidence,
                }]);
                return;
            }

            setMessages(prev => [...prev.filter(message => message.id !== agentMsgId), {
                id: agentMsgId,
                role: "agent",
                content: getCopilotFailureMessage(err),
                receipt: effectiveMode === 'execute' ? actionReceipt([], true) : undefined,
                timestamp: agentMsgTimestamp,
                mode: effectiveMode,
                evidence: pageEvidence,
            }]);
        } finally {
            setIsTyping(false);
            setTypingStatus(null);
        }
    }, [attachments, isTyping, location, mode, page, subPage, selectedUiContext, pageEvidence, ephemeralContext, sessionId, initialContext, messages, updateWorkMemory, activeOrgId, activeCycleId, contextChoice.pageMode]);

    useEffect(() => {
        const isNewAssistRequest = assistRequestId !== undefined && assistRequestId !== lastAutoSentRequestId.current;
        if (open && initialPrompt && (!didAutoSend.current || isNewAssistRequest)) {
            didAutoSend.current = true;
            lastAutoSentRequestId.current = assistRequestId;
            const requestedMode = normalizeCopilotMode(initialContext?.mode);
            setMode(requestedMode);
            sendMessage(initialPrompt, { overrideMode: requestedMode });
        }
        if (!open) {
            didAutoSend.current = false;
        }
    }, [open, initialPrompt, initialContext, assistRequestId, sendMessage]);

    // Deterministic daily brief: routes to backend agentService fast-path via
    // sendMessage, which fetches real platform data in ~130ms, persists history,
    // and streams response cleanly.
    const runDailyBrief = useCallback(() => {
        if (isTyping) return;
        sendMessage("Daily brief");
    }, [isTyping, sendMessage]);

    const handleAction = (action: PageAction) => {
        setMode(action.mode);
        if (action.action === "daily_brief") {
            runDailyBrief();
            return;
        }
        if (action.action === "tutorial" || action.tutorialId) {
            if (action.tutorialId) {
                startTutorial(action.tutorialId);
                toast({
                    title: `Starting ${action.label}`,
                    description: "Interactive S.C.O.R.E. tutorial mounted.",
                });
            }
            return;
        }
        sendMessage(action.prompt, { overrideMode: action.mode });
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendMessage(input);
        }
    };

    const clearChat = () => {
        conversation.deleteConversation();
        setPendingExecution(null);
        setAttachments([]);
        setWorkMemory([]);
    };

    const clearWorkMemory = () => {
        setWorkMemory([]);
    };

    const resumeWorkItem = (item: WorkMemoryItem) => {
        sendMessage(item.title, { overrideMode: item.mode as any });
    };

    const removeWorkItem = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setWorkMemory(prev => {
            const next = prev.filter(item => item.id !== id);
            return next;
        });
    };

    const confirmExecution = () => {
        if (!pendingExecution) return;
        sendMessage(pendingExecution.prompt, { confirmedExecution: true, overrideMode: "execute" });
    };

    // The agent asked (via `request_execute_mode`) to move from a read-only mode
    // into Execute to carry out a write. Switch the sheet to Execute mode and
    // re-run the request that triggered it — this goes through the normal Execute
    // preview/confirm gate, so the user still approves before anything runs.
    const switchToExecuteAndRun = (agentMsg: Message, fallbackReason?: string) => {
        const idx = messages.findIndex(m => m.id === agentMsg.id);
        let prompt = "";
        for (let i = idx - 1; i >= 0; i--) {
            if (messages[i].role === "user") { prompt = messages[i].content; break; }
        }
        setMode("execute");
        sendMessage(prompt || fallbackReason || "Carry out the action we just discussed.", { overrideMode: "execute" });
    };

    const renderUpdatesView = () => (
        <div className="flex-1 overflow-y-auto px-4 py-4">
            <div className="mb-4 rounded-xl border border-foreground/10 bg-card/60 p-3">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <p className="text-xs font-bold text-foreground">Assistant Updates</p>
                        <p className="mt-1 text-xs text-muted-foreground">Persistent decisions, cycle changes, suggestions, and system attention items.</p>
                    </div>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-xs text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                        onClick={clearAssistantInbox}
                        disabled={assistantInbox.length === 0}
                    >
                        <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                        Clear
                    </Button>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                    <div className="rounded-lg border border-foreground/10 bg-background/20 p-3">
                        <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Needs review</p>
                        <p className="mt-1 text-xl font-black text-foreground">{pendingCount + unreadAssistantInboxCount}</p>
                    </div>
                    <div className="rounded-lg border border-foreground/10 bg-background/20 p-3">
                        <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Live queue</p>
                        <p className="mt-1 text-xl font-black text-foreground">{queueLength}</p>
                    </div>
                </div>
                {active && (
                    <div className="mt-3 rounded-lg border border-indigo-500/20 bg-indigo-500/10 p-3">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <Badge variant="outline" className={cn("mb-2 text-[9px] uppercase", assistantInboxPriorityClass(active.priority))}>{active.priority}</Badge>
                                <p className="truncate text-xs font-bold text-foreground">{active.title}</p>
                                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{active.description}</p>
                            </div>
                            <Button size="sm" className="h-8 shrink-0 bg-indigo-600 text-xs hover:bg-indigo-500" onClick={accept}>
                                Open
                            </Button>
                        </div>
                    </div>
                )}
            </div>

            <div className="mb-3 flex rounded-lg border border-foreground/10 bg-card/70 p-1 text-[10px] font-bold uppercase tracking-wider">
                {(["all", "decisions", "cycles", "suggestions", "system"] as const).map(filter => (
                    <button
                        key={filter}
                        onClick={() => setUpdatesFilter(filter)}
                        className={cn("flex-1 rounded-md px-2 py-1.5 transition-colors", updatesFilter === filter ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:text-foreground")}
                    >
                        {filter}
                    </button>
                ))}
            </div>

            {(updatesFilter === "all" || updatesFilter === "decisions") && pendingCount > 0 && (
                <button
                    onClick={() => setView("approvals")}
                    className="mb-3 flex w-full items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-3 text-left transition-colors hover:bg-amber-400/15"
                >
                    <ClipboardCheck className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
                    <span className="min-w-0 flex-1">
                        <span className="block text-sm font-bold text-amber-100">{pendingCount} pending {pendingCount === 1 ? "decision" : "decisions"}</span>
                        <span className="block text-xs text-amber-700 dark:text-amber-200/70">Review approvals inline in Assistant.</span>
                    </span>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">Review</span>
                </button>
            )}

            {(updatesFilter === "all" || updatesFilter === "cycles") && cycleUpdates.length > 0 && (
                <div className="mb-3 space-y-2">
                    {cycleUpdates.map(update => (
                        <div key={update.id} className={cn(
                            "rounded-xl border p-3",
                            update.tone === "danger" ? "border-rose-500/25 bg-rose-500/10" :
                            update.tone === "success" ? "border-emerald-500/25 bg-emerald-500/10" :
                            "border-foreground/10 bg-card/60"
                        )}>
                            <div className="flex items-start gap-2">
                                <Activity className="mt-0.5 h-4 w-4 shrink-0 text-indigo-700 dark:text-indigo-300" />
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-bold text-foreground">{update.title}</p>
                                    {update.description && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{update.description}</p>}
                                    <p className="mt-2 text-[10px] text-muted-foreground">{formatAssistantInboxAge(update.timestamp)}</p>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {filteredAssistantInbox.length === 0 && !(updatesFilter === "all" && (pendingCount > 0 || cycleUpdates.length > 0)) && !(updatesFilter === "decisions" && pendingCount > 0) && !(updatesFilter === "cycles" && cycleUpdates.length > 0) ? (
                <div className="flex min-h-56 flex-col items-center justify-center rounded-xl border border-dashed border-foreground/10 bg-card/40 p-8 text-center">
                    <Wand2 className="mb-3 h-10 w-10 text-muted-foreground" />
                    <p className="text-sm font-bold text-foreground">No updates here</p>
                    <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                        Decisions, cycle changes, suggestions, and system notices appear here when they need review.
                    </p>
                </div>
            ) : filteredAssistantInbox.length > 0 ? (
                <div className="space-y-3">
                    {filteredAssistantInbox.map(item => (
                        <div key={item.id} className="rounded-xl border border-foreground/10 bg-card/60 p-3">
                            <div className="flex flex-wrap items-center gap-1.5">
                                <Badge variant="outline" className={cn("text-[9px] uppercase", assistantInboxPriorityClass(item.priority))}>{item.priority}</Badge>
                                <Badge variant="outline" className={cn("text-[9px] uppercase", assistantInboxOutcomeClass(item.outcome))}>{item.outcome}</Badge>
                                <span className="ml-auto text-[10px] text-muted-foreground">{formatAssistantInboxAge(item.updatedAt || item.receivedAt)}</span>
                            </div>
                            <p className="mt-2 text-sm font-bold text-foreground">{item.title}</p>
                            <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground">{item.description}</p>
                            {item.rationale && <p className="mt-2 rounded-lg border border-foreground/10 bg-background/20 p-2 text-xs text-foreground">{item.rationale}</p>}
                            <Button
                                size="sm"
                                className="mt-3 h-8 bg-indigo-600 text-xs text-foreground hover:bg-indigo-500"
                                onClick={() => {
                                    acceptInboxItem(item);
                                    if (item.context?.deliberationRoom) {
                                        onOpenChange(false);
                                    } else {
                                        setView("chat");
                                    }
                                }}
                            >
                                <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
                                Open in chat
                            </Button>
                        </div>
                    ))}
                </div>
            ) : null}
        </div>
    );

    const renderMissionsStreamView = () => (
        <div className="flex-1 overflow-y-auto px-3 py-3 sm:px-4 sm:py-4">
            <div className="mb-4 flex items-center justify-between">
                <div>
                    <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                        <Compass className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                        Live Mission Flight Deck
                    </h3>
                    <p className="text-xs text-muted-foreground">Real-time telemetry, spend caps, and mid-flight steering</p>
                </div>
                {activeMissionsCount > 0 && (
                    <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-[10px]">
                        <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        {activeMissionsCount} Active
                    </Badge>
                )}
            </div>

            {activeOrgId == null ? (
                <p className="text-sm text-muted-foreground">Select an organization to view mission runs.</p>
            ) : missionsError ? (
                <p role="alert" className="text-sm text-destructive">Unable to load mission runs. Try again shortly.</p>
            ) : missionsPending && activeOrgId != null ? (
                <p className="text-sm text-muted-foreground">Loading mission runs...</p>
            ) : activeMissions.length === 0 ? (
                <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-foreground/10 bg-card/40 p-8 text-center">
                    <Compass className="mb-3 h-10 w-10 text-muted-foreground/60" />
                    <p className="text-sm font-bold text-foreground">All Flight Paths Clear</p>
                    <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                        No autonomous missions are currently executing. Trigger a mission from the Mission Hub or chat with Copilot to launch one.
                    </p>
                    <Button
                        size="sm"
                        variant="outline"
                        className="mt-4 text-xs"
                        onClick={() => {
                            onOpenChange(false);
                            setLocation("/operations/missions");
                        }}
                    >
                        Browse Mission Hub
                    </Button>
                </div>
            ) : (
                <div className="space-y-4">
                    {activeMissions.map((mission) => {
                        const spend = mission.costUsd;
                        const softCap = mission.budgetLimitUsd;
                        const spendPct = spend != null && softCap != null && softCap > 0
                            ? Math.max(0, Math.min(100, Math.round((spend / softCap) * 100))) : null;
                        const isPaused = mission.status === "paused";
                        const isWaiting = mission.status === "waiting_on_human" || mission.status === "waiting_on_file";

                        return (
                            <div key={mission.runId} className="rounded-2xl border border-foreground/10 bg-card/80 p-4 shadow-sm backdrop-blur-sm">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-bold text-foreground truncate">{mission.name || `Run #${mission.runId}`}</span>
                                            <Badge variant="outline" className={cn(
                                                "text-[9px] uppercase",
                                                (isPaused || isWaiting || mission.stale) ? "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400" :
                                                "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                                            )}>
                                                {mission.stale ? "Stale" : isPaused ? "Paused" : mission.status === "waiting_on_human" ? "Awaiting approval" : mission.status === "waiting_on_file" ? "Awaiting file" : "In Flight"}
                                            </Badge>
                                        </div>
                                        <p className="mt-1 text-xs text-muted-foreground">Run #{mission.runId} · Last activity {new Date(mission.lastActivityAt).toLocaleString()}</p>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                        {mission.stale ? (
                                            <Button size="sm" variant="outline" onClick={() => handleTerminateRun(mission.runId)}>Stop stale run</Button>
                                        ) : isPaused ? (
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="h-7 px-2 text-xs text-emerald-700 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
                                                onClick={() => handleResumeMission(mission.runId)}
                                            >
                                                <Play className="h-3 w-3 mr-1" /> Resume
                                            </Button>
                                        ) : !isWaiting ? (
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="h-7 px-2 text-xs text-amber-600 dark:text-amber-400 border-amber-500/30 hover:bg-amber-500/10"
                                                onClick={() => handlePauseMission(mission.runId)}
                                            >
                                                <Pause className="h-3 w-3 mr-1" /> Pause
                                            </Button>
                                        ) : null}
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                                            title="Open full mission"
                                            onClick={() => {
                                                onOpenChange(false);
                                                setLocation(`/operations/missions${mission.missionId != null ? `/${mission.missionId}` : ""}`);
                                            }}
                                        >
                                            <ExternalLink className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>
                                </div>

                                {/* Budget Cap Gauge */}
                                <div className="mt-3 rounded-xl border border-foreground/5 bg-background/50 p-2.5">
                                    <div className="flex items-center justify-between text-[10px]">
                                        <span className="font-semibold text-muted-foreground">Recorded spend / budget</span>
                                        <span className="font-mono font-bold text-foreground">
                                            {spend != null ? `$${spend.toFixed(2)}` : "Not recorded"} / {softCap != null ? `$${softCap.toFixed(2)}` : "No budget set"}{spendPct != null ? ` (${spendPct}%)` : ""}
                                        </span>
                                    </div>
                                    {spendPct != null && <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
                                        <div
                                            className={cn(
                                                "h-full rounded-full transition-all duration-500",
                                                spendPct > 80 ? "bg-rose-500" : spendPct > 50 ? "bg-amber-500" : "bg-emerald-400"
                                            )}
                                            style={{ width: `${spendPct}%` }}
                                        />
                                    </div>}
                                </div>

                                {/* Thought Stream */}
                                <div className="mt-3 rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-2.5">
                                    <div className="flex items-center gap-1.5 text-[10px] font-semibold text-indigo-700 dark:text-indigo-300">
                                        <Sparkles className="h-3 w-3" />
                                        <span>Last recorded event</span>
                                    </div>
                                    <p className="mt-1 font-mono text-[11px] leading-relaxed text-indigo-900 dark:text-indigo-200/90">
                                        {mission.lastEvent || "No execution event recorded"}
                                        {mission.stale && " · No recent activity; this run may have lost its worker."}
                                    </p>
                                </div>

                                {/* Steering updates the parent definition; run actions use runId. */}
                                {mission.missionId != null && !mission.stale && <div className="mt-3">
                                    <div className="flex gap-1.5">
                                        <input
                                            type="text"
                                            placeholder="Steer agent (e.g. 'prioritize zone 4', 'skip external sync')..."
                                            value={steerInput}
                                            onChange={e => setSteerInput(e.target.value)}
                                            onKeyDown={e => {
                                                if (e.key === "Enter") {
                                                    e.preventDefault();
                                                    handleSendMissionSteer(mission.missionId!);
                                                }
                                            }}
                                            className="flex-1 rounded-lg border border-foreground/10 bg-background/60 px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                        />
                                        <Button
                                            size="sm"
                                            className="h-8 px-3 text-xs bg-indigo-600 hover:bg-indigo-500 text-foreground"
                                            disabled={!steerInput.trim()}
                                            onClick={() => handleSendMissionSteer(mission.missionId!)}
                                        >
                                            <Send className="h-3 w-3 mr-1" /> Steer
                                        </Button>
                                    </div>
                                </div>}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );

    const ModeIcon = modeMeta.icon;

    const submitAssistantForm = async (messageId: string, data: Record<string, any>, formContext?: Record<string, any>) => {
        setSubmittedRichResponses(prev => ({ ...prev, [messageId]: data }));

        // Forms rendered from an existing form_agent (e.g. the bug-report form)
        // carry the source job id — submit those straight into the pipeline's data
        // store instead of only echoing the values back into the chat.
        const formJobId = formContext?.formJobId;
        if (formJobId) {
            try {
                const res = await fetch("/api/agent/intake-form/submit", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify({ formJobId, data }),
                });
                const body = await res.json().catch(() => ({}));
                const ok = res.ok && body?.stored;
                setMessages(prev => [...prev, {
                    id: generateUUID(),
                    role: "agent",
                    content: ok
                        ? `✅ ${body.message || "Your submission was saved."}`
                        : `⚠️ I couldn't save that submission: ${body?.error || body?.message || `HTTP ${res.status}`}`,
                    timestamp: Date.now(),
                    mode,
                }]);
            } catch (err: any) {
                setMessages(prev => [...prev, {
                    id: generateUUID(),
                    role: "agent",
                    content: `⚠️ I couldn't save that submission: ${err?.message || "network error"}`,
                    timestamp: Date.now(),
                    mode,
                }]);
            }
            return;
        }

        // Ad-hoc form with no backing job → hand the values back to the agent.
        sendMessage(`Submitted assistant form:\n\n${JSON.stringify(data, null, 2)}`, { overrideMode: "plan" });
    };

    const submitInputRequest = (messageId: string, nonce: string, inputData: Record<string, any>) => {
        setSubmittedRichResponses(prev => ({ ...prev, [`${messageId}:${nonce}`]: inputData }));
        sendMessage(`Submitted requested inputs for ${nonce}:\n\n${JSON.stringify(inputData, null, 2)}`, { overrideMode: "execute" });
    };

    const renderAssistantMessageBody = (msg: Message) => {
        // A form/input submission is sent to the agent as JSON (it needs the exact
        // values) but must never be SHOWN as JSON — it renders as the same summary
        // card the agent side uses.
        const submission = msg.role === "user" ? parseSubmissionEcho(msg.content) : null;
        if (submission) {
            return <SubmittedRichSummary title={submission.title} values={submission.values} variant="inline" />;
        }

        const rich = parseAssistantRichResponse(msg.content);
        const displayContent = msg.role === "agent" ? stripInternalScaffolding(msg.content) : msg.content;
        const markdown = (
            <div className={cn(
                "prose prose-sm max-w-none leading-relaxed",
                msg.role === "user"
                    ? "prose-invert"
                    : "prose-invert prose-p:text-foreground prose-headings:text-foreground prose-code:text-indigo-700 dark:text-indigo-300 prose-pre:bg-card prose-pre:border prose-pre:border-foreground/10"
            )}>
                <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                        a({ href, children, ...props }: any) {
                            if (href?.startsWith("tutorial:")) {
                                const tutorialId = href.replace("tutorial:", "");
                                return (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            startTutorial(tutorialId);
                                        }}
                                        className="inline-flex items-center gap-1.5 px-2.5 py-1 my-1 rounded-md text-xs font-semibold bg-primary/20 hover:bg-primary/30 text-primary border border-primary/30 transition-all cursor-pointer not-prose"
                                    >
                                        <Sparkles className="w-3.5 h-3.5 text-primary shrink-0" />
                                        <span>{children}</span>
                                        <Play className="w-3 h-3 ml-0.5 fill-current opacity-80 shrink-0" />
                                    </button>
                                );
                            }
                            return <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>;
                        },
                        code({ inline, className, children, ...props }: any) {
                            const match = /language-(\w+)/.exec(className || "");
                            if (!inline && match && match[1] === "mermaid") {
                                return (
                                    <div className="my-3 overflow-hidden rounded-xl border border-border/80 bg-card/60 shadow-md">
                                        <MermaidRenderer chart={String(children).replace(/\n$/, "")} />
                                    </div>
                                );
                            }
                            return (
                                <code className={className} {...props}>
                                    {children}
                                </code>
                            );
                        },
                    }}
                >
                    {displayContent}
                </ReactMarkdown>
            </div>
        );

        if (!rich || msg.role !== "agent") {
            return markdown;
        }

        // Clean the raw JSON payload and any internal orchestrator scaffolding out
        // of the prose message text.
        const proseText = stripInternalScaffolding(stripRichPayloadFromProse(msg.content));

        const proseHeader = proseText ? (
            <div className="prose prose-sm max-w-none leading-relaxed prose-invert prose-p:text-foreground prose-headings:text-foreground mb-3">
                <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                        a({ href, children, ...props }: any) {
                            if (href?.startsWith("tutorial:")) {
                                const tutorialId = href.replace("tutorial:", "");
                                return (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            startTutorial(tutorialId);
                                        }}
                                        className="inline-flex items-center gap-1.5 px-2.5 py-1 my-1 rounded-md text-xs font-semibold bg-primary/20 hover:bg-primary/30 text-primary border border-primary/30 transition-all cursor-pointer not-prose"
                                    >
                                        <Sparkles className="w-3.5 h-3.5 text-primary shrink-0" />
                                        <span>{children}</span>
                                        <Play className="w-3 h-3 ml-0.5 fill-current opacity-80 shrink-0" />
                                    </button>
                                );
                            }
                            return <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>;
                        },
                        code({ inline, className, children, ...props }: any) {
                            const match = /language-(\w+)/.exec(className || "");
                            if (!inline && match && match[1] === "mermaid") {
                                return (
                                    <div className="my-3 overflow-hidden rounded-xl border border-border/80 bg-card/60 shadow-md">
                                        <MermaidRenderer chart={String(children).replace(/\n$/, "")} />
                                    </div>
                                );
                            }
                            return (
                                <code className={className} {...props}>
                                    {children}
                                </code>
                            );
                        },
                    }}
                >
                    {proseText}
                </ReactMarkdown>
            </div>
        ) : null;

        if (rich.type === "input_request") {
            const submittedKey = `${msg.id}:${rich.data.nonce}`;
            if (submittedRichResponses[submittedKey]) {
                return (
                    <div className="space-y-3">
                        {proseHeader}
                        <SubmittedRichSummary
                            title="Inputs submitted"
                            values={submittedRichResponses[submittedKey]}
                            fields={(rich.data as any)?.fields}
                        />
                    </div>
                );
            }
            return (
                <div className="space-y-3">
                    {proseHeader}
                    <AgentInputForm
                        request={rich.data}
                        onSubmit={(nonce, inputData) => submitInputRequest(msg.id, nonce, inputData)}
                        isSubmitting={isTyping}
                        primaryColor="#6366f1"
                    />
                </div>
            );
        }

        if (rich.type === "assistant_form") {
            if (submittedRichResponses[msg.id]) {
                return (
                    <div className="space-y-3">
                        {proseHeader}
                        <SubmittedRichSummary
                            title="Form submitted"
                            values={submittedRichResponses[msg.id]}
                            fields={rich.data.schema?.fields}
                        />
                    </div>
                );
            }
            return (
                <div className="space-y-3">
                    {proseHeader}
                    <div className="rounded-2xl border border-foreground/10 bg-card/80 p-4 shadow-xl">
                        {(rich.data.title || rich.data.description) && (
                            <div className="mb-4 border-b border-foreground/10 pb-3">
                                {rich.data.title && <h3 className="text-sm font-bold text-foreground">{rich.data.title}</h3>}
                                {rich.data.description && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{rich.data.description}</p>}
                            </div>
                        )}
                        <StudioForm
                            schema={rich.data.schema}
                            submitLabel={rich.data.submitLabel || "Submit"}
                            context={rich.data.context || initialContext || {}}
                            themeConfig={{ primaryColor: "#6366f1", companyName: "Oddjob" }}
                            disabled={isTyping}
                            onSubmit={(data) => submitAssistantForm(msg.id, data, rich.data.context)}
                        />
                    </div>
                </div>
            );
        }

        if (rich.type === "assistant_app") {
            return (
                <div className="space-y-3">
                    {proseHeader}
                    <AssistantAppCard
                        app={rich.data}
                        onNavigate={(href) => {
                            // Close the copilot sheet and navigate to the app in the same tab.
                            onOpenChange(false);
                            setLocation(href);
                        }}
                        onEvent={(summary) => {
                            sendMessage(summary, { overrideMode: "plan" });
                        }}
                    />
                </div>
            );
        }

        if (rich.type === "instant_app") {
            return (
                <div className="space-y-3">
                    {proseHeader}
                    <InstantAppRenderer
                        module={rich.data.module}
                        componentName={rich.data.componentName}
                        title={rich.data.title}
                        note={rich.data.note}
                        props={rich.data.props}
                    />
                </div>
            );
        }

        if (rich.type === "instant_app_surface") {
            return (
                <div className="space-y-3">
                    {proseHeader}
                    <InstantAppSurface
                        title={rich.data.title}
                        note={rich.data.note}
                        layout={rich.data.layout}
                        blocks={rich.data.blocks}
                    />
                </div>
            );
        }

        if (rich.type === "mode_switch_request") {
            return (
                <div className="space-y-3">
                    {proseHeader}
                    <div className="rounded-2xl border border-indigo-400/30 bg-indigo-500/10 p-4 shadow-xl">
                        <div className="flex items-start gap-3">
                            <div className="rounded-xl border border-indigo-400/30 bg-indigo-500/15 p-2 text-indigo-700 dark:text-indigo-200">
                                <Zap className="h-4 w-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-indigo-700 dark:text-indigo-300">Switch to Execute mode</p>
                                <p className="mt-1 text-sm leading-relaxed text-foreground">
                                    {rich.data.message || "Shall I switch to Execute mode and carry out this action?"}
                                </p>
                                {rich.data.reason && (
                                    <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">{rich.data.reason}</p>
                                )}
                            </div>
                        </div>
                        <div className="mt-4 flex items-center gap-2">
                            <Button
                                className="h-9 bg-indigo-600 text-foreground hover:bg-indigo-500"
                                onClick={() => switchToExecuteAndRun(msg, rich.data.reason)}
                                disabled={isTyping}
                            >
                                <Zap className="mr-1.5 h-3.5 w-3.5" />
                                Switch to Execute
                            </Button>
                            <span className="text-[11px] text-muted-foreground">You'll still confirm before anything runs.</span>
                        </div>
                    </div>
                </div>
            );
        }

        if (rich.type === "intent_clarification") {
            const clarification = rich.data;
            return (
                <div className="space-y-3">
                    {proseHeader}
                    <div className="rounded-2xl border border-indigo-400/30 bg-card/90 p-4 shadow-xl">
                        <div className="flex items-start gap-3">
                            <div className="rounded-xl border border-indigo-400/30 bg-indigo-500/15 p-2 text-indigo-700 dark:text-indigo-200">
                                <Sparkles className="h-4 w-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-indigo-700 dark:text-indigo-300">
                                    Clarification Needed
                                </p>
                                <p className="mt-1 text-sm font-semibold leading-relaxed text-foreground">
                                    {clarification.headline || clarification.question}
                                </p>
                                {clarification.headline && clarification.question && (
                                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                                        {clarification.question}
                                    </p>
                                )}
                            </div>
                        </div>
                        {Array.isArray(clarification.options) && clarification.options.length > 0 && (
                            <div className="mt-3.5 flex flex-wrap gap-2">
                                {clarification.options.map((opt: any, idx: number) => (
                                    <Button
                                        key={idx}
                                        variant="outline"
                                        size="sm"
                                        onClick={() => sendMessage(opt.prompt || opt.label)}
                                        disabled={isTyping}
                                        className="rounded-full border-foreground/15 bg-background/80 hover:bg-foreground/10 text-xs font-medium text-foreground transition-all hover:border-indigo-500/50"
                                    >
                                        <Sparkles className="mr-1.5 h-3 w-3 text-indigo-400" />
                                        {opt.label}
                                    </Button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            );
        }

        if (rich.type === "launch_tutorial") {
            return (
                <div className="space-y-3">
                    {proseHeader}
                    <div className="rounded-2xl border border-indigo-500/30 bg-indigo-500/10 p-4 shadow-xl">
                        <div className="flex items-start gap-3">
                            <div className="rounded-xl border border-indigo-400/30 bg-indigo-500/20 p-2 text-indigo-400">
                                <Sparkles className="h-4 w-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-indigo-400">Interactive Guided Tour</p>
                                <h4 className="text-sm font-bold text-foreground mt-0.5">
                                    {rich.data.title || `Guided Tour: ${rich.data.trackId}`}
                                </h4>
                                {rich.data.description && (
                                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{rich.data.description}</p>
                                )}
                            </div>
                        </div>
                        <div className="mt-4 flex items-center gap-2">
                            <Button
                                className="h-9 bg-indigo-600 text-white hover:bg-indigo-500 rounded-xl font-bold uppercase tracking-wider text-xs gap-1.5 shadow-md"
                                onClick={() => {
                                    startTutorial(rich.data.trackId);
                                }}
                            >
                                <Play className="mr-1 h-3.5 w-3.5 fill-current" />
                                Start Walkthrough
                            </Button>
                        </div>
                    </div>
                </div>
            );
        }

        return markdown;
    };

    return (
        <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
            <SheetContent
                side="right"
                hideOverlay
                onPointerDownOutside={(e) => {
                    // Prevent closing when clicking outside so the Copilot remains an interactive side panel
                    e.preventDefault();
                }}
                onInteractOutside={(e) => {
                    // Prevent closing on outside focus or interactions (e.g. dropdown closing or interacting with workspace)
                    e.preventDefault();
                }}
                className={cn(
                    "inset-0 flex h-[100dvh] min-h-0 w-screen max-w-none flex-col overflow-hidden rounded-none border-0 bg-background/95 p-0 text-foreground sm:inset-y-0 sm:left-auto sm:h-auto sm:w-auto sm:rounded-l-3xl sm:border-l sm:border-foreground/10",
                    isHalfScreen && "sm:!w-[50vw]",
                )}
                style={{ width: isHalfScreen ? "100vw" : `min(100vw, ${panelWidth}px)`, maxWidth: "100vw" }}
                data-testid="copilot-chat-sheet"
            >
                <div
                    onMouseDown={onHandleMouseDown}
                    className="absolute left-0 top-0 h-full w-3 hidden sm:flex items-center justify-center cursor-ew-resize z-10 group select-none"
                    title="Drag to resize"
                >
                    <div className="w-1 h-12 rounded-full bg-foreground/10 group-hover:bg-indigo-500/60 group-active:bg-indigo-400 transition-colors flex flex-col items-center justify-center gap-0.5">
                        <GripVertical className="h-3 w-3 text-foreground/20 group-hover:text-indigo-700 dark:text-indigo-300 transition-colors" />
                    </div>
                </div>

                <SheetHeader className="flex-shrink-0 border-b border-foreground/10 bg-background px-3 py-2.5 sm:px-5 sm:py-4">
                    <div className="flex items-start justify-between gap-4 pr-8">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2.5">
                                <div className="p-1.5 rounded-lg bg-indigo-600 shadow-[0_0_16px_rgba(79,70,229,0.35)]">
                                    <Sparkles className="h-4 w-4 text-foreground" />
                                </div>
                                <SheetTitle className="text-base font-bold tracking-tight text-foreground">
                                    Oddjob Copilot
                                </SheetTitle>
                                {/* Active Project Space. The copilot used to infer context
                                    from the last cycle touched; showing the scope here makes
                                    that guess an explicit, visible selection the user can
                                    change (PROJECT_SPACES_DESIGN §6.4). */}
                                {activeProjectName && (
                                    <span
                                        className="hidden max-w-[9rem] items-center truncate rounded-full border border-foreground/15 bg-foreground/5 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground sm:inline-flex"
                                        title={`Answering within the "${activeProjectName}" project space`}
                                        data-testid="copilot-project-scope"
                                    >
                                        <FolderKanban className="mr-1 h-3 w-3 shrink-0" />
                                        {activeProjectName}
                                    </span>
                                )}
                            </div>
                        </div>
                        <div className="flex items-center gap-1">
                            <button
                                type="button"
                                onClick={moveDiscussionToCrew}
                                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
                                title="Meet Now in a CREW room"
                                aria-label="Meet Now in CREW Chat"
                                data-testid="copilot-move-to-crew"
                            >
                                <Users className="h-3.5 w-3.5" />
                                <span className="hidden min-[520px]:inline">Meet Now</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setIsHalfScreen(value => !value)}
                                className="hidden p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors sm:inline-flex"
                                title={isHalfScreen ? "Restore Copilot width" : "Expand Copilot to half screen"}
                                aria-label={isHalfScreen ? "Restore Copilot width" : "Expand Copilot to half screen"}
                                aria-pressed={isHalfScreen}
                            >
                                {isHalfScreen
                                    ? <Minimize2 className="h-3.5 w-3.5" />
                                    : <Maximize2 className="h-3.5 w-3.5" />}
                            </button>
                            <button
                                type="button"
                                onClick={clearChat}
                                disabled={isTyping}
                                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
                                title="Clear conversation"
                                aria-label="Clear conversation"
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    </div>

                    <div className="mt-2 flex items-center gap-2">
                        <select aria-label="Saved Copilot conversations" disabled={isTyping} value={sessionId}
                            className="min-w-0 flex-1 rounded-md border border-border bg-background p-1.5 text-xs"
                            onChange={event => { conversation.selectConversation(event.target.value); setPendingExecution(null); setAttachments([]); setWorkMemory([]); }}>
                            {conversation.conversations.map(item => <option key={item.id} value={item.id}>
                                {item.messages.find(message => message.role === 'user')?.content.slice(0, 60) || 'New conversation'}
                            </option>)}
                        </select>
                        <Button size="sm" variant="outline" disabled={isTyping} onClick={() => { conversation.newConversation(); setPendingExecution(null); setAttachments([]); setWorkMemory([]); }}>New chat</Button>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground" role={conversation.storageError ? 'alert' : undefined}>
                        {conversation.storageError ? 'Conversation could not be saved in this browser. Keep this page open to retain it.' : 'Saved in this browser · 12 recent chats, up to 200 messages each'}
                    </p>

                    <div className="mt-2 flex rounded-lg border border-foreground/10 bg-card/70 p-0.5 text-[10px] font-bold uppercase tracking-wider sm:mt-3">
                        <button onClick={() => setView("chat")} className={cn("flex-1 flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 transition-colors", view === "chat" ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:text-foreground")}>
                            <MessageSquare className="h-3.5 w-3.5" /> Chat
                        </button>
                        <button onClick={() => setView("updates")} className={cn("flex-1 flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 transition-colors", view === "updates" ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:text-foreground")}>
                            <Inbox className="h-3.5 w-3.5" /> Updates
                            {updatesCount > 0 && <span className="ml-0.5 rounded-full bg-indigo-500/80 px-1.5 py-0.5 text-[9px] leading-none text-foreground">{updatesCount > 9 ? "9+" : updatesCount}</span>}
                        </button>
                        <button onClick={() => setView("approvals")} className={cn("flex-1 flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 transition-colors", view === "approvals" ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:text-foreground")}>
                            <ClipboardCheck className="h-3.5 w-3.5" /> Approvals
                            {pendingCount > 0 && <span className="ml-0.5 rounded-full bg-amber-500/80 px-1.5 py-0.5 text-[9px] leading-none text-foreground">{pendingCount}</span>}
                        </button>
                        <button onClick={() => setView("missions")} className={cn("flex-1 flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 transition-colors", view === "missions" ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:text-foreground")}>
                            <Compass className="h-3.5 w-3.5" /> Missions
                            {activeMissionsCount > 0 && <span className="ml-0.5 flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />}
                        </button>
                    </div>
                </SheetHeader>

                {view === "approvals" ? (
                    <div className="flex-1 overflow-y-auto px-4 py-4"><AssistantApprovals onResumedOutcome={handleResumedOutcome} /></div>
                ) : view === "updates" ? (
                    renderUpdatesView()
                ) : view === "missions" ? (
                    renderMissionsStreamView()
                ) : (<>
                <div className="border-b border-foreground/10 bg-background px-3 py-2 sm:px-4 sm:py-3">
                    <div className="mb-3">
                        <div className="mb-1.5 flex items-center justify-between">
                            <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Active context</span>
                            {(ephemeralContext.activeIntervention || ephemeralContext.workstreamEvents.length > 0) && (
                                <span className="flex items-center gap-1 text-[9px] font-semibold text-emerald-700 dark:text-emerald-300">
                                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                                    Live signals
                                </span>
                            )}
                        </div>
                        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                            <label className="flex items-center gap-1">Page
                                <select aria-label="Page context" value={contextChoice.pageMode} disabled={isTyping}
                                    className="rounded border border-border bg-background p-1"
                                    onChange={event => setContextChoice(previous => ({ ...previous, pageMode: event.target.value as typeof previous.pageMode, pinnedUrl: browserLocation }))}>
                                    <option value="follow">Follow navigation</option>
                                    <option value="pinned">Pin this page</option>
                                    <option value="excluded">Exclude page</option>
                                </select>
                            </label>
                            <label className="flex items-center gap-1">Selection
                                <select aria-label="Selected record context" value={contextChoice.selectionMode} disabled={isTyping}
                                    className="rounded border border-border bg-background p-1"
                                    onChange={event => setContextChoice(previous => ({ ...previous, selectionMode: event.target.value as typeof previous.selectionMode }))}>
                                    <option value="follow">Follow selection</option>
                                    <option value="pinned" disabled={!selectedUiContext}>Pin selection</option>
                                    <option value="excluded">Exclude selection</option>
                                </select>
                            </label>
                        </div>
                        {contextChoice.pageMode === 'pinned' && <p className="mb-2 break-all text-xs text-muted-foreground">Pinned: {location}</p>}
                        <div className="flex gap-1.5 overflow-x-auto pb-1">
                            {contextSummary.map(item => (
                                <span
                                    key={`${item.label}-${item.detail}`}
                                    title={item.detail}
                                    className="shrink-0 rounded-full border border-foreground/10 bg-card/80 px-2.5 py-1 text-[10px] font-semibold text-foreground"
                                >
                                    {item.label}
                                </span>
                            ))}
                            {ephemeralContext.activeIntervention && (
                                <button
                                    type="button"
                                    onClick={() => setView("updates")}
                                    title={ephemeralContext.activeIntervention.description}
                                    className="flex shrink-0 items-center gap-1 rounded-full border border-amber-400/25 bg-amber-400/10 px-2.5 py-1 text-[10px] font-semibold text-amber-700 dark:text-amber-200"
                                >
                                    {ephemeralContext.activeIntervention.title}
                                    <ChevronRight className="h-3 w-3" />
                                </button>
                            )}
                    </div>
                    </div>
                    <div className="mt-2 hidden items-center justify-between gap-2 sm:flex">
                        <button
                            className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground"
                            onClick={() => setShowCapabilities(v => !v)}
                        >
                            <Boxes className="h-3 w-3" />
                            What I can do here
                        </button>
                        {workMemory.length > 0 && (
                            <button
                                className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground"
                                onClick={clearWorkMemory}
                            >
                                Clear open loops
                            </button>
                        )}
                    </div>
                    {showCapabilities && (
                        <div className="mt-3 grid gap-2 rounded-xl border border-foreground/10 bg-background/25 p-3">
                            {CAPABILITIES.map(item => (
                                <div key={item.label} className="flex gap-2">
                                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                                    <div>
                                        <p className="text-[11px] font-bold text-foreground">{item.label}</p>
                                        <p className="text-[10px] leading-relaxed text-muted-foreground">{item.detail}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-4" ref={scrollRef}>
                    <div className="space-y-3 pb-3">
                        {pendingCount > 0 && (
                            <button
                                onClick={() => setView("approvals")}
                                className="flex w-full items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-left transition-colors hover:bg-amber-400/15"
                            >
                                <Inbox className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
                                <span className="text-xs font-medium text-amber-100">
                                    {pendingCount} pending {pendingCount === 1 ? "decision" : "decisions"} need review
                                </span>
                                <span className="ml-auto text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">Review →</span>
                            </button>
                        )}
                        {workMemory.length > 0 && (
                            <div className="rounded-xl border border-foreground/10 bg-card/50 p-3">
                                <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                    <ClipboardCheck className="h-3 w-3" />
                                    Recent work
                                </div>
                                <div className="space-y-2">
                                    {workMemory.slice(0, 3).map(item => (
                                        <div 
                                            key={item.id} 
                                            className="group flex items-center justify-between gap-3 rounded-lg bg-background/20 px-2.5 py-2 cursor-pointer hover:bg-foreground/5 transition-colors"
                                            onClick={() => resumeWorkItem(item)}
                                        >
                                            <div className="min-w-0 flex-1">
                                                <p className="truncate text-[11px] font-medium text-foreground group-hover:text-foreground transition-colors">{item.title}</p>
                                                <p className={cn(
                                                    "flex items-center gap-1 text-[9px] uppercase tracking-wider",
                                                    item.status === "executed" ? "text-emerald-400/80" : "text-muted-foreground",
                                                )}>
                                                    {item.status === "executed" && <CheckCircle2 className="h-2.5 w-2.5" />}
                                                    {item.mode} · {item.status}
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0">
                                                <Badge variant="outline" className="h-5 border-foreground/10 text-[9px] text-muted-foreground whitespace-nowrap">
                                                    {new Date(item.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                                </Badge>
                                                <button
                                                    onClick={(e) => removeWorkItem(item.id, e)}
                                                    className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-foreground/10 text-muted-foreground hover:text-foreground transition-all shrink-0"
                                                    title="Remove"
                                                >
                                                    <X className="h-3 w-3" />
                                                </button>
                                            </div>
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
                                        "max-w-[96%] rounded-xl px-3.5 py-2.5 text-sm sm:max-w-[90%]",
                                        msg.role === "user"
                                            ? "bg-indigo-600 text-foreground ml-6"
                                            : "bg-muted/80 border border-foreground/10 text-foreground mr-6"
                                    )}>
                                        {msg.role === "agent" && (
                                            <div className="mb-1 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-indigo-400">
                                                <Sparkles className="h-2.5 w-2.5" />
                                                Copilot
                                                {msg.mode === "execute" && <span className="text-emerald-400">/ Live Action</span>}
                                            </div>
                                        )}
                                        {msg.role === "user" && msg.attachments && msg.attachments.length > 0 && (
                                            <div className="mb-2 flex flex-wrap justify-end gap-1.5">
                                                {msg.attachments.map(file => (
                                                    <span key={file.id} className="inline-flex max-w-full items-center gap-1 rounded-md bg-foreground/15 px-2 py-1 text-[10px] text-indigo-50">
                                                        <Paperclip className="h-3 w-3 shrink-0" />
                                                        <span className="truncate">{file.name}</span>
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                        {renderAssistantMessageBody(msg)}
                                        {msg.receipt && (
                                            <section aria-label="Action receipt" className="mt-3 rounded-lg border border-border bg-background p-3 text-xs">
                                                <p className="font-semibold">Action receipt · {{ completed: 'Tools reported success', partial: 'Some tools failed', failed: 'Request failed or was blocked', unverified: 'Changes not confirmed' }[msg.receipt.status]}</p>
                                                <p className="mt-1 text-muted-foreground">{new Date(msg.receipt.timestamp).toLocaleString()}</p>
                                                {msg.receipt.tools.length ? <ul className="mt-2 space-y-1">
                                                    {msg.receipt.tools.map((tool, index) => <li key={index}>
                                                        {tool.tool.replace(/_/g, ' ')} · {tool.status === 'succeeded' ? tool.verified ? 'Verified' : 'Reported success' : tool.status}
                                                        {safeReceiptHref(tool.href) && <a className="ml-2 underline" href={safeReceiptHref(tool.href)}>Open result</a>}
                                                    </li>)}
                                                </ul> : <p className="mt-2 text-muted-foreground">No confirmed tool outcomes were returned. Check the affected record before retrying a change.</p>}
                                            </section>
                                        )}
                                        {msg.id === "welcome" && pageActions.length > 0 && (
                                            <div className="mt-3 flex flex-wrap gap-1.5 border-t border-foreground/10 pt-2.5">
                                                {pageActions.slice(0, 4).map((action, idx) => {
                                                    const ActionIcon = action.icon;
                                                    return (
                                                        <Button
                                                            key={idx}
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={() => handleAction(action)}
                                                            disabled={isTyping}
                                                            className="rounded-full border-foreground/15 bg-background/80 hover:bg-foreground/10 text-xs font-medium text-foreground transition-all hover:border-indigo-500/50"
                                                        >
                                                            {ActionIcon && <ActionIcon className="mr-1.5 h-3 w-3 text-indigo-400" />}
                                                            {action.label}
                                                        </Button>
                                                    );
                                                })}
                                            </div>
                                        )}
                                        {msg.role === "agent" && msg.evidence && msg.evidence.length > 0 && (
                                            <div className="mt-3 flex flex-wrap gap-1.5 border-t border-foreground/10 pt-2">
                                                {msg.evidence.slice(0, 4).map((item, index) => (
                                                    <span
                                                        key={`${item.label}-${index}`}
                                                        className="rounded-full border border-foreground/10 bg-foreground/5 px-2 py-1 text-[9px] font-medium text-muted-foreground"
                                                        title={item.source}
                                                    >
                                                        {item.label}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                        <div className={cn(
                                            "text-[9px] mt-1.5 font-medium flex items-center justify-between gap-2",
                                            msg.role === "user" ? "text-indigo-700 dark:text-indigo-200/60 justify-end" : "text-muted-foreground"
                                        )}>
                                            <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                                            {msg.role === "agent" && msg.serverMessageId && (
                                                <div className="flex items-center gap-1.5 ml-auto">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleMessageFeedback(msg.id, true)}
                                                        className={cn(
                                                            "p-1 rounded hover:bg-foreground/10 transition-colors",
                                                            feedbackMap[msg.id] === "up" ? "text-emerald-400 font-bold" : "text-muted-foreground hover:text-foreground"
                                                        )}
                                                        title="Helpful response"
                                                        aria-label="Thumbs Up"
                                                    >
                                                        <ThumbsUp className="h-3 w-3" />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleMessageFeedback(msg.id, false)}
                                                        className={cn(
                                                            "p-1 rounded hover:bg-foreground/10 transition-colors",
                                                            feedbackMap[msg.id] === "down" ? "text-rose-400 font-bold" : "text-muted-foreground hover:text-foreground"
                                                        )}
                                                        title="Unhelpful response"
                                                        aria-label="Thumbs Down"
                                                    >
                                                        <ThumbsDown className="h-3 w-3" />
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}

                        {pendingExecution && (
                            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-amber-100">
                                <div className="flex items-start gap-3">
                                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
                                    <div className="min-w-0 flex-1">
                                        <p className="text-xs font-bold uppercase tracking-wider">Confirm live execution</p>
                                        <p className="mt-1 text-sm text-amber-100/85">{pendingExecution.summary}</p>
                                        <div className="mt-3 grid gap-2 text-[11px] sm:grid-cols-2">
                                            <div>
                                                <p className="font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300/80">Targets</p>
                                                <p className="mt-1 text-amber-100/75">{pendingExecution.targets.join(", ") || "Current context"}</p>
                                            </div>
                                            <div>
                                                <p className="font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300/80">Tools</p>
                                                <p className="mt-1 text-amber-100/75">{pendingExecution.likelyTools.join(", ")}</p>
                                            </div>
                                        </div>
                                        <div className="mt-3 grid gap-2 rounded-lg border border-amber-300/15 bg-background/15 p-2.5 text-[10px] sm:grid-cols-2">
                                            <div>
                                                <p className="font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300/80">Verification</p>
                                                <p className="mt-1 text-amber-100/70">Copilot must check the resulting state before reporting completion.</p>
                                            </div>
                                            <div>
                                                <p className="font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300/80">Recovery</p>
                                                <p className="mt-1 text-amber-100/70">Any available rollback or safe retry will be included in the result.</p>
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
                                <div className="bg-muted/80 border border-foreground/10 rounded-xl px-3.5 py-2.5 mr-6 flex items-center gap-2">
                                    <div className="flex gap-1">
                                        <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
                                        <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
                                        <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" />
                                    </div>
                                    <span className="text-foreground text-xs">{typingStatus || "Thinking..."}</span>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex-shrink-0 border-t border-foreground/10 bg-card/60 px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 sm:px-4">
                    <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept=".txt,.md,.csv,.json,.xml,.bpmn,.pdf,.docx,image/*"
                        className="hidden"
                        onChange={(event) => void uploadAttachments(event.target.files)}
                    />
                    {attachments.length > 0 && (
                        <div className="mb-2 flex flex-wrap gap-1.5" aria-label="Attachments">
                            {attachments.map(file => (
                                <span key={file.id} className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-foreground/10 bg-muted px-2 py-1.5 text-[10px] text-foreground">
                                    <Paperclip className="h-3 w-3 shrink-0 text-indigo-700 dark:text-indigo-300" />
                                    <span className="max-w-40 truncate">{file.name}</span>
                                    <button
                                        type="button"
                                        className="rounded p-0.5 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                                        onClick={() => setAttachments(previous => previous.filter(item => item.id !== file.id))}
                                        aria-label={`Remove ${file.name}`}
                                    >
                                        <X className="h-3 w-3" />
                                    </button>
                                </span>
                            ))}
                        </div>
                    )}
                    {attachmentError && <p className="mb-2 text-xs text-rose-700 dark:text-rose-300">{attachmentError}</p>}
                    <div className="flex gap-2 items-end">
                        <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isTyping || isUploading || attachments.length >= 5}
                            className="h-11 w-11 shrink-0 rounded-xl border border-foreground/10 text-foreground hover:bg-foreground/10 hover:text-foreground disabled:opacity-40"
                            title="Attach files"
                        >
                            {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                        </Button>
                        <Textarea
                            ref={textareaRef}
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Ask Oddjob Copilot..."
                            className="flex-1 min-h-[44px] max-h-[140px] resize-none bg-muted/60 border-foreground/10 text-foreground placeholder:text-muted-foreground focus-visible:ring-indigo-500/50 text-sm rounded-xl"
                            rows={1}
                            disabled={isTyping}
                        />
                        <Button
                            size="icon"
                            onClick={() => sendMessage(input)}
                            disabled={isTyping || isUploading || (!input.trim() && attachments.length === 0)}
                            className={cn(
                                "h-11 w-11 shrink-0 rounded-xl disabled:opacity-40",
                                mode === "execute" ? "bg-emerald-600 hover:bg-emerald-500" : "bg-indigo-600 hover:bg-indigo-500"
                            )}
                            title="Send to Copilot"
                        >
                            <Send className="h-4 w-4" />
                        </Button>
                    </div>
                    <p className="text-[9px] text-muted-foreground mt-1.5 text-center">
                        Enter to send. Shift+Enter for a new line. Actions preview before modifying system state.
                    </p>
                </div>
                </>)}
            </SheetContent>
        </Sheet>
    );
}

export default AgentChatSheet;
