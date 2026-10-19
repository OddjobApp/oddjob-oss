import React, { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../ui/card.js";
import { Button } from "../ui/button.js";
import { Badge } from "../ui/badge.js";
import { Input } from "../ui/input.js";
import { Target, CheckSquare, Plus, Trash2, Gauge, Award, DollarSign, Sparkles, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { emitWorkbenchSaved, generateW3CTraceparent, usePodEventListener } from "./pod-event-bus.js";

export interface DeliverableItem {
  id: string;
  title: string;
  verificationMethod: "automated_test" | "hil_signoff" | "agent_evaluation";
}

interface MissionBriefPodProps {
  stageId?: string;
  title?: string;
  defaultMissionTitle?: string;
  defaultDeliverables?: (string | DeliverableItem)[];
  defaultMaxRounds?: number;
  defaultMaxBudgetUsd?: number;
  defaultBudgetUsd?: number;
  defaultMaxTokens?: number;
  onStageComplete?: (payload: {
    missionTitle: string;
    deliverables: string[];
    deliverableDetails?: DeliverableItem[];
    maxRounds: number;
    maxBudgetUsd?: number;
    maxTokens?: number;
    stageId: string;
  }) => void;
  className?: string;
}

const SUGGESTED_DELIVERABLES = [
  "SOC2 Attestation & Compliance Evidence",
  "OpenAPI 3.1 Contract & Validation Tests",
  "W3C Distributed Trace Forensics",
  "E2E Integration Test Suite & Coverage",
  "Automated Pull Request & Patch Artifact",
];

export default function MissionBriefPod({
  stageId = "stage-mission-brief",
  title = "Mission Brief & Campaign Bounds",
  defaultMissionTitle = "Automated Incident Remediation & Post-Mortem Synthesis",
  defaultDeliverables = [
    "Forensic Root Cause Analysis (RCA) Document",
    "Automated Patch Pull Request & Integration Tests",
    "SOC2 Attested Signoff Record"
  ],
  defaultMaxRounds = 5,
  defaultMaxBudgetUsd,
  defaultBudgetUsd,
  defaultMaxTokens = 100000,
  onStageComplete,
  className
}: MissionBriefPodProps) {
  const normalizeDeliverables = (items: (string | DeliverableItem)[]): DeliverableItem[] => {
    return items.map((item, idx) => {
      if (typeof item === "string") {
        return {
          id: `deliv-${idx}`,
          title: item,
          verificationMethod: "automated_test",
        };
      }
      return item;
    });
  };

  const [missionTitle, setMissionTitle] = useState(defaultMissionTitle);
  const [deliverables, setDeliverables] = useState<DeliverableItem[]>(() => normalizeDeliverables(defaultDeliverables));
  const [maxRounds, setMaxRounds] = useState(defaultMaxRounds);
  const [maxBudgetUsd, setMaxBudgetUsd] = useState(defaultMaxBudgetUsd ?? defaultBudgetUsd ?? 25);
  const [maxTokens, setMaxTokens] = useState(defaultMaxTokens);
  const [newDeliverable, setNewDeliverable] = useState("");
  const [newMethod, setNewMethod] = useState<DeliverableItem["verificationMethod"]>("automated_test");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Two-way sync: Listen for agent events from Crew Chat
  usePodEventListener(
    stageId,
    useCallback((event) => {
      if (event.action === "add-deliverable" && event.payload?.title) {
        setDeliverables((prev) => [
          ...prev,
          {
            id: `deliv-${Date.now()}`,
            title: event.payload.title,
            verificationMethod: event.payload.verificationMethod || "automated_test",
          },
        ]);
      } else if (event.action === "set-title" && event.payload?.title) {
        setMissionTitle(event.payload.title);
      } else if (event.action === "set-bounds") {
        if (event.payload?.maxRounds) setMaxRounds(event.payload.maxRounds);
        if (event.payload?.maxBudgetUsd) setMaxBudgetUsd(event.payload.maxBudgetUsd);
      }
    }, [])
  );

  const addDeliverable = (overrideTitle?: string) => {
    const textToAdd = overrideTitle || newDeliverable;
    if (!textToAdd.trim()) return;
    setDeliverables([
      ...deliverables,
      {
        id: `deliv-${Date.now()}`,
        title: textToAdd.trim(),
        verificationMethod: newMethod,
      },
    ]);
    if (!overrideTitle) setNewDeliverable("");
  };

  const removeDeliverable = (id: string) => {
    setDeliverables(deliverables.filter((d) => d.id !== id));
  };

  const updateVerification = (id: string, method: DeliverableItem["verificationMethod"]) => {
    setDeliverables(deliverables.map((d) => (d.id === id ? { ...d, verificationMethod: method } : d)));
  };

  const handleConfirm = () => {
    setIsSubmitting(true);
    const traceparent = generateW3CTraceparent();
    const deliverableTitles = deliverables.map((d) => d.title);
    const payload = {
      stageId,
      missionTitle,
      deliverables: deliverableTitles,
      deliverableDetails: deliverables,
      maxRounds,
      maxBudgetUsd,
      maxTokens,
      timestamp: new Date().toISOString(),
      _trace: {
        traceparent,
        generatedAt: new Date().toISOString(),
      }
    };

    if (onStageComplete) {
      onStageComplete(payload);
    }

    emitWorkbenchSaved({
      stageId,
      summary: `Approved Mission Brief "${missionTitle}" with ${deliverables.length} key deliverables and $${maxBudgetUsd} budget cap`,
      data: payload,
      traceparent,
    });

    setTimeout(() => setIsSubmitting(false), 500);
  };

  return (
    <Card className={cn("border border-border/70 bg-card/80 shadow-md backdrop-blur-md", className)} data-testid="mission-brief-pod">
      <CardHeader className="pb-3 border-b border-border/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-blue-500/10 text-blue-500">
              <Target className="w-4 h-4" />
            </span>
            <div>
              <CardTitle className="text-sm font-bold tracking-tight">{title}</CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Define measurable deliverables, campaign bounds, and fiscal token thresholds
              </CardDescription>
            </div>
          </div>
          <Badge variant="outline" className="text-[10px] font-mono uppercase bg-blue-500/5 text-blue-600 border-blue-500/20">
            {deliverables.length} Deliverables Bound
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="p-4 space-y-4">
        {/* Mission Title */}
        <div>
          <label className="text-[11px] font-semibold text-foreground mb-1 block">Mission Title & Purpose</label>
          <Input
            value={missionTitle}
            onChange={(e) => setMissionTitle(e.target.value)}
            className="h-8 text-xs bg-background font-medium"
          />
        </div>

        {/* Deliverables Checklist with Verification Method */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-semibold text-foreground flex items-center gap-1.5">
              <Award className="w-3.5 h-3.5 text-blue-500" />
              Mandatory Completion Deliverables & DoD
            </label>
            <span className="text-[10px] text-muted-foreground">Verification Method</span>
          </div>

          <div className="space-y-1.5">
            {deliverables.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-1.5 text-xs"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <CheckSquare className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                  <span className="truncate text-foreground font-medium">{item.title}</span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <select
                    value={item.verificationMethod}
                    onChange={(e) => updateVerification(item.id, e.target.value as any)}
                    className="h-6 text-[10px] rounded border border-border/60 bg-background px-1.5 text-muted-foreground"
                  >
                    <option value="automated_test">Automated Test</option>
                    <option value="hil_signoff">Human Signoff</option>
                    <option value="agent_evaluation">AI Evaluator</option>
                  </select>

                  {deliverables.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeDeliverable(item.id)}
                      className="text-muted-foreground/60 hover:text-rose-500"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Suggested Deliverables Chips */}
          <div className="flex flex-wrap items-center gap-1 pt-1">
            <span className="text-[10px] font-semibold text-blue-500 flex items-center gap-1 mr-1">
              <Sparkles className="w-3 h-3" /> Suggestions:
            </span>
            {SUGGESTED_DELIVERABLES.slice(0, 3).map((sug) => (
              <button
                key={sug}
                type="button"
                onClick={() => addDeliverable(sug)}
                className="text-[10px] px-2 py-0.5 rounded-full border border-border/60 bg-muted/30 hover:bg-blue-500/10 hover:border-blue-500/30 text-foreground transition-colors"
              >
                + {sug.split(" ")[0]} {sug.split(" ")[1]}
              </button>
            ))}
          </div>

          <div className="flex gap-2 pt-1">
            <Input
              placeholder="Add required deliverable (e.g. Compliance Report)..."
              value={newDeliverable}
              onChange={(e) => setNewDeliverable(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addDeliverable()}
              className="h-7 text-xs bg-background"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => addDeliverable()}
              className="h-7 text-xs px-2.5 gap-1 shrink-0"
            >
              <Plus className="w-3 h-3" /> Add
            </Button>
          </div>
        </div>

        {/* Campaign Bounds, Rounds & Budget Guardrails */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Max Rounds */}
          <div className="rounded-lg border border-border/60 bg-card/40 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Gauge className="w-3.5 h-3.5 text-blue-500" />
                Max Execution Rounds
              </span>
              <Badge variant="outline" className="text-[10px] font-mono">{maxRounds} rds</Badge>
            </div>
            <div className="flex items-center gap-1">
              {[3, 5, 10, 20].map((rounds) => (
                <button
                  key={rounds}
                  type="button"
                  onClick={() => setMaxRounds(rounds)}
                  className={cn(
                    "flex-1 rounded py-1 text-[10px] font-medium font-mono transition-colors",
                    maxRounds === rounds
                      ? "bg-blue-600 text-white font-bold"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  )}
                >
                  {rounds}
                </button>
              ))}
            </div>
          </div>

          {/* Budget Cap (USD) */}
          <div className="rounded-lg border border-border/60 bg-card/40 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <DollarSign className="w-3.5 h-3.5 text-emerald-500" />
                Fiscal Spend Cap
              </span>
              <Badge variant="outline" className="text-[10px] font-mono text-emerald-600 border-emerald-500/30">
                ${typeof maxBudgetUsd === "number" ? maxBudgetUsd.toFixed(2) : maxBudgetUsd} USD
              </Badge>
            </div>
            <div className="flex items-center gap-1">
              {[10, 25, 50, 100].map((cost) => (
                <button
                  key={cost}
                  type="button"
                  onClick={() => setMaxBudgetUsd(cost)}
                  className={cn(
                    "flex-1 rounded py-1 text-[10px] font-medium font-mono transition-colors",
                    maxBudgetUsd === cost
                      ? "bg-emerald-600 text-white font-bold"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  )}
                >
                  ${cost}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-border/40">
          <span className="text-[11px] text-muted-foreground flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-blue-500" />
            Supervisor validates DoD before advancing waves
          </span>
          <Button
            size="sm"
            onClick={handleConfirm}
            disabled={deliverables.length === 0 || isSubmitting}
            className="bg-blue-600 text-white hover:bg-blue-500 text-xs h-8 px-4"
            data-testid="mission-brief-confirm"
          >
            {isSubmitting ? "Approving..." : "Approve Mission Brief & Continue"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
