import React, { useState } from "react";
import { ShieldCheck, ShieldAlert, AlertTriangle, Check, X, Server, DollarSign, Users, Terminal, Lock } from "lucide-react";

export type GovernanceRiskTier = "low" | "medium" | "high" | "critical";

export interface GovernanceCheckpoint {
    id: string;
    actionKey: string;
    actionTitle: string;
    riskTier: GovernanceRiskTier;
    requestedBy: string;
    blastRadius: {
        affectedServices?: string[];
        dataDestructionRisk?: boolean;
        estimatedCostUsd?: number;
        tenantsImpactedCount?: number;
        summary?: string;
    };
    executionPayload: Record<string, any>;
    status: "pending" | "approved" | "rejected";
    requiresDualSignOff?: boolean;
    requestedAt: string;
    decisionNote?: string;
}

interface CrewGovernanceGateRailProps {
    checkpoints: GovernanceCheckpoint[];
    onApprove?: (checkpointId: string) => void;
    onReject?: (checkpointId: string, note?: string) => void;
    onDiscussInChat?: (context: string) => void;
    className?: string;
}

export const CrewGovernanceGateRail: React.FC<CrewGovernanceGateRailProps> = ({
    checkpoints,
    onApprove,
    onReject,
    onDiscussInChat,
    className = "",
}) => {
    const [selectedCheckpointId, setSelectedCheckpointId] = useState<string>(
        checkpoints.find((c) => c.status === "pending")?.id || checkpoints[0]?.id || ""
    );
    const [rejectionNote, setRejectionNote] = useState("");
    const [isRejecting, setIsRejecting] = useState(false);

    const selectedCheckpoint = checkpoints.find((c) => c.id === selectedCheckpointId) || checkpoints[0];
    const pendingCount = checkpoints.filter((c) => c.status === "pending").length;

    const getRiskColor = (tier: GovernanceRiskTier) => {
        switch (tier) {
            case "critical":
                return "bg-red-500/20 text-red-500 border-red-500/50";
            case "high":
                return "bg-orange-500/20 text-orange-500 border-orange-500/50";
            case "medium":
                return "bg-amber-500/20 text-amber-500 border-amber-500/50";
            case "low":
            default:
                return "bg-emerald-500/20 text-emerald-500 border-emerald-500/50";
        }
    };

    return (
        <div
            data-testid="crew-governance-gate-rail"
            className={`flex flex-col gap-3 rounded-xl border border-border/80 bg-card/95 p-4 shadow-xl backdrop-blur-md font-sans text-xs text-foreground ${className}`}
        >
            {/* Header: Security & Risk Gate */}
            <div className="flex items-start justify-between gap-3 border-b border-border/60 pb-3">
                <div className="flex flex-col gap-1 min-w-0">
                    <div className="flex items-center gap-1.5 text-indigo-500 dark:text-indigo-400 font-bold uppercase tracking-wider text-[11px]">
                        <ShieldCheck className="w-4 h-4" />
                        <span>Governed AI Action Gate</span>
                    </div>
                    <span className="font-semibold text-xs text-muted-foreground">
                        Human-in-the-Loop Operational Checkpoints
                    </span>
                </div>

                <div className="flex items-center gap-1 bg-muted px-2.5 py-1 rounded-full border border-border">
                    <Lock className="w-3 h-3 text-indigo-400" />
                    <span className="font-bold text-[11px] text-foreground">
                        {pendingCount} Pending
                    </span>
                </div>
            </div>

            {/* Checkpoint Queue */}
            <div className="flex flex-col gap-1.5">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                    Approval Queue ({checkpoints.length}):
                </span>
                <div className="grid grid-cols-1 gap-1.5 max-h-40 overflow-y-auto">
                    {checkpoints.map((cp) => {
                        const isSelected = cp.id === selectedCheckpointId;
                        return (
                            <button
                                key={cp.id}
                                onClick={() => {
                                    setSelectedCheckpointId(cp.id);
                                    setIsRejecting(false);
                                }}
                                className={`flex items-center justify-between p-2 rounded-lg border transition-all text-left ${
                                    isSelected
                                        ? "border-indigo-500/80 bg-indigo-500/10 shadow-xs"
                                        : "border-border/60 bg-muted/30 hover:bg-muted/60"
                                }`}
                            >
                                <div className="flex items-center gap-2 min-w-0">
                                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border ${getRiskColor(cp.riskTier)}`}>
                                        {cp.riskTier}
                                    </span>
                                    <span className="font-bold truncate text-foreground">{cp.actionTitle}</span>
                                </div>
                                <span className={`text-[10px] font-bold capitalize ${
                                    cp.status === "approved" ? "text-emerald-500" : cp.status === "rejected" ? "text-red-500" : "text-amber-500 animate-pulse"
                                }`}>
                                    {cp.status}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Selected Checkpoint Detail & Blast Radius */}
            {selectedCheckpoint && (
                <div className="flex flex-col gap-2.5 rounded-lg border border-border/60 bg-muted/20 p-3">
                    <div className="flex items-center justify-between">
                        <span className="font-bold text-foreground text-xs">{selectedCheckpoint.actionTitle}</span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${getRiskColor(selectedCheckpoint.riskTier)}`}>
                            {selectedCheckpoint.riskTier} Risk
                        </span>
                    </div>

                    <div className="text-[11px] text-muted-foreground">
                        Proposed by <span className="font-bold text-foreground">@{selectedCheckpoint.requestedBy}</span>
                    </div>

                    {/* Blast Radius Box */}
                    <div className="flex flex-col gap-1.5 p-2.5 rounded bg-background/60 border border-border/40 text-[11px]">
                        <span className="font-bold text-foreground text-[10px] uppercase tracking-wider flex items-center gap-1">
                            <ShieldAlert className="w-3 h-3 text-amber-500" /> Blast Radius Analysis:
                        </span>
                        
                        {selectedCheckpoint.blastRadius.dataDestructionRisk && (
                            <div className="flex items-center gap-1.5 text-red-500 font-bold bg-red-500/10 p-1.5 rounded border border-red-500/30">
                                <AlertTriangle className="w-3.5 h-3.5" />
                                Data Mutation / Destruction Warning
                            </div>
                        )}

                        <div className="grid grid-cols-2 gap-2 pt-1">
                            {selectedCheckpoint.blastRadius.estimatedCostUsd != null && (
                                <div className="flex items-center gap-1 text-muted-foreground">
                                    <DollarSign className="w-3 h-3 text-emerald-500" />
                                    <span>Cost: ~${selectedCheckpoint.blastRadius.estimatedCostUsd}</span>
                                </div>
                            )}
                            {selectedCheckpoint.blastRadius.tenantsImpactedCount != null && (
                                <div className="flex items-center gap-1 text-muted-foreground">
                                    <Users className="w-3 h-3 text-blue-400" />
                                    <span>Tenants: {selectedCheckpoint.blastRadius.tenantsImpactedCount}</span>
                                </div>
                            )}
                        </div>

                        {selectedCheckpoint.blastRadius.affectedServices && (
                            <div className="flex items-center gap-1 text-muted-foreground pt-1">
                                <Server className="w-3 h-3 text-indigo-400" />
                                <span>Services: {selectedCheckpoint.blastRadius.affectedServices.join(", ")}</span>
                            </div>
                        )}
                    </div>

                    {/* Execution Payload Preview */}
                    <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-bold text-muted-foreground uppercase flex items-center gap-1">
                            <Terminal className="w-3 h-3" /> Execution Payload:
                        </span>
                        <pre className="p-2 rounded bg-black/40 text-emerald-400 font-mono text-[10px] max-h-24 overflow-y-auto border border-border/40">
                            {JSON.stringify(selectedCheckpoint.executionPayload, null, 2)}
                        </pre>
                    </div>

                    {/* Rejection Note Input */}
                    {isRejecting && (
                        <div className="flex flex-col gap-1.5 pt-2 border-t border-border/40 animate-in fade-in">
                            <label className="text-[10px] font-bold text-red-500">Reason for Rejection:</label>
                            <input
                                type="text"
                                value={rejectionNote}
                                onChange={(e) => setRejectionNote(e.target.value)}
                                placeholder="Explain why this action cannot proceed..."
                                className="w-full bg-background border border-red-500/50 rounded px-2.5 py-1 text-foreground text-xs focus:outline-none"
                            />
                        </div>
                    )}

                    {/* Action Execution Controls */}
                    {selectedCheckpoint.status === "pending" ? (
                        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/40">
                            {isRejecting ? (
                                <>
                                    <button
                                        onClick={() => setIsRejecting(false)}
                                        className="px-2.5 py-1 bg-background border border-border rounded text-foreground text-xs"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={() => {
                                            onReject?.(selectedCheckpoint.id, rejectionNote);
                                            setIsRejecting(false);
                                        }}
                                        className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded font-bold text-xs flex items-center gap-1 shadow-xs"
                                    >
                                        <X className="w-3 h-3" /> Confirm Reject
                                    </button>
                                </>
                            ) : (
                                <>
                                    <button
                                        onClick={() => setIsRejecting(true)}
                                        className="px-3 py-1.5 bg-background hover:bg-red-500/10 border border-red-500/30 text-red-500 rounded font-semibold text-xs flex items-center gap-1 transition-colors"
                                    >
                                        <X className="w-3 h-3" /> Reject
                                    </button>
                                    <button
                                        onClick={() => onApprove?.(selectedCheckpoint.id)}
                                        className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-bold text-xs flex items-center gap-1 shadow-xs transition-colors"
                                    >
                                        <Check className="w-3.5 h-3.5" /> Approve & Execute
                                    </button>
                                </>
                            )}
                        </div>
                    ) : (
                        <div className="pt-2 text-center text-xs font-bold text-muted-foreground">
                            Decision Recorded: <span className="capitalize font-bold text-foreground">{selectedCheckpoint.status}</span>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default CrewGovernanceGateRail;
