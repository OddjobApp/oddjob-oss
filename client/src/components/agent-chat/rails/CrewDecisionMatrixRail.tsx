import React, { useState } from "react";
import { Scale, CheckCircle2, ThumbsUp, MessageSquare, ChevronRight, BarChart2, Users, Award } from "lucide-react";

export interface DecisionCriterion {
    key: string;
    label: string;
    weight: number;
    description?: string;
}

export interface DecisionCandidate {
    id: string;
    name: string;
    description?: string;
    scores: Record<string, number>; // 1-10
    overallScore?: number;
    pros?: string[];
    cons?: string[];
}

export interface PersonaStance {
    agentName: string;
    preferredCandidateId: string;
    confidence: number;
    rationale: string;
}

export interface DecisionMatrixPayload {
    topic: string;
    candidates: DecisionCandidate[];
    criteria: DecisionCriterion[];
    personaStances?: PersonaStance[];
    recommendedCandidateId?: string;
    consensusPercentage?: number;
    updatedAt?: string;
}

interface CrewDecisionMatrixRailProps {
    data: DecisionMatrixPayload;
    onAdoptRecommendation?: (candidate: DecisionCandidate) => void;
    onDiscussInChat?: (context: string) => void;
    className?: string;
}

export const CrewDecisionMatrixRail: React.FC<CrewDecisionMatrixRailProps> = ({
    data,
    onAdoptRecommendation,
    onDiscussInChat,
    className = "",
}) => {
    const [selectedCandidateId, setSelectedCandidateId] = useState<string>(
        data.recommendedCandidateId || data.candidates[0]?.id || ""
    );

    const selectedCandidate = data.candidates.find((c) => c.id === selectedCandidateId) || data.candidates[0];
    const consensus = data.consensusPercentage ?? 75;

    return (
        <div
            data-testid="crew-decision-matrix-rail"
            className={`flex flex-col gap-3 rounded-xl border border-border/80 bg-card/95 p-4 shadow-xl backdrop-blur-md font-sans text-xs text-foreground ${className}`}
        >
            {/* Header: Topic & Consensus Dial */}
            <div className="flex items-start justify-between gap-3 border-b border-border/60 pb-3">
                <div className="flex flex-col gap-1 min-w-0">
                    <div className="flex items-center gap-1.5 text-amber-500 dark:text-amber-400 font-bold uppercase tracking-wider text-[11px]">
                        <Scale className="w-4 h-4" />
                        <span>Decision & Tradeoff Matrix</span>
                    </div>
                    <h3 className="font-bold text-sm text-foreground line-clamp-2" title={data.topic}>
                        {data.topic}
                    </h3>
                </div>

                {/* Consensus Gauge */}
                <div className="flex flex-col items-end shrink-0">
                    <span className="text-[10px] text-muted-foreground font-semibold">Consensus</span>
                    <div className="flex items-center gap-1">
                        <div className="h-2 w-16 bg-muted rounded-full overflow-hidden">
                            <div
                                className={`h-full transition-all duration-500 ${
                                    consensus >= 80 ? "bg-emerald-500" : consensus >= 50 ? "bg-amber-500" : "bg-red-500"
                                }`}
                                style={{ width: `${consensus}%` }}
                            />
                        </div>
                        <span className="font-bold font-mono text-[11px]">{consensus}%</span>
                    </div>
                </div>
            </div>

            {/* Candidates Leaderboard Pills */}
            <div className="flex flex-col gap-1.5">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                    Candidate Options ({data.candidates.length}):
                </span>
                <div className="grid grid-cols-1 gap-1.5">
                    {data.candidates.map((cand, idx) => {
                        const isSelected = cand.id === selectedCandidateId;
                        const isLeader = idx === 0 || cand.id === data.recommendedCandidateId;
                        return (
                            <button
                                key={cand.id}
                                onClick={() => setSelectedCandidateId(cand.id)}
                                className={`flex items-center justify-between p-2 rounded-lg border transition-all text-left ${
                                    isSelected
                                        ? "border-amber-500/80 bg-amber-500/10 shadow-xs"
                                        : "border-border/60 bg-muted/30 hover:bg-muted/60"
                                }`}
                            >
                                <div className="flex items-center gap-2 min-w-0">
                                    <div className={`w-5 h-5 rounded-full flex items-center justify-center font-bold text-[10px] ${
                                        isLeader ? "bg-amber-500 text-black font-extrabold" : "bg-muted text-muted-foreground"
                                    }`}>
                                        {idx + 1}
                                    </div>
                                    <div className="flex flex-col min-w-0">
                                        <span className="font-bold truncate text-foreground flex items-center gap-1">
                                            {cand.name}
                                            {isLeader && (
                                                <Award className="w-3.5 h-3.5 text-amber-500 inline shrink-0" />
                                            )}
                                        </span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0 font-mono">
                                    <span className="font-bold text-emerald-600 dark:text-emerald-400 text-xs">
                                        {(cand.overallScore ?? 0).toFixed(1)}/10
                                    </span>
                                    <ChevronRight className={`w-3.5 h-3.5 transition-transform ${isSelected ? "rotate-90 text-amber-500" : "text-muted-foreground"}`} />
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Selected Candidate Detailed Criteria Breakdown */}
            {selectedCandidate && (
                <div className="flex flex-col gap-2.5 rounded-lg border border-border/60 bg-muted/20 p-3">
                    <div className="flex items-center justify-between">
                        <span className="font-bold text-foreground text-xs flex items-center gap-1.5">
                            <BarChart2 className="w-3.5 h-3.5 text-indigo-500" />
                            {selectedCandidate.name} Scorecard
                        </span>
                        {selectedCandidate.id === data.recommendedCandidateId && (
                            <span className="text-[10px] bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded-full font-bold">
                                Recommended
                            </span>
                        )}
                    </div>

                    {/* Criteria Bars */}
                    <div className="flex flex-col gap-1.5">
                        {data.criteria.map((crit) => {
                            const score = selectedCandidate.scores?.[crit.key] ?? 5;
                            const scorePct = Math.min(100, Math.max(0, score * 10));
                            return (
                                <div key={crit.key} className="flex flex-col gap-0.5">
                                    <div className="flex items-center justify-between text-[11px]">
                                        <span className="text-muted-foreground">{crit.label} <span className="text-[9px] text-muted-foreground/70">({crit.weight}x)</span></span>
                                        <span className="font-mono font-bold text-foreground">{score}/10</span>
                                    </div>
                                    <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                                        <div
                                            className={`h-full transition-all duration-300 ${
                                                score >= 8 ? "bg-emerald-500" : score >= 5 ? "bg-sky-500" : "bg-red-400"
                                            }`}
                                            style={{ width: `${scorePct}%` }}
                                        />
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Pros & Cons */}
                    {(selectedCandidate.pros || selectedCandidate.cons) && (
                        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/40 text-[11px]">
                            {selectedCandidate.pros && selectedCandidate.pros.length > 0 && (
                                <div className="flex flex-col gap-1">
                                    <span className="font-bold text-emerald-600 dark:text-emerald-400">Pros:</span>
                                    {selectedCandidate.pros.map((p, i) => (
                                        <span key={i} className="text-muted-foreground leading-tight">• {p}</span>
                                    ))}
                                </div>
                            )}
                            {selectedCandidate.cons && selectedCandidate.cons.length > 0 && (
                                <div className="flex flex-col gap-1">
                                    <span className="font-bold text-red-500 dark:text-red-400">Cons:</span>
                                    {selectedCandidate.cons.map((c, i) => (
                                        <span key={i} className="text-muted-foreground leading-tight">• {c}</span>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Agent Persona Voting Stances */}
            {data.personaStances && data.personaStances.length > 0 && (
                <div className="flex flex-col gap-1.5 pt-1">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                        <Users className="w-3 h-3 text-indigo-400" /> Persona Positions:
                    </span>
                    <div className="flex flex-col gap-1">
                        {data.personaStances.map((stance, idx) => {
                            const preferredCand = data.candidates.find((c) => c.id === stance.preferredCandidateId);
                            return (
                                <div
                                    key={idx}
                                    className="p-1.5 rounded bg-muted/40 border border-border/40 flex items-center justify-between text-[11px]"
                                    title={stance.rationale}
                                >
                                    <div className="flex items-center gap-1.5 min-w-0">
                                        <span className="font-bold text-foreground">@{stance.agentName}</span>
                                        <span className="text-muted-foreground">votes</span>
                                        <span className="font-semibold text-amber-500 truncate">{preferredCand?.name || stance.preferredCandidateId}</span>
                                    </div>
                                    <span className="font-mono text-[10px] font-bold text-emerald-500 shrink-0">
                                        {stance.confidence}% conf
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Action Bar */}
            <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/60">
                <button
                    onClick={() => onDiscussInChat?.(`Regarding ${selectedCandidate.name} (Score: ${(selectedCandidate.overallScore || 0).toFixed(1)}/10): let's discuss why this option is preferred.`)}
                    className="flex-1 px-2.5 py-1.5 bg-background hover:bg-muted border border-border rounded text-foreground font-semibold flex items-center justify-center gap-1 text-[11px] transition-colors"
                >
                    <MessageSquare className="w-3 h-3 text-muted-foreground" />
                    Discuss in Chat
                </button>
                <button
                    onClick={() => onAdoptRecommendation?.(selectedCandidate)}
                    className="flex-1 px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded flex items-center justify-center gap-1 text-[11px] transition-colors shadow-xs"
                >
                    <CheckCircle2 className="w-3 h-3" />
                    Adopt Option
                </button>
            </div>
        </div>
    );
};

export default CrewDecisionMatrixRail;
