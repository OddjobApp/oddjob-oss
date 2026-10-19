import React, { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../ui/card.js";
import { Button } from "../ui/button.js";
import { Badge } from "../ui/badge.js";
import { Input } from "../ui/input.js";
import { 
  Scale, 
  Trophy, 
  CheckCircle2, 
  AlertCircle, 
  Users, 
  Sparkles, 
  ArrowRight, 
  ThumbsUp, 
  ThumbsDown,
  Percent,
  Sliders,
  Activity,
  Vote
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  emitWorkbenchSaved,
  generateW3CTraceparent,
  usePodEventListener
} from "./pod-event-bus.js";

export interface DecisionCandidate {
  id: string;
  name: string;
  description?: string;
  scores: Record<string, number>;
  overallScore?: number;
  pros?: string[];
  cons?: string[];
  telemetryBenchmark?: {
    latencyP99Ms?: number;
    costPerMillionOps?: number;
    memoryMb?: number;
  };
}

export interface DecisionCriterion {
  key: string;
  label: string;
  weight: number;
  description?: string;
}

export interface PersonaStance {
  agentName: string;
  preferredCandidateId: string;
  confidence: number;
  rationale: string;
}

export interface DecisionMatrixPodProps {
  stageId?: string;
  topic?: string;
  candidates?: DecisionCandidate[];
  criteria?: DecisionCriterion[];
  personaStances?: PersonaStance[];
  recommendedCandidateId?: string;
  consensusPercentage?: number;
  onStageComplete?: (payload: {
    stageId: string;
    topic: string;
    selectedCandidateId: string;
    selectedCandidateName: string;
    ratifiedScores: Record<string, number>;
    criteria: DecisionCriterion[];
    candidates: DecisionCandidate[];
    consensusPercentage: number;
    ratifiedAt: string;
    timestamp?: string;
    _trace?: { traceparent: string; generatedAt: string };
  }) => void;
  onDecisionConfirmed?: (payload: any) => void;
}

const DEFAULT_CRITERIA: DecisionCriterion[] = [
  { key: "latency", label: "Performance & Latency", weight: 1.5, description: "p99 response time and throughput" },
  { key: "cost", label: "Fiscal / Token Cost", weight: 1.0, description: "Monthly run rate and token consumption" },
  { key: "security", label: "Security & Blast Radius", weight: 2.0, description: "Data boundary isolation and auditability" },
  { key: "maintainability", label: "Team Velocity & DX", weight: 1.0, description: "Code simplicity and maintainability" },
];

const DEFAULT_CANDIDATES: DecisionCandidate[] = [
  {
    id: "cand-1",
    name: "Distributed Redis Cluster + Cache-Aside",
    description: "In-memory caching with asynchronous master-replica failover.",
    scores: { latency: 9, cost: 7, security: 8, maintainability: 8 },
    pros: ["Sub-millisecond reads", "Mature ecosystem", "Built-in replication"],
    cons: ["Higher infrastructure cost", "Cold-start cache stampede"],
    telemetryBenchmark: { latencyP99Ms: 1.2, costPerMillionOps: 0.15, memoryMb: 512 }
  },
  {
    id: "cand-2",
    name: "Native Edge KV Store",
    description: "Replicated global key-value store executed on Cloudflare Workers.",
    scores: { latency: 9, cost: 8, security: 7, maintainability: 6 },
    pros: ["Global low latency", "Zero server maintenance"],
    cons: ["Vendor lock-in", "Eventual consistency lag on writes"],
    telemetryBenchmark: { latencyP99Ms: 4.5, costPerMillionOps: 0.50, memoryMb: 128 }
  },
  {
    id: "cand-3",
    name: "PostgreSQL Materialized Views + Unlogged Tables",
    description: "Leverage existing relational database with partitioned unlogged write buffers.",
    scores: { latency: 6, cost: 9, security: 9, maintainability: 9 },
    pros: ["Zero additional infrastructure", "Strong relational integrity", "Lowest cost"],
    cons: ["Contention on high-write traffic", "Refresh locking"],
    telemetryBenchmark: { latencyP99Ms: 14.0, costPerMillionOps: 0.05, memoryMb: 256 }
  },
];

const DEFAULT_STANCES: PersonaStance[] = [
  {
    agentName: "Architect-Prime",
    preferredCandidateId: "cand-1",
    confidence: 88,
    rationale: "Distributed Redis cluster provides the best balance of blast radius isolation and SLA predictability.",
  },
  {
    agentName: "FinOps-Agent",
    preferredCandidateId: "cand-3",
    confidence: 82,
    rationale: "PostgreSQL materialized views eliminate secondary SaaS costs and reduce vendor overhead.",
  },
  {
    agentName: "Security-Officer",
    preferredCandidateId: "cand-1",
    confidence: 90,
    rationale: "Isolated VPC Redis prevents cross-tenant memory leakage.",
  },
];

export default function DecisionMatrixPod({
  stageId = "stage-decision-deliberation",
  topic = "Cache Tier Architecture for High-Throughput Ingestion",
  candidates: initialCandidates = DEFAULT_CANDIDATES,
  criteria: initialCriteria = DEFAULT_CRITERIA,
  personaStances: initialStances = DEFAULT_STANCES,
  recommendedCandidateId: initialRecommendedId,
  consensusPercentage = 80,
  onStageComplete,
  onDecisionConfirmed,
}: DecisionMatrixPodProps) {
  const [criteria, setCriteria] = useState<DecisionCriterion[]>(initialCriteria);
  const [candidates, setCandidates] = useState<DecisionCandidate[]>(initialCandidates);
  const [stances, setStances] = useState<PersonaStance[]>(initialStances);
  const [isRatified, setIsRatified] = useState(false);

  // Compute weighted scores dynamically based on current criteria weights
  const evaluatedCandidates = useMemo(() => {
    const totalWeight = criteria.reduce((sum, c) => sum + (c.weight || 1), 0);

    return candidates.map((cand) => {
      let weightedSum = 0;
      criteria.forEach((crit) => {
        const score = cand.scores[crit.key] ?? 5;
        weightedSum += score * (crit.weight || 1);
      });
      const computedOverall = totalWeight > 0 ? Number((weightedSum / totalWeight).toFixed(1)) : 5;
      return {
        ...cand,
        overallScore: computedOverall,
      };
    }).sort((a, b) => (b.overallScore || 0) - (a.overallScore || 0));
  }, [candidates, criteria]);

  const defaultTopId = initialRecommendedId || evaluatedCandidates[0]?.id || "";
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>(defaultTopId);

  // Two-way chat event bus
  usePodEventListener(stageId, (event) => {
    const { action, payload } = event;
    if ((action === "matrix:cast-vote" || action === "cast-vote") && payload?.agentName && payload?.candidateId) {
      setStances(prev => {
        const exists = prev.find(s => s.agentName === payload.agentName);
        if (exists) {
          return prev.map(s => s.agentName === payload.agentName ? {
            ...s,
            preferredCandidateId: payload.candidateId,
            confidence: payload.confidence || 85,
            rationale: payload.rationale || s.rationale
          } : s);
        } else {
          return [...prev, {
            agentName: payload.agentName,
            preferredCandidateId: payload.candidateId,
            confidence: payload.confidence || 85,
            rationale: payload.rationale || "Deliberated stance."
          }];
        }
      });
    } else if (action === "set-weight" && payload?.key && typeof payload?.weight === "number") {
      handleWeightChange(payload.key, payload.weight);
    } else if (action === "select-candidate" && payload?.candidateId) {
      setSelectedCandidateId(payload.candidateId);
    } else if (action === "confirm") {
      handleRatify();
    }
  });

  // Update a criterion weight
  const handleWeightChange = (key: string, newWeight: number) => {
    setCriteria((prev) =>
      prev.map((c) => (c.key === key ? { ...c, weight: Math.max(0.1, Number(newWeight.toFixed(1))) } : c))
    );
  };

  // Update a candidate score for a criterion
  const handleScoreChange = (candId: string, criterionKey: string, val: number) => {
    setCandidates((prev) =>
      prev.map((cand) => {
        if (cand.id !== candId) return cand;
        return {
          ...cand,
          scores: {
            ...cand.scores,
            [criterionKey]: Math.min(10, Math.max(1, val)),
          },
        };
      })
    );
  };

  const activeSelectedCandidate = evaluatedCandidates.find((c) => c.id === selectedCandidateId) || evaluatedCandidates[0];

  const handleRatify = () => {
    setIsRatified(true);
    const traceparent = generateW3CTraceparent();
    const payload = {
      stageId,
      topic,
      selectedCandidateId: activeSelectedCandidate?.id || "",
      selectedCandidateName: activeSelectedCandidate?.name || "",
      ratifiedScores: activeSelectedCandidate?.scores || {},
      criteria,
      candidates: evaluatedCandidates,
      consensusPercentage,
      ratifiedAt: new Date().toISOString(),
      timestamp: new Date().toISOString(),
      _trace: {
        traceparent,
        generatedAt: new Date().toISOString()
      }
    };

    if (onStageComplete) {
      onStageComplete(payload);
    }
    if (onDecisionConfirmed) {
      onDecisionConfirmed(payload);
    }

    emitWorkbenchSaved(
      stageId,
      `Ratified Decision for "${topic}": Selected "${activeSelectedCandidate?.name}" (${activeSelectedCandidate?.overallScore}/10)`,
      payload
    );
  };

  return (
    <Card className="w-full border-border bg-card text-card-foreground shadow-2xl backdrop-blur-md">
      <CardHeader className="border-b border-border pb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Scale className="h-6 w-6 text-amber-400" />
            <div>
              <CardTitle className="text-xl font-bold tracking-tight text-foreground">
                Decision Matrix: {topic}
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Multi-Criteria Weighted Deliberation Cockpit • Live Agent Voting & Telemetry Benchmarks
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-300">
              <Percent className="mr-1 h-3 w-3" /> Consensus Target: {consensusPercentage}%
            </Badge>
            {isRatified ? (
              <Badge className="bg-emerald-600 text-white hover:bg-emerald-500">
                <CheckCircle2 className="mr-1 h-3 w-3" /> Ratified & Committed
              </Badge>
            ) : (
              <Badge variant="secondary" className="bg-blue-900/50 text-blue-300">
                <Sparkles className="mr-1 h-3 w-3" /> Deliberating ({stances.length} votes)
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6 pt-6">
        {/* PANE 1: Weighted Criteria Scoring Grid */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              <Sliders className="h-4 w-4 text-cyan-400" />
              1. Multi-Criteria Scoring Grid & Weight Modifiers
            </h3>
            <span className="text-xs text-muted-foreground">Scores 1–10 • Adjust weights to test sensitivity</span>
          </div>

          <div className="overflow-x-auto rounded-lg border border-border bg-card/60 p-3">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="pb-2 font-medium">Candidate Option</th>
                  {criteria.map((crit) => (
                    <th key={crit.key} className="pb-2 text-center font-medium">
                      <div>{crit.label}</div>
                      <div className="mt-1 flex items-center justify-center gap-1">
                        <span className="text-[10px] text-amber-400 font-mono">wt:</span>
                        <input
                          type="number"
                          step="0.1"
                          min="0.1"
                          max="5.0"
                          value={crit.weight}
                          onChange={(e) => handleWeightChange(crit.key, parseFloat(e.target.value) || 1.0)}
                          className="w-12 rounded border border-border bg-muted px-1 py-0.5 text-center text-xs text-amber-300 focus:border-amber-400 focus:outline-none"
                          data-testid={`weight-input-${crit.key}`}
                        />
                      </div>
                    </th>
                  ))}
                  <th className="pb-2 text-right font-medium text-amber-400">Weighted Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {evaluatedCandidates.map((cand, idx) => (
                  <tr
                    key={cand.id}
                    onClick={() => setSelectedCandidateId(cand.id)}
                    className={cn(
                      "cursor-pointer transition-colors hover:bg-muted/40",
                      selectedCandidateId === cand.id && "bg-amber-500/10"
                    )}
                  >
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center gap-2">
                        {idx === 0 && <Trophy className="h-4 w-4 text-amber-400" />}
                        <span className="font-semibold text-foreground">{cand.name}</span>
                      </div>
                    </td>
                    {criteria.map((crit) => (
                      <td key={crit.key} className="py-2.5 text-center">
                        <input
                          type="number"
                          min="1"
                          max="10"
                          value={cand.scores[crit.key] ?? 5}
                          onChange={(e) => handleScoreChange(cand.id, crit.key, parseInt(e.target.value, 10) || 5)}
                          className="w-10 rounded border border-border bg-muted px-1 py-0.5 text-center text-xs text-foreground focus:border-cyan-400 focus:outline-none"
                          data-testid={`score-input-${cand.id}-${crit.key}`}
                        />
                      </td>
                    ))}
                    <td className="py-2.5 text-right font-mono text-sm font-bold text-amber-400">
                      {cand.overallScore} / 10
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* PANE 2: Candidate Leaderboard & Deep Dive */}
        <div>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-foreground/70">
            <Trophy className="h-4 w-4 text-amber-400" />
            2. Candidate Leaderboard & Analysis
          </h3>

          <div className="grid gap-3 md:grid-cols-3">
            {evaluatedCandidates.map((cand, idx) => {
              const isSelected = selectedCandidateId === cand.id;
              const isTop = idx === 0;

              return (
                <div
                  key={cand.id}
                  onClick={() => setSelectedCandidateId(cand.id)}
                  className={cn(
                    "relative cursor-pointer rounded-lg border p-4 transition-all",
                    isSelected
                      ? "border-amber-500 bg-accent/80 shadow-md ring-1 ring-amber-500/50"
                      : "border-border bg-card/60 hover:border-border/80"
                  )}
                  data-testid={`candidate-card-${cand.id}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      {isTop && (
                        <Badge className="mb-1 bg-amber-500/20 text-amber-300 border-amber-500/30 text-[10px]">
                          ★ Leading Candidate
                        </Badge>
                      )}
                      <h4 className="font-semibold text-foreground text-sm">{cand.name}</h4>
                    </div>
                    <div className="text-right">
                      <span className="font-mono text-base font-bold text-amber-400">
                        {cand.overallScore}
                      </span>
                      <span className="text-[10px] text-muted-foreground block">score</span>
                    </div>
                  </div>

                  {cand.description && (
                    <p className="mt-2 text-xs text-muted-foreground line-clamp-2">{cand.description}</p>
                  )}

                  {/* Telemetry Benchmarks */}
                  {cand.telemetryBenchmark && (
                    <div className="mt-2 flex items-center gap-2 text-[10px] font-mono text-cyan-400/90 bg-cyan-950/40 px-2 py-1 rounded border border-cyan-800/30">
                      <Activity className="w-3 h-3 text-cyan-400" />
                      <span>{cand.telemetryBenchmark.latencyP99Ms}ms p99</span>
                      <span>•</span>
                      <span>${cand.telemetryBenchmark.costPerMillionOps}/M ops</span>
                    </div>
                  )}

                  {/* Pros & Cons */}
                  <div className="mt-3 space-y-1 text-[11px]">
                    {cand.pros && cand.pros.length > 0 && (
                      <div className="flex items-center gap-1.5 text-emerald-400">
                        <ThumbsUp className="h-3 w-3 shrink-0" />
                        <span className="truncate">{cand.pros[0]}</span>
                      </div>
                    )}
                    {cand.cons && cand.cons.length > 0 && (
                      <div className="flex items-center gap-1.5 text-rose-400">
                        <ThumbsDown className="h-3 w-3 shrink-0" />
                        <span className="truncate">{cand.cons[0]}</span>
                      </div>
                    )}
                  </div>

                  <div className="mt-3 pt-2 border-t border-border flex justify-between items-center text-[10px] text-muted-foreground">
                    <span>Rank #{idx + 1}</span>
                    <span className={isSelected ? "text-amber-300 font-semibold" : ""}>
                      {isSelected ? "● Selected for Ratification" : "Click to select"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* PANE 3: Deliberation Stances */}
        {stances && stances.length > 0 && (
          <div>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              <Users className="h-4 w-4 text-purple-400" />
              3. Participant & Agent Deliberation Stances ({stances.length} votes)
            </h3>

            <div className="grid gap-3 md:grid-cols-3">
              {stances.map((stance, idx) => {
                const targetCand = candidates.find((c) => c.id === stance.preferredCandidateId);
                return (
                  <div
                    key={idx}
                    className="rounded-lg border border-border bg-card/60 p-3 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-foreground">{stance.agentName}</span>
                      <Badge variant="outline" className="border-purple-500/30 text-purple-300 text-[10px]">
                        {stance.confidence}% Confidence
                      </Badge>
                    </div>
                    <div className="mt-2 text-[11px] text-amber-300">
                      Prefers: <span className="font-medium text-foreground">{targetCand?.name || stance.preferredCandidateId}</span>
                    </div>
                    <p className="mt-1.5 text-[11px] text-muted-foreground italic">
                      "{stance.rationale}"
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* PANE 4: Ratification Cockpit */}
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                Current Ratification Selection
              </div>
              <div className="text-lg font-bold text-foreground flex items-center gap-2 mt-0.5">
                {activeSelectedCandidate?.name}
                <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/40">
                  {activeSelectedCandidate?.overallScore} / 10
                </Badge>
              </div>
            </div>

            <Button
              onClick={handleRatify}
              disabled={isRatified || !activeSelectedCandidate}
              className="bg-amber-500 text-slate-950 hover:bg-amber-400 font-semibold px-6 shadow-lg shadow-amber-500/20"
              data-testid="decision-matrix-confirm"
            >
              {isRatified ? (
                <>
                  <CheckCircle2 className="mr-2 h-4 w-4 text-slate-950" />
                  Decision Ratified
                </>
              ) : (
                <>
                  <Scale className="mr-2 h-4 w-4" />
                  Ratify Decision & Commit to Blueprint
                </>
              )}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
