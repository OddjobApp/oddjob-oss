import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { VerticalSubwaySpine } from "./components/VerticalSubwaySpine";
import { ScribePageTree } from "./components/ScribePageTree";
import { LivingDocumentCanvas, ScribeLiveInsight } from "./components/LivingDocumentCanvas";
import { MultiLensCriticGallery } from "./components/MultiLensCriticGallery";
import { TelemetryExportDock, ExportTypographyTheme } from "./components/TelemetryExportDock";
import { BranchDiffViewer } from "./components/BranchDiffViewer";
import { AmbientGQESidebar } from "./components/AmbientGQESidebar";
import { ScribeGovernancePanel } from "./components/ScribeGovernancePanel";
import { FullDocumentView } from "@domain/scribe/core/scribe.service";
import { markStaleness, type AnnotationView } from "@shared/scribe-annotation-staleness";
import { computeTelemetry } from "@shared/scribe-telemetry";
import type { ScribeSelection } from "@shared/scribe-context";
import { latestPublication } from "./publication-state";
import { resolveRails, type AuthorRails, type TouchedRail } from "./canvas-layout";
import {
    ScribeAnnotation,
    ScribeAnnotationSeverity,
    ScribeLensType,
    ScribeNode,
    type ScribeAnnotationStatus,
    type ScribeNodeStatus,
} from "@shared/schema/scribe";
import { BookOpen, FolderTree, X, RefreshCw, Maximize2, Minimize2, Sparkles, Send, ArrowRight, ChevronRight, ChevronLeft, Users, Layers, Lightbulb, Download, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

/**
 * An annotation the server has just created, against the content on screen.
 *
 * Only the initial payload arrives pre-marked; anything added during the
 * session is current by construction, and markStaleness re-derives the whole
 * list on every render anyway.
 */
const asFresh = (a: ScribeAnnotation): AnnotationView => ({ ...a, isStale: false });

const CRITIC_ROLES_MAP: Record<string, string[]> = {
    sow_statement_of_work: ["Commercial Counsel", "Delivery Principal", "Risk & Compliance Lead"],
    business_doc_best_practices: ["Lead Business Architect", "Enterprise Strategist", "Governance SME"],
    enterprise_sop: ["Operations Controller", "Quality Assurance Auditor"],
    saas_msa: ["Commercial Counsel", "Privacy Officer"],
    yc_pitch_deck: ["Venture Partner", "Story Architect"],
    amazon_prfaq: ["Product Lead", "Customer Advocate"],
    minto_pyramid: ["Executive Editor", "Clarity SME"],
    imrad_paper: ["Peer Reviewer", "Methodology SME"],
    harvard_batna: ["Negotiation Strategist", "Deal Lead"],
    heros_journey: ["Story Architect", "Dialogue Coach", "Pacing SME"],
    story_circle: ["Story Editor", "Character Coach"],
    save_the_cat: ["Beat Architect", "Screenplay SME"],
    ai_system_governance: ["AI Governance Lead", "Compliance Officer", "Responsible AI Reviewer"],
    data_lineage_narrative: ["Data Governance Analyst", "ML Platform Architect", "Privacy Officer"],
    bias_mitigation_strategy: ["Responsible AI Reviewer", "Fairness Researcher", "Domain SME"],
    freeform: ["Reviewer", "Editor"],
};

export interface ScribeStudioPodProps {
    manuscriptRailTarget?: HTMLElement | null;
    documentId?: number;
    sessionId?: number;
    title?: string;
    subject?: string;
    /**
     * The framework the mount asked for.
     *
     * The session bootstrap creates the document if none exists, and without a
     * mode it created a freeform one — so a studio opened for an SOW could get
     * the generic "Overview / Main Body / Conclusion" skeleton purely by
     * reaching the session first.
     */
    archetypeMode?: string;
    isFocusMode?: boolean;
    onToggleFocusMode?: () => void;
    onClose?: () => void;
    onFocusInChat?: (selection: ScribeSelection, promptSuggestion?: string) => void;
}

export const ScribeStudioPod: React.FC<ScribeStudioPodProps> = ({
    documentId,
    sessionId,
    title = "Manuscript",
    subject,
    archetypeMode,
    isFocusMode = false,
    onToggleFocusMode,
    onClose,
    onFocusInChat,
    manuscriptRailTarget,
}) => {
    /**
     * What the server sends back from Tier 1. Deliberately not the same shape
     * as the canvas's ScribeLiveInsight: the server speaks the schema's own
     * lens/severity vocabulary so a finding can become a real annotation, while
     * the canvas type is about rendering. toLiveInsight is the one place the
     * two meet.
     */
    interface AmbientInsightWire {
        ruleId: string;
        lensType: string;
        severity: "info" | "suggestion" | "warning" | "critical_conflict";
        title: string;
        detail: string;
        start: number;
        end: number;
        excerpt: string;
        canonical?: string;
    }

    /** Severity is the server's word for it; the canvas renders on `type`. */
    const toLiveInsight = (w: AmbientInsightWire): ScribeLiveInsight => ({
        // Position makes it stable across re-evaluations, so React keeps the
        // marker rather than remounting it on every keystroke.
        id: `${w.ruleId}:${w.start}`,
        agentRole: "RuleEngine",
        lensType: w.lensType as ScribeLiveInsight["lensType"],
        type: w.severity === "warning" || w.severity === "critical_conflict" ? "warning" : "suggestion",
        title: w.title,
        message: w.detail,
        originalExcerpt: w.excerpt,
        canonical: w.canonical,
        // No suggestedReplacement and no confidence: a rule reports what it
        // matched, it does not rewrite the clause or estimate its own accuracy.
    });

    const [docView, setDocView] = useState<FullDocumentView | null>(null);
    /** Last findings sent to the server, so it can broadcast only on a change. */
    const lastInsightsRef = useRef<AmbientInsightWire[]>([]);
    const [selectedStationKey, setSelectedStationKey] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Branch Diff Viewer Modal State
    const [isDiffViewerOpen, setIsDiffViewerOpen] = useState(false);
    const [trunkDocView, setTrunkDocView] = useState<FullDocumentView | null>(null);

    // Batch Manuscript Audit State
    const [isAuditingAll, setIsAuditingAll] = useState(false);

    // Warm Canvas State (Phase 3)
    const [isWarmCanvas, setIsWarmCanvas] = useState(false);
    const [warmContext, setWarmContext] = useState("");
    const [briefOutcome, setBriefOutcome] = useState("");
    const [briefAudience, setBriefAudience] = useState("");
    const [briefConstraints, setBriefConstraints] = useState("");
    const [isCrystallizing, setIsCrystallizing] = useState(false);
    const autoEvaluatedNodesRef = useRef<Set<number>>(new Set());
    /**
     * The manuscript actually on screen.
     *
     * Seeded from the documentId prop, then owned here: the page tree opens a
     * sibling without the mount that created this pod having to change, and a
     * later prop change (a fresh mount) still wins.
     */
    const [openDocumentId, setOpenDocumentId] = useState<number | undefined>(documentId);
    const [isTreeOpen, setIsTreeOpen] = useState(false);
    const [treeRefreshKey, setTreeRefreshKey] = useState(0);

    // In-Pod Scribe Copilot State
    const [isSyncingCrew, setIsSyncingCrew] = useState(false);
    const [isExporting, setIsExporting] = useState(false);

    // Responsive Dock State: Tabbed Companion ('critics' | 'gqe' | 'governance') & Collapsible Spine
    const [rightPanelTab, setRightPanelTab] = useState<"critics" | "gqe" | "governance">("critics");
    const [isRightPanelOpen, setIsRightPanelOpen] = useState(true);
    const [isSpineCollapsed, setIsSpineCollapsed] = useState(false);
    /** The row holding spine, canvas and dock — what the rails are fitted into. */
    const columnsRef = useRef<HTMLDivElement | null>(null);
    /**
     * The arrangement the author asked for, and which rail they touched.
     *
     * This used to be a boolean that switched the fitting off for good. It
     * honoured the request and then let the consequence land off-screen: expand
     * the spine at a width that cannot hold both rails and the critics dock was
     * clipped past the edge of the window, because the column row hides its
     * overflow rather than scrolling it. resolveRails keeps the rail they
     * touched and gives up the other instead.
     */
    const [authorRails, setAuthorRails] = useState<AuthorRails | null>(null);

    /** Record a deliberate rail change, and apply it. */
    const setRailByAuthor = (touched: TouchedRail, next: Partial<{ spineCollapsed: boolean; dockOpen: boolean }>) => {
        const layout = {
            spineCollapsed: next.spineCollapsed ?? isSpineCollapsed,
            dockOpen: next.dockOpen ?? isRightPanelOpen,
        };
        setAuthorRails({ layout, touched });
        setIsSpineCollapsed(layout.spineCollapsed);
        setIsRightPanelOpen(layout.dockOpen);
    };

    const loadDocument = async () => {
        if (!openDocumentId && !sessionId) {
            setDocView(null);
            setTrunkDocView(null);
            setSelectedStationKey(null);
            setIsLoading(false);
            setError("No document or session to open.");
            return;
        }
        setIsLoading(true);
        setError(null);
        setDocView(null);
        setTrunkDocView(null);
        setSelectedStationKey(null);
        try {
            const effectiveTitle = subject || title;
            const sessionUrl = `/api/scribe/session/${sessionId}?title=${encodeURIComponent(effectiveTitle)}` +
                (archetypeMode ? `&mode=${encodeURIComponent(archetypeMode)}` : "");

            let res: Response;
            if (openDocumentId) {
                try {
                    res = await apiRequest("GET", `/api/scribe/documents/${openDocumentId}`, undefined, 15000);
                } catch (docErr: any) {
                    if (sessionId) {
                        res = await apiRequest("GET", sessionUrl, undefined, 15000);
                    } else {
                        throw docErr;
                    }
                }
            } else {
                res = await apiRequest("GET", sessionUrl, undefined, 15000);
            }
            const data: FullDocumentView = await res.json();
            setDocView(data);
            if (data.nodes.length > 0) {
                setSelectedStationKey(data.nodes[0].stationKey);
            }

            // Check if freshly initialized document with zero word count
            const isFresh = (data.telemetry?.totalWordCount === 0 || !data.telemetry?.totalWordCount) && data.nodes.every((n) => (n.wordCount || 0) === 0);
            if (isFresh) {
                setIsWarmCanvas(true);
            }

            // If on non-trunk branch, fetch trunk doc for diff comparison
            const mainBranch = data.allBranches.find((b) => b.branchKey === "main" || !b.parentBranchId || b.name.toLowerCase() === "main" || b.name.toLowerCase() === "trunk");
            setTrunkDocView(null);
            if (mainBranch && data.activeBranch.id !== mainBranch.id) {
                const trunkUrl = `/api/scribe/documents/${data.document.id}?branchId=${mainBranch.id}`;
                apiRequest("GET", trunkUrl)
                    .then((r) => r.json())
                    .then((td) => setTrunkDocView(td ?? null))
                    .catch((err) => {
                        console.error("Failed to load trunk branch for diff", err);
                        setTrunkDocView(null);
                    });
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    const handleCrystallize = async () => {
        if (!docView || isCrystallizing) return;
        const documentBrief = [
            `Desired outcome: ${briefOutcome.trim()}`,
            `Primary audience and approvers: ${briefAudience.trim()}`,
            briefConstraints.trim() ? `Requirements and constraints: ${briefConstraints.trim()}` : "",
            warmContext.trim() ? `Background, evidence, and source material: ${warmContext.trim()}` : "",
        ].filter(Boolean).join("\n");
        setIsCrystallizing(true);
        try {
            const res = await apiRequest("POST", `/api/scribe/documents/${docView.document.id}/crystallize`, {
                contextParagraph: documentBrief,
                extractedEntities: {
                    desired_outcome: briefOutcome.trim(),
                    primary_audience: briefAudience.trim(),
                    constraints: briefConstraints.trim(),
                },
            }, 45000);
            const updated: FullDocumentView = await res.json();
            setDocView(updated);
            setIsWarmCanvas(false);
            if (updated.nodes.length > 0) {
                setSelectedStationKey(updated.nodes[0].stationKey);
            }
        } catch (err: any) {
            console.error("Failed to crystallize document", err);
            setError(err.message || "Failed to crystallize context");
        } finally {
            setIsCrystallizing(false);
        }
    };

    const handleSyncCrew = async () => {
        if (!docView?.document.id || isSyncingCrew) return;
        setIsSyncingCrew(true);
        setError(null);
        try {
            const res = await apiRequest("POST", `/api/scribe/documents/${docView.document.id}/copilot/sync-crew`);
            const data = await res.json();
            if (data.success && data.document) {
                setDocView(data.document);
                setIsWarmCanvas(false);
                if (data.document.nodes?.length > 0) {
                    setSelectedStationKey(data.document.nodes[0].stationKey);
                }
            }
        } catch (err: any) {
            console.error("Failed to sync crew advice", err);
            setError(err.message || "Failed to sync crew advice");
        } finally {
            setIsSyncingCrew(false);
        }
    };

    const handleReset = async (newTitle?: string) => {
        setIsLoading(true);
        setError(null);
        try {
            const targetTitle = newTitle || subject || title || "Manuscript";
            let res: Response;
            if (sessionId) {
                res = await apiRequest("POST", `/api/scribe/session/${sessionId}/reset`, {
                    title: targetTitle,
                    archetypeMode,
                });
            } else if (docView?.document.id || openDocumentId) {
                const id = docView?.document.id || openDocumentId;
                res = await apiRequest("POST", `/api/scribe/documents/${id}/reset`, {
                    title: targetTitle,
                    archetypeMode,
                });
            } else {
                return;
            }
            const data: FullDocumentView = await res.json();
            setDocView(data);
            setSelectedStationKey(data.nodes.length > 0 ? data.nodes[0].stationKey : null);
            setIsWarmCanvas(true);
            setWarmContext("");
            setBriefOutcome("");
            setBriefAudience("");
            setBriefConstraints("");
        } catch (err: any) {
            console.error("Failed to reset Scribe Studio", err);
            setError(err.message || "Failed to reset Scribe Studio");
        } finally {
            setIsLoading(false);
        }
    };

    const effectiveSubject = (subject || title || "").trim();
    const prevSubjectRef = useRef<string>(effectiveSubject);

    useEffect(() => {
        const prev = prevSubjectRef.current;
        prevSubjectRef.current = effectiveSubject;
        // If subject changed to a distinct non-empty value after initial load, trigger reset
        if (prev && effectiveSubject && prev.toLowerCase() !== effectiveSubject.toLowerCase()) {
            void handleReset(effectiveSubject);
        }
    }, [effectiveSubject]);

    useEffect(() => {
        loadDocument();
    }, [openDocumentId, sessionId, archetypeMode]);

    // A new mount re-points the pod; a tree click does not go through the prop.
    useEffect(() => {
        if (documentId != null) setOpenDocumentId(documentId);
    }, [documentId]);

    // In-Pod Copilot: Auto-refresh manuscript state when stations or nodes update
    useEffect(() => {
        if (!docView?.document?.id) return;
        const interval = setInterval(() => {
            const docId = docView.document.id;
            apiRequest("GET", `/api/scribe/documents/${docId}`)
                .then((res) => res.json())
                .then((fresh: FullDocumentView) => {
                    if (
                        fresh &&
                        fresh.nodes &&
                        (fresh.nodes.length !== docView.nodes.length ||
                            fresh.document.currentRevision !== docView.document.currentRevision)
                    ) {
                        setDocView(fresh);
                        if (isWarmCanvas && fresh.nodes.length > 0) {
                            setIsWarmCanvas(false);
                        }
                    }
                })
                .catch(() => {});
        }, 4000);
        return () => clearInterval(interval);
    }, [docView?.document?.id, docView?.nodes?.length, docView?.document?.currentRevision, isWarmCanvas]);

    /**
     * Keep the manuscript readable.
     *
     * The three columns are fixed-width either side of a canvas that takes what
     * is left, and nothing checked the leftover was usable: 461px on a 1920px
     * screen, 266px on a 1440px one. fitRails folds the spine, and closes the
     * critics dock only if that was not enough.
     */
    useEffect(() => {
        const el = columnsRef.current;
        if (!el) return;

        const apply = () => {
            const available = el.getBoundingClientRect().width;
            // Zero is not a narrow container, it is an unmeasured one — before
            // first layout, or while the studio is in a hidden pane. Folding
            // the rails on that would decide the layout from nothing.
            if (available <= 0) return;

            const { spineCollapsed, dockOpen } = resolveRails(available, window.innerWidth, authorRails);
            setIsSpineCollapsed(spineCollapsed);
            setIsRightPanelOpen(dockOpen);
        };
        apply();

        // Absent in jsdom, and the studio must still mount without it.
        if (typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(apply);
        observer.observe(el);
        return () => observer.disconnect();
    }, [authorRails, docView !== null]);

    /**
     * Studio Keyboard Ergonomics:
     * - Cmd/Ctrl + S: Flush save immediately to server (fires save boundary & Tier 2 review)
     * - Cmd/Ctrl + Enter: Advance to next subway station node
     * - Cmd/Ctrl + J: Toggle Multi-Lens Critic Gallery dock
     * - Escape: Exit focus mode or dismiss modal
     */
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const isMod = e.metaKey || e.ctrlKey;

            // Save shortcut (Cmd/Ctrl + S)
            if (isMod && e.key.toLowerCase() === "s") {
                e.preventDefault();
                if (docView && selectedStationKey) {
                    const activeNode = docView.nodes.find((n) => n.stationKey === selectedStationKey);
                    if (activeNode) {
                        void handleSaveContent(activeNode.id, activeNode.content || "", activeNode.status);
                    }
                }
                return;
            }

            // Next Station shortcut (Cmd/Ctrl + Enter)
            if (isMod && e.key === "Enter") {
                e.preventDefault();
                if (docView && docView.nodes.length > 0) {
                    const currentIndex = docView.nodes.findIndex((n) => n.stationKey === selectedStationKey);
                    if (currentIndex !== -1 && currentIndex < docView.nodes.length - 1) {
                        setSelectedStationKey(docView.nodes[currentIndex + 1].stationKey);
                    }
                }
                return;
            }

            // Toggle Critic Gallery / Right Panel (Cmd/Ctrl + J)
            if (isMod && e.key.toLowerCase() === "j") {
                e.preventDefault();
                setIsRightPanelOpen((prev) => !prev);
                return;
            }

            // Exit Focus Mode on Escape
            if (e.key === "Escape" && isFocusMode && onToggleFocusMode) {
                e.preventDefault();
                onToggleFocusMode();
                return;
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [docView, selectedStationKey, isFocusMode, onToggleFocusMode]);

    /** Writes a station on the trunk while the studio is on a branch. */
    const applyToTrunk = async (nodeId: number, content: string) => {
        try {
            const res = await apiRequest("POST", `/api/scribe/nodes/${nodeId}`, { content });
            const updatedNode: ScribeNode = await res.json();
            setTrunkDocView((prev) =>
                prev
                    ? {
                          ...prev,
                          nodes: prev.nodes.map((n) => (n.id === nodeId ? { ...n, ...updatedNode } : n)),
                      }
                    : prev,
            );
        } catch (err: any) {
            console.error("Failed to apply branch content to trunk", err);
            setError(err.message || "Failed to apply to trunk");
        }
    };

    const handleSaveContent = async (nodeId: number, content: string, status?: ScribeNodeStatus) => {
        if (!docView) return;
        try {
            const body: Record<string, unknown> = { content };
            if (status) body.status = status;
            const res = await apiRequest("POST", `/api/scribe/nodes/${nodeId}`, body);
            const updatedNode: ScribeNode = await res.json();
            setDocView((prev) =>
                prev
                    ? {
                          ...prev,
                          nodes: prev.nodes.map((n) => (n.id === nodeId ? { ...n, ...updatedNode } : n)),
                      }
                    : prev,
            );

            // Phase 5: Auto-trigger critic evaluation on station content save (>=100 words)
            if (
                updatedNode.wordCount &&
                updatedNode.wordCount >= 100 &&
                !autoEvaluatedNodesRef.current.has(nodeId)
            ) {
                autoEvaluatedNodesRef.current.add(nodeId);
                const defaultLenses = docView.document.settings?.defaultLenses || ["legal", "stylistic", "devils_advocate"];
                void handleRunCriticEvaluation(defaultLenses);
            }
        } catch (err: any) {
            console.error("Failed to save content", err);
            setError(err.message || "Failed to save station content");
            // Re-thrown so the canvas can report it. Swallowing here is what
            // let the footer show a green "Synced" over a write that failed.
            throw err;
        }
    };

    const handleAddStation = async (stationTitle: string) => {
        if (!docView) return;
        try {
            const res = await apiRequest("POST", `/api/scribe/documents/${docView.document.id}/stations`, {
                title: stationTitle,
                branchId: docView.activeBranch.id,
            });
            const newNode: ScribeNode = await res.json();
            await loadDocument();
            if (newNode?.stationKey) {
                setSelectedStationKey(newNode.stationKey);
            }
        } catch (err: any) {
            console.error("Failed to add station", err);
            setError(err.message || "Failed to add station");
        }
    };

    const handleRenameStation = async (nodeId: number, newTitle: string) => {
        if (!docView) return;
        try {
            await apiRequest("PATCH", `/api/scribe/nodes/${nodeId}/rename`, { title: newTitle });
            await loadDocument();
        } catch (err: any) {
            console.error("Failed to rename station", err);
            setError(err.message || "Failed to rename station");
        }
    };

    const handleReorderStation = async (nodeId: number, direction: "up" | "down") => {
        if (!docView) return;
        const sortedNodes = [...docView.nodes].sort((a, b) => a.sortOrder - b.sortOrder);
        const idx = sortedNodes.findIndex((n) => n.id === nodeId);
        if (idx < 0) return;
        const swapIdx = direction === "up" ? idx - 1 : idx + 1;
        if (swapIdx < 0 || swapIdx >= sortedNodes.length) return;

        // Swap positions
        const reordered = [...sortedNodes];
        [reordered[idx], reordered[swapIdx]] = [reordered[swapIdx], reordered[idx]];
        const orderedNodeIds = reordered.map((n) => n.id);

        try {
            await apiRequest("POST", `/api/scribe/documents/${docView.document.id}/reorder-stations`, {
                orderedNodeIds,
                branchId: docView.activeBranch.id,
            });
            await loadDocument();
        } catch (err: any) {
            console.error("Failed to reorder stations", err);
            setError(err.message || "Failed to reorder stations");
        }
    };

    const handleDeleteStation = async (nodeId: number) => {
        if (!docView) return;
        try {
            await apiRequest("DELETE", `/api/scribe/nodes/${nodeId}`);
            // If the deleted station was selected, reset selection to first remaining
            if (docView.nodes.find((n) => n.id === nodeId)?.stationKey === selectedStationKey) {
                const remaining = docView.nodes.filter((n) => n.id !== nodeId);
                if (remaining.length > 0) {
                    setSelectedStationKey(remaining[0].stationKey);
                }
            }
            await loadDocument();
        } catch (err: any) {
            console.error("Failed to delete station", err);
            setError(err.message || "Failed to delete station");
        }
    };

    const handleUpdateStationStatus = async (nodeId: number, status: "draft" | "in_review" | "approved") => {
        if (!docView) return;
        const targetNode = docView.nodes.find((n) => n.id === nodeId);
        if (!targetNode) return;
        await handleSaveContent(nodeId, targetNode.content || "", status);
    };

    const handleInsertScaffolding = (textToInsert: string) => {
        if (!docView) return;
        const activeNode = docView.nodes.find((n) => n.stationKey === selectedStationKey);
        if (!activeNode) return;
        const existing = activeNode.content || "";
        const updated = existing ? `${existing}\n\n${textToInsert}` : textToInsert;
        void handleSaveContent(activeNode.id, updated);
    };

    const handleSwitchBranch = async (branchId: number) => {
        if (!docView) return;
        try {
            await apiRequest("POST", `/api/scribe/documents/${docView.document.id}/branches/${branchId}/switch`);
            loadDocument();
        } catch (err) {
            console.error("Failed to switch branch", err);
        }
    };

    const handleForkBranch = async (stationKey: string, branchName?: string) => {
        if (!docView) return;
        const station = docView.nodes.find((n) => n.stationKey === stationKey);
        const resolvedName = branchName || `Branch from ${station?.title || stationKey}`;
        try {
            await apiRequest("POST", "/api/scribe/branches/fork", {
                documentId: docView.document.id,
                fromBranchId: docView.activeBranch.id,
                name: resolvedName,
            });
            loadDocument();
        } catch (err) {
            console.error("Failed to fork branch", err);
        }
    };

    const handleRunCriticEvaluation = async (
        lenses: (ScribeLensType | string)[],
        lensDefinitions?: Array<{ id: string; label: string; description: string }>,
    ) => {
        if (!docView) return;
        const activeNode = docView.nodes.find((n) => n.stationKey === selectedStationKey);
        if (!activeNode) return;
        try {
            const res = await apiRequest("POST", "/api/scribe/critics/evaluate", {
                documentId: docView.document.id,
                nodeId: activeNode.id,
                lenses,
                lensDefinitions,
            });
            const { annotations: newAnnotations = [] } = (await res.json()) as {
                annotations?: ScribeAnnotation[];
            };
            setDocView((prev) =>
                prev
                    ? {
                          ...prev,
                          annotations: [
                              ...prev.annotations.filter((a) => a.nodeId !== activeNode.id),
                              ...newAnnotations.map(asFresh),
                          ],
                      }
                    : prev,
            );
        } catch (err: any) {
            console.error("Failed to run critic evaluation", err);
            const status = err.statusCode || err.status || 500;
            setError(`HTTP ${status}: critic pass failed - ${err.message || "critic unavailable"}`);
        }
    };

    const handleRunFullManuscriptAudit = async () => {
        if (!docView || isAuditingAll) return;
        setIsAuditingAll(true);
        try {
            for (const node of docView.nodes) {
                const res = await apiRequest("POST", "/api/scribe/critics/evaluate", {
                    documentId: docView.document.id,
                    nodeId: node.id,
                    lenses: ["legal", "stylistic", "devils_advocate", "pacing"],
                });
                const { annotations: newAnnotations = [] } = (await res.json()) as {
                    annotations?: ScribeAnnotation[];
                };
                setDocView((prev) =>
                    prev
                        ? {
                              ...prev,
                              annotations: [
                                  ...prev.annotations.filter((a) => a.nodeId !== node.id),
                                  ...newAnnotations.map(asFresh),
                              ],
                          }
                        : prev,
                );
            }
        } catch (err: any) {
            console.error("Full manuscript audit failed", err);
            const status = err.statusCode || err.status || 500;
            setError(`HTTP ${status}: audit failed - ${err.message || "audit unavailable"}`);
        } finally {
            setIsAuditingAll(false);
        }
    };

    /**
     * Swap the anchored passage for the proposal.
     *
     * This used to save proposedDiff as the station's entire content. The
     * critic prompt asks for "replacement text" for the excerpt — a clause, not
     * a section — so one click on a card replaced the author's whole draft with
     * a fragment, with no confirmation and no undo (the gallery bypasses the
     * canvas's snapshot history).
     *
     * Without an anchor there is nowhere to put the replacement, so nothing is
     * applied. The gallery does not offer the button in that case; this is the
     * guard behind it.
     */
    /**
     * Apply a critic's proposed fix, and close the finding it came from.
     *
     * Two things were wrong. It never touched the annotation, so a critique
     * stayed open after the author had acted on it — which made the gallery's
     * "N / M done" count everything except the work actually done. And it
     * returned silently on three separate conditions, the important one being an
     * anchor that no longer matches: that is precisely the case where the text
     * moved under the critique, and the author pressed Apply and was told
     * nothing at all.
     */
    const handleApplyDiff = async (
        proposedDiff: string,
        paragraphAnchor?: string | null,
        annotationId?: number,
    ) => {
        if (!docView) return;
        const activeNode = docView.nodes.find((n) => n.stationKey === selectedStationKey);
        if (!activeNode?.content) {
            setError("Open the station this critique applies to before applying its fix.");
            return;
        }
        if (!paragraphAnchor) {
            setError("This critique has no anchor, so there is no passage to replace.");
            return;
        }
        if (!activeNode.content.includes(paragraphAnchor)) {
            setError(
                "The passage this critique refers to has changed, so the fix was not applied. Re-run the critic pass to anchor it again.",
            );
            return;
        }

        setError(null);
        try {
            await handleSaveContent(
                activeNode.id,
                activeNode.content.replace(paragraphAnchor, proposedDiff),
            );
            // Only after the write lands: resolving a finding whose fix failed to
            // save would be the same lie in the other direction.
            if (annotationId) await setAnnotationStatus(annotationId, "resolved");
        } catch {
            // handleSaveContent has already reported it; the finding stays open.
        }
    };

    const handleCreateAnnotation = async (data: {
        lensType?: ScribeLensType;
        title: string;
        critiqueBody: string;
        paragraphAnchor?: string;
        proposedDiff?: string;
        severity?: ScribeAnnotationSeverity;
    }) => {
        if (!docView) return;
        const activeNode = docView.nodes.find((n) => n.stationKey === selectedStationKey);
        if (!activeNode) return;

        try {
            const res = await apiRequest("POST", "/api/scribe/annotations", {
                documentId: docView.document.id,
                nodeId: activeNode.id,
                ...data,
            });
            const newAnn: ScribeAnnotation = await res.json();
            setDocView((prev) =>
                prev
                    ? {
                          ...prev,
                          annotations: [...prev.annotations, asFresh(newAnn)],
                      }
                    : prev,
            );
        } catch (err) {
            console.error("Failed to create annotation", err);
        }
    };

    /**
     * Move one finding's review state.
     *
     * Shared by the toggle and by applying a fix, so the two cannot disagree
     * about what "resolved" does to the document view.
     */
    const setAnnotationStatus = async (annotationId: number, status: ScribeAnnotationStatus) => {
        // apiRequest throws a ClientAppError carrying the server's message on any
        // non-ok response, so there is no res.ok branch to write here.
        const res = await apiRequest("PATCH", `/api/scribe/annotations/${annotationId}`, { status });
        const updated: ScribeAnnotation = await res.json();
        setDocView((prev) =>
            prev
                ? {
                      ...prev,
                      annotations: prev.annotations.map((a) => (a.id === annotationId ? asFresh(updated) : a)),
                  }
                : prev,
        );
        return updated;
    };

    const handleToggleAnnotationStatus = async (annotationId: number, currentStatus: string) => {
        const nextStatus = currentStatus === "resolved" ? "open" : "resolved";
        try {
            await setAnnotationStatus(annotationId, nextStatus);
        } catch (err: any) {
            // Reported, not logged. A review state that silently failed to move
            // leaves the gallery showing something the server does not agree with.
            console.error("Failed to toggle annotation status", err);
            setError(err?.message || "Failed to update the review state.");
        }
    };

    const handleDeleteAnnotation = async (annotationId: number) => {
        try {
            await apiRequest("DELETE", `/api/scribe/annotations/${annotationId}`);
            setDocView((prev) =>
                prev
                    ? {
                          ...prev,
                          annotations: prev.annotations.filter((a) => a.id !== annotationId),
                          }
                    : prev,
            );
        } catch (err) {
            console.error("Failed to delete annotation", err);
        }
    };

    const handleDiscussAnnotationInChat = (ann: ScribeAnnotation) => {
        if (!onFocusInChat) return;
        const prompt = `@Critic Regarding feedback on "${ann.title}": "${ann.critiqueBody}". How can we best resolve this?`;
        const activeNode = docView?.nodes.find((n) => n.stationKey === selectedStationKey);
        onFocusInChat(
            {
                documentId: docView?.document.id,
                branchId: docView?.activeBranch.id,
                stationKey: selectedStationKey ?? undefined,
                stationTitle: activeNode?.title,
                nodeId: activeNode?.id,
                annotationId: ann.id,
                title: ann.title,
                lensType: ann.lensType,
                critiqueBody: ann.critiqueBody,
                proposedDiff: ann.proposedDiff ?? undefined,
            },
            prompt,
        );
    };

    const handleDiscussExcerptInChat = (excerpt: string, personaTag?: string) => {
        if (!onFocusInChat) return;
        const cleanPersona = personaTag ? personaTag.replace(/^@+/, '') : '';
        const recipient = cleanPersona ? `@${cleanPersona} ` : "@Crew ";
        const isGhostwriter = cleanPersona.toLowerCase().includes("ghostwriter");
        const isCopyEditor = cleanPersona.toLowerCase().includes("copyeditor");
        const activeNode = docView?.nodes.find((n) => n.stationKey === selectedStationKey);

        let prompt: string;
        if (isGhostwriter) {
            prompt = `${recipient}Please rewrite the following excerpt as polished, professional document prose for Station "${activeNode?.title || 'Active Station'}":\n\n"${excerpt}"\n\nOutput only the revised manuscript passage directly as part of the document (without conversational meta-commentary, advisory bullet points, or Q&A preambles) so it can directly replace this excerpt in the document.`;
        } else if (isCopyEditor) {
            prompt = `${recipient}Please copyedit and tighten the following excerpt for Station "${activeNode?.title || 'Active Station'}":\n\n"${excerpt}"\n\nOutput only the concise, polished manuscript prose directly so it can replace this excerpt in the document.`;
        } else {
            prompt = `${recipient}Regarding excerpt: "${excerpt}" in Station "${activeNode?.title || 'Active Station'}". Please provide a proposed rewrite as document prose so it can be inserted into the document.`;
        }
        const selectionPayload = {
            documentId: docView?.document.id,
            branchId: docView?.activeBranch.id,
            stationKey: selectedStationKey ?? undefined,
            stationTitle: activeNode?.title,
            nodeId: activeNode?.id,
            excerpt,
        };

        if (typeof window !== "undefined") {
            window.dispatchEvent(
                new CustomEvent("scribe:focus-chat", {
                    detail: {
                        selection: selectionPayload,
                        prompt,
                    },
                })
            );
        }

        onFocusInChat(selectionPayload, prompt);
    };

    // "word", not "docx": that is what the dock's button sends and what both
    // POST /api/scribe/export and scribe_export_manuscript accept. The mismatch
    // was type-only — the value passes straight through — so the build broke
    // while the runtime path happened to be correct.
    /**
     * Save the manuscript as a file.
     *
     * This used to read data.downloadUrl from a JSON reply, and the route has
     * never sent that key — so every export, in every format, silently did
     * nothing. The route now returns the file itself; this turns the response
     * into a download and says so when it cannot.
     */
    const handleExport = async (format: "markdown" | "word" | "pdf", theme?: ExportTypographyTheme) => {
        if (!docView || isExporting) return;
        setIsExporting(true);
        setError(null);
        try {
            const res = await apiRequest("POST", "/api/scribe/export", {
                documentId: docView.document.id,
                branchId: docView.activeBranch.id,
                format,
                typographyTheme: theme,
            });

            // A 415 for PDF, or any other failure, arrives as a thrown
            // ClientAppError already carrying the server's wording — apiRequest
            // never returns a non-ok response.
            const blob = await res.blob();
            const disposition = res.headers.get("Content-Disposition") ?? "";
            const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
            const filename = match ? decodeURIComponent(match[1]) : `${docView.document.title}.md`;

            const url = URL.createObjectURL(blob);
            const link = window.document.createElement("a");
            link.href = url;
            link.download = filename;
            window.document.body.appendChild(link);
            link.click();
            link.remove();
            // Freed on the next tick: revoking synchronously can cancel the
            // download in some browsers before it has started reading.
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (err: any) {
            console.error("Failed to export document", err);
            setError(err?.message || "Failed to export the manuscript.");
        } finally {
            setIsExporting(false);
        }
    };

    /**
     * Tier 1 ambient review, called from the canvas on the delta debounce.
     *
     * The response carries the findings, so the author's own gutter renders
     * from the HTTP reply rather than waiting on the round trip through Redis.
     * The `scribe-insight` event the server publishes is for everyone ELSE in
     * the room — agents and other viewers — who have no other way to see it.
     *
     * Rules only, no model: this is why it is safe on the delta timer at all.
     */
    const handleStreamDelta = async (nodeId: number, text: string) => {
        if (!docView) return;
        try {
            const res = await fetch("/api/scribe/deltas", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    documentId: docView.document.id,
                    nodeId,
                    text,
                    // The server only broadcasts on a change, so it needs to
                    // know what this client is already showing.
                    previous: lastInsightsRef.current,
                }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}: ambient review failed`);

            const data = await res.json();
            const raw: AmbientInsightWire[] = data.insights ?? [];
            lastInsightsRef.current = raw;

            return { insights: raw.map(toLiveInsight) };
        } catch (err) {
            // Ambient review is advisory. A failure must not interrupt typing
            // or surface as a document error, so it is logged and the gutter
            // simply keeps whatever it had.
            console.error("Ambient review failed", err);
            return undefined;
        }
    };

    /**
     * Accept a spelling the author says is fine.
     *
     * Drift detection is only worth having if it can be disagreed with. Without
     * this the same marker returns on every save, and a warning that cannot be
     * settled is one the author learns to scroll past — along with the ones
     * that matter.
     */
    const handleAcceptAlias = async (canonical: string, alias: string) => {
        if (!docView) return;
        try {
            const res = await fetch("/api/scribe/terms/alias", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ documentId: docView.document.id, canonical, alias }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || `HTTP ${res.status}: could not accept the alias`);
            }
            // Drop it from what the next delta reports as already-shown, so the
            // server treats the cleared marker as a change.
            lastInsightsRef.current = lastInsightsRef.current.filter(
                (i) => !(i.ruleId === "term_drift" && i.excerpt === alias),
            );
        } catch (err: any) {
            console.error("Failed to accept term alias", err);
            setError(err.message || "Could not accept the alias");
        }
    };

    const handlePublish = async (
        versionTag: string,
        releaseNotes?: string,
        /**
         * The typography theme chosen in the publish modal. The dock declared
         * it, passed it, and this handler took two arguments — so it was
         * dropped, and both the route and the stored publication record fell
         * back to corporate_legal whatever the author picked.
         */
        theme?: ExportTypographyTheme,
    ) => {
        if (!docView) return;
        await apiRequest("POST", `/api/scribe/documents/${docView.document.id}/publish`, {
            versionTag,
            releaseNotes,
            theme,
        });
        // Reload rather than patch: publishing bumps the revision, appends to
        // the publication history and posts a turn in the room.
        await loadDocument();
    };

    if (isLoading) {
        return (
            <div className="flex-1 flex items-center justify-center bg-card text-muted-foreground font-mono text-xs gap-2 min-h-[500px]">
                <RefreshCw className="w-4 h-4 animate-spin text-emerald-500" />
                Mounting Scribe Studio authoring pod...
            </div>
        );
    }

    if (error || !docView) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center bg-card text-destructive font-mono text-xs gap-3 min-h-[500px] p-6">
                <span>Failed to initialize Scribe Studio: {error}</span>
                <button
                    onClick={loadDocument}
                    className="px-3 py-1 bg-background border border-border rounded text-foreground hover:bg-muted"
                >
                    Retry
                </button>
            </div>
        );
    }

    const activeNode = docView.nodes.find((n) => n.stationKey === selectedStationKey) || docView.nodes[0] || null;
    const trunkActiveNode = trunkDocView?.nodes.find((n) => n.stationKey === selectedStationKey) || null;
    const criticRoles = CRITIC_ROLES_MAP[docView.document.archetypeMode] || ["Critic", "Reviewer"];

    /**
     * Re-derived every render rather than trusted from the payload.
     *
     * The server marks staleness when it builds the view, but the author edits
     * after that and handleSaveContent updates node content locally without
     * reloading — so a payload flag is wrong from the first keystroke, which is
     * exactly when a critique goes stale. Recomputing is a Map build and a
     * substring test per annotation, far cheaper than being wrong.
     */
    const annotations = markStaleness(docView.annotations, docView.nodes);

    /**
     * Also re-derived, for the same reason.
     *
     * telemetry arrives in the payload and was never recomputed: every later
     * setDocView spreads the same object forward while updating nodes, so the
     * footer reported the word count as of page load. An author filled three
     * stations and watched it sit at "28 / 5000w, 1 / 3 Done" until publishing
     * forced a reload.
     */
    const telemetry = computeTelemetry(docView.nodes, docView.document.targetWordCount);

    /**
     * The last publish, and whether the draft has moved since it.
     *
     * Derived from the nodes on screen, for the same reason as the rest: a
     * "still current" flag written at publish time is wrong from the author's
     * next keystroke.
     */
    const published = latestPublication(docView.document.settings?.publications, docView.nodes);

    return (
        <div className="flex min-h-0 min-w-0 flex-col h-full w-full bg-card text-card-foreground border border-border rounded-xl overflow-hidden shadow-2xl">
            {manuscriptRailTarget && createPortal(
                <ScribePageTree
                    key={treeRefreshKey}
                    activeDocumentId={docView.document.id}
                    onOpenDocument={setOpenDocumentId}
                    onTreeChanged={() => setTreeRefreshKey((k) => k + 1)}
                    onDocumentDeleted={() => setOpenDocumentId(undefined)}
                    className="min-h-0 h-full"
                />,
                manuscriptRailTarget,
            )}
            {/* Diff Viewer Modal */}
            {isDiffViewerOpen && activeNode && (
                <BranchDiffViewer
                    stationTitle={activeNode.title}
                    stationKey={activeNode.stationKey}
                    trunkNode={trunkActiveNode}
                    branchNode={activeNode}
                    activeBranch={docView.activeBranch}
                    onClose={() => setIsDiffViewerOpen(false)}
                    onApplyBranchToTrunk={(content) => {
                        if (trunkActiveNode) {
                            void applyToTrunk(trunkActiveNode.id, content);
                        }
                    }}
                />
            )}

            <div className="bg-card px-2 py-2 sm:px-4 border-b border-border flex items-center justify-between gap-2 font-mono text-xs select-none">
                <div className="flex min-w-0 items-center gap-2 overflow-hidden">
                    <BookOpen className="w-4 h-4 text-emerald-500 dark:text-emerald-400 shrink-0" />
                    <span className="font-bold text-foreground uppercase tracking-wider text-[11px]">
                        Scribe Studio
                    </span>
                    <span className="text-muted-foreground">•</span>
                    <span className="truncate text-emerald-700 dark:text-emerald-400 font-semibold">{docView.document.title}</span>
                    <span className="hidden sm:inline text-[10px] bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25 px-2 py-0.5 rounded-full font-bold uppercase">
                        {docView.document.archetypeMode.replaceAll("_", " ")}
                    </span>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                    <button
                        type="button"
                        data-testid="scribe-sync-crew-button"
                        onClick={() => void handleSyncCrew()}
                        disabled={isSyncingCrew}
                        className="flex items-center gap-1.5 rounded border border-indigo-500/40 bg-indigo-950/20 px-2.5 py-1 text-[11px] font-semibold text-indigo-300 transition-colors hover:bg-indigo-900/30 hover:border-indigo-400 disabled:opacity-50 shadow-xs"
                        title="Synchronize proposed Table of Contents & sections from Crew discussion directly into canvas"
                    >
                        <Sparkles className={cn("h-3.5 w-3.5 text-indigo-400", isSyncingCrew && "animate-spin")} />
                        <span className="hidden sm:inline">{isSyncingCrew ? "Syncing..." : "Sync Crew Outline"}</span>
                    </button>
                    <button
                        type="button"
                        data-testid="scribe-reset-button"
                        onClick={() => void handleReset()}
                        className="flex items-center gap-1.5 rounded border border-border bg-background px-2.5 py-1 text-[11px] font-semibold text-foreground transition-colors hover:border-amber-500/50 hover:text-amber-700 dark:hover:text-amber-300"
                        title="Reset Scribe Studio document for a new subject or fresh start"
                    >
                        <RefreshCw className={cn("h-3.5 w-3.5 text-amber-500", isLoading && "animate-spin")} />
                        <span className="hidden sm:inline">Reset</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => void handleExport("word")}
                        className="flex items-center gap-1.5 rounded border border-border bg-background px-2.5 py-1 text-[11px] font-semibold text-foreground transition-colors hover:border-emerald-500/50 hover:text-emerald-700 dark:hover:text-emerald-300"
                        title="Download this document as a Word DOCX"
                    >
                        <Download className="h-3.5 w-3.5 text-blue-500" />
                        <span className="hidden sm:inline">Download</span>
                    </button>
                    {onToggleFocusMode && (
                        <button
                            type="button"
                            onClick={onToggleFocusMode}
                            className="flex items-center gap-1.5 px-2.5 py-1 bg-background border border-border hover:border-emerald-500/50 rounded text-[11px] text-foreground hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors shadow-xs"
                            title={isFocusMode ? "Restore Split View (Show Chat)" : "Expand Studio (Collapse Chat)"}
                        >
                            {isFocusMode ? <Minimize2 className="w-3.5 h-3.5 text-emerald-500" /> : <Maximize2 className="w-3.5 h-3.5 text-emerald-500" />}
                            <span className="hidden sm:inline font-semibold">{isFocusMode ? "Show Chat" : "Focus Studio"}</span>
                        </button>
                    )}

                    {onClose && (
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex items-center gap-1.5 rounded border border-border bg-background px-2.5 py-1 text-[11px] font-semibold text-foreground transition-colors hover:border-border hover:bg-muted"
                            title="Close Scribe Studio and return to the scaffold rail"
                        >
                            <X className="h-3.5 w-3.5" />
                            <span className="hidden sm:inline">Exit</span>
                        </button>
                    )}
                </div>
            </div>

            {isWarmCanvas ? (
                <div className="flex flex-1 flex-col items-center justify-center p-8 text-center bg-card/60 overflow-y-auto" data-testid="scribe-warm-canvas">
                    <div className="max-w-xl w-full space-y-4">
                        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30">
                            <Sparkles className="h-6 w-6" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-foreground">
                                Build the document brief
                            </h2>
                            <p className="text-xs text-muted-foreground mt-1">
                                Answer the essentials first. Scribe will turn them into a structured, editable blueprint and seed every section.
                            </p>
                        </div>

                        <div className="grid gap-3 text-left sm:grid-cols-2">
                            <label className="space-y-1.5">
                                <span className="text-[11px] font-semibold text-foreground">What must this document accomplish? *</span>
                                <textarea
                                    value={briefOutcome}
                                    onChange={(e) => setBriefOutcome(e.target.value)}
                                    placeholder="Secure approval, define obligations, recommend a decision…"
                                    rows={3}
                                    className="w-full resize-none rounded-lg border border-border/80 bg-background/80 p-2.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-indigo-500/60 focus:outline-hidden"
                                />
                            </label>
                            <label className="space-y-1.5">
                                <span className="text-[11px] font-semibold text-foreground">Who will read or approve it? *</span>
                                <textarea
                                    value={briefAudience}
                                    onChange={(e) => setBriefAudience(e.target.value)}
                                    placeholder="Executive sponsor, procurement, engineering reviewers…"
                                    rows={3}
                                    className="w-full resize-none rounded-lg border border-border/80 bg-background/80 p-2.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-indigo-500/60 focus:outline-hidden"
                                />
                            </label>
                        </div>

                        <label className="block space-y-1.5 text-left">
                            <span className="text-[11px] font-semibold text-foreground">Requirements, format, and constraints</span>
                            <input
                                value={briefConstraints}
                                onChange={(e) => setBriefConstraints(e.target.value)}
                                placeholder="Required sections, deadline, jurisdiction, word count, tone, evaluation criteria…"
                                className="w-full rounded-lg border border-border/80 bg-background/80 px-3 py-2.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-indigo-500/60 focus:outline-hidden"
                            />
                        </label>

                        <div className="rounded-xl border border-border/80 bg-background/80 p-3 shadow-inner text-left space-y-2">
                            <span className="text-[11px] font-semibold text-foreground">Background, evidence, and source material</span>
                            <textarea
                                value={warmContext}
                                onChange={(e) => setWarmContext(e.target.value)}
                                placeholder="Paste relevant facts, prior decisions, source notes, or describe the material Scribe should work from. Unknowns will be marked [TBD]."
                                rows={4}
                                className="w-full resize-none bg-transparent text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-hidden"
                            />
                        </div>

                        <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-3 text-left">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-400">Proposed blueprint</p>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                                {docView.nodes.slice(0, 8).map((node) => (
                                    <span key={node.id} className="rounded-full border border-border/70 bg-background/70 px-2 py-1 text-[10px] text-muted-foreground">
                                        {node.title}
                                    </span>
                                ))}
                                {docView.nodes.length > 8 && <span className="px-1 py-1 text-[10px] text-muted-foreground">+{docView.nodes.length - 8} more</span>}
                            </div>
                        </div>

                        <div className="flex items-center justify-between pt-2">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setIsWarmCanvas(false)}
                                className="text-xs text-muted-foreground hover:text-foreground"
                            >
                                Skip to Blank Outline <ArrowRight className="ml-1 h-3 w-3 inline" />
                            </Button>

                            <Button
                                onClick={handleCrystallize}
                                disabled={isCrystallizing || !briefOutcome.trim() || !briefAudience.trim()}
                                className="bg-indigo-600 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 shadow-md"
                            >
                                {isCrystallizing ? (
                                    <>
                                        <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Crystallizing...
                                    </>
                                ) : (
                                    <>
                                        <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Build Structured Draft
                                    </>
                                )}
                            </Button>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="flex flex-1 flex-col min-h-0 min-w-0 overflow-hidden">
                    <div className="flex items-center justify-between border-b border-border/60 bg-muted/30 px-3.5 py-1 text-xs select-none shrink-0" data-testid="scribe-in-pod-copilot-bar">
                        <div className="flex items-center gap-2">
                            <span className="inline-flex items-center gap-1.5 font-semibold text-[11px] text-foreground">
                                <Sparkles className="h-3.5 w-3.5 text-indigo-400" /> Scribe Copilot (In-Pod Custodian)
                            </span>
                            <span className="text-[10px] text-muted-foreground hidden md:inline">• Connected to Living Canvas & Subway Spine</span>
                            {!manuscriptRailTarget && <button
                                type="button"
                                data-testid="scribe-tree-toggle"
                                onClick={() => setIsTreeOpen((v) => !v)}
                                className={cn(
                                    "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium transition-colors",
                                    isTreeOpen
                                        ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                                        : "border-border bg-muted text-muted-foreground hover:text-foreground",
                                )}
                                aria-label={isTreeOpen ? "Hide the manuscript tree" : "Show the manuscript tree"}
                            >
                                <FolderTree className="h-3 w-3" />
                                Manuscripts
                            </button>}
                        </div>
                        <div className="flex items-center gap-2.5">
                            <span className="text-[10px] text-muted-foreground font-mono">
                                {docView.nodes.length} stations • {docView.telemetry?.totalWordCount ?? 0} words
                            </span>
                            <button
                                type="button"
                                onClick={() => void handleSyncCrew()}
                                disabled={isSyncingCrew}
                                className="inline-flex items-center gap-1 text-[11px] text-indigo-700 dark:text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-300 font-medium cursor-pointer transition-colors"
                                title="Reconcile and sync outline suggestions from Crew chat advisors into canvas stations"
                            >
                                <Sparkles className={cn("h-3 w-3 text-amber-400", isSyncingCrew && "animate-spin")} />
                                {isSyncingCrew ? "Syncing..." : "Sync Crew Recommendations"}
                            </button>
                        </div>
                    </div>
                    <div
                        ref={columnsRef}
                        data-testid="scribe-studio-columns"
                    className="grid min-h-0 min-w-0 flex-1 overflow-hidden"
                    style={{
                        // The canvas is the only elastic track. Flexbox allowed
                        // its rich editor contents to retain an intrinsic width
                        // and push the companion dock beyond the clipped frame
                        // in Edge/Windows scaling. minmax(0, 1fr) explicitly
                        // permits the canvas to shrink inside the studio.
                        gridTemplateColumns: `${isTreeOpen && !manuscriptRailTarget ? "clamp(11rem, 13vw, 14rem) " : ""}${isSpineCollapsed ? "3rem" : "clamp(14rem, 16vw, 16rem)"} minmax(0, 1fr) ${isRightPanelOpen ? "clamp(16rem, 20vw, 20rem)" : "2.5rem"}`,
                    }}
                >
                    {isTreeOpen && !manuscriptRailTarget && (
                        <ScribePageTree
                            key={treeRefreshKey}
                            activeDocumentId={docView.document.id}
                            onOpenDocument={(id) => setOpenDocumentId(id)}
                            onTreeChanged={() => setTreeRefreshKey((k) => k + 1)}
                            onDocumentDeleted={() => setOpenDocumentId(undefined)}
                            className="min-h-0"
                        />
                    )}

                    {/* Column 1: Vertical Subway Spine */}
                    <VerticalSubwaySpine
                        nodes={docView.nodes}
                        activeBranch={docView.activeBranch}
                        allBranches={docView.allBranches}
                        selectedStationKey={selectedStationKey}
                        targetWordCount={docView.document.targetWordCount || 10000}
                        trunkNodes={trunkDocView?.nodes}
                        isAuditingAll={isAuditingAll}
                        isCollapsed={isSpineCollapsed}
                        onToggleCollapse={() => setRailByAuthor("spine", { spineCollapsed: !isSpineCollapsed })}
                        onSelectStation={(key) => setSelectedStationKey(key)}
                        onSwitchBranch={handleSwitchBranch}
                        onForkBranch={handleForkBranch}
                        onAddStation={handleAddStation}
                        onRenameStation={handleRenameStation}
                        onReorderStation={handleReorderStation}
                        onDeleteStation={handleDeleteStation}
                        onCompareBranch={() => setIsDiffViewerOpen(true)}
                        onRunFullManuscriptAudit={handleRunFullManuscriptAudit}
                        className="w-full 2xl:w-full"
                    />

                    {/* Column 2: Central Living Document Canvas */}
                    <div data-testid="scribe-living-canvas-column" className="flex min-h-0 min-w-0 w-full overflow-hidden relative">
                        <LivingDocumentCanvas
                            activeNode={activeNode}
                            allNodes={docView.nodes}
                            documentTitle={docView.document.title}
                            defaultMode="rendered"
                            onSelectStation={(key) => setSelectedStationKey(key)}
                            onSaveContent={handleSaveContent}
                            onUpdateStatus={handleUpdateStationStatus}
                            onCreateAnnotation={handleCreateAnnotation}
                            onDiscussWithCrew={handleDiscussExcerptInChat}
                            onStreamDelta={handleStreamDelta}
                            onAcceptAlias={handleAcceptAlias}
                        />
                    </div>

                    {/* Column 3: Tabbed Review & Co-Author Companion Dock */}
                    {isRightPanelOpen ? (
                        <div data-testid="scribe-companion-dock" className="flex h-full w-full min-w-0 flex-col select-none overflow-hidden border-l border-border bg-card/60 shadow-xs transition-all">
                            {/* Panel Tab Switcher Header */}
                            <div className="flex items-center justify-between px-2.5 py-2 border-b border-border bg-card/90 font-mono text-[11px]">
                                <div className="flex items-center gap-1 bg-muted/60 p-0.5 rounded-lg border border-border/50">
                                    <button
                                        type="button"
                                        onClick={() => setRightPanelTab("critics")}
                                        className={cn(
                                            "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold transition-all",
                                            rightPanelTab === "critics"
                                                ? "bg-background text-foreground shadow-xs border border-border"
                                                : "text-muted-foreground hover:text-foreground"
                                        )}
                                    >
                                        <span>👥 Critics</span>
                                        {docView.annotations.length > 0 && (
                                            <span className="bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 px-1.5 py-0.2 rounded-full text-[9px]">
                                                {docView.annotations.length}
                                            </span>
                                        )}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setRightPanelTab("gqe")}
                                        className={cn(
                                            "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold transition-all",
                                            rightPanelTab === "gqe"
                                                ? "bg-background text-foreground shadow-xs border border-border"
                                                : "text-muted-foreground hover:text-foreground"
                                        )}
                                    >
                                        <Sparkles className="w-3 h-3 text-indigo-400" />
                                        <span>Co-Author</span>
                                    </button>
                                    <button
                                        type="button"
                                        data-testid="scribe-governance-tab"
                                        onClick={() => setRightPanelTab("governance")}
                                        className={cn(
                                            "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold transition-all",
                                            rightPanelTab === "governance"
                                                ? "bg-background text-foreground shadow-xs border border-border"
                                                : "text-muted-foreground hover:text-foreground"
                                        )}
                                        title="AI-system metadata, version history, and review approvals"
                                    >
                                        <History className="w-3 h-3 text-sky-400" />
                                        <span>History</span>
                                    </button>
                                </div>

                                <button
                                    type="button"
                                    onClick={() => setRailByAuthor("dock", { dockOpen: false })}
                                    className="p-1 hover:bg-muted text-muted-foreground hover:text-foreground rounded transition-colors"
                                    title="Collapse companion rail"
                                >
                                    <ChevronRight className="w-3.5 h-3.5" />
                                </button>
                            </div>

                            {/* Tab Body */}
                            <div className="flex-1 min-h-0 overflow-y-auto">
                                {rightPanelTab === "governance" ? (
                                    <ScribeGovernancePanel
                                        document={docView.document}
                                        nodes={docView.nodes}
                                        activeNode={activeNode}
                                        onChanged={() => void loadDocument()}
                                        className="w-full h-full border-none"
                                    />
                                ) : rightPanelTab === "critics" ? (
                                    <MultiLensCriticGallery
                                        annotations={annotations}
                                        activeNodeId={activeNode?.id || null}
                                        criticRoles={criticRoles}
                                        onRunEvaluation={handleRunCriticEvaluation}
                                        onApplyDiff={handleApplyDiff}
                                        onCreateAnnotation={handleCreateAnnotation}
                                        onToggleStatus={handleToggleAnnotationStatus}
                                        onDeleteAnnotation={handleDeleteAnnotation}
                                        onDiscussWithCrew={handleDiscussAnnotationInChat}
                                        className="w-full h-full border-none"
                                    />
                                ) : activeNode ? (
                                    <AmbientGQESidebar
                                        archetypeMode={docView.document.archetypeMode}
                                        stationKey={activeNode.stationKey}
                                        stationTitle={activeNode.title}
                                        currentContent={activeNode.content || ""}
                                        onInsertScaffolding={handleInsertScaffolding}
                                        className="w-full h-full border-none overflow-y-auto"
                                    />
                                ) : (
                                    <div className="p-6 text-center text-xs text-muted-foreground font-mono">
                                        Select a station to view GQE co-author questions.
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center py-2 px-1 border-l border-border bg-card/60 gap-2 shrink-0 select-none">
                            <button
                                type="button"
                                onClick={() => {
                                    setRailByAuthor("dock", { dockOpen: true });
                                    setRightPanelTab("critics");
                                }}
                                className="p-1.5 hover:bg-muted text-muted-foreground hover:text-foreground rounded transition-colors relative"
                                title="Open Critics & Review Squad"
                            >
                                <Users className="w-4 h-4 text-emerald-400" />
                                {docView.annotations.length > 0 && (
                                    <span className="absolute -top-1 -right-1 w-2 h-2 bg-indigo-500 rounded-full" />
                                )}
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setRailByAuthor("dock", { dockOpen: true });
                                    setRightPanelTab("gqe");
                                }}
                                className="p-1.5 hover:bg-muted text-muted-foreground hover:text-foreground rounded transition-colors"
                                title="Open GQE Co-Author"
                            >
                                <Sparkles className="w-4 h-4 text-indigo-400" />
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setRailByAuthor("dock", { dockOpen: true });
                                    setRightPanelTab("governance");
                                }}
                                className="p-1.5 hover:bg-muted text-muted-foreground hover:text-foreground rounded transition-colors"
                                title="Open History & Governance"
                            >
                                <History className="w-4 h-4 text-sky-400" />
                            </button>
                        </div>
                    )}
                </div>
                </div>
            )}

            <TelemetryExportDock
                telemetry={telemetry}
                published={published}
                currentRevision={docView.document.currentRevision}
                onExport={handleExport}
                onPublish={handlePublish}
            />
        </div>
    );
};

export default ScribeStudioPod;
