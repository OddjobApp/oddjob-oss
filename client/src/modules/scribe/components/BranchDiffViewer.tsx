import React from "react";
import { X, GitCompare, ArrowRight, Check } from "lucide-react";
import { ScribeNode, ScribeBranch } from "@shared/schema/scribe";
import { useModalBehavior } from "@/hooks/use-modal-behavior";

interface BranchDiffViewerProps {
    stationTitle: string;
    stationKey: string;
    trunkNode: ScribeNode | null;
    branchNode: ScribeNode | null;
    activeBranch: ScribeBranch;
    onClose: () => void;
    onApplyBranchToTrunk?: (content: string) => void;
}

export const BranchDiffViewer: React.FC<BranchDiffViewerProps> = ({
    stationTitle,
    stationKey,
    trunkNode,
    branchNode,
    activeBranch,
    onClose,
    onApplyBranchToTrunk,
}) => {
    const trunkContent = trunkNode?.content || "";
    const branchContent = branchNode?.content || "";

    const trunkWords = trunkContent.trim().split(/\s+/).filter(Boolean).length;
    const branchWords = branchContent.trim().split(/\s+/).filter(Boolean).length;
    const wordDelta = branchWords - trunkWords;

    // Simple line-by-line diff computation
    const trunkLines = trunkContent.split("\n");
    const branchLines = branchContent.split("\n");

    // Mounted only while open, so it is open whenever it renders.
    const panelRef = useModalBehavior<HTMLDivElement>({ isOpen: true, onClose });

    return (
        <div data-testid="branch-diff-viewer-modal" className="fixed inset-0 z-modal flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-label="Branch comparison"
                className="flex h-[85vh] w-full max-w-5xl flex-col rounded-xl border border-border bg-card shadow-2xl overflow-hidden font-mono text-xs"
            >
                {/* Modal Header */}
                <div className="flex items-center justify-between border-b border-border bg-muted/40 px-5 py-3.5">
                    <div className="flex items-center gap-2.5">
                        <GitCompare className="h-4 w-4 text-emerald-500" />
                        <div>
                            <span className="font-bold text-foreground text-sm">Branch Comparison Diff</span>
                            <span className="text-muted-foreground ml-2 text-xs">
                                Station: <strong className="text-foreground">{stationTitle}</strong> ({stationKey})
                            </span>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <span className="text-[11px] px-2.5 py-0.5 rounded-full border border-border bg-background">
                            Delta:{" "}
                            <strong className={wordDelta > 0 ? "text-emerald-500" : wordDelta < 0 ? "text-amber-500" : "text-muted-foreground"}>
                                {wordDelta > 0 ? `+${wordDelta} words` : wordDelta < 0 ? `${wordDelta} words` : "Identical length"}
                            </strong>
                        </span>
                        <button
                            onClick={onClose}
                            className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                </div>

                {/* Subheader with Branch Details */}
                <div className="grid grid-cols-2 border-b border-border bg-muted/20 px-5 py-2 text-[11px] font-semibold text-muted-foreground">
                    <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-emerald-500" />
                        <span>Main Trunk (Base Version • {trunkWords} words)</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-sky-500" />
                        <span>
                            Branch: <span className="text-foreground">{activeBranch.name}</span> ({branchWords} words)
                        </span>
                    </div>
                </div>

                {/* Side-by-Side Content Comparison */}
                <div className="grid grid-cols-2 flex-1 divide-x divide-border overflow-hidden bg-background">
                    {/* Trunk Column */}
                    <div className="flex flex-col h-full overflow-y-auto p-4 select-text">
                        {trunkContent ? (
                            <pre className="font-sans text-xs leading-relaxed text-foreground whitespace-pre-wrap">
                                {trunkContent}
                            </pre>
                        ) : (
                            <div className="flex h-full items-center justify-center text-muted-foreground italic text-xs">
                                Station is empty on main trunk.
                            </div>
                        )}
                    </div>

                    {/* Branch Column */}
                    <div className="flex flex-col h-full overflow-y-auto p-4 select-text bg-sky-500/5">
                        {branchContent ? (
                            <pre className="font-sans text-xs leading-relaxed text-foreground whitespace-pre-wrap">
                                {branchContent}
                            </pre>
                        ) : (
                            <div className="flex h-full items-center justify-center text-muted-foreground italic text-xs">
                                Station has no content on this branch.
                            </div>
                        )}
                    </div>
                </div>

                {/* Modal Footer */}
                <div className="flex items-center justify-between border-t border-border bg-muted/30 px-5 py-3">
                    <span className="text-[11px] text-muted-foreground">
                        Inspecting differences between main trunk and current branch track.
                    </span>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={onClose}
                            className="px-3 py-1.5 rounded-lg border border-border bg-background hover:bg-muted text-foreground transition-colors font-medium text-xs"
                        >
                            Close Diff
                        </button>
                        {onApplyBranchToTrunk && (
                            <button
                                onClick={() => {
                                    onApplyBranchToTrunk(branchContent);
                                    onClose();
                                }}
                                className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs flex items-center gap-1.5 transition-colors shadow-xs"
                            >
                                <Check className="h-3.5 w-3.5" /> Apply Branch to Trunk
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
