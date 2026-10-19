import React, { useState, useRef } from "react";
import { ScribeNode, ScribeBranch } from "@shared/schema/scribe";
import { GitFork, CheckCircle2, AlertTriangle, Plus, GitCompare, ShieldCheck, RefreshCw, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Pencil, Trash2, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface VerticalSubwaySpineProps {
    nodes: ScribeNode[];
    activeBranch: ScribeBranch;
    allBranches: ScribeBranch[];
    selectedStationKey: string | null;
    targetWordCount: number;
    trunkNodes?: ScribeNode[];
    isAuditingAll?: boolean;
    isCollapsed?: boolean;
    onToggleCollapse?: () => void;
    onSelectStation: (stationKey: string) => void;
    onSwitchBranch: (branchId: number) => void;
    onForkBranch: (stationKey: string) => void;
    onAddStation?: (title: string) => void;
    onRenameStation?: (nodeId: number, newTitle: string) => void;
    onReorderStation?: (nodeId: number, direction: "up" | "down") => void;
    onDeleteStation?: (nodeId: number) => void;
    onCompareBranch?: () => void;
    onRunFullManuscriptAudit?: () => void;
    className?: string;
}

export const VerticalSubwaySpine: React.FC<VerticalSubwaySpineProps> = ({
    nodes,
    activeBranch,
    allBranches,
    selectedStationKey,
    targetWordCount,
    trunkNodes,
    isAuditingAll = false,
    isCollapsed = false,
    onToggleCollapse,
    onSelectStation,
    onSwitchBranch,
    onForkBranch,
    onAddStation,
    onRenameStation,
    onReorderStation,
    onDeleteStation,
    onCompareBranch,
    onRunFullManuscriptAudit,
    className,
}) => {
    const [hoveredStation, setHoveredStation] = useState<string | null>(null);
    const [isAddingStation, setIsAddingStation] = useState(false);
    const [newStationTitle, setNewStationTitle] = useState("");
    const [renamingNodeId, setRenamingNodeId] = useState<number | null>(null);
    const [renameValue, setRenameValue] = useState("");
    const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null);

    const isNonTrunkBranch = activeBranch && activeBranch.name.toLowerCase() !== "main" && activeBranch.name.toLowerCase() !== "trunk";

    // Map trunk nodes for delta comparison
    const trunkNodeMap = new Map((trunkNodes || []).map((n) => [n.stationKey, n]));

    const startRename = (node: ScribeNode, e: React.MouseEvent) => {
        e.stopPropagation();
        setRenamingNodeId(node.id);
        setRenameValue(node.title);
    };

    const commitRename = () => {
        if (cancellingRef.current) return;
        if (renamingNodeId && renameValue.trim() && onRenameStation) {
            onRenameStation(renamingNodeId, renameValue.trim());
        }
        setRenamingNodeId(null);
        setRenameValue("");
    };

    /**
     * Cancel has to survive the input\'s own blur.
     *
     * Clicking the X blurs the field first, and the blur handler commits — so
     * without this flag the cancel button saves the edit it was meant to discard.
     * onMouseDown fires before blur, which is the only ordering that can set it.
     */
    const cancellingRef = useRef(false);

    const cancelRename = () => {
        cancellingRef.current = false;
        setRenamingNodeId(null);
        setRenameValue("");
    };

    if (isCollapsed) {
        return (
            <div className={cn("flex h-full w-12 shrink-0 select-none flex-col items-center border-r border-border bg-muted/20 py-2.5 font-mono text-xs gap-2", className)}>
                {onToggleCollapse && (
                    <button
                        type="button"
                        onClick={onToggleCollapse}
                        className="p-1 hover:bg-muted text-muted-foreground hover:text-foreground rounded transition-colors"
                        title="Expand Subway Spine"
                    >
                        <ChevronRight className="w-4 h-4 text-emerald-500" />
                    </button>
                )}
                <div className="w-6 h-px bg-border my-1" />
                <div className="flex flex-col gap-2 items-center overflow-y-auto w-full py-1">
                    {nodes.map((node, idx) => {
                        const isSelected = selectedStationKey === node.stationKey;
                        // scribeNodeStatuses is draft | in_review | approved |
                        // continuity_conflict. There is no "ready", so that half
                        // of the test could never be true.
                        const isComplete = node.status === "approved";
                        return (
                            <button
                                key={node.id}
                                type="button"
                                onClick={() => onSelectStation(node.stationKey)}
                                className={cn(
                                    "w-8 h-8 rounded-full flex items-center justify-center font-bold text-[11px] transition-all relative",
                                    isSelected
                                        ? "bg-emerald-500 text-white shadow-md ring-2 ring-emerald-400/40"
                                        : isComplete
                                        ? "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/30"
                                        : "bg-background text-muted-foreground hover:text-foreground border border-border"
                                )}
                                title={`#${idx + 1}: ${node.title}`}
                            >
                                {idx + 1}
                            </button>
                        );
                    })}
                </div>
            </div>
        );
    }

    return (
        <div className={cn("flex h-full w-56 2xl:w-64 shrink-0 select-none flex-col overflow-y-auto border-r border-border bg-muted/20 p-3 font-mono text-xs", className)}>
            {/* Header & Branch Switcher */}
            <div className="mb-3 pb-3 border-b border-border flex flex-col gap-2">
                <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                        <GitFork className="w-3.5 h-3.5" /> Subway Spine
                    </span>
                    <div className="flex items-center gap-1">
                        <span className="text-[10px] text-muted-foreground bg-background px-2 py-0.5 rounded border border-border">
                            {nodes.length} Stations
                        </span>
                        {onToggleCollapse && (
                            <button
                                type="button"
                                onClick={onToggleCollapse}
                                className="p-0.5 hover:bg-muted text-muted-foreground hover:text-foreground rounded transition-colors ml-1"
                                title="Collapse Subway Spine"
                            >
                                <ChevronLeft className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>
                </div>

                {/* Active Branch Pill */}
                <div className="flex items-center gap-1.5 bg-background border border-border p-1.5 rounded-lg shadow-xs">
                    <select
                        // axe: select-name, critical. It had no accessible name
                        // at all, so a screen reader announced the current
                        // branch as the whole of what this control is.
                        aria-label="Active manuscript branch"
                        value={activeBranch?.id || ""}
                        onChange={(e) => onSwitchBranch(Number(e.target.value))}
                        className="bg-transparent text-foreground text-xs w-full focus:outline-none cursor-pointer"
                    >
                        {allBranches.map((b) => (
                            <option key={b.id} value={b.id} className="bg-popover text-popover-foreground">
                                {b.name} {b.status === "merged" ? "(Merged)" : ""}
                            </option>
                        ))}
                    </select>
                </div>

                {/* Header Actions: Compare Branch & Full Manuscript Audit */}
                <div className="flex items-center gap-1.5 pt-1">
                    {isNonTrunkBranch && onCompareBranch && (
                        <button
                            onClick={onCompareBranch}
                            className="flex-1 py-1 px-2 rounded border border-sky-500/40 bg-sky-500/10 hover:bg-sky-500/20 text-sky-700 dark:text-sky-300 flex items-center justify-center gap-1 text-[10px] font-semibold transition-colors shadow-xs"
                            title="Side-by-side comparison of active branch against main trunk"
                        >
                            <GitCompare className="w-3 h-3" /> Compare Diff
                        </button>
                    )}

                    {onRunFullManuscriptAudit && (
                        <button
                            onClick={onRunFullManuscriptAudit}
                            disabled={isAuditingAll}
                            className={`flex-1 py-1 px-2 rounded border transition-colors flex items-center justify-center gap-1 text-[10px] font-bold shadow-xs ${
                                isAuditingAll
                                    ? "bg-amber-500/20 border-amber-500/40 text-amber-700 animate-pulse cursor-wait"
                                    : "bg-emerald-500/10 border-emerald-500/40 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
                            }`}
                            title="Run a multi-lens audit pass across all stations in the document"
                        >
                            {isAuditingAll ? <RefreshCw className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3 text-emerald-500" />}
                            <span>{isAuditingAll ? "Auditing..." : "Audit All"}</span>
                        </button>
                    )}
                </div>
            </div>

            {/* Vertical Subway Station Track */}
            <div className="relative flex flex-col flex-1 pl-2">
                {/* Continuous Subway Vertical Line */}
                <div className="absolute left-[19px] top-3 bottom-6 w-0.5 bg-gradient-to-b from-emerald-500/80 via-border to-border/40" />

                {nodes.map((node, idx) => {
                    const isSelected = selectedStationKey === node.stationKey;
                    const isConflict = node.status === "continuity_conflict";
                    const isApproved = node.status === "approved";
                    const stationTarget = Math.round(targetWordCount * (node.targetPercentage || 0.1));
                    const progressPct = Math.min(100, Math.round(((node.wordCount || 0) / (stationTarget || 1)) * 100));
                    const isHovered = hoveredStation === node.stationKey;
                    const isRenaming = renamingNodeId === node.id;
                    const isConfirmingDelete = confirmingDeleteId === node.id;
                    const isFirst = idx === 0;
                    const isLast = idx === nodes.length - 1;

                    // Compute branch delta relative to trunk
                    const trunkNode = trunkNodeMap.get(node.stationKey);
                    let deltaLabel: string | null = null;
                    let deltaColor = "text-muted-foreground";

                    if (isNonTrunkBranch && trunkNode) {
                        const trunkWords = trunkNode.wordCount || 0;
                        const branchWords = node.wordCount || 0;
                        const diff = branchWords - trunkWords;
                        if (node.content !== trunkNode.content) {
                            if (diff > 0) {
                                deltaLabel = `+${diff}w`;
                                deltaColor = "text-emerald-500";
                            } else if (diff < 0) {
                                deltaLabel = `${diff}w`;
                                deltaColor = "text-amber-500";
                            } else {
                                deltaLabel = "Δ mod";
                                deltaColor = "text-sky-500";
                            }
                        }
                    }

                    return (
                        <div
                            key={node.id}
                            className={`group relative flex items-start gap-3 py-2 px-2 rounded-lg cursor-pointer transition-all ${
                                isSelected
                                    ? "bg-card border border-emerald-500/50 shadow-md ring-1 ring-emerald-500/20"
                                    : "hover:bg-muted/60 border border-transparent"
                            }`}
                            onClick={() => onSelectStation(node.stationKey)}
                            onMouseEnter={() => setHoveredStation(node.stationKey)}
                            onMouseLeave={() => {
                                setHoveredStation(null);
                                // Reset confirming delete when mouse leaves
                                if (isConfirmingDelete) setConfirmingDeleteId(null);
                            }}
                        >
                            {/* Subway Node Circle Icon */}
                            <div
                                className={`relative z-10 w-5 h-5 rounded-full flex items-center justify-center border-2 shrink-0 transition-transform ${
                                    isConflict
                                        ? "bg-red-500/15 border-red-500 text-red-700 dark:text-red-400 animate-pulse"
                                        : isApproved
                                        ? "bg-emerald-500/15 border-emerald-500 text-emerald-700 dark:text-emerald-400"
                                        : isSelected
                                        ? "bg-card border-emerald-500 text-emerald-700 dark:text-emerald-400 scale-110 shadow-sm"
                                        : "bg-background border-border text-muted-foreground group-hover:border-foreground/40"
                                    }`}
                            >
                                {isConflict ? (
                                    <AlertTriangle className="w-2.5 h-2.5" />
                                ) : isApproved ? (
                                    <CheckCircle2 className="w-2.5 h-2.5" />
                                ) : (
                                    <div className="w-1.5 h-1.5 rounded-full bg-current" />
                                )}
                            </div>

                            {/* Station Info & Word Progress */}
                            <div className="flex flex-col flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-1">
                                    {isRenaming ? (
                                        /* Inline Rename Input */
                                        <div className="flex items-center gap-1 flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
                                            <input
                                                type="text"
                                                value={renameValue}
                                                onChange={(e) => setRenameValue(e.target.value)}
                                                onKeyDown={(e) => {
                                                    if (e.key === "Enter") commitRename();
                                                    else if (e.key === "Escape") { cancellingRef.current = true; cancelRename(); }
                                                }}
                                                className="flex-1 min-w-0 px-1.5 py-0.5 bg-background border border-emerald-500/50 rounded text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
                                                autoFocus
                                                onBlur={commitRename}
                                            />
                                            <button
                                                type="button"
                                                onClick={(e) => { e.stopPropagation(); commitRename(); }}
                                                className="p-0.5 hover:bg-emerald-500/20 text-emerald-600 rounded"
                                                title="Confirm rename"
                                            >
                                                <Check className="w-3 h-3" />
                                            </button>
                                            <button
                                                type="button"
                                                onMouseDown={() => { cancellingRef.current = true; }}
                                                onClick={(e) => { e.stopPropagation(); cancelRename(); }}
                                                className="p-0.5 hover:bg-red-500/20 text-red-500 rounded"
                                                title="Cancel rename"
                                            >
                                                <X className="w-3 h-3" />
                                            </button>
                                        </div>
                                    ) : (
                                        <>
                                            <span
                                                className={`font-semibold truncate text-xs ${
                                                    isSelected
                                                        ? "text-emerald-700 dark:text-emerald-300 font-bold"
                                                        : isConflict
                                                        ? "text-red-700 dark:text-red-400"
                                                        : "text-foreground"
                                                }`}
                                                onDoubleClick={(e) => {
                                                    if (onRenameStation) startRename(node, e);
                                                }}
                                                title="Double-click to rename"
                                            >
                                                {node.title}
                                            </span>
                                            <div className="flex items-center gap-0.5">
                                                {deltaLabel && (
                                                    <span className={`text-[9px] px-1 py-0.2 rounded border border-border bg-background font-bold ${deltaColor}`}>
                                                        {deltaLabel}
                                                    </span>
                                                )}

                                                {/* Hover Actions: Reorder ▲▼, Rename ✎, Delete 🗑, Fork + */}
                                                {isHovered && !isRenaming && (
                                                    <div className="flex items-center gap-0 animate-in fade-in duration-150">
                                                        {/* Move Up */}
                                                        {onReorderStation && !isFirst && (
                                                            <button
                                                                type="button"
                                                                onClick={(e) => { e.stopPropagation(); onReorderStation(node.id, "up"); }}
                                                                title="Move station up"
                                                                className="p-0.5 hover:bg-muted text-muted-foreground hover:text-foreground rounded transition-colors"
                                                            >
                                                                <ChevronUp className="w-3 h-3" />
                                                            </button>
                                                        )}
                                                        {/* Move Down */}
                                                        {onReorderStation && !isLast && (
                                                            <button
                                                                type="button"
                                                                onClick={(e) => { e.stopPropagation(); onReorderStation(node.id, "down"); }}
                                                                title="Move station down"
                                                                className="p-0.5 hover:bg-muted text-muted-foreground hover:text-foreground rounded transition-colors"
                                                            >
                                                                <ChevronDown className="w-3 h-3" />
                                                            </button>
                                                        )}
                                                        {/* Rename */}
                                                        {onRenameStation && (
                                                            <button
                                                                type="button"
                                                                onClick={(e) => startRename(node, e)}
                                                                title="Rename station"
                                                                className="p-0.5 hover:bg-muted text-muted-foreground hover:text-sky-600 dark:hover:text-sky-400 rounded transition-colors"
                                                            >
                                                                <Pencil className="w-3 h-3" />
                                                            </button>
                                                        )}
                                                        {/* Delete */}
                                                        {onDeleteStation && (
                                                            isConfirmingDelete ? (
                                                                <button
                                                                    type="button"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        onDeleteStation(node.id);
                                                                        setConfirmingDeleteId(null);
                                                                    }}
                                                                    title="Click again to confirm deletion"
                                                                    className="p-0.5 bg-red-500/20 text-red-600 dark:text-red-400 rounded animate-pulse"
                                                                >
                                                                    <Trash2 className="w-3 h-3" />
                                                                </button>
                                                            ) : (
                                                                <button
                                                                    type="button"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        setConfirmingDeleteId(node.id);
                                                                    }}
                                                                    title="Delete station"
                                                                    className="p-0.5 hover:bg-red-500/10 text-muted-foreground hover:text-red-600 dark:hover:text-red-400 rounded transition-colors"
                                                                >
                                                                    <Trash2 className="w-3 h-3" />
                                                                </button>
                                                            )
                                                        )}
                                                        {/* Fork */}
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                onForkBranch(node.stationKey);
                                                            }}
                                                            title="Fork subway branch here"
                                                            className="p-0.5 hover:bg-muted text-muted-foreground hover:text-emerald-700 dark:hover:text-emerald-300 rounded transition-colors"
                                                        >
                                                            <Plus className="w-3 h-3" />
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </>
                                    )}
                                </div>

                                <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-0.5">
                                    <span>
                                        {node.wordCount} / {stationTarget}w
                                    </span>
                                    <span>{progressPct}%</span>
                                </div>

                                {/* Micro Progress Bar */}
                                <div className="w-full bg-muted h-1 rounded-full overflow-hidden mt-1">
                                    <div
                                        className={`h-full transition-all duration-300 ${
                                            isConflict
                                                ? "bg-red-500"
                                                : progressPct >= 100
                                                ? "bg-emerald-500"
                                                : "bg-emerald-600 dark:bg-emerald-500"
                                        }`}
                                        style={{ width: `${progressPct}%` }}
                                    />
                                </div>

                                {/* Continuity Alert Pill */}
                                {isConflict && node.continuityNotes && node.continuityNotes.length > 0 && (
                                    <div className="mt-1.5 p-1 bg-red-500/10 border border-red-500/30 rounded text-[9px] text-red-700 dark:text-red-300 flex items-center gap-1">
                                        <AlertTriangle className="w-2.5 h-2.5 shrink-0" />
                                        <span className="truncate">Conflict: {node.continuityNotes[0].message}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}

                {/* Add Custom Station Section */}
                {onAddStation && (
                    <div className="pt-2">
                        {isAddingStation ? (
                            <div className="p-2 bg-card border border-emerald-500/40 rounded-lg flex flex-col gap-2 shadow-xs animate-in fade-in zoom-in-95">
                                <span className="text-[10px] font-bold text-foreground">New Station Title:</span>
                                <input
                                    type="text"
                                    value={newStationTitle}
                                    onChange={(e) => setNewStationTitle(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" && newStationTitle.trim()) {
                                            onAddStation(newStationTitle.trim());
                                            setNewStationTitle("");
                                            setIsAddingStation(false);
                                        } else if (e.key === "Escape") {
                                            setIsAddingStation(false);
                                        }
                                    }}
                                    placeholder="e.g. Chapter 4: Risk Matrix..."
                                    className="px-2 py-1 bg-background border border-border rounded text-xs text-foreground focus:outline-none focus:border-emerald-500"
                                    autoFocus
                                />
                                <div className="flex items-center justify-end gap-1.5 pt-1">
                                    <button
                                        type="button"
                                        onClick={() => setIsAddingStation(false)}
                                        className="px-2 py-0.5 bg-background hover:bg-muted text-muted-foreground rounded text-[10px] border border-border"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        disabled={!newStationTitle.trim()}
                                        onClick={() => {
                                            if (newStationTitle.trim()) {
                                                onAddStation(newStationTitle.trim());
                                                setNewStationTitle("");
                                                setIsAddingStation(false);
                                            }
                                        }}
                                        className="px-2.5 py-0.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[10px] font-bold disabled:opacity-50 transition-colors shadow-2xs"
                                    >
                                        Add Station
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <button
                                type="button"
                                onClick={() => setIsAddingStation(true)}
                                className="w-full py-1.5 px-2 rounded-lg border border-dashed border-border hover:border-emerald-500/50 hover:bg-emerald-500/5 text-muted-foreground hover:text-emerald-700 dark:hover:text-emerald-400 flex items-center justify-center gap-1 text-[11px] font-semibold transition-colors"
                            >
                                <Plus className="w-3.5 h-3.5" />
                                <span>Add Station</span>
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
