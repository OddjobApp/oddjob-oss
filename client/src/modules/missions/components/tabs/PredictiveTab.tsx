/**
 * Predictive Tab
 * 
 * Displays predictive planning insights from Phase 5.1
 */

import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Progress } from "@domain-ui/core/ui/components/ui/progress";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { 
  TrendingUp, 
  AlertTriangle, 
  Clock,
  BrainCircuit,
  Zap,
  CheckCircle2,
  AlertCircle,
  Wrench,
  ShieldAlert,
  Lightbulb
} from "lucide-react";

interface PredictiveTabProps {
  mission: any;
  run?: any;
  strategy?: string;
  viewMode?: "business" | "developer";
}

interface RiskFactor {
  label: string;
  resolution: string;
  icon: React.ElementType;
}

export default function PredictiveTab({ mission, run, viewMode }: PredictiveTabProps) {
  const [appliedResolutions, setAppliedResolutions] = useState<Set<number>>(new Set());

  // Simulated predictive data (would come from API in real implementation)
  const predictions = {
    completionEstimate: {
      hours: 4.5,
      confidence: 0.82,
      range: "3.5 - 6.2 hours"
    },
    riskLevel: "medium", // low, medium, high
    riskFactors: [
      {
        label: "Complex integration step ahead",
        resolution: "Pre-validate API credentials and sandbox test the endpoint before proceeding.",
        icon: ShieldAlert,
      },
      {
        label: "Tool dependency on external API",
        resolution: "Enable fallback mode to allow the agent to retry with a secondary provider.",
        icon: Wrench,
      },
    ] as RiskFactor[],
    toolRecommendations: [
      { tool: "code_analyzer", successRate: 0.94, reason: "Similar patterns in past missions" },
      { tool: "smart_contract_auditor", successRate: 0.89, reason: "Recommended for security tasks" },
    ],
    patternMatch: {
      similarMissions: 3,
      avgCompletionTime: "5.2 hours",
      successRate: "87%"
    }
  };

  const getRiskStyles = (risk: string) => {
    switch (risk) {
      case "low": return {
        card: "bg-emerald-500/5 border-emerald-500/20",
        text: "text-emerald-500",
        border: "border-emerald-500",
        bg: "bg-emerald-500/10",
        icon: "text-emerald-500"
      };
      case "medium": return {
        card: "bg-amber-500/5 border-amber-500/20",
        text: "text-amber-500",
        border: "border-amber-500",
        bg: "bg-amber-500/10",
        icon: "text-amber-500"
      };
      case "high": return {
        card: "bg-red-500/5 border-red-500/20",
        text: "text-red-500",
        border: "border-red-500",
        bg: "bg-red-500/10",
        icon: "text-red-500"
      };
      default: return {
        card: "bg-gray-500/5 border-gray-500/20",
        text: "text-muted-foreground",
        border: "border-gray-500",
        bg: "bg-gray-500/10",
        icon: "text-muted-foreground"
      };
    }
  };

  const styles = getRiskStyles(predictions.riskLevel);

  const toggleResolution = (idx: number) => {
    setAppliedResolutions(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {/* Prototype notice — data is simulated until predictive API is wired */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-medium">
        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
        Predictive insights are illustrative estimates. Live data integration is pending.
      </div>

      {/* Risk Assessment */}
      <Card className={styles.card}>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className={`w-5 h-5 ${styles.icon}`} />
            <CardTitle className="text-lg font-bold">Risk Assessment</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-6 mb-4">
            <div className={`w-20 h-20 rounded-full border-4 ${styles.border} flex items-center justify-center flex-shrink-0 ${styles.bg} transition-all duration-500 hover:scale-105 shadow-lg`}>
              <span className={`text-[11px] font-black ${styles.text} uppercase tracking-[0.15em] text-center px-1 whitespace-nowrap`}>
                {predictions.riskLevel}
              </span>
            </div>
            <div className="flex-1">
              <p className="text-sm text-muted-foreground leading-relaxed">
                Based on mission complexity, historical patterns, and current trajectory.
              </p>
            </div>
          </div>
          
          {predictions.riskFactors.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs uppercase tracking-widest text-muted-foreground">Risk Factors</p>
              {predictions.riskFactors.map((factor, idx) => {
                const Icon = factor.icon;
                const isResolved = appliedResolutions.has(idx);
                return (
                  <div
                    key={idx}
                    className={`p-3 rounded-xl border transition-all duration-300 ${
                      isResolved
                        ? "bg-emerald-500/5 border-emerald-500/20"
                        : "bg-muted/30 border-border/50"
                    }`}
                  >
                    <div className="flex items-start gap-2 mb-2">
                      {isResolved ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                      ) : (
                        <AlertCircle className={`w-4 h-4 ${styles.icon} mt-0.5 shrink-0`} />
                      )}
                      <div className="flex-1">
                        <p className={`text-sm font-medium ${isResolved ? "line-through text-muted-foreground" : ""}`}>
                          {factor.label}
                        </p>
                        {/* Resolution suggestion */}
                        <div className="flex items-start gap-1.5 mt-1.5">
                          <Lightbulb className="w-3 h-3 text-amber-400 mt-0.5 shrink-0" />
                          <p className="text-xs text-amber-400/80 leading-relaxed">
                            {factor.resolution}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="flex justify-end mt-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => toggleResolution(idx)}
                        className={`h-7 px-3 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all ${
                          isResolved
                            ? "text-emerald-500 hover:text-emerald-400 hover:bg-emerald-500/10"
                            : `${styles.text} hover:bg-foreground/5 border border-transparent hover:border-white/10`
                        }`}
                      >
                        {isResolved ? "✓ Acknowledged" : "Mark Resolved →"}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Completion Forecast */}
      <Card className="bg-background/40 backdrop-blur-md border-border">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-blue-500" />
            <CardTitle className="text-lg font-bold">Completion Forecast</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-3xl font-black text-blue-500">
                {predictions.completionEstimate.hours}h
              </div>
              <p className="text-xs text-muted-foreground">Estimated time remaining</p>
            </div>
            <div className="text-right">
              <div className="text-lg font-bold text-muted-foreground">
                {predictions.completionEstimate.range}
              </div>
              <p className="text-xs text-muted-foreground">Confidence range</p>
            </div>
          </div>
          
          <div>
            <div className="flex justify-between mb-1">
              <span className="text-xs uppercase tracking-widest text-muted-foreground">Confidence</span>
              <span className="text-xs font-bold">{Math.round(predictions.completionEstimate.confidence * 100)}%</span>
            </div>
            <Progress 
              value={predictions.completionEstimate.confidence * 100} 
              className="h-2 bg-muted" 
            />
          </div>
        </CardContent>
      </Card>

      {/* Tool Recommendations — Developer only */}
      {viewMode !== "business" && (
        <Card className="bg-background/40 backdrop-blur-md border-border">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-amber-500" />
              <CardTitle className="text-lg font-bold">Tool Recommendations</CardTitle>
            </div>
            <CardDescription>
              AI-suggested tools based on historical success rates
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {predictions.toolRecommendations.map((rec, idx) => (
                <div 
                  key={idx}
                  className="flex items-center gap-4 p-3 rounded-lg bg-background/50 border border-border/50"
                >
                  <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
                    <BrainCircuit className="w-5 h-5 text-amber-500" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold capitalize">{rec.tool.replace(/_/g, " ")}</span>
                      <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 text-[9px]">
                        {Math.round(rec.successRate * 100)}% success
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{rec.reason}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Historical Pattern Match */}
      <Card className="bg-background/40 backdrop-blur-md border-border">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-purple-500" />
            <CardTitle className="text-lg font-bold">Historical Pattern Match</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-2xl font-black text-purple-500">
                {predictions.patternMatch.similarMissions}
              </div>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Similar Missions</p>
            </div>
            <div>
              <div className="text-2xl font-black text-blue-500">
                {predictions.patternMatch.avgCompletionTime}
              </div>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Avg. Time</p>
            </div>
            <div>
              <div className="text-2xl font-black text-emerald-500">
                {predictions.patternMatch.successRate}
              </div>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Success Rate</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

