import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../ui/card.js";
import { Button } from "../ui/button.js";
import { Badge } from "../ui/badge.js";
import { Input } from "../ui/input.js";
import {
  ShieldCheck,
  UserCheck,
  Clock,
  AlertTriangle,
  FileText,
  CheckCircle2,
  Lock,
  KeyRound,
  Bell,
  Radio,
  ArrowUpRight
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  emitWorkbenchSaved,
  generateW3CTraceparent,
  usePodEventListener
} from "./pod-event-bus.js";

export type QuorumPolicy = "single_owner" | "multi_sig_2_of_3" | "security_council";
export type SlaEscalationPolicy = "auto_quarantine" | "abort_pipeline" | "escalate_to_ciso";

export interface HILGovernancePodProps {
  stageId?: string;
  title?: string;
  defaultApproverRole?: string;
  defaultQuorum?: QuorumPolicy;
  defaultSlaMinutes?: number;
  defaultEscalationPolicy?: SlaEscalationPolicy;
  defaultRequirePasskey?: boolean;
  onStageComplete?: (payload: {
    approverRole: string;
    quorum: string;
    slaMinutes: number;
    requireAttestation?: boolean;
    requireWebAuthn?: boolean;
    escalationPolicy?: SlaEscalationPolicy;
    notificationChannel?: string;
    stageId: string;
    timestamp?: string;
    _trace?: { traceparent: string; generatedAt: string };
  }) => void;
  className?: string;
}

export const NOTIFICATION_CHANNELS = [
  { id: "slack_security_ops", label: "#security-ops (Slack Broadcast)" },
  { id: "pagerduty_high_sev", label: "PagerDuty (P1 / Critical Escalation)" },
  { id: "email_distribution", label: "SecOps Security Council Distribution" }
];

