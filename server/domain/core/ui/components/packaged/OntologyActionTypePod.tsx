import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../ui/card.js";
import { Button } from "../ui/button.js";
import { Badge } from "../ui/badge.js";
import { Input } from "../ui/input.js";
import { Zap, ShieldAlert, ArrowRight, CheckCircle2, UserCheck } from "lucide-react";
import { cn } from "@/lib/utils";

export interface OntologyActionTypePayload {
  stageId: string;
  actionName: string;
  displayName: string;
  description: string;
  targetObjectType: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  requiresApproval: boolean;
  approverRole?: string;
  parameters: Record<string, string>;
  handlerType: "pipeline" | "micro_action" | "ontology_mutation";
  executionTarget: string;
}

export interface OntologyActionTypePodProps {
  stageId?: string;
  title?: string;
  defaultActionName?: string;
  defaultTargetObjectType?: string;
  onStageComplete?: (payload: OntologyActionTypePayload) => void;
  className?: string;
}

const RISK_LEVELS: Array<{ level: OntologyActionTypePayload["riskLevel"]; label: string; color: string }> = [
  { level: "low", label: "Low (Auto-Approved)", color: "text-emerald-400 border-emerald-500/40" },
  { level: "medium", label: "Medium (Audited)", color: "text-blue-400 border-blue-500/40" },
  { level: "high", label: "High (HIL Signoff Required)", color: "text-amber-400 border-amber-500/40" },
  { level: "critical", label: "Critical (Multi-Sign Quorum)", color: "text-rose-400 border-rose-500/40" },
];

export default function OntologyActionTypePod({
  stageId = "stage-ontology-action-type",
  title = "Configure an Ontology Action Type",
  defaultActionName = "",
  defaultTargetObjectType = "",
  onStageComplete,
  className,
}: OntologyActionTypePodProps) {
  const [actionName, setActionName] = useState(defaultActionName);
  const [displayName, setDisplayName] = useState(defaultActionName ? defaultActionName.replace(/_/g, " ") : "");
  const [description, setDescription] = useState("");
  const [targetObjectType, setTargetObjectType] = useState(defaultTargetObjectType);
  const [riskLevel, setRiskLevel] = useState<OntologyActionTypePayload["riskLevel"]>("medium");
  const [requiresApproval, setRequiresApproval] = useState<boolean>(true);
  const [approverRole, setApproverRole] = useState("Security Officer");
  const [handlerType, setHandlerType] = useState<OntologyActionTypePayload["handlerType"]>("pipeline");
  const [executionTarget, setExecutionTarget] = useState("");

  const isValid = actionName.trim().length >= 2 && targetObjectType.trim().length >= 2;

  const handleConfirm = () => {
    if (!isValid) return;

    const payload: OntologyActionTypePayload = {
      stageId,
      actionName: actionName.trim().replace(/[^a-zA-Z0-9_]/g, "_"),
      displayName: displayName.trim() || actionName.trim(),
      description: description.trim(),
      targetObjectType: targetObjectType.trim(),
      riskLevel,
      requiresApproval,
      approverRole: requiresApproval ? approverRole.trim() : undefined,
      parameters: { reason: "string", initiatedBy: "string" },
      handlerType,
      executionTarget: executionTarget.trim() || `execute_${actionName.trim().toLowerCase()}`,
    };

    onStageComplete?.(payload);
  };

  return (
    <Card className={cn("w-full border-amber-500/30 bg-card/70 backdrop-blur-md shadow-xl", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <CardTitle className="text-base font-bold text-foreground">{title}</CardTitle>
              <CardDescription className="text-xs">
                Declare a governed business mutation or automated action on an Ontology Object
              </CardDescription>
            </div>
          </div>
          <Badge variant="outline" className="text-[10px] font-mono border-amber-500/40 text-amber-300">
            Action Type
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 text-xs">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-foreground">Action Name (ID)</label>
            <Input
              placeholder="e.g. RestartService, QuarantineCustomer"
              value={actionName}
              onChange={(e) => {
                setActionName(e.target.value);
                if (!displayName) setDisplayName(e.target.value);
              }}
              className="h-8 text-xs font-mono"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-foreground">Target Object Type</label>
            <Input
              placeholder="e.g. Microservice, Customer, Incident"
              value={targetObjectType}
              onChange={(e) => setTargetObjectType(e.target.value)}
              className="h-8 text-xs font-mono"
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold text-foreground">Description & Business Justification</label>
          <Input
            placeholder="What operational effect does this action execute on the target object?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="h-8 text-xs"
          />
        </div>

        {/* ── Governance & Risk Level ── */}
        <div className="space-y-2 pt-2 border-t border-border/40">
          <span className="font-semibold text-foreground flex items-center gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5 text-amber-400" /> Action Risk & Governance Gate
          </span>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {RISK_LEVELS.map((r) => (
              <button
                key={r.level}
                type="button"
                onClick={() => {
                  setRiskLevel(r.level);
                  if (r.level === "high" || r.level === "critical") setRequiresApproval(true);
                }}
                className={cn(
                  "flex items-center justify-between p-2 rounded-md border text-left text-xs transition-all",
                  riskLevel === r.level
                    ? "bg-amber-500/10 border-amber-500 text-amber-300 font-semibold"
                    : "bg-muted/20 border-border/40 text-muted-foreground hover:bg-muted/40"
                )}
              >
                <span>{r.label}</span>
                {riskLevel === r.level && <CheckCircle2 className="w-3.5 h-3.5 text-amber-400" />}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3 pt-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={requiresApproval}
                onChange={(e) => setRequiresApproval(e.target.checked)}
                className="rounded border-input text-amber-500 focus:ring-amber-400"
              />
              <span className="text-xs font-medium text-foreground">Require Human Sign-off (HIL)</span>
            </label>

            {requiresApproval && (
              <div className="flex items-center gap-1.5 flex-1">
                <UserCheck className="w-3.5 h-3.5 text-amber-400" />
                <Input
                  placeholder="Designated Approver Role (e.g. Lead SRE, Security Auditor)"
                  value={approverRole}
                  onChange={(e) => setApproverRole(e.target.value)}
                  className="h-7 text-xs flex-1"
                />
              </div>
            )}
          </div>
        </div>

        {/* ── Handler & Execution Target ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-border/40">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-foreground">Execution Handler</label>
            <select
              value={handlerType}
              onChange={(e) => setHandlerType(e.target.value as any)}
              className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="pipeline">Automated Pipeline</option>
              <option value="micro_action">Direct Micro-Action</option>
              <option value="ontology_mutation">Ontology DB Mutation</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-foreground">Target Pipeline / Endpoint</label>
            <Input
              placeholder="e.g. restart_service_pipeline"
              value={executionTarget}
              onChange={(e) => setExecutionTarget(e.target.value)}
              className="h-8 text-xs font-mono"
            />
          </div>
        </div>

        {/* Submit */}
        <div className="flex items-center justify-between pt-3 border-t border-border/40">
          <span className="text-[11px] text-muted-foreground">
            {isValid ? "Ready to declare Action Type to CREW" : "Provide an action name and target object"}
          </span>
          <Button
            size="sm"
            disabled={!isValid}
            onClick={handleConfirm}
            className="bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs h-8"
          >
            Declare Action Type <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
