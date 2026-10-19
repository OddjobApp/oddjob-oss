import React, { useState, useMemo } from "react";
import { Boxes, ShieldCheck, Clock, ChevronLeft, ChevronRight, Zap, Gavel, ClipboardList } from "lucide-react";
import { cn } from "@/lib/utils";
import { CrewDecisionMatrixRail, DecisionMatrixPayload, DecisionCandidate } from "./CrewDecisionMatrixRail";
import { CrewGovernanceGateRail, GovernanceCheckpoint } from "./CrewGovernanceGateRail";
import { CrewForensicTimelineRail, ForensicEvent } from "./CrewForensicTimelineRail";

export type CrewRailTab = "supervisor" | "blackboard" | "puzzle";

export interface CrewTabbedRightRailProps {
    turns: any[];
    sessionMode?: string;
    supervisorRail?: React.ReactNode;
    blackboardRail?: React.ReactNode;
    puzzleRail: React.ReactNode;
    isCollapsed: boolean;
    onToggleCollapse: () => void;
    activeTab?: CrewRailTab;
    onTabChange?: (tab: CrewRailTab) => void;
    onSendMessage?: (content: string) => void;
    className?: string;
}

export const CrewTabbedRightRail: React.FC<CrewTabbedRightRailProps> = ({
    turns,
    sessionMode = "explore",
    supervisorRail,
    blackboardRail,
    puzzleRail,
    isCollapsed,
    onToggleCollapse,
    activeTab: controlledTab,
    onTabChange,
    onSendMessage,
    className = "",
}) => {
    // 1. Extract Decision Matrix State from Turns
    const decisionMatrixData = useMemo<DecisionMatrixPayload | null>(() => {
        for (let i = turns.length - 1; i >= 0; i--) {
            const list = Array.isArray(turns[i].artifacts) ? turns[i].artifacts : [];
            for (const a of list) {
                if (a?.tool === "propose_decision_matrix" || a?.payload?.type === "crew_decision_matrix_pod") {
                    return a.payload as DecisionMatrixPayload;
                }
            }
        }
        return null;
    }, [turns]);

    // 2. Extract Governance Checkpoints from Turns
    const governanceCheckpoints = useMemo<GovernanceCheckpoint[]>(() => {
        const checkpoints: GovernanceCheckpoint[] = [];
        for (const t of turns) {
            const list = Array.isArray(t.artifacts) ? t.artifacts : [];
            for (const a of list) {
                if (a?.tool === "request_governance_approval" || a?.payload?.type === "crew_governance_gate_pod") {
                    if (a.payload?.checkpoint) {
                        checkpoints.push(a.payload.checkpoint);
                    }
                }
            }
        }
        return checkpoints;
    }, [turns]);

    // 3. Extract Forensic Events from Turns
    const forensicEvents = useMemo<ForensicEvent[]>(() => {
        const events: ForensicEvent[] = [];
        for (const t of turns) {
            const list = Array.isArray(t.artifacts) ? t.artifacts : [];
            for (const a of list) {
                if (a?.tool === "pin_forensic_event" || a?.payload?.type === "crew_forensic_timeline_pod") {
                    if (a.payload?.event) {
                        events.push(a.payload.event);
                    }
                }
            }
        }
        return events;
    }, [turns]);

    // Local tab state if uncontrolled
    const [localTab, setLocalTab] = useState<CrewRailTab>("supervisor");
    const activeTab = controlledTab ?? localTab;

    const handleSelectTab = (tab: CrewRailTab) => {
        if (onTabChange) {
            onTabChange(tab);
        } else {
            setLocalTab(tab);
        }
    };

    const pendingGovCount = governanceCheckpoints.filter((checkpoint) => checkpoint.status === "pending").length;

    const handleAdoptDecision = (candidate: DecisionCandidate) => {
        onSendMessage?.(
            `Adopted recommendation: "${candidate.name}" (Score: ${(candidate.overallScore || 0).toFixed(1)}/10). Proceeding with this architectural option.`
        );
    };

    const handleApproveGovernance = (id: string) => {
        const cp = governanceCheckpoints.find((c) => c.id === id);
        onSendMessage?.(`Approved governance action [${cp?.actionTitle || id}]. Authorization confirmed.`);
    };

    const handleRejectGovernance = (id: string, note?: string) => {
        const cp = governanceCheckpoints.find((c) => c.id === id);
        onSendMessage?.(`Rejected governance action [${cp?.actionTitle || id}]${note ? `: ${note}` : ""}. Execution blocked.`);
    };

    const TAB_INFO: Record<CrewRailTab, { label: string; icon: React.ReactNode }> = {
        supervisor: { label: "Supervisor", icon: <Gavel className="w-3.5 h-3.5 text-amber-500" /> },
        blackboard: { label: "Blackboard", icon: <ClipboardList className="w-3.5 h-3.5 text-indigo-400" /> },
        puzzle: { label: "Assembler", icon: <Boxes className="w-3.5 h-3.5" /> },
    };

    // Collapsed View
    if (isCollapsed) {
        return (
            <div
                className={cn(
                    "flex flex-col items-center justify-between shrink-0 w-8 h-full min-h-0 px-1 py-3",
                    "rounded-lg border border-border/70 bg-card/85 shadow-sm backdrop-blur-md cursor-pointer select-none",
                    "hover:border-border transition-all duration-300",
                    className
                )}
                data-testid="crew-tabbed-rail-collapsed"
                onClick={onToggleCollapse}
                title="Click to expand Tabbed Rail"
            >
                <div
                    className="w-full h-full flex flex-col items-center justify-between"
                    data-testid={activeTab === "puzzle" ? "crew-assembly-puzzle-rail" : undefined}
                >
                    <div className="flex flex-col items-center gap-2">
                        <button
                            type="button"
                            data-testid="toggle-puzzle-rail-btn"
                            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                            title="Expand Tabbed Rail"
                            aria-label="Expand Tabbed Rail"
                            onClick={(e) => {
                                e.stopPropagation();
                                onToggleCollapse();
                            }}
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </button>
                        <div className="p-1 rounded bg-muted/40 text-foreground">
                            {TAB_INFO[activeTab].icon}
                        </div>
                    </div>

                    <div className="flex flex-col items-center gap-3 my-auto py-2">
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                onToggleCollapse();
                            }}
                            className="group relative flex h-8 w-8 items-center justify-center rounded-lg border border-border/40 bg-muted/40 text-muted-foreground hover:bg-primary/10 hover:text-primary hover:border-primary/40 transition-all shadow-xs"
                            title={`Expand ${TAB_INFO[activeTab].label} Rail`}
                            aria-label={`Expand ${TAB_INFO[activeTab].label} Rail`}
                            data-testid="collapsed-activity-bar-icon"
                        >
                            {activeTab === "puzzle" ? <Boxes className="h-4 w-4" /> : TAB_INFO[activeTab].icon}
                            {/* Subtle pulse indicator when modules/tabs are active */}
                            <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2" aria-hidden="true">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary/60 opacity-75" />
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                            </span>
                        </button>
                    </div>

                    <div className="flex flex-col items-center gap-1">
                        {pendingGovCount > 0 && (
                            <span className="w-4 h-4 rounded-full bg-indigo-500 text-white text-[9px] font-bold flex items-center justify-center" title={`${pendingGovCount} pending governance approvals`}>
                                {pendingGovCount}
                            </span>
                        )}
                        <Zap className="w-3 h-3 text-emerald-400 animate-pulse" />
                    </div>
                </div>
            </div>
        );
    }

    // Expanded View
    return (
        <aside
            aria-label="Tabbed Rail"
            data-testid="crew-tabbed-right-rail"
            className={cn(
                "flex flex-col shrink-0 w-72 lg:w-80 h-full min-h-0",
                "rounded-lg border border-border/70 bg-card/85 shadow-sm backdrop-blur-md",
                "transition-all duration-300 overflow-hidden",
                className
            )}
        >
            {/* Rail Header & Tab Navigation */}
            <div className="flex items-center justify-between gap-1 p-1.5 border-b border-border/60 bg-muted/30 shrink-0">
                <nav aria-label="Rail navigation tabs" className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto">
                    <button
                        type="button"
                        data-testid="tab-supervisor"
                        onClick={() => handleSelectTab("supervisor")}
                        className={cn(
                            "flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-semibold transition-all",
                            activeTab === "supervisor"
                                ? "border border-border bg-background font-bold text-foreground shadow-xs"
                                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                        )}
                        title="Supervisor"
                        aria-label="Supervisor"
                    >
                        <Gavel className="h-3.5 w-3.5 text-amber-500" />
                        <span>Supervisor</span>
                    </button>
                    <button
                        type="button"
                        data-testid="tab-blackboard"
                        onClick={() => handleSelectTab("blackboard")}
                        className={cn(
                            "flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-semibold transition-all",
                            activeTab === "blackboard"
                                ? "border border-border bg-background font-bold text-foreground shadow-xs"
                                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                        )}
                        title="Blackboard"
                        aria-label="Blackboard"
                    >
                        <ClipboardList className="h-3.5 w-3.5 text-indigo-400" />
                        <span>Blackboard</span>
                    </button>
                    {/* Assembler Tab */}
                    <button
                        type="button"
                        data-testid="tab-puzzle-rail"
                        onClick={() => handleSelectTab("puzzle")}
                        className={cn(
                            "flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-semibold transition-all",
                            activeTab === "puzzle"
                                ? "border border-border bg-background font-bold text-foreground shadow-xs"
                                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                        )}
                        title="Assembler"
                        aria-label="Assembler"
                    >
                        <Boxes className="h-3.5 w-3.5 text-indigo-400" />
                        <span>Assembler</span>
                    </button>
                </nav>

                {/* Right actions: Collapse button */}
                <button
                    type="button"
                    data-testid="toggle-tabbed-rail-btn"
                    onClick={onToggleCollapse}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    title="Collapse Tabbed Rail"
                    aria-label="Collapse Tabbed Rail"
                >
                    <ChevronRight className="h-4 w-4" />
                </button>
            </div>

            {/* Tab Surface Area */}
            <div className="flex-1 min-h-0 w-full overflow-hidden flex flex-col">
                {activeTab === "supervisor" ? (
                    <div className="h-full min-h-0 w-full overflow-y-auto" data-testid="tabbed-rail-supervisor-surface">
                        {supervisorRail}
                        <div className="px-2 pb-2" data-testid="supervisor-governance">
                            {governanceCheckpoints.length > 0 ? (
                                <CrewGovernanceGateRail
                                    checkpoints={governanceCheckpoints}
                                    onApprove={handleApproveGovernance}
                                    onReject={handleRejectGovernance}
                                    onDiscussInChat={(msg) => onSendMessage?.(msg)}
                                    className="w-full"
                                />
                            ) : (
                                <div className="rounded-lg border border-dashed border-border/70 p-4 text-center">
                                    <ShieldCheck className="w-8 h-8 text-muted-foreground/50 mx-auto mb-2" />
                                    <p className="text-xs text-muted-foreground font-medium">No governance checkpoints pending.</p>
                                    <p className="text-[11px] text-muted-foreground/70 mt-1">Sensitive operations requiring human review will appear here.</p>
                                </div>
                            )}
                        </div>
                    </div>
                ) : activeTab === "blackboard" ? (
                    <div className="h-full min-h-0 w-full overflow-y-auto" data-testid="tabbed-rail-blackboard-surface">
                        {blackboardRail}
                        {decisionMatrixData && (
                            <div className="px-2 pb-2" data-testid="blackboard-decision-matrix">
                                <CrewDecisionMatrixRail
                                    data={decisionMatrixData}
                                    onAdoptRecommendation={handleAdoptDecision}
                                    onDiscussInChat={(msg) => onSendMessage?.(msg)}
                                    className="w-full"
                                />
                            </div>
                        )}
                        <div className="px-2 pb-2" data-testid="blackboard-forensics">
                            {forensicEvents.length > 0 ? (
                                <CrewForensicTimelineRail
                                    events={forensicEvents}
                                    onDiscussInChat={(msg) => onSendMessage?.(msg)}
                                    className="w-full"
                                />
                            ) : (
                                <div className="rounded-lg border border-dashed border-border/70 p-4 text-center">
                                    <Clock className="w-8 h-8 text-muted-foreground/50 mx-auto mb-2" />
                                    <p className="text-xs text-muted-foreground font-medium">No forensic events recorded.</p>
                                    <p className="text-[11px] text-muted-foreground/70 mt-1">Audit ledger proofs and pinned milestones will track here.</p>
                                </div>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="h-full min-h-0 w-full flex flex-col" data-testid="tabbed-rail-puzzle-surface">
                        {puzzleRail}
                    </div>
                )}
            </div>
        </aside>
    );
};

export default CrewTabbedRightRail;