export default function HILGovernancePod({
  stageId = "stage-hil-governance",
  title = "Human-in-the-Loop (HIL) Governance Gate",
  defaultApproverRole = "security_lead",
  defaultQuorum = "single_owner",
  defaultSlaMinutes = 60,
  defaultEscalationPolicy = "auto_quarantine",
  defaultRequirePasskey = true,
  onStageComplete,
  className
}: HILGovernancePodProps) {
  const [approverRole, setApproverRole] = useState(defaultApproverRole);
  const [quorum, setQuorum] = useState<QuorumPolicy>(defaultQuorum);
  const [slaMinutes, setSlaMinutes] = useState(defaultSlaMinutes);
  const [requireAttestation, setRequireAttestation] = useState(true);
  const [requireWebAuthn, setRequireWebAuthn] = useState(defaultRequirePasskey);
  const [escalationPolicy, setEscalationPolicy] = useState<SlaEscalationPolicy>(defaultEscalationPolicy);
  const [notificationChannel, setNotificationChannel] = useState<string>("slack_security_ops");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Two-way chat event bus
  usePodEventListener(stageId, (event) => {
    const { action, payload } = event;
    if (action === "set-role" && payload?.role) {
      setApproverRole(payload.role);
    } else if (action === "set-quorum" && payload?.quorum) {
      setQuorum(payload.quorum);
    } else if (action === "set-sla" && typeof payload?.slaMinutes === "number") {
      setSlaMinutes(payload.slaMinutes);
    } else if (action === "set-escalation" && payload?.policy) {
      setEscalationPolicy(payload.policy);
    } else if (action === "confirm") {
      handleConfirm();
    }
  });

  const handleConfirm = () => {
    setIsSubmitting(true);
    const traceparent = generateW3CTraceparent();
    const payload = {
      stageId,
      approverRole,
      quorum,
      slaMinutes,
      requireAttestation,
      requireWebAuthn,
      escalationPolicy,
      notificationChannel,
      timestamp: new Date().toISOString(),
      _trace: {
        traceparent,
        generatedAt: new Date().toISOString()
      }
    };

    if (onStageComplete) {
      onStageComplete(payload);
    }

    emitWorkbenchSaved(
      stageId,
      `Configured HIL Policy: Role=${approverRole}, Quorum=${quorum}, SLA=${slaMinutes}m, Escalation=${escalationPolicy}`,
      payload
    );

    setTimeout(() => setIsSubmitting(false), 500);
  };

  return (
    <Card className={cn("border border-border/70 bg-card/80 shadow-md backdrop-blur-md", className)} data-testid="hil-governance-pod">
      <CardHeader className="pb-3 border-b border-border/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-emerald-500/10 text-emerald-500">
              <ShieldCheck className="w-4 h-4" />
            </span>
            <div>
              <CardTitle className="text-sm font-bold tracking-tight">{title}</CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Enforce multi-signature human attestation, WebAuthn passkey gates, and SLA timeout escalation
              </CardDescription>
            </div>
          </div>
          <Badge variant="outline" className="text-[10px] font-mono uppercase bg-emerald-500/5 text-emerald-600 border-emerald-500/20">
            SOC2 / ISO Guardrail Active
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          {/* Approver Role */}
          <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2">
            <label className="text-[11px] font-semibold text-foreground flex items-center gap-1.5">
              <UserCheck className="w-3.5 h-3.5 text-emerald-500" />
              Designated Approver Role
            </label>
            <select
              value={approverRole}
              onChange={(e) => setApproverRole(e.target.value)}
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground"
            >
              <option value="security_lead">Security Operations Lead</option>
              <option value="compliance_officer">Compliance & Risk Officer</option>
              <option value="engineering_manager">Engineering Manager</option>
              <option value="org_owner">Organization Owner</option>
            </select>
            <p className="text-[10px] text-muted-foreground">
              Only users with this cryptographic role can attest approval forms.
            </p>
          </div>

          {/* Quorum Policy */}
          <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2">
            <label className="text-[11px] font-semibold text-foreground flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-emerald-500" />
              Quorum & Multi-Sig Rule
            </label>
            <select
              value={quorum}
              onChange={(e) => setQuorum(e.target.value as any)}
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground"
            >
              <option value="single_owner">Single Signoff (1 of 1)</option>
              <option value="multi_sig_2_of_3">Multi-Signature (2 of 3 Approvers)</option>
              <option value="security_council">Security Council Consensus (100%)</option>
            </select>
            <p className="text-[10px] text-muted-foreground">
              Protects against single-point-of-compromise in high blast-radius actions.
            </p>
          </div>
        </div>

        {/* SLA & Timeout Escalation Matrix */}
        <div className="rounded-lg border border-border/60 bg-card/40 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-emerald-500" />
              <span className="text-xs font-semibold text-foreground">SLA Approval Window & Escalation</span>
            </div>
            <div className="flex items-center gap-1.5">
              {[15, 30, 60, 240].map(mins => (
                <button
                  key={mins}
                  type="button"
                  onClick={() => setSlaMinutes(mins)}
                  className={cn(
                    "rounded px-2.5 py-1 text-[11px] font-medium font-mono transition-colors",
                    slaMinutes === mins
                      ? "bg-emerald-600 text-white font-bold"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  )}
                >
                  {mins}m
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-border/30 text-xs">
            <div>
              <label className="text-[10px] font-medium text-muted-foreground mb-1 block">
                Action on SLA Expiration
              </label>
              <select
                value={escalationPolicy}
                onChange={(e) => setEscalationPolicy(e.target.value as any)}
                className="h-7 w-full rounded border border-border bg-background px-2 text-xs"
              >
                <option value="auto_quarantine">Auto-Quarantine Execution (Fail-Safe)</option>
                <option value="abort_pipeline">Abort Pipeline & Rollback</option>
                <option value="escalate_to_ciso">Escalate to CISO On-Call</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-medium text-muted-foreground mb-1 block">
                Notification Channel
              </label>
              <select
                value={notificationChannel}
                onChange={(e) => setNotificationChannel(e.target.value)}
                className="h-7 w-full rounded border border-border bg-background px-2 text-xs"
              >
                {NOTIFICATION_CHANNELS.map(ch => (
                  <option key={ch.id} value={ch.id}>{ch.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* WebAuthn Passkey & Cryptographic Signing */}
        <div className="rounded-lg border border-border/60 bg-muted/20 p-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <KeyRound className="w-4 h-4 text-emerald-500" />
            <div>
              <p className="text-xs font-semibold text-foreground">WebAuthn / Passkey Hardware Attestation</p>
              <p className="text-[10px] text-muted-foreground">
                Require physical FIDO2 / YubiKey biometric challenge to complete signoff
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setRequireWebAuthn(!requireWebAuthn)}
            className={cn(
              "px-3 py-1 rounded text-[11px] font-medium transition-colors border",
              requireWebAuthn
                ? "border-emerald-500/40 bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-semibold"
                : "border-border bg-muted text-muted-foreground"
            )}
          >
            {requireWebAuthn ? "Enforced" : "Optional"}
          </button>
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-border/40">
          <span className="text-[11px] text-muted-foreground">
            All attestations are cryptographically signed and stored in forensic audit logs
          </span>
          <Button
            size="sm"
            onClick={handleConfirm}
            disabled={isSubmitting}
            className="bg-emerald-600 text-white hover:bg-emerald-500 text-xs h-8 px-4"
            data-testid="hil-governance-confirm"
          >
            {isSubmitting ? "Locking..." : "Lock Governance Gate & Continue"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
