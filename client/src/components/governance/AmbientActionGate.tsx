import React, { useState } from "react";
import {
  ShieldCheck,
  AlertTriangle,
  Lock,
  Check,
  X,
  Play,
  ArrowUpRight,
  HelpCircle,
  Clock3,
  DollarSign
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type GovernanceTier = "tier1_autopilot" | "tier2_microgate" | "tier3_multisig";

export interface AmbientActionGateProps {
  id: string;
  tier: GovernanceTier;
  actionTitle: string;
  actionDescription?: string;
  estimatedCost?: number;
  policyName?: string;
  rationales?: {
    agentPersona: string;
    verdict: "approve" | "caution" | "reject";
    reasoning: string;
  }[];
  onApprove?: (actionId: string, dryRun?: boolean) => void;
  onReject?: (actionId: string) => void;
  className?: string;
}

/**
 * AmbientActionGate
 * 
 * Non-disruptive, 3-tier ambient governance chip:
 * - Tier 1: 🟢 Autonomous execution under policy guardrails (ambient chip)
 * - Tier 2: 🟡 1-Click inline micro-approval without breaking conversation/work flow
 * - Tier 3: 🔴 Adversarial multi-agent consensus attestation card
 */
export const AmbientActionGate: React.FC<AmbientActionGateProps> = ({
  id,
  tier,
  actionTitle,
  actionDescription,
  estimatedCost,
  policyName = "Oddjob Autonomous Policy Guardrail",
  rationales = [],
  onApprove,
  onReject,
  className = ""
}) => {
  const [isResolved, setIsResolved] = useState<"approved" | "rejected" | "dry_run" | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  const handleApprove = (dryRun = false) => {
    setIsResolved(dryRun ? "dry_run" : "approved");
    onApprove?.(id, dryRun);
  };

  const handleReject = () => {
    setIsResolved("rejected");
    onReject?.(id);
  };

  if (isResolved) {
    return (
      <div className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs ${
        isResolved === "approved"
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : isResolved === "dry_run"
          ? "border-indigo-500/30 bg-indigo-500/10 text-indigo-500"
          : "border-destructive/30 bg-destructive/10 text-destructive"
      } ${className}`} data-testid={`action-gate-resolved-${id}`}>
        {isResolved === "approved" ? (
          <Check className="h-3.5 w-3.5" />
        ) : isResolved === "dry_run" ? (
          <Play className="h-3.5 w-3.5" />
        ) : (
          <X className="h-3.5 w-3.5" />
        )}
        <span className="font-medium">
          {actionTitle}: {isResolved === "approved" ? "Approved & Executed" : isResolved === "dry_run" ? "Dry-Run Simulation Complete" : "Action Rejected"}
        </span>
      </div>
    );
  }

  // TIER 1: Ambient Autonomous Auto-Pilot (Green)
  if (tier === "tier1_autopilot") {
    return (
      <div
        className={`inline-flex items-center gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-2.5 py-1 text-xs text-muted-foreground ${className}`}
        data-testid={`action-gate-tier1-${id}`}
      >
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
        </span>
        <span className="font-medium text-foreground">{actionTitle}</span>
        <Badge variant="outline" className="h-4 px-1 text-[9px] border-emerald-500/30 text-emerald-600 dark:text-emerald-400">
          Auto-Pilot
        </Badge>
        {estimatedCost !== undefined && (
          <span className="text-[10px] text-muted-foreground/80 font-mono">
            ${estimatedCost.toFixed(2)}
          </span>
        )}
      </div>
    );
  }

  // TIER 2: 1-Click Micro-Gate (Amber)
  if (tier === "tier2_microgate") {
    return (
      <div
        className={`flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/5 p-2.5 text-xs shadow-xs ${className}`}
        data-testid={`action-gate-tier2-${id}`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1 rounded-md bg-amber-500/10 text-amber-500">
            <AlertTriangle className="h-4 w-4 shrink-0" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-foreground truncate">{actionTitle}</span>
              <Badge variant="outline" className="h-4 px-1 text-[9px] border-amber-500/40 text-amber-600 dark:text-amber-400 font-mono">
                Micro-Gate
              </Badge>
            </div>
            {actionDescription && (
              <p className="text-[11px] text-muted-foreground truncate max-w-sm">
                {actionDescription}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => handleApprove(true)}
            title="Execute as non-destructive dry-run"
          >
            <Play className="h-3 w-3 mr-1" />
            Dry-Run
          </Button>

          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2.5 text-xs gap-1 border-amber-500/50 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 font-medium"
            onClick={() => handleApprove(false)}
          >
            <Check className="h-3 w-3" />
            <span>Approve {estimatedCost ? `(+$${estimatedCost.toFixed(2)})` : ""}</span>
          </Button>

          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={handleReject}
            title="Reject action"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    );
  }

  // TIER 3: Adversarial Multi-Sig Consensus Gate (Red)
  return (
    <div
      className={`rounded-xl border border-destructive/40 bg-card p-3.5 text-xs shadow-md space-y-3 ${className}`}
      data-testid={`action-gate-tier3-${id}`}
    >
      <div className="flex items-center justify-between border-b border-border/70 pb-2.5">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-destructive/10 text-destructive">
            <Lock className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-foreground text-sm">{actionTitle}</span>
              <Badge variant="destructive" className="h-4 px-1.5 text-[9px] font-mono uppercase">
                Tier 3: Multi-Sig Required
              </Badge>
            </div>
            <span className="text-[10px] text-muted-foreground">Governed by: {policyName}</span>
          </div>
        </div>

        {estimatedCost !== undefined && (
          <Badge variant="outline" className="font-mono text-xs">
            ${estimatedCost.toFixed(2)} USD
          </Badge>
        )}
      </div>

      {actionDescription && (
        <p className="text-muted-foreground text-xs leading-relaxed">
          {actionDescription}
        </p>
      )}

      {/* Adversarial Consensus Rationales */}
      {rationales.length > 0 && (
        <div className="space-y-1.5 rounded-lg border border-border/60 bg-muted/20 p-2.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Adversarial Agent Attestations
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
            {rationales.map((r, idx) => (
              <div
                key={idx}
                className={`rounded-md p-2 border text-[11px] ${
                  r.verdict === "approve"
                    ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400"
                    : r.verdict === "caution"
                    ? "border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400"
                    : "border-destructive/30 bg-destructive/5 text-destructive"
                }`}
              >
                <div className="flex items-center justify-between font-semibold mb-0.5">
                  <span>{r.agentPersona}</span>
                  <span className="uppercase text-[9px]">{r.verdict}</span>
                </div>
                <p className="text-muted-foreground text-[10px] leading-snug">
                  {r.reasoning}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Dual Signature Controls */}
      <div className="flex items-center justify-end gap-2 pt-1">
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          onClick={handleReject}
        >
          <X className="h-3.5 w-3.5 mr-1" />
          Reject & Rollback
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs gap-1.5 border-indigo-500/40 text-indigo-500 hover:bg-indigo-500/10"
          onClick={() => handleApprove(true)}
        >
          <Play className="h-3.5 w-3.5" />
          Verify in Sandbox
        </Button>
        <Button
          size="sm"
          className="h-8 text-xs gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold shadow-sm"
          onClick={() => handleApprove(false)}
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          Authorize Multi-Sig Action
        </Button>
      </div>
    </div>
  );
};

export default AmbientActionGate;
