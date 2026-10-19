import React, { useState } from "react";
import { useModalBehavior } from "@/hooks/use-modal-behavior";
import { ScribeAnnotation, ScribeLensType } from "@shared/schema/scribe";
import { scorableAnnotations, type AnnotationView } from "@shared/scribe-annotation-staleness";
import {
    Sparkles,
    Scale,
    Clock,
    Flame,
    CheckCircle,
    Search,
    Play,
    Plus,
    StickyNote,
    CheckSquare,
    Highlighter,
    Trash2,
    Check,
    X,
    MessageSquare,
    SlidersHorizontal,
    Activity,
    Shield,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface CustomLens {
    id: string;
    label: string;
    description: string;
    color: string;
}

interface MultiLensCriticGalleryProps {
    /**
     * Carrying whether each still describes text that exists. The pod re-derives
     * this on every render, so it stays right as the author types.
     */
    annotations: AnnotationView[];
    activeNodeId: number | null;
    criticRoles?: string[];
    onRunEvaluation: (
        lenses: (ScribeLensType | string)[],
        lensDefinitions?: Array<{ id: string; label: string; description: string }>,
    ) => void;
    /**
     * The anchor says where to put the replacement; without one nothing is applied.
     * The id says which finding to close once it is.
     */
    onApplyDiff?: (proposedDiff: string, paragraphAnchor?: string | null, annotationId?: number) => void;
    onCreateAnnotation?: (data: {
        lensType?: ScribeLensType;
        title: string;
        critiqueBody: string;
        proposedDiff?: string;
        severity?: "info" | "suggestion" | "warning" | "critical_conflict";
    }) => void;
    onToggleStatus?: (annotationId: number, currentStatus: string) => void;
    onDeleteAnnotation?: (annotationId: number) => void;
    onDiscussWithCrew?: (annotation: ScribeAnnotation) => void;
    className?: string;
}

export const MultiLensCriticGallery: React.FC<MultiLensCriticGalleryProps> = ({
    annotations,
    activeNodeId,
    criticRoles,
    onRunEvaluation,
    onApplyDiff,
    onCreateAnnotation,
    onToggleStatus,
    onDeleteAnnotation,
    onDiscussWithCrew,
    className,
}) => {
    const [selectedLens, setSelectedLens] = useState<string>("all");
    const [isEvaluating, setIsEvaluating] = useState(false);
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [newTitle, setNewTitle] = useState("");
    const [newBody, setNewBody] = useState("");
    const [newType, setNewType] = useState<ScribeLensType>("todo");

    // Custom Lenses Builder State
    const [customLenses, setCustomLenses] = useState<CustomLens[]>([
        { id: "compliance", label: "SOC-2 / Compliance", description: "Audits security, data handling and regulatory requirements", color: "text-indigo-500" },
    ]);
    const [isCustomLensModalOpen, setIsCustomLensModalOpen] = useState(false);
    const customLensPanelRef = useModalBehavior<HTMLDivElement>({
        isOpen: isCustomLensModalOpen,
        onClose: () => setIsCustomLensModalOpen(false),
    });
    const [customLensName, setCustomLensName] = useState("");
    const [customLensDesc, setCustomLensDesc] = useState("");

    const filteredAnnotations = annotations.filter((a) => {
        if (activeNodeId && a.nodeId !== activeNodeId) return false;
        if (selectedLens === "all") return true;
        if (selectedLens === "notes_todos") return a.lensType === "note" || a.lensType === "todo" || a.lensType === "highlight";
        return a.lensType === selectedLens;
    });

    /*
     * Manuscript health, over findings that still apply.
     *
     * The score used to count every unresolved annotation on the document,
     * including critiques of paragraphs that had since been rewritten and
     * findings belonging to another branch entirely. An author who fixed the
     * flagged clause watched the score stay where it was, because the finding
     * that pushed it down was still being counted.
     */
    const scorable = scorableAnnotations(annotations);
    const staleCount = annotations.length - scorable.length;
    const totalCount = scorable.length;
    const resolvedCount = scorable.filter((a) => a.status === "resolved").length;
    const criticalCount = scorable.filter((a) => a.severity === "critical_conflict" && a.status !== "resolved").length;
    const warningCount = scorable.filter((a) => a.severity === "warning" && a.status !== "resolved").length;
    const healthScore = totalCount === 0 ? 100 : Math.max(20, Math.round(((totalCount - (criticalCount * 2 + warningCount)) / Math.max(1, totalCount)) * 100));

    const handleRunEvaluation = async () => {
        setIsEvaluating(true);
        try {
            const allLensIds: (ScribeLensType | string)[] = [
                "legal",
                "stylistic",
                "devils_advocate",
                "pacing",
                ...customLenses.map((cl) => cl.id),
            ];
            // The server has criteria for the built-in lenses only, so a custom
            // lens has to carry its own definition or the model is asked to
            // review against a name and nothing else.
            await onRunEvaluation(allLensIds, customLenses.map((cl) => ({
                id: cl.id,
                label: cl.label,
                description: cl.description,
            })));
        } finally {
            setIsEvaluating(false);
        }
    };

    const handleCreateNote = () => {
        if (!newTitle.trim()) return;
        onCreateAnnotation?.({
            lensType: newType,
            title: newTitle.trim(),
            critiqueBody: newBody.trim() || newTitle.trim(),
            severity: newType === "todo" ? "warning" : "info",
        });
        setNewTitle("");
        setNewBody("");
        setIsAddOpen(false);
    };

    const handleCreateCustomLens = () => {
        if (!customLensName.trim()) return;
        const id = customLensName.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 20);
        setCustomLenses((prev) => [
            ...prev,
            {
                id,
                label: customLensName.trim(),
                description: customLensDesc.trim() || "Custom editorial audit lens",
                color: "text-purple-500",
            },
        ]);
        setCustomLensName("");
        setCustomLensDesc("");
        setIsCustomLensModalOpen(false);
    };

    const getLensIcon = (lens: string) => {
        switch (lens) {
            case "legal":
                return <Scale className="w-3.5 h-3.5 text-blue-500" />;
            case "stylistic":
                return <Sparkles className="w-3.5 h-3.5 text-emerald-500" />;
            case "pacing":
                return <Clock className="w-3.5 h-3.5 text-amber-500" />;
            case "devils_advocate":
                return <Flame className="w-3.5 h-3.5 text-red-500" />;
            case "todo":
                return <CheckSquare className="w-3.5 h-3.5 text-amber-500" />;
            case "note":
                return <StickyNote className="w-3.5 h-3.5 text-emerald-500" />;
            case "highlight":
                return <Highlighter className="w-3.5 h-3.5 text-yellow-500" />;
            default:
                return <Shield className="w-3.5 h-3.5 text-indigo-500" />;
        }
    };

    return (
        <div className={cn("flex h-full w-64 shrink-0 select-none flex-col overflow-y-auto border-l border-border bg-muted/20 p-3 font-mono text-xs 2xl:w-80", className)}>
            {/* Header & Run Evaluation Trigger */}
            <div className="mb-3 pb-3 border-b border-border flex items-center justify-between">
                <span className="text-[10px] uppercase font-bold tracking-wider text-foreground flex items-center gap-1.5">
                    👥 Critic Hub
                </span>
                <div className="flex items-center gap-1.5">
                    <button
                        onClick={() => setIsCustomLensModalOpen(true)}
                        className="px-2 py-1 bg-background hover:bg-muted border border-border text-foreground rounded flex items-center gap-1 text-[10px] font-bold transition-colors shadow-xs"
                        title="Add Custom Critic Lens"
                    >
                        <SlidersHorizontal className="w-3 h-3 text-indigo-500" />
                    </button>
                    <button
                        onClick={() => setIsAddOpen(true)}
                        className="px-2 py-1 bg-background hover:bg-muted border border-border text-foreground rounded flex items-center gap-1 text-[10px] font-bold transition-colors shadow-xs"
                        title="Add Note or To-Do"
                    >
                        <Plus className="w-3 h-3 text-emerald-500" />
                        <span>Add</span>
                    </button>
                    <button
                        onClick={handleRunEvaluation}
                        disabled={isEvaluating}
                        className="px-2.5 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/40 text-emerald-700 dark:text-emerald-300 rounded flex items-center gap-1 text-[10px] font-bold transition-colors shadow-xs disabled:opacity-50"
                    >
                        <Play className="w-2.5 h-2.5 fill-current" />
                        {isEvaluating ? "Auditing..." : "Audit"}
                    </button>
                </div>
            </div>

            {/*
              * The audit runs for a while, and its finishing was announced by
              * findings appearing in a list nobody was told had changed.
              *
              * A sibling of the button, not a child of it: nested inside, the
              * live region became part of the button's own accessible name, so
              * it announced as "Audit, Audit complete, 3 findings".
              */}
            <span className="sr-only" role="status" aria-live="polite">
                {isEvaluating
                    ? "Running critic audit"
                    : `Audit complete. ${scorable.length} finding${scorable.length === 1 ? "" : "s"}.`}
            </span>

            {/* Active Review Squad Announcement */}
            {criticRoles && criticRoles.length > 0 && (
                <div className="mb-3 rounded-lg border border-indigo-500/25 bg-indigo-950/30 p-2 text-[11px] font-sans">
                    <div className="flex items-center gap-1 font-bold text-indigo-400 text-[10px] uppercase tracking-wider">
                        <Shield className="w-3 h-3" /> Active Review Squad
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                        {criticRoles.map((role) => (
                            <span
                                key={role}
                                className="inline-flex items-center rounded bg-indigo-500/15 px-1.5 py-0.5 text-[10px] text-indigo-300 font-medium border border-indigo-500/20"
                            >
                                🔷 {role}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* Manuscript Health Score Summary Card */}
            <div className="mb-3 p-2.5 bg-card border border-border rounded-xl shadow-xs flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-emerald-500" />
                    <div className="flex flex-col">
                        <span className="text-[10px] font-bold uppercase text-muted-foreground">Health Index</span>
                        <span className="text-sm font-bold text-foreground">{healthScore}% Clean</span>
                    </div>
                </div>
                <div className="flex items-center gap-2 text-[10px]">
                    {criticalCount > 0 && (
                        <span className="text-red-500 font-bold bg-red-500/10 border border-red-500/30 px-1.5 py-0.5 rounded">
                            {criticalCount} critical
                        </span>
                    )}
                    {warningCount > 0 && (
                        <span className="text-amber-500 font-bold bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 rounded">
                            {warningCount} warn
                        </span>
                    )}
                    <span className="text-muted-foreground">
                        {resolvedCount}/{totalCount} done
                    </span>
                    {staleCount > 0 && (
                        <span
                            data-testid="stale-excluded-count"
                            title="These critiques are about text that has since changed, so they are not counted in the score"
                            className="text-muted-foreground bg-muted border border-border px-1.5 py-0.5 rounded"
                        >
                            {staleCount} outdated
                        </span>
                    )}
                </div>
            </div>

            {/* Custom Lens Modal */}
            {isCustomLensModalOpen && (
                <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/50 p-4">
                    <div
                        ref={customLensPanelRef}
                        role="dialog"
                        aria-modal="true"
                        aria-label="Add a custom lens"
                        className="bg-card border border-border p-4 rounded-xl shadow-2xl w-full max-w-sm flex flex-col gap-3 font-mono text-xs"
                    >
                        <div className="flex items-center justify-between border-b border-border pb-2">
                            <span className="font-bold text-foreground text-sm flex items-center gap-1.5">
                                <SlidersHorizontal className="w-4 h-4 text-indigo-500" /> New Critic Lens
                            </span>
                            <button onClick={() => setIsCustomLensModalOpen(false)} className="text-muted-foreground hover:text-foreground">
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        <input
                            type="text"
                            value={customLensName}
                            onChange={(e) => setCustomLensName(e.target.value)}
                            placeholder="Lens name (e.g., SOC-2 Security Auditor)..."
                            className="w-full px-2.5 py-1.5 bg-background border border-border rounded text-foreground text-xs focus:outline-none focus:border-emerald-500"
                            autoFocus
                        />
                        <textarea
                            value={customLensDesc}
                            onChange={(e) => setCustomLensDesc(e.target.value)}
                            placeholder="Evaluation directive / criteria..."
                            rows={3}
                            className="w-full px-2.5 py-1.5 bg-background border border-border rounded text-foreground text-xs focus:outline-none focus:border-emerald-500 resize-none font-sans"
                        />
                        <button
                            onClick={handleCreateCustomLens}
                            className="w-full py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded text-xs transition-colors shadow-xs"
                        >
                            Create Custom Lens
                        </button>
                    </div>
                </div>
            )}

            {/* Inline Add Note / To-Do Form Drawer */}
            {isAddOpen && (
                <div className="mb-3 p-3 bg-card border border-emerald-500/40 rounded-xl shadow-lg flex flex-col gap-2.5 animate-in fade-in zoom-in-95">
                    <div className="flex items-center justify-between text-[11px] font-bold text-foreground">
                        <span>Create Note / To-Do</span>
                        <button onClick={() => setIsAddOpen(false)} className="p-0.5 text-muted-foreground hover:text-foreground">
                            <X className="w-3.5 h-3.5" />
                        </button>
                    </div>

                    <div className="flex flex-wrap gap-1">
                        {(["todo", "note", "stylistic", "legal"] as ScribeLensType[]).map((t) => (
                            <button
                                key={t}
                                onClick={() => setNewType(t)}
                                className={`flex-1 py-1 rounded text-[10px] font-bold capitalize transition-colors ${
                                    newType === t ? "bg-emerald-500 text-white shadow-xs" : "bg-muted text-muted-foreground hover:text-foreground"
                                }`}
                            >
                                {t === "todo" ? "To-Do" : t}
                            </button>
                        ))}
                    </div>

                    <input
                        type="text"
                        value={newTitle}
                        onChange={(e) => setNewTitle(e.target.value)}
                        placeholder="Title or action item..."
                        className="w-full px-2.5 py-1 bg-background border border-border rounded text-foreground text-xs focus:outline-none focus:border-emerald-500"
                        autoFocus
                    />

                    <textarea
                        value={newBody}
                        onChange={(e) => setNewBody(e.target.value)}
                        placeholder="Details or reference context (optional)..."
                        rows={2}
                        className="w-full px-2.5 py-1 bg-background border border-border rounded text-foreground text-xs focus:outline-none focus:border-emerald-500 resize-none font-sans"
                    />

                    <button
                        onClick={handleCreateNote}
                        className="w-full py-1 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded text-xs transition-colors shadow-xs"
                    >
                        Save Card
                    </button>
                </div>
            )}

            {/* Lens Filter Tabs */}
            {/*
              * Wraps rather than scrolls.
              *
              * Seven lens filters come to 510px; the panel gives them 296 at a
              * 1920px viewport and 263 at 1440. As a single overflow-x-auto row
              * that put Devil's Advocate and SOC-2 / Compliance past the panel
              * edge with no affordance saying they were there — a filter you
              * cannot see is a filter you do not have.
              */}
            <div className="flex flex-wrap items-center gap-1 pb-3 border-b border-border mb-3">
                {[
                    { id: "all", label: "All" },
                    { id: "notes_todos", label: "Notes & To-Dos" },
                    { id: "legal", label: "Legal" },
                    { id: "stylistic", label: "Style" },
                    { id: "pacing", label: "Pacing" },
                    { id: "devils_advocate", label: "Devil's Adv" },
                    ...customLenses.map((cl) => ({ id: cl.id, label: cl.label })),
                ].map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => setSelectedLens(tab.id)}
                        className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider whitespace-nowrap transition-colors ${
                            selectedLens === tab.id
                                ? "bg-card text-emerald-700 dark:text-emerald-400 border border-border shadow-xs"
                                : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                        }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Margin Annotation Cards */}
            <div className="flex flex-col gap-2.5 flex-1">
                {filteredAnnotations.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground text-[11px] leading-relaxed">
                        No annotations matching this filter. Click <span className="text-emerald-700 dark:text-emerald-400 font-bold">"+ Add"</span> or <span className="text-emerald-700 dark:text-emerald-400 font-bold">"Audit"</span> to populate.
                    </div>
                ) : (
                    filteredAnnotations.map((annot) => {
                        const isSevere = annot.severity === "critical_conflict" || annot.severity === "warning";
                        const isResolved = annot.status === "resolved";
                        const isTodo = annot.lensType === "todo";
                        // A critique about text that no longer exists. Shown
                        // rather than hidden — the author may still want to read
                        // it — but not scored, and not actionable.
                        const isStale = annot.isStale;

                        return (
                            <div
                                key={annot.id}
                                className={`p-3 rounded-lg border flex flex-col gap-2 transition-all shadow-xs group ${
                                    isResolved
                                        ? "bg-muted/40 border-border/60 opacity-60"
                                        : isSevere
                                        ? "bg-red-500/10 border-red-500/30 text-foreground"
                                        : "bg-card border-border text-foreground"
                                }`}
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-1.5">
                                        {getLensIcon(annot.lensType)}
                                        <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
                                            {annot.lensType === "todo" ? "To-Do Item" : annot.lensType.replace("_", " ")}
                                        </span>
                                    </div>

                                    <div className="flex items-center gap-1.5">
                                        {onToggleStatus ? (
                                            <button
                                                type="button"
                                                onClick={() => onToggleStatus(annot.id, annot.status)}
                                                className={`text-[9px] uppercase px-1.5 py-0.5 rounded font-bold transition-colors cursor-pointer ${
                                                    isResolved
                                                        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25"
                                                        : isSevere
                                                        ? "bg-red-500/15 text-red-700 dark:text-red-300 border border-red-500/30 hover:bg-red-500/25"
                                                        : "bg-muted hover:bg-muted/80 text-muted-foreground"
                                                }`}
                                                title={isResolved ? "Click to reopen" : "Click to mark resolved"}
                                                // The visible text is the severity, so the accessible
                                                // name was "suggestion" — a label for what the finding
                                                // IS, on a control that changes what it is.
                                                aria-label={isResolved ? "Reopen this critique" : "Mark this critique resolved"}
                                            >
                                                {isResolved ? "✓ Resolved" : annot.severity}
                                            </button>
                                        ) : (
                                            <span
                                                className={`text-[9px] uppercase px-1.5 py-0.5 rounded font-bold ${
                                                    isResolved
                                                        ? "bg-emerald-500/10 text-emerald-700 border border-emerald-500/20"
                                                        : isSevere
                                                        ? "bg-red-500/15 text-red-700 dark:text-red-300 border border-red-500/30"
                                                        : "bg-muted text-muted-foreground"
                                                }`}
                                            >
                                                {isResolved ? "Done" : annot.severity}
                                            </span>
                                        )}

                                        {onDeleteAnnotation && (
                                            <button
                                                onClick={() => onDeleteAnnotation(annot.id)}
                                                className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-destructive/10 text-muted-foreground hover:text-destructive rounded transition-opacity"
                                                title="Delete annotation"
                                            >
                                                <Trash2 className="w-3 h-3" />
                                            </button>
                                        )}
                                    </div>
                                </div>

                                <div className="flex items-start gap-2">
                                    {isTodo && onToggleStatus && (
                                        <button
                                            type="button"
                                            onClick={() => onToggleStatus(annot.id, annot.status)}
                                            className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center transition-colors shrink-0 ${
                                                isResolved
                                                    ? "bg-emerald-500 border-emerald-600 text-white"
                                                    : "border-border hover:border-emerald-500 bg-background"
                                            }`}
                                            title={isResolved ? "Mark as open" : "Mark as completed"}
                                        >
                                            {isResolved && <Check className="w-3 h-3" />}
                                        </button>
                                    )}

                                    <div className="flex-1 min-w-0">
                                        <div className={`font-bold text-xs text-foreground ${isResolved ? "line-through text-muted-foreground" : ""}`}>
                                            {annot.title}
                                        </div>
                                        {annot.critiqueBody && annot.critiqueBody !== annot.title && (
                                            <div className={`text-[11px] text-muted-foreground leading-relaxed font-sans mt-0.5 ${isResolved ? "line-through opacity-70" : ""}`}>
                                                {annot.critiqueBody}
                                            </div>
                                        )}
                                        {/*
                                          * The phrase the critique is about.
                                          * paragraphAnchor has existed on the
                                          * table since Scribe shipped and was
                                          * never written or read, so a finding
                                          * like "use active voice" arrived with
                                          * no indication of where it applied.
                                          */}
                                        {annot.paragraphAnchor && !isResolved && (
                                            <div
                                                data-testid="annotation-anchor"
                                                title={isStale ? "This passage is no longer in the station" : "The passage this critique refers to"}
                                                className={`mt-1 border-l-2 pl-2 font-serif italic text-[11px] line-clamp-2 ${
                                                    isStale ? "border-dashed border-border/60 text-muted-foreground/60 line-through" : "border-border text-muted-foreground/90"
                                                }`}
                                            >
                                                “{annot.paragraphAnchor}”
                                            </div>
                                        )}
                                        {isStale && !isResolved && (
                                            <div
                                                data-testid="annotation-stale"
                                                className="mt-1.5 text-[10px] font-semibold text-muted-foreground flex items-center gap-1"
                                            >
                                                <Clock className="w-3 h-3" />
                                                {annot.staleReason === "other_branch"
                                                    ? "From another branch — not counted here"
                                                    : "The text this refers to has changed — not counted"}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {annot.proposedDiff && !isResolved && !isStale && annot.paragraphAnchor && (
                                    <div className="mt-1 pt-2 border-t border-border flex flex-col gap-1.5">
                                        <div className="text-[10px] text-emerald-700 dark:text-emerald-400 font-bold">⚡ Proposed Adjustment:</div>
                                        <div className="bg-muted/50 p-2 rounded border border-emerald-500/30 text-[10px] text-foreground font-serif italic">
                                            "{annot.proposedDiff}"
                                        </div>
                                        <button
                                            onClick={() => onApplyDiff?.(annot.proposedDiff!, annot.paragraphAnchor, annot.id)}
                                            className="mt-1 w-full py-1 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/40 text-emerald-700 dark:text-emerald-300 rounded text-[10px] font-bold flex items-center justify-center gap-1 transition-colors shadow-xs"
                                        >
                                            <CheckCircle className="w-3 h-3" /> Apply Proposed Fix
                                        </button>
                                    </div>
                                )}

                                {onDiscussWithCrew && !isResolved && (
                                    <button
                                        onClick={() => onDiscussWithCrew(annot)}
                                        className="mt-1 w-full py-1 bg-background hover:bg-muted border border-border hover:border-emerald-500/50 rounded text-[10px] font-semibold text-muted-foreground hover:text-foreground flex items-center justify-center gap-1 transition-colors shadow-xs"
                                        title="Target this annotation in Agent Chat"
                                    >
                                        <MessageSquare className="w-3 h-3 text-emerald-500" /> Discuss with Crew
                                    </button>
                                )}
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
};
