/**
 * Self-Healing Tab
 * 
 * Displays self-healing events and health status from Phase 5.2
 */

import React, { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Progress } from "@domain-ui/core/ui/components/ui/progress";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import {
  Wand2,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Activity,
  RotateCcw,
  XCircle,
  UserCheck,
  RefreshCw
} from "lucide-react";

interface ApprovalRequest {
  id: number;
  executionId: string;
  jobId: number | null;
  status: string;
  token: string;
  createdAt: string;
}

interface SelfHealingTabProps {
  mission: any;
  run?: any;
  strategy?: string;
}

export default function SelfHealingTab({ mission, run }: SelfHealingTabProps) {
  const missionId = mission?.id;
  const [pendingApprovals, setPendingApprovals] = useState<ApprovalRequest[]>([]);
  const [approvalsLoading, setApprovalsLoading] = useState(false);
  const [decidingId, setDecidingId] = useState<number | null>(null);

  const fetchPendingApprovals = useCallback(async () => {
    if (!missionId) return;
    setApprovalsLoading(true);
    try {
      const res = await fetch(`/api/missions/${missionId}/pending-approvals`);
      if (res.ok) {
        const data = await res.json();
        setPendingApprovals(data.approvals || []);
      }
    } finally {
      setApprovalsLoading(false);
    }
  }, [missionId]);

  useEffect(() => {
    fetchPendingApprovals();
    const interval = setInterval(fetchPendingApprovals, 15000);
    return () => clearInterval(interval);
  }, [fetchPendingApprovals]);

  const handleDecision = async (approvalId: number, decision: "approved" | "rejected") => {
    setDecidingId(approvalId);
    try {
      await fetch(`/api/approvals/${approvalId}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      await fetchPendingApprovals();
    } finally {
      setDecidingId(null);
    }
  };
  // Simulated healing data (would come from API)
  const healingData = {
    healthScore: 87,
    activePatterns: [
      { pattern: "API timeout", severity: "medium", autoFix: true, detected: "2024-01-20T10:30:00Z" },
      { pattern: "Memory pressure", severity: "low", autoFix: true, detected: "2024-01-20T10:15:00Z" },
    ],
    events: [
      { 
        id: 1,
        pattern: "API timeout",
        status: "resolved", 
        remedy: "Retry with exponential backoff",
        timestamp: "2024-01-20T10:30:00Z",
        duration: 45
      },
      { 
        id: 2,
        pattern: "Tool failure",
        status: "resolved", 
        remedy: "Switched to alternative tool",
        timestamp: "2024-01-20T10:25:00Z",
        duration: 120
      },
      { 
        id: 3,
        pattern: "Memory pressure",
        status: "resolved", 
        remedy: "Garbage collection triggered",
        timestamp: "2024-01-20T10:15:00Z",
        duration: 30
      },
    ],
    escalations: [],
    newPatternsLearned: 2
  };

  const getHealthColor = (score: number) => {
    if (score >= 80) return "emerald";
    if (score >= 60) return "amber";
    return "red";
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "critical": return "red";
      case "high": return "orange";
      case "medium": return "amber";
      case "low": return "blue";
      default: return "gray";
    }
  };

  const healthColor = getHealthColor(healingData.healthScore);

  return (
    <div className="space-y-4">
      {/* Pending HIL Approval Requests */}
      {(pendingApprovals.length > 0 || approvalsLoading) && (
        <Card className="bg-amber-500/5 border-amber-500/30">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <UserCheck className="w-5 h-5 text-amber-500" />
                <CardTitle className="text-lg font-bold">Awaiting Your Approval</CardTitle>
                {pendingApprovals.length > 0 && (
                  <Badge className="bg-amber-500 text-foreground text-xs">{pendingApprovals.length}</Badge>
                )}
              </div>
              <Button variant="ghost" size="sm" onClick={fetchPendingApprovals} disabled={approvalsLoading}>
                <RefreshCw className={`w-3 h-3 ${approvalsLoading ? "animate-spin" : ""}`} />
              </Button>
            </div>
            <CardDescription>
              Mission self-healing requires your decision to continue
            </CardDescription>
          </CardHeader>
          <CardContent>
            {approvalsLoading && pendingApprovals.length === 0 ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : (
              <div className="space-y-3">
                {pendingApprovals.map((approval) => {
                  let parsedOutput: any = null;
                  try {
                    const stepOutput = (approval as any).output;
                    if (stepOutput) parsedOutput = JSON.parse(stepOutput);
                  } catch { /* ignore */ }
                  const message = parsedOutput?.message || parsedOutput?.recommendation || "Supervisor self-healing requires approval";
                  const type = parsedOutput?._type || "supervisor_triage_approval";

                  return (
                    <div key={approval.id} className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant="outline" className="text-[9px] bg-amber-500/10 text-amber-600 border-amber-500/30">
                              {type === "supervisor_plan_approval" ? "Plan Review" : "Self-Healing"}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {new Date(approval.createdAt).toLocaleTimeString()}
                            </span>
                          </div>
                          <p className="text-sm font-medium leading-snug">{message}</p>
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-red-500/30 text-red-500 hover:bg-red-500/10 h-7 text-xs"
                            disabled={decidingId === approval.id}
                            onClick={() => handleDecision(approval.id, "rejected")}
                          >
                            Reject
                          </Button>
                          <Button
                            size="sm"
                            className="bg-emerald-600 hover:bg-emerald-700 text-foreground h-7 text-xs"
                            disabled={decidingId === approval.id}
                            onClick={() => handleDecision(approval.id, "approved")}
                          >
                            Approve
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Health Score Dashboard */}
      <Card className={`bg-${healthColor}-500/5 border-${healthColor}-500/20`}>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className={`w-5 h-5 text-${healthColor}-500`} />
              <CardTitle className="text-lg font-bold">Mission Health Score</CardTitle>
            </div>
            <Badge variant="outline" className={`bg-${healthColor}-500/10 text-${healthColor}-500 border-${healthColor}-500/30`}>
              {healingData.healthScore >= 80 ? "Healthy" : healingData.healthScore >= 60 ? "Degraded" : "Critical"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-6">
            <div className={`w-20 h-20 rounded-full border-4 border-${healthColor}-500 flex items-center justify-center`}>
              <span className={`text-3xl font-black text-${healthColor}-500`}>
                {healingData.healthScore}
              </span>
            </div>
            <div className="flex-1">
              <Progress value={healingData.healthScore} className="h-3 bg-muted mb-2" />
              <p className="text-xs text-muted-foreground">
                Based on recovery success rate, failure pattern detection, and auto-remediation effectiveness.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Monitored Patterns */}
      {healingData.activePatterns.length > 0 && (
        <Card className="bg-background/40 backdrop-blur-md border-border">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              <CardTitle className="text-lg font-bold">Monitored Failure Patterns</CardTitle>
            </div>
            <CardDescription>
              Currently detected patterns being monitored for auto-remediation
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {healingData.activePatterns.map((pattern, idx) => (
                <div 
                  key={idx}
                  className="flex items-center gap-4 p-3 rounded-lg bg-background/50 border border-border/50"
                >
                  <div className={`w-2 h-2 rounded-full bg-${getSeverityColor(pattern.severity)}-500 animate-pulse`} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{pattern.pattern}</span>
                      <Badge variant="outline" className={`text-[9px] bg-${getSeverityColor(pattern.severity)}-500/10 text-${getSeverityColor(pattern.severity)}-500`}>
                        {pattern.severity}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Detected {new Date(pattern.detected).toLocaleTimeString()}
                    </p>
                  </div>
                  {pattern.autoFix && (
                    <Badge className="bg-emerald-500/20 text-emerald-500 text-[9px]">
                      <Wand2 className="w-3 h-3 mr-1" /> Auto-fix enabled
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Healing Events Log */}
      <Card className="bg-background/40 backdrop-blur-md border-border">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <RotateCcw className="w-5 h-5 text-blue-500" />
            <CardTitle className="text-lg font-bold">Recovery Events</CardTitle>
          </div>
          <CardDescription>
            Auto-remediation events and applied remedies
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[300px]">
            <div className="p-4 space-y-3">
              {healingData.events.map((event) => (
                <div 
                  key={event.id}
                  className="flex items-start gap-3 p-3 rounded-lg bg-background/50 border border-border/50"
                >
                  <div className={`w-8 h-8 rounded-lg ${event.status === "resolved" ? "bg-emerald-500/20" : "bg-red-500/20"} flex items-center justify-center shrink-0`}>
                    {event.status === "resolved" ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    ) : (
                      <XCircle className="w-4 h-4 text-red-500" />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{event.pattern}</span>
                      <Badge variant="outline" className={`text-[9px] ${event.status === "resolved" ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500"}`}>
                        {event.status}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      <span className="font-medium">Remedy:</span> {event.remedy}
                    </p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(event.timestamp).toLocaleTimeString()}
                      </span>
                      <span className="flex items-center gap-1">
                        <Activity className="w-3 h-3" />
                        Resolved in {event.duration}s
                      </span>
                    </div>
                  </div>
                </div>
              ))}
              {healingData.events.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No healing events recorded. Mission is running smoothly.
                </p>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Learning Stats */}
      <div className="grid grid-cols-2 gap-4">
        <Card className="bg-background/40 backdrop-blur-md border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
                <ShieldCheck className="w-5 h-5 text-purple-500" />
              </div>
              <div>
                <div className="text-2xl font-black">{healingData.events.length}</div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Total Recoveries</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-background/40 backdrop-blur-md border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
                <Wand2 className="w-5 h-5 text-amber-500" />
              </div>
              <div>
                <div className="text-2xl font-black">{healingData.newPatternsLearned}</div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground">New Patterns Learned</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
