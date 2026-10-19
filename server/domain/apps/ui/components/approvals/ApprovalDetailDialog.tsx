/**
 * Approval Detail Dialog with Shadow Diff UI.
 * Aligned with docs/specs/HIL_2_ACCOUNTABILITY_SPEC.md
 */
import { imageClickCoordinates, type ImageClick } from '@/lib/image-click-coordinates';

import { useState, useEffect, useMemo } from 'react';
import { useLocation } from 'wouter';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@domain-ui/core/ui/components/ui/dialog";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { CheckCircle2, XCircle, Clock, AlertCircle, Wrench, Info, GitCompare, Sparkles, FileText, Bot, Terminal, ShieldCheck, UserCheck, Link2, Fingerprint, KeyRound, Swords, ZoomIn, ZoomOut } from 'lucide-react';
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@domain-ui/core/ui/components/ui/tabs";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@domain-ui/core/ui/components/ui/resizable";
import { JsonDiffViewer } from './JsonDiffViewer';
import { cn } from "@/lib/utils";
import { computeImpactLevel, type ImpactLevel } from "@/utils/json-diff";
import type { FormSchema } from "@domain-ui/core/ui/components/shared/FormRenderer";
import { StudioForm } from "@/modules/forms/StudioForm";
import { FormStageRequestPanel } from "@/modules/forms/FormStageTask";
import { approvalReviewFields } from "@shared/approval-args";

interface ApprovalRequest {
    id: number;
    pipelineName: string;
    stepName: string;
    createdAt: string;
    contextSnapshot: any;
    pipelineExecutionId: number;
    status?: string;
    comments?: string | null;
    isEvolutionary?: boolean;
    baselineSnapshot?: any;
    baselineLabel?: string;
    toolName?: string | null;
    toolArgs?: any;
    jobId?: number | null;
    missionId?: number | null;
}

interface ApprovalDetailDialogProps {
    approval: ApprovalRequest | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onDecision: () => void;
}

function getImpactBadge(level: ImpactLevel) {
    switch (level) {
        case 'structural':
            return { label: 'Structural change', variant: 'destructive' as const, className: 'bg-rose-500/15 text-rose-700 dark:text-rose-300' };
        case 'major':
            return { label: 'Major changes', variant: 'destructive' as const, className: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' };
        case 'minor':
            return { label: 'Minor edits', variant: 'secondary' as const, className: 'bg-slate-500/15 text-muted-foreground dark:text-muted-foreground' };
        default:
            return null;
    }
}

/**
 * Mirrors RemediationChip in
 * server/domain/governor/core/swiss-cheese-guardrail.service.ts — the guardrail
 * generates these on every block, so the shape is the service's, not the UI's.
 */
interface RemediationChip {
    id: string;
    label: string;
    actionType: "request_override" | "downgrade_scope" | "escalate_hil" | "sanitize_prompt" | "retry_with_redaction";
    suggestedPayload?: any;
    description: string;
}

/**
 * Guardrail verdict carried on the approval's context snapshot. Absent for
 * approvals that never went through the Swiss Cheese layers, which is why every
 * field is optional and the panel renders nothing when there are no chips.
 */
function getGuardrailContext(approval: ApprovalRequest | null): {
    chips: RemediationChip[];
    blockedAtLayer?: number;
    blockedLayerName?: string;
    riskScore?: number;
} {
    const snapshot = approval?.contextSnapshot;
    const chips = Array.isArray(snapshot?.remediationChips) ? (snapshot.remediationChips as RemediationChip[]) : [];
    return {
        chips: chips.filter((chip) => chip && typeof chip.id === "string" && typeof chip.label === "string"),
        blockedAtLayer: typeof snapshot?.blockedAtLayer === "number" ? snapshot.blockedAtLayer : undefined,
        blockedLayerName: typeof snapshot?.blockedLayerName === "string" ? snapshot.blockedLayerName : undefined,
        riskScore: typeof snapshot?.overallRiskScore === "number" ? snapshot.overallRiskScore : undefined,
    };
}

function getGovernanceContext(approval: ApprovalRequest | null) {
    const snapshot = approval?.contextSnapshot;
    const governance = snapshot?.governance;
    if (governance?.source === "agent_governance") return governance;
    return null;
}

function formatValue(value: unknown) {
    if (value == null || value === "") return "—";
    if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
    return String(value);
}

function riskClassName(risk: string | undefined) {
    switch (risk) {
        case "critical":
        case "high":
            return "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300";
        case "medium":
            return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
        default:
            return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    }
}

function humanizeKey(key: string) {
    return key
        .replace(/[_-]+/g, " ")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/\b\w/g, (char) => char.toUpperCase());
}

function isSensitiveKey(key: string) {
    return /token|secret|password|credential|api[_-]?key/i.test(key);
}

function displayValue(value: unknown): string {
    if (value == null || value === "") return "-";
    if (Array.isArray(value)) return value.length ? value.map(displayValue).join(", ") : "-";
    if (typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>)
            .filter(([key]) => !isSensitiveKey(key))
            .slice(0, 4)
            .map(([key, entryValue]) => `${humanizeKey(key)}: ${displayValue(entryValue)}`);
        return entries.length ? entries.join("; ") : "-";
    }
    return String(value);
}

function SummaryField({ label, value }: { label: string; value: unknown }) {
    return (
        <div className="rounded-xl border border-white/10 bg-black/10 p-3">
            <div className="mb-1 text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                {label}
            </div>
            <div className="break-words text-sm font-semibold text-foreground" title={displayValue(value)}>
                {displayValue(value)}
            </div>
        </div>
    );
}

export function ApprovalDetailDialog({ approval, open, onOpenChange, onDecision }: ApprovalDetailDialogProps) {
    const [, setLocation] = useLocation();
    const { toast } = useToast();
    const [comments, setComments] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSnoozing, setIsSnoozing] = useState(false);
    const [activeTab, setActiveTab] = useState("review");
    const [editableOutput, setEditableOutput] = useState("");
    const [captchaSolution, setCaptchaSolution] = useState("");
    const [captchaCoordinates, setCaptchaCoordinates] = useState<ImageClick | null>(null);
    const [isCaptchaZoomed, setIsCaptchaZoomed] = useState(false);

    const originalOutput = useMemo(() => {
        if (!approval || !approval.contextSnapshot) return '';
        try {
            return JSON.stringify(approval.contextSnapshot, null, 2);
        } catch {
            return String(approval.contextSnapshot);
        }
    }, [approval?.contextSnapshot]);

    const baselineOutput = useMemo(() => {
        if (!approval || !approval.baselineSnapshot) return '';
        try {
            return JSON.stringify(approval.baselineSnapshot, null, 2);
        } catch {
            return String(approval.baselineSnapshot);
        }
    }, [approval?.baselineSnapshot]);

    const impactLevel = useMemo(
        () => computeImpactLevel(originalOutput, editableOutput),
        [originalOutput, editableOutput]
    );

    const impactBadge = getImpactBadge(impactLevel);

    const isIntervention = useMemo(() => {
        if (!approval?.contextSnapshot) return false;
        const ctx = approval.contextSnapshot;
        return ctx.type === 'strategic_intervention' || 
               ctx.context?.type === 'strategic_intervention' ||
               (typeof ctx.command === 'string' && ctx.command.startsWith('SIG_USER_ALERT'));
    }, [approval?.contextSnapshot]);

    const isOptimization = useMemo(() => {
        if (!approval?.contextSnapshot) return false;
        const ctx = approval.contextSnapshot;
        return ctx.type === 'OPTIMIZATION_PROPOSAL';
    }, [approval?.contextSnapshot]);

    const isInputRequest = useMemo(() => {
        if (!approval?.contextSnapshot) return false;
        const ctx = approval.contextSnapshot;
        return ctx.type === 'input_request' || 
               ctx.params?.type === 'input_request' || 
               ctx.context?.type === 'input_request' || 
               ctx.context?.params?.type === 'input_request' ||
               ctx.command === 'Agent requested input_request' ||
               (ctx.message || ctx.context?.message)?.includes('requires the following information to proceed:');
    }, [approval?.contextSnapshot]);

    /**
     * CAPTCHA relay from server/domain/agents/core/selenium-agent.service.ts.
     * That code screenshots the challenge, files this approval, pauses the
     * mission run and then polls `modifiedOutput.solution` for five minutes.
     * Until this branch existed nothing in the client referenced
     * `captcha_solution` at all, so the only way to answer was to hand-type
     * JSON into the edit tab — inside that five-minute window.
     */
    const isCaptchaRequest = useMemo(() => {
        if (!approval?.contextSnapshot) return false;
        const ctx = approval.contextSnapshot;
        return ctx.type === 'captcha_solution' || ctx.context?.type === 'captcha_solution' ||
               ctx.type === 'security_challenge' || ctx.context?.type === 'security_challenge' ||
               ctx.type === '2fa' || ctx.context?.type === '2fa' ||
               ctx.type === 'mfa' || ctx.context?.type === 'mfa' ||
               ctx.type === 'two_factor_auth' || ctx.context?.type === 'two_factor_auth' ||
               ctx.type === 'verification_code' || ctx.context?.type === 'verification_code';
    }, [approval?.contextSnapshot]);

    /**
     * A stage of a cycle's Form Studio response (form-studio-stage-requests.service.ts).
     * It is completed by submitting the stage's answers, never by approving the
     * request, which the server refuses.
     */
    const isFormStage = approval?.contextSnapshot?.kind === 'form_stage';

    const governance = getGovernanceContext(approval);
    const isGovernanceApproval = !!governance;
    const isNonTechnical = isIntervention || isInputRequest || isOptimization || isGovernanceApproval || isCaptchaRequest || isFormStage;

    useEffect(() => {
        if (open && approval) {
            setEditableOutput(originalOutput);
            setCaptchaSolution("");
            setCaptchaCoordinates(null);
            setIsCaptchaZoomed(false);
            setComments(approval.comments || '');
            setActiveTab("review");
        }
    }, [open, approval, originalOutput]);

    const isResolved = !!(approval?.status && approval.status !== 'pending');

    const formValues = useMemo(() => {
        try {
            const parsed = JSON.parse(editableOutput);
            if (parsed.type === 'input_request') return parsed;
            if (parsed.params?.type === 'input_request') return parsed.params;
            if (parsed.context?.type === 'input_request') return parsed.context;
            if (parsed.context?.params?.type === 'input_request') return parsed.context.params;
            
            // NEW: Handle Dynamic Orchestrator HIL_REQUEST
            if (parsed.dynamicAction?.action === 'HIL_REQUEST') {
                const actionDetails = parsed.dynamicAction?.action_details || {};
                const thoughtProcess = parsed.dynamicAction?.thought_process || parsed.thought_process;
                
                // Construct a robust message from available context
                const message = actionDetails.question || 
                                (actionDetails.final_product ? `REVIEW PROPOSED OUTPUT:\n${actionDetails.final_product}` : null) ||
                                thoughtProcess || 
                                'The agent requires human input to proceed.';

                return {
                    type: 'input_request',
                    pipelineName: parsed.pipelineName || 'Mission Request',
                    message: message,
                    reasoning: thoughtProcess,
                    thought_process: thoughtProcess,
                    fields: [{
                        name: 'answer',
                        label: 'Your Response',
                        type: 'textarea',
                        required: true,
                        description: 'Provide the requested context or decision.'
                    }]
                };
            }

            // Heuristic fallback for plain text messages (synced with renderContext)
            const msg = parsed.message || parsed.context?.message || parsed.params?.message;
            if (msg?.includes('requires the following information to proceed:')) {
                const fieldNames = msg.split('proceed:')[1]?.split(',').map((s: string) => s.trim()) || [];
                return {
                    type: 'input_request',
                    pipelineName: parsed.pipelineName || parsed.context?.pipelineName || 'Agent Request',
                    message: msg,
                    fields: fieldNames.map((name: string) => ({
                        name: name,
                        label: name.charAt(0).toUpperCase() + name.slice(1).replace(/_/g, ' '),
                        type: 'text',
                        required: true
                    }))
                };
            }
            return null;
        } catch {
            return null;
        }
    }, [editableOutput]);

    if (!approval) return null;

    const handleDecision = async (action: 'approve' | 'reject', remediation?: RemediationChip) => {
        // Approving a CAPTCHA with an empty box resumes the agent with nothing
        // to type, which burns the single relay attempt.
        if (isCaptchaRequest && action === 'approve' && !captchaSolution.trim() && !captchaCoordinates) {
            toast({
                title: "No solution entered",
                description: "Type the challenge text or click coordinates on the image before approving, or reject to abort the mission.",
                variant: "destructive",
            });
            return;
        }
        setIsSubmitting(true);
        try {
            const decision = action === 'approve' ? 'approved' : 'rejected';
            const payload: any = {
                decision,
                // Which remediation was chosen has to survive the request, or every
                // chip becomes an indistinguishable "approved".
                comments: remediation
                    ? [`Applied remediation: ${remediation.label}`, comments].filter(Boolean).join("\n")
                    : comments
            };

            if (remediation) {
                payload.modifiedOutput = {
                    ...(approval.contextSnapshot ?? {}),
                    appliedRemediation: remediation,
                };
            }

            // The relay reads `modifiedOutput.solution` and nothing else, so the
            // rest of the snapshot is carried through unchanged for the audit
            // trail. Placed before the edit-tab branch below because a CAPTCHA
            // approval never exposes those tabs.
            if (isCaptchaRequest && action === 'approve') {
                payload.modifiedOutput = {
                    ...(approval.contextSnapshot ?? {}),
                    // Only what the human typed: the consumer types `solution` into the
                    // challenge field, so synthesized "Click at (x, y)" text would be entered.
                    solution: captchaSolution.trim(),
                    ...(captchaCoordinates ? { coordinates: { x: captchaCoordinates.x, y: captchaCoordinates.y } } : {}),
                };
            }

            // A remediation already claimed modifiedOutput; the edited-payload path
            // would otherwise overwrite it and lose the record of the choice.
            if (!remediation && action === 'approve' && (activeTab === 'edit' || activeTab === 'diff')) {
                try {
                    payload.modifiedOutput = JSON.parse(editableOutput);
                } catch (e) {
                    toast({
                        title: "Invalid JSON",
                        description: "Please fix the JSON errors before approving.",
                        variant: "destructive"
                    });
                    setIsSubmitting(false);
                    return;
                }
            }

            await apiRequest('POST', `/api/approvals/${approval.id}/decision`, payload);

            const hasEdits = !remediation && (activeTab === 'edit' || activeTab === 'diff');
            toast({
                title: remediation
                    ? "Remediated"
                    : action === 'approve' ? (hasEdits ? "Approved with changes" : "Approved") : "Rejected",
                description: remediation
                    ? `${remediation.label} — recorded against this request.`
                    : hasEdits && action === 'approve'
                        ? `Your correction will be used for future learning (Shadow Mode).`
                        : `Request for ${approval.stepName} has been processed.`,
                variant: action === 'approve' ? "default" : "destructive",
            });

            setComments('');
            onDecision();
            onOpenChange(false);
        } catch (error) {
            console.error("Decision failed:", error);
            toast({
                title: "Error",
                description: "Failed to submit decision. Please try again.",
                variant: "destructive",
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleSnooze = async (durationHours: number) => {
        setIsSnoozing(true);
        try {
            const snoozedUntil = new Date(Date.now() + durationHours * 60 * 60 * 1000);
            await apiRequest('POST', `/api/approvals/${approval.id}/snooze`, {
                snoozedUntil: snoozedUntil.toISOString(),
                comments: comments || `Snoozed for ${durationHours === 1 ? '1 hour' : durationHours === 24 ? '1 day' : '1 week'}`
            });

            toast({
                title: "Request Snoozed",
                description: `This decision has been deferred until ${snoozedUntil.toLocaleString()}.`,
            });

            onDecision();
            onOpenChange(false);
        } catch (error) {
            console.error("Snooze failed:", error);
            toast({
                title: "Error",
                description: "Failed to snooze request.",
                variant: "destructive",
            });
        } finally {
            setIsSnoozing(false);
        }
    };

    /**
     * Swiss Cheese remediations for a guardrail-blocked request. Choosing one
     * approves the request and records which remediation was chosen, so two
     * different chips no longer collapse into the same "approved".
     */
    const renderGuardrailRemediation = () => {
        const { chips, blockedAtLayer, blockedLayerName, riskScore } = getGuardrailContext(approval);
        if (chips.length === 0) return null;

        const alreadyApplied = approval.contextSnapshot?.appliedRemediation as RemediationChip | undefined;
        const decided = approval.status && approval.status !== "pending";

        return (
            <div
                data-testid="guardrail-remediation"
                className="mb-6 rounded-[1.5rem] border border-indigo-500/25 bg-indigo-500/[0.04] p-6"
            >
                <div className="flex flex-wrap items-center gap-3">
                    <Label className="text-[10px] font-black uppercase tracking-[0.28em] text-muted-foreground">
                        Guardrail Remediation
                    </Label>
                    {blockedAtLayer != null && (
                        <Badge variant="outline" className="border-indigo-500/30 bg-indigo-500/10 text-[10px] font-black uppercase tracking-widest text-indigo-700 dark:text-indigo-300">
                            Blocked at Layer {blockedAtLayer}
                            {blockedLayerName ? ` — ${blockedLayerName}` : ""}
                        </Badge>
                    )}
                    {riskScore != null && (
                        <Badge variant="outline" className={cn("text-[10px] font-black uppercase tracking-widest", riskClassName(riskScore >= 75 ? "high" : riskScore >= 40 ? "medium" : "low"))}>
                            Risk {riskScore}/100
                        </Badge>
                    )}
                </div>

                {alreadyApplied && (
                    <p data-testid="applied-remediation" className="mt-3 text-xs font-bold text-indigo-600 dark:text-indigo-300">
                        Applied: {alreadyApplied.label}
                    </p>
                )}

                <div className="mt-4 space-y-2">
                    {chips.map((chip) => (
                        <button
                            key={chip.id}
                            type="button"
                            disabled={isSubmitting || !!decided}
                            onClick={() => handleDecision('approve', chip)}
                            className="w-full rounded-xl border border-indigo-500/25 bg-indigo-500/[0.06] p-3 text-left text-xs transition-all hover:bg-indigo-500/15 disabled:opacity-50"
                        >
                            <div className="font-bold text-foreground">{chip.label}</div>
                            <div className="mt-0.5 text-[11px] text-muted-foreground">{chip.description}</div>
                        </button>
                    ))}
                </div>
            </div>
        );
    };

    const renderContext = (ctx: any) => {
        if (!ctx) return <div className="text-[11px] font-black uppercase tracking-widest text-muted-foreground/40 italic h-full flex items-center justify-center">SYSTEM EMPTY: No context snapshot available</div>;

        const { env, _stepOutput, ...rest } = ctx;
        const governance = getGovernanceContext(approval);

        // Tool-call approvals store a routing envelope ({ type, kind, args, ... })
        // either as the snapshot itself or inside toolArgs — render its reviewable
        // fields rather than the transport keys.
        const envelope = ctx.toolArgs && typeof ctx.toolArgs === "object" ? ctx.toolArgs : ctx;
        const envelopeFields = approvalReviewFields(envelope);
        if (envelopeFields?.length) {
            return (
                <div className="space-y-4">
                    <div className="grid gap-2 md:grid-cols-2">
                        {envelopeFields.map((field) => (
                            <SummaryField key={field.label} label={field.label} value={field.value} />
                        ))}
                    </div>
                </div>
            );
        }

        // CAPTCHA relay. The screenshot is a data: URI captured by the agent at
        // the moment it stalled; `goal` is the mission objective, shown so the
        // solver knows what they are unblocking.
        if (isCaptchaRequest) {
            const captchaCtx = ctx.type === 'captcha_solution' ? ctx : ctx.context;
            const screenshot: string | undefined = captchaCtx?.screenshot;
            const goal: string | undefined = captchaCtx?.goal;
            const deadline = approval.createdAt
                ? new Date(new Date(approval.createdAt).getTime() + 5 * 60 * 1000)
                : null;

            return (
                <div className="space-y-6">
                    <div className="rounded-[1.5rem] border border-amber-500/20 bg-amber-500/[0.04] p-6">
                        <div className="mb-5 flex items-start gap-4">
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-amber-500/25 bg-amber-500/10">
                                <KeyRound className="h-6 w-6 text-amber-700 dark:text-amber-300" />
                            </div>
                            <div className="min-w-0">
                                <div className="text-[10px] font-black uppercase tracking-[0.28em] text-amber-700 dark:text-amber-300">
                                    Agent blocked on a human check
                                </div>
                                <h3 className="mt-1 text-xl font-black uppercase italic tracking-tight">
                                    Solve the challenge
                                </h3>
                                <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                                    The browser agent hit a CAPTCHA and paused its mission. Read the
                                    challenge below, type the answer, and approve — the agent types it
                                    into the page and carries on.
                                </p>
                            </div>
                        </div>

                        {goal && (
                            <div className="mb-5 rounded-2xl border border-border bg-card/60 p-4">
                                <div className="text-[10px] font-black uppercase tracking-[0.28em] text-muted-foreground">
                                    Mission goal
                                </div>
                                <p className="mt-1.5 text-sm leading-relaxed">{goal}</p>
                            </div>
                        )}

                        {screenshot ? (
                            <div className="flex flex-col items-center p-3 rounded-2xl border border-border bg-black/20 overflow-hidden">
                                <div className="mb-2 flex items-center justify-between w-full text-xs">
                                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                                        Challenge Visual Context
                                    </span>
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => { setIsCaptchaZoomed(!isCaptchaZoomed); setCaptchaCoordinates(null); /* pin was placed at the old scale */ }}
                                            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                                            data-testid="captcha-zoom-toggle"
                                        >
                                            {isCaptchaZoomed ? <ZoomOut className="h-3.5 w-3.5" /> : <ZoomIn className="h-3.5 w-3.5" />}
                                            <span>{isCaptchaZoomed ? 'Fit' : 'Zoom'}</span>
                                        </button>
                                        {captchaCoordinates && (
                                            <button
                                                type="button"
                                                onClick={() => setCaptchaCoordinates(null)}
                                                className="text-[11px] text-destructive hover:underline ml-2"
                                                data-testid="captcha-clear-coordinates"
                                            >
                                                Clear pin
                                            </button>
                                        )}
                                    </div>
                                </div>
                                <div className="relative inline-block overflow-hidden rounded-xl border border-border/40 cursor-crosshair">
                                    <img
                                        src={screenshot}
                                        alt="CAPTCHA challenge captured from the agent's browser session"
                                        onClick={(e) => {
                                            // Screenshot pixels, not the scaled, letterboxed box.
                                            const hit = imageClickCoordinates(e);
                                            if (hit) setCaptchaCoordinates(hit);
                                        }}
                                        className={cn(
                                            "w-full object-contain transition-all duration-200 select-none",
                                            isCaptchaZoomed ? "max-h-[650px]" : "max-h-[420px]"
                                        )}
                                        data-testid="captcha-screenshot-image"
                                    />
                                    {captchaCoordinates && (
                                        <div
                                            className="absolute pointer-events-none -translate-x-1/2 -translate-y-1/2 flex items-center justify-center"
                                            style={{ left: captchaCoordinates.display.x, top: captchaCoordinates.display.y }}
                                        >
                                            <span className="relative flex h-5 w-5">
                                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                                                <span className="relative inline-flex rounded-full h-5 w-5 bg-amber-500 border border-white items-center justify-center text-[9px] text-white font-bold shadow">
                                                    •
                                                </span>
                                            </span>
                                        </div>
                                    )}
                                </div>
                                {captchaCoordinates && (
                                    <div className="mt-2 text-[10px] font-mono text-amber-600 dark:text-amber-400">
                                        Target Position: ({captchaCoordinates.x}px, {captchaCoordinates.y}px)
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                                No screenshot was attached to this request. Reject it and re-run the
                                mission — approving blind types an unverified string into the page.
                            </div>
                        )}

                        <div className="mt-5 space-y-2">
                            <Label htmlFor="captcha-solution" className="text-[10px] font-black uppercase tracking-[0.28em]">
                                Challenge answer
                            </Label>
                            <Input
                                id="captcha-solution"
                                data-testid="captcha-solution-input"
                                value={captchaSolution}
                                onChange={(e) => setCaptchaSolution(e.target.value)}
                                placeholder="Type exactly what the challenge shows"
                                autoComplete="off"
                                spellCheck={false}
                                disabled={isResolved}
                                className="font-mono text-base tracking-wide"
                            />
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <Clock className="h-3.5 w-3.5 shrink-0" />
                                <span>
                                    The agent stops waiting five minutes after the request was filed
                                    {deadline ? ` (about ${deadline.toLocaleTimeString()})` : ''}, then
                                    fails the mission. Rejecting aborts it immediately.
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            );
        }

        if (governance) {
            const params = ctx.params && typeof ctx.params === "object" ? ctx.params : approval.toolArgs;
            return (
                <div className="space-y-6">
                    <div className="rounded-[1.5rem] border border-amber-500/20 bg-amber-500/[0.04] p-6">
                        <div className="mb-5 flex items-start gap-4">
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-amber-500/25 bg-amber-500/10">
                                <ShieldCheck className="h-6 w-6 text-amber-700 dark:text-amber-300" />
                            </div>
                            <div>
                                <div className="text-[10px] font-black uppercase tracking-[0.28em] text-amber-700 dark:text-amber-300">Requested Agent Action</div>
                                <h3 className="mt-1 text-xl font-black uppercase italic tracking-tight">
                                    {displayValue(governance.tool)}.{displayValue(governance.action)}
                                </h3>
                                <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                                    {displayValue(governance.rationale)}
                                </p>
                            </div>
                        </div>

                        <div className="grid gap-3 md:grid-cols-2">
                            <SummaryField label="Agent" value={governance.agentId} />
                            <SummaryField label="Resource" value={governance.resource} />
                            <SummaryField label="Risk" value={`${displayValue(governance.riskLevel)} risk`} />
                            <SummaryField label="Policy" value={governance.policyCodes} />
                        </div>
                    </div>

                    {params && Object.keys(params).filter((key) => !isSensitiveKey(key)).length > 0 && (
                        <div className="rounded-[1.5rem] border border-border bg-card p-6">
                            <Label className="mb-4 block text-[10px] font-black uppercase tracking-[0.28em] text-muted-foreground">
                                Request Details
                            </Label>
                            <div className="grid gap-3 md:grid-cols-2">
                                {Object.entries(params)
                                    .filter(([key]) => !isSensitiveKey(key))
                                    .map(([key, value]) => (
                                        <SummaryField key={key} label={humanizeKey(key)} value={value} />
                                    ))}
                            </div>
                        </div>
                    )}
                </div>
            );
        }

        // Special Handling for Strategic Interventions (SIG USER ALERT)
        // Detect if it's a direct intervention or wrapped in a MOLT command
        const isIntervention = ctx.type === 'strategic intervention' || 
                             ctx.context?.type === 'strategic intervention' ||
                             (typeof ctx.command === 'string' && ctx.command.startsWith('SIG USER ALERT'));

        if (isIntervention || ctx.missionGoal || ctx.context?.missionGoal) {
            const data = ctx.type === 'strategic_intervention' ? ctx : (ctx.context || ctx);
            const description = data.description || ctx.command?.split(':')[1] || 'System Action';
            const risk = data.risk || 'medium';

            return (
                <div className="space-y-6">
                    <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-[1.5rem] p-8 relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 blur-[60px] rounded-full -mr-16 -mt-16"></div>
                        <div className="flex items-center gap-4 mb-8 relative z-10">
                            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/20 shadow-lg shadow-primary/10">
                                <Sparkles className="h-6 w-6 text-primary" />
                            </div>
                            <div>
                                <span className="text-[10px] font-black uppercase tracking-[0.4em] text-indigo-400 block mb-1">Strategic Intervention</span>
                                <h3 className="font-black text-xl italic tracking-tight uppercase">{description}</h3>
                            </div>
                        </div>

                        <div className="grid gap-6 relative z-10">
                            <div className="p-6 bg-card rounded-[1.2rem] border border-border shadow-inner">
                                <Label className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground/60 font-black mb-3 block">Planned Action</Label>
                                <p className="text-base font-medium leading-relaxed italic text-foreground/90">"{data.description || `Executing strategic intervention: ${description}`}"</p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="p-5 bg-muted/40 rounded-[1.2rem] border border-border border-l-4 border-l-primary/60">
                                    <Label className="text-[10px] uppercase tracking-[0.3em] text-primary/60 font-black mb-2 block">Hypothesis</Label>
                                    <p className="text-sm text-foreground/80 leading-relaxed font-medium">{data.hypothesis || 'Outcome unspecified - proceeding with autonomous resolution.'}</p>
                                </div>
                                <div className={`p-5 bg-muted/40 rounded-[1.2rem] border border-border border-l-4 ${risk === 'high' ? 'border-l-destructive' : 'border-l-amber-500'}`}>
                                    <Label className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground/60 font-black mb-2 block">Risk Assessment</Label>
                                    <div className="flex items-center gap-3">
                                        <Badge className={cn(
                                            "text-[10px] font-black tracking-widest px-3 py-1 rounded-full",
                                            risk === 'high' ? "bg-rose-500/20 text-rose-400 border border-rose-500/30" : "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                                        )}>
                                            {risk.toUpperCase()}
                                        </Badge>
                                        <span className="text-[10px] text-muted-foreground/40 font-mono font-bold uppercase tracking-widest whitespace-nowrap">Override Required</span>
                                    </div>
                                </div>
                            </div>

                            {data.params && Object.keys(data.params).length > 0 && (
                                <div className="p-4 bg-muted rounded border border-border shadow-inner">
                                    <Label className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-2 block">Tool Parameters</Label>
                                    <pre className="text-xs text-foreground font-mono whitespace-pre-wrap">
                                        {JSON.stringify(data.params, null, 2)}
                                    </pre>
                                </div>
                            )}

                            {(data.missionGoal || ctx.missionGoal) && (
                                <div className="mt-2 flex items-start gap-2 text-xs text-muted-foreground bg-primary/5 p-3 rounded">
                                    <Info className="h-4 w-4 mt-0.5 text-primary" />
                                    <div>
                                        <span className="font-semibold text-primary/80">Mission Context:</span> "{data.missionGoal || ctx.missionGoal}"
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="p-3 border rounded-md bg-secondary/20 flex items-center gap-3">
                        <Badge variant="outline" className="text-[10px] bg-background">DECISION PROTOCOL</Badge>
                        <span className="text-xs text-muted-foreground">Approve to allow the agent to proceed with this high-risk step.</span>
                    </div>
                </div>
            );
        }

        // Special Handling for Deliverable Review
        if (ctx.type === 'deliverable review' || ctx.deliverable) {
            return (
                <div className="space-y-6">
                    <div className="bg-primary/5 border border-primary/20 rounded-lg p-6">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 bg-primary/10 rounded-full">
                                <FileText className="h-5 w-5 text-primary" />
                            </div>
                            <div>
                                <h3 className="font-bold text-lg">{ctx.missionName || 'Mission Deliverable'}</h3>
                                <p className="text-sm text-muted-foreground">Role: {ctx.stepName || 'Final Analysis'}</p>
                            </div>
                        </div>
                        
                        <div className="p-6 rounded-md border bg-background shadow-inner max-h-[600px] overflow-auto">
                            <div className="whitespace-pre-wrap font-sans text-base leading-relaxed text-foreground dark:text-foreground/85">
                                {String(ctx.deliverable || ctx.final_product || JSON.stringify(rest, null, 2))}
                            </div>
                        </div>
                    </div>
                    
                    <div className="text-xs text-muted-foreground italic px-2">
                        * Note: Approving this will finalize this deliverable as the official mission output.
                    </div>
                </div>
            );
        }

        // Special Handling for Agent Input Requests (Forms)
        const isInputRequest = ctx.type === 'input_request' || 
                             ctx.params?.type === 'input_request' || 
                             ctx.context?.type === 'input_request' || 
                             ctx.context?.params?.type === 'input_request';
                             
        const isHilDynamic = ctx.dynamicAction?.action === 'HIL_REQUEST';

        // Check for plain-text message "Requires information" fallback
        const hasInputMessage = !isInputRequest && !isHilDynamic && (ctx.message || ctx.context?.message)?.includes('requires the following information to proceed:');

        if (isInputRequest || hasInputMessage || isHilDynamic) {
            let inputReq: any;
            let fields: any[];

            if (isHilDynamic) {
                inputReq = {
                    pipelineName: ctx.pipelineName || 'Mission Request',
                    message: ctx.dynamicAction?.action_details?.question || 'The agent requires human input to proceed.'
                };
                fields = [{
                    name: 'answer',
                    label: 'Your Response',
                    type: 'textarea',
                    required: true,
                    description: 'Provide the requested context or decision.'
                }];
            } else if (isInputRequest) {
                inputReq = ctx.type === 'input_request' ? ctx : 
                            (ctx.params?.type === 'input_request' ? ctx.params : 
                            (ctx.context?.type === 'input_request' ? ctx.context : ctx.context.params));
                fields = inputReq.fields || [];
            } else {
                const msg = ctx.message || ctx.context?.message;
                const fieldNames = msg.split('proceed:')[1]?.split(',').map((s: string) => s.trim()) || [];
                inputReq = {
                    pipelineName: ctx.pipelineName || ctx.context?.pipelineName || 'Agent Request',
                    message: msg
                };
                fields = fieldNames.map((name: string) => ({
                    name: name,
                    label: name.charAt(0).toUpperCase() + name.slice(1).replace(/_/g, ' '),
                    type: 'text',
                    required: true
                }));
            }
            
            const schema: FormSchema = {
                fields: fields.map((f: any) => ({
                    key: f.name || f.key,
                    label: f.label || f.name,
                    type: (f.type === 'number' || f.type === 'email') ? 'text' : (f.type || 'text'),
                    required: f.required !== undefined ? f.required : true,
                    placeholder: f.placeholder,
                    description: f.description,
                    options: Array.isArray(f.options) ? f.options.map((o: any) => typeof o === 'string' ? o : (o.value || String(o))) : undefined,
                    defaultValue: f.defaultValue,
                    readOnly: f.readOnly,
                    source: f.source
                }))
            };
            
            return (
                <div className="space-y-6">
                    <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-[1.5rem] p-8 relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 blur-[60px] rounded-full -mr-16 -mt-16"></div>
                        <div className="flex items-center gap-4 mb-8 relative z-10">
                            <div className="w-12 h-12 rounded-2xl bg-indigo-500/20 flex items-center justify-center border border-indigo-500/30">
                                <Sparkles className="h-6 w-6 text-indigo-400" />
                            </div>
                            <div>
                                <span className="text-[10px] font-black uppercase tracking-[0.4em] text-indigo-400 block mb-1">Human-In-The-Loop Protocol</span>
                                <h3 className="font-black text-xl italic tracking-tight uppercase">{inputReq.pipelineName || 'Input Required'}</h3>
                            </div>
                        </div>

                        <div className="bg-card rounded-[1.5rem] border border-border p-8 shadow-inner relative z-10">
                            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-muted-foreground/80 mb-6 italic">AGENT NOTE: "{inputReq.message || 'Informational prerequisite required.'}"</p>
                            <StudioForm
                                schema={schema} 
                                context={formValues}
                                onSubmit={(data) => {
                                    try {
                                        const current = JSON.parse(editableOutput);
                                        let updated;
                                        if (current.dynamicAction?.action === 'HIL_REQUEST') {
                                            updated = { ...current, answer: data.answer };
                                        } else if (current.type === 'input_request') {
                                            updated = { ...current, ...data };
                                        } else if (current.params?.type === 'input_request') {
                                            updated = { ...current, params: { ...current.params, ...data } };
                                        } else if (current.context?.type === 'input_request') {
                                            updated = { ...current, context: { ...current.context, ...data } };
                                        } else {
                                            updated = { ...current, ...data };
                                        }
                                        setEditableOutput(JSON.stringify(updated, null, 2));
                                        setActiveTab("diff");
                                        toast({
                                            title: "Input Recorded",
                                            description: "You can now review the diff or approve to proceed.",
                                            variant: "default"
                                        });
                                    } catch(e) { /* ignore */ }
                                }}
                                submitLabel="Commit Parameters"
                                themeConfig={{ primaryColor: "#6366f1" }}
                            />
                        </div>
                    </div>
                </div>
            );
        }

        // Special Handling for Optimization Proposals (Phase 3)
        if (ctx.type === 'OPTIMIZATION PROPOSAL') {
            const isWinner = ctx.improvementDetected;
            return (
                <div className="space-y-6">
                    <div className={cn(
                        "rounded-[2rem] p-8 border relative overflow-hidden",
                        isWinner ? "bg-emerald-500/5 border-emerald-500/20" : "bg-slate-500/5 border-slate-500/20"
                    )}>
                        <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 blur-[60px] rounded-full -mr-16 -mt-16"></div>
                        
                        <div className="flex items-center justify-between mb-8 relative z-10">
                            <div className="flex items-center gap-4">
                                <div className={cn(
                                    "w-12 h-12 rounded-2xl flex items-center justify-center border shadow-lg",
                                    isWinner ? "bg-emerald-500/20 border-emerald-500/30 shadow-emerald-500/20" : "bg-slate-500/20 border-slate-500/30"
                                )}>
                                    <Sparkles className={cn("h-6 w-6", isWinner ? "text-emerald-400" : "text-muted-foreground")} />
                                </div>
                                <div>
                                    <span className={cn(
                                        "text-[10px] font-black uppercase tracking-[0.4em] block mb-1",
                                        isWinner ? "text-emerald-400" : "text-muted-foreground"
                                    )}>Autonomous Improvement Proposal</span>
                                    <h3 className="font-black text-xl italic tracking-tight uppercase">
                                        {isWinner ? "Performance Lift Detected" : "Benchmark Neutral"}
                                    </h3>
                                </div>
                            </div>
                            <div className="text-right">
                                <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/40 mb-1">Judge Score</div>
                                <div className={cn(
                                    "text-3xl font-black italic",
                                    ctx.score >= 70 ? "text-emerald-400" : (ctx.score >= 50 ? "text-amber-400" : "text-rose-400")
                                )}>
                                    {ctx.score}/100
                                </div>
                            </div>
                        </div>

                        <div className="grid gap-6 relative z-10">
                            <div className="p-6 bg-card rounded-[1.5rem] border border-border shadow-inner">
                                <Label className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground/60 font-black mb-3 block">Autonomous Insight</Label>
                                <p className="text-base font-medium leading-relaxed italic text-foreground/90">
                                    "{ctx.reasoning}"
                                </p>
                            </div>

                            {ctx.humanSteeringNudge && (
                                <div className="p-5 bg-indigo-500/5 rounded-[1.2rem] border border-indigo-500/20 border-l-4 border-l-indigo-400">
                                    <Label className="text-[10px] uppercase tracking-[0.3em] text-indigo-400/80 font-black mb-2 block flex items-center gap-2">
                                        <UserCheck size={12} />
                                        Your Guidance Influence
                                    </Label>
                                    <p className="text-xs text-foreground/80 leading-relaxed font-medium italic">
                                        "{ctx.humanSteeringNudge}"
                                    </p>
                                </div>
                            )}

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="p-5 bg-muted/40 rounded-[1.2rem] border border-border border-l-4 border-l-primary/60">
                                    <Label className="text-[10px] uppercase tracking-[0.3em] text-primary/60 font-black mb-2 block">Proposed Configuration</Label>
                                    <div className="space-y-1">
                                        <div className="text-xs font-bold text-foreground">Model: <span className="text-primary">{ctx.modelId}</span></div>
                                        <div className="text-[10px] text-muted-foreground font-mono uppercase tracking-tighter">Prompt Version: {ctx.promptVersion}</div>
                                    </div>
                                </div>
                                <div className="p-5 bg-muted/40 rounded-[1.2rem] border border-border border-l-4 border-l-emerald-500">
                                    <Label className="text-[10px] uppercase tracking-[0.3em] text-emerald-400/60 font-black mb-2 block">Expected Delta</Label>
                                    <p className="text-xs text-foreground/80 leading-relaxed font-medium">
                                        {ctx.delta || "Improved response quality and metric alignment."}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="p-4 border rounded-2xl bg-indigo-500/5 flex items-center gap-4 border-indigo-500/10">
                        <div className="p-2 bg-indigo-500/20 rounded-full">
                            <Bot className="h-4 w-4 text-indigo-400" />
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                            Approving this proposal will <span className="text-foreground font-bold italic uppercase tracking-tighter">immediately promote</span> this configuration to be the primary standard for mission <span className="text-indigo-400 font-bold">"{ctx.missionName}"</span>.
                        </p>
                    </div>
                </div>
            );
        }

        // Special Handling for Evolutionary Pitches (Innovation Lab)
        if (ctx.type === 'EVOLUTIONARY PITCH') {
            return (
                <div className="space-y-6">
                    <div className="bg-primary/10 border border-primary/30 rounded-[2.5rem] p-10 relative overflow-hidden shadow-2xl">
                        <div className="absolute top-0 right-0 w-64 h-64 bg-primary/20 blur-[100px] rounded-full -mr-32 -mt-32 animate-pulse"></div>
                        <div className="absolute bottom-0 left-0 w-48 h-48 bg-indigo-500/10 blur-[80px] rounded-full -ml-24 -mb-24"></div>
                        
                        <div className="flex items-start justify-between mb-10 relative z-10">
                            <div className="flex items-center gap-6">
                                <div className="w-16 h-16 rounded-[1.5rem] bg-primary/20 flex items-center justify-center border-2 border-primary/40 shadow-xl shadow-primary/20">
                                    <Sparkles className="h-8 w-8 text-primary animate-bounce-subtle" />
                                </div>
                                <div>
                                    <div className="flex items-center gap-3 mb-2">
                                        <Badge className="bg-primary text-[10px] font-black tracking-widest px-3 py-1 rounded-full border-none shadow-sm">INNOVATION LAB</Badge>
                                        <Badge variant="outline" className="text-[10px] font-bold border-primary/30 text-primary/80 tracking-tighter italic">EVOLUTIONARY PITCH</Badge>
                                    </div>
                                    <h3 className="font-black text-3xl italic tracking-tight uppercase leading-none">
                                        Autonomous Growth Proposal: <span className="text-primary">{ctx.gap}</span>
                                    </h3>
                                </div>
                            </div>
                        </div>

                        <div className="grid gap-8 relative z-10">
                            <div className="p-8 bg-background/60 backdrop-blur-md rounded-[2rem] border border-border shadow-inner group transition-all hover:border-primary/30">
                                <Label className="text-[11px] uppercase tracking-[0.4em] text-primary/60 font-black mb-4 block flex items-center gap-2">
                                    <Bot size={14} />
                                    The Core Rationale
                                </Label>
                                <div className="text-lg font-medium leading-relaxed italic text-foreground/90 whitespace-pre-wrap pl-4 border-l-2 border-primary/20">
                                    {ctx.rationale}
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="p-6 bg-muted/40 rounded-[1.5rem] border border-border border-t-4 border-t-primary/60 shadow-sm">
                                    <Label className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground/60 font-black mb-3 block">Proposed Implementation</Label>
                                    <div className="text-sm text-foreground/80 leading-relaxed font-semibold">
                                        {typeof ctx.proposal === 'object' ? JSON.stringify(ctx.proposal, null, 2) : ctx.proposal}
                                    </div>
                                </div>
                                <div className="p-6 bg-emerald-500/5 rounded-[1.5rem] border border-emerald-500/20 border-t-4 border-t-emerald-500/60 shadow-sm">
                                    <Label className="text-[10px] uppercase tracking-[0.3em] text-emerald-500/60 font-black mb-3 block">ROI Hypothesis</Label>
                                    <p className="text-sm text-foreground/90 leading-relaxed font-bold italic">
                                        "Structural acceleration detected. Enhancing Oddjob's capability set with {ctx.gap} will reduce dependency on generic LLM synthesis and increase deterministic accuracy."
                                    </p>
                                </div>
                            </div>

                            {ctx.integrationAssessment && (
                                <div className="p-6 bg-indigo-500/5 rounded-[1.5rem] border border-indigo-500/20 shadow-sm group hover:border-indigo-400 Transition-all">
                                    <Label className="text-[10px] uppercase tracking-[0.3em] text-indigo-400/80 font-black mb-4 block flex items-center gap-2">
                                        <Link2 size={14} className="group-hover:rotate-45 transition-transform" />
                                        Integration Value-Add
                                    </Label>
                                    <div className="space-y-4">
                                        <p className="text-sm text-foreground/80 leading-relaxed font-medium italic">
                                            {ctx.integrationAssessment}
                                        </p>
                                        {ctx.connectedPlatforms && ctx.connectedPlatforms.length > 0 && (
                                            <div className="flex flex-wrap gap-2">
                                                {ctx.connectedPlatforms.map((platform: string) => (
                                                    <Badge key={platform} variant="outline" className="bg-indigo-500/10 border-indigo-500/20 text-indigo-400 font-bold px-2 py-0.5 rounded-lg text-[10px] uppercase tracking-wider">
                                                        {platform} Active
                                                    </Badge>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="p-4 border rounded-[1.2rem] bg-primary/5 flex items-center gap-5 border-primary/20 shadow-sm">
                        <div className="p-3 bg-primary/10 rounded-xl">
                            <Info className="h-5 w-5 text-primary" />
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                            Approving this pitch will authorize for **Just-In-Time Skill Forging**. The Innovation Lab will begin extracting requirements and drafting the implementation code for <span className="text-primary font-black uppercase tracking-tighter">"{ctx.gap}"</span>.
                        </p>
                    </div>
                </div>
            );
        }

        return (
            <div className="space-y-4">
                {env && Object.keys(env).length > 0 && (
                    <div>
                        <h4 className="text-sm font-semibold mb-2">Variables</h4>
                        <div className="grid grid-cols-2 gap-2 text-sm bg-muted p-2 rounded">
                            {Object.entries(env).map(([k, v]) => (
                                <div key={k} className="flex flex-col">
                                    <span className="text-xs text-muted-foreground">{k}</span>
                                    <span className="font-mono truncate" title={String(v)}>{String(v)}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <div>
                    <h4 className="text-sm font-semibold mb-2">Request Summary</h4>
                    <div className="grid gap-2 md:grid-cols-2">
                        {Object.entries(rest)
                            .filter(([key]) => !["_stepOutput", "env"].includes(key) && !isSensitiveKey(key))
                            .slice(0, 12)
                            .map(([key, value]) => (
                                <SummaryField key={key} label={humanizeKey(key)} value={value} />
                            ))}
                    </div>
                </div>
            </div>
        );
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col bg-background/80 backdrop-blur-[40px] border border-white/10 rounded-[3rem] shadow-[0_32px_128px_-12px_rgba(0,0,0,0.5)] p-0 overflow-hidden">
                <div className="absolute inset-0 bg-primary/[0.03] pointer-events-none"></div>
                <DialogHeader className="p-10 pb-6 border-b border-border relative z-10 bg-muted/30">
                    <div className="flex items-center justify-between">
                        <div className="space-y-1">
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center border border-amber-500/30">
                                    <ShieldCheck className="h-5 w-5 text-amber-500" />
                                </div>
                                <DialogTitle className="text-2xl font-black italic tracking-tighter uppercase">Operational Authorization</DialogTitle>
                            </div>
                            <DialogDescription className="text-[11px] font-black uppercase tracking-[0.3em] text-muted-foreground/80 pl-11">
                                Pending Action Review for <span className="text-primary/80">{approval.pipelineName}</span> // {approval.stepName}
                            </DialogDescription>
                        </div>
                        <Badge className="bg-amber-500/10 text-amber-500 border border-amber-500/30 font-black text-[10px] tracking-widest px-4 py-1.5 rounded-full animate-pulse">
                            PENDING DECISION
                        </Badge>
                    </div>
                </DialogHeader>

                <div className="flex-1 overflow-hidden py-4 flex flex-col">
                    <div className="flex items-center gap-4 mb-4 flex-wrap px-8">
                        <Badge variant="outline" className="flex gap-1 items-center">
                            <Clock className="w-3 h-3" />
                            {new Date(approval.createdAt).toLocaleString()}
                        </Badge>
                        <Badge variant="secondary">
                            Execution ID: {approval.pipelineExecutionId}
                        </Badge>
                        {impactBadge && activeTab !== 'review' && (
                            <Badge variant={impactBadge.variant} className={impactBadge.className}>
                                <Sparkles className="w-3 h-3 mr-1" />
                                {impactBadge.label}
                            </Badge>
                        )}
                    </div>

                    {governance && (
                        <div className="mx-8 mb-5 rounded-2xl border border-amber-500/20 bg-amber-500/[0.04] p-5">
                            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                <div className="flex items-start gap-3">
                                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-500/25 bg-amber-500/10">
                                        <Fingerprint className="h-5 w-5 text-amber-700 dark:text-amber-300" />
                                    </div>
                                    <div>
                                        <div className="text-[10px] font-black uppercase tracking-[0.28em] text-amber-700 dark:text-amber-300">
                                            Agent Governance Review
                                        </div>
                                        <p className="mt-1 max-w-3xl text-sm font-medium leading-relaxed text-muted-foreground">
                                            {formatValue(governance.rationale)}
                                        </p>
                                    </div>
                                </div>
                                <Badge variant="outline" className={cn("shrink-0 text-[10px] font-black uppercase tracking-widest", riskClassName(String(governance.riskLevel ?? "")))}>
                                    {formatValue(governance.riskLevel)} risk
                                </Badge>
                            </div>

                            <div className="grid gap-3 md:grid-cols-3">
                                <div className="rounded-xl border border-white/10 bg-black/10 p-3">
                                    <div className="mb-1 flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                                        <Bot className="h-3.5 w-3.5" />
                                        Agent
                                    </div>
                                    <div className="truncate text-sm font-bold text-foreground" title={formatValue(governance.agentId)}>
                                        {formatValue(governance.agentId)}
                                    </div>
                                    <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground" title={formatValue(governance.agentIdentityId)}>
                                        {formatValue(governance.agentIdentityId)}
                                    </div>
                                </div>

                                <div className="rounded-xl border border-white/10 bg-black/10 p-3">
                                    <div className="mb-1 flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                                        <Terminal className="h-3.5 w-3.5" />
                                        Requested Action
                                    </div>
                                    <div className="truncate text-sm font-bold text-foreground" title={`${formatValue(governance.tool)}.${formatValue(governance.action)}`}>
                                        {formatValue(governance.tool)}.{formatValue(governance.action)}
                                    </div>
                                    <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground" title={formatValue(governance.resource)}>
                                        {formatValue(governance.resource)}
                                    </div>
                                </div>

                                <div className="rounded-xl border border-white/10 bg-black/10 p-3">
                                    <div className="mb-1 flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                                        <KeyRound className="h-3.5 w-3.5" />
                                        Policy Match
                                    </div>
                                    <div className="truncate text-sm font-bold text-foreground" title={formatValue(governance.grantId)}>
                                        {formatValue(governance.grantId)}
                                    </div>
                                    <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground" title={formatValue(governance.policyCodes)}>
                                        {formatValue(governance.policyCodes)}
                                    </div>
                                </div>
                            </div>

                            <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                                <Badge variant="outline" className="border-white/10 bg-foreground/5 text-[10px]">
                                    Run {formatValue(governance.runId)}
                                </Badge>
                                <Badge variant="outline" className="border-white/10 bg-foreground/5 text-[10px]">
                                    Mission Run {formatValue(governance.missionRunId)}
                                </Badge>
                                <Badge variant="outline" className="border-white/10 bg-foreground/5 text-[10px]">
                                    Job {formatValue(governance.jobId ?? approval.jobId)}
                                </Badge>
                            </div>
                        </div>
                    )}

                    <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden px-8">
                        <TabsList className={cn(
                            "grid w-full mb-6 p-1 bg-muted/50 border border-border rounded-2xl",
                            isNonTechnical ? 'grid-cols-1' : 'grid-cols-3'
                        )}>
                            <TabsTrigger 
                                value="review" 
                                className="rounded-xl data-[state=active]:bg-primary/20 data-[state=active]:text-primary data-[state=active]:shadow-sm font-black uppercase text-[10px] tracking-widest transition-all"
                            >
                                Review Context
                            </TabsTrigger>
                            {!isNonTechnical && (
                                <TabsTrigger 
                                    value="diff" 
                                    className="rounded-xl data-[state=active]:bg-primary/20 data-[state=active]:text-primary data-[state=active]:shadow-sm font-black uppercase text-[10px] tracking-widest transition-all"
                                >
                                    Shadow Diff
                                </TabsTrigger>
                            )}
                            {!isNonTechnical && (
                                <TabsTrigger 
                                    value="edit" 
                                    className="rounded-xl data-[state=active]:bg-primary/20 data-[state=active]:text-primary data-[state=active]:shadow-sm font-black uppercase text-[10px] tracking-widest transition-all"
                                >
                                    Edit & Approve
                                </TabsTrigger>
                            )}
                            {approval.baselineSnapshot && (
                                <TabsTrigger 
                                    value="baseline-diff" 
                                    className="rounded-xl data-[state=active]:bg-indigo-500/20 data-[state=active]:text-indigo-400 data-[state=active]:shadow-sm font-black uppercase text-[10px] tracking-widest transition-all border-l border-white/5"
                                >
                                    <ShieldCheck className="w-3 h-3 mr-2" /> Baseline Compare
                                </TabsTrigger>
                            )}
                        </TabsList>

                        <div className="flex-1 overflow-auto min-h-[300px]">
                            {/* Form-First UI Overlay: If we detect an input request, we show it prominently regardless of tab background */}
                            {isFormStage ? (
                                <div className="p-4">
                                    <FormStageRequestPanel approvalId={approval.id} onCompleted={onDecision} />
                                </div>
                            ) : formValues && (activeTab === 'review' || activeTab === 'edit') ? (
                                <div className="p-4 space-y-6">
                                    <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-[1.5rem] p-8 relative overflow-hidden">
                                        <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 blur-[60px] rounded-full -mr-16 -mt-16"></div>
                                        <div className="flex items-center gap-4 mb-8 relative z-10">
                                            <div className="w-12 h-12 rounded-2xl bg-indigo-500/20 flex items-center justify-center border border-indigo-500/30">
                                                <Sparkles className="h-6 w-6 text-indigo-400" />
                                            </div>
                                            <div>
                                                <span className="text-[10px] font-black uppercase tracking-[0.4em] text-indigo-400 block mb-1">Interactive Input Hub</span>
                                                <h3 className="font-black text-xl italic tracking-tight uppercase">Agent Synchronization Required</h3>
                                            </div>
                                        </div>

                                        <div className="bg-card rounded-[2rem] border border-border p-10 shadow-inner relative z-10">
                                            <div className="mb-8 space-y-4">
                                                <div className="flex items-start gap-3 p-4 bg-primary/5 rounded-2xl border border-primary/10">
                                                    <Bot className="w-5 h-5 text-primary mt-1 flex-shrink-0" />
                                                    <div>
                                                        <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-primary mb-1 block">Agent Message</Label>
                                                        <p className="text-sm font-medium leading-relaxed italic text-foreground/90">
                                                            "{formValues.message || 'The autonomous unit requires your input to proceed.'}"
                                                        </p>
                                                    </div>
                                                </div>
                                                
                                                {(formValues.reasoning || formValues.thought_process || formValues.reason) && (
                                                    <div className="px-4 py-3 bg-muted/30 rounded-xl border border-border/50">
                                                        <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 mb-1 block">Context / Reasoning</Label>
                                                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                                                            {formValues.reasoning || formValues.thought_process || formValues.reason}
                                                        </p>
                                                    </div>
                                                )}

                                                {formValues.suggestion && (
                                                    <div className="px-4 py-3 bg-indigo-500/10 rounded-xl border border-indigo-500/20">
                                                        <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-400 mb-1 block">Agent Suggestion</Label>
                                                        <p className="text-[11px] text-indigo-400 font-medium italic">
                                                            "{formValues.suggestion}"
                                                        </p>
                                                    </div>
                                                )}
                                            </div>

                                            <StudioForm
                                                schema={{
                                                    fields: (formValues.fields || []).map((f: any) => ({
                                                        key: f.name || f.key || 'field',
                                                        label: f.label || f.name || 'Input',
                                                        type: (f.type === 'number' || f.type === 'email') ? 'text' : (f.type || 'text'),
                                                        required: true,
                                                        placeholder: f.placeholder,
                                                        description: f.description,
                                                        options: f.options,
                                                        defaultValue: f.defaultValue,
                                                        readOnly: f.readOnly
                                                    }))
                                                }} 
                                                context={formValues}
                                                onSubmit={(data) => {
                                                    try {
                                                        const current = JSON.parse(editableOutput);
                                                        let updated;
                                                        if (current.dynamicAction?.action === 'HIL_REQUEST') {
                                                            updated = { ...current, answer: data.answer };
                                                        } else if (current.type === 'input_request') {
                                                            updated = { ...current, ...data };
                                                        } else if (current.params?.type === 'input_request') {
                                                            updated = { ...current, params: { ...current.params, ...data } };
                                                        } else if (current.context?.type === 'input_request') {
                                                            updated = { ...current, context: { ...current.context, ...data } };
                                                        } else {
                                                            updated = { ...current, ...data };
                                                        }
                                                        setEditableOutput(JSON.stringify(updated, null, 2));
                                                        setActiveTab("diff");
                                                        toast({
                                                            title: "Input Recorded",
                                                            description: "You can now review the diff or approve to proceed.",
                                                            variant: "default"
                                                        });
                                                    } catch (e) {
                                                        setEditableOutput(JSON.stringify(data, null, 2));
                                                    }
                                                }}
                                                submitLabel="Sync Parameters"
                                                themeConfig={{ primaryColor: "#6366f1" }}
                                            />
                                        </div>
                                    </div>
                                    
                                    {activeTab === 'edit' && (
                                        <div className="mt-8 pt-8 border-t border-border">
                                            <Label className="text-sm font-semibold mb-2 block">Developer View (Raw JSON)</Label>
                                            <Textarea
                                                className="font-mono text-xs bg-muted text-foreground h-32 border-border"
                                                value={editableOutput}
                                                onChange={(e) => setEditableOutput(e.target.value)}
                                            />
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <>
                                    <TabsContent value="review" className="mt-0 h-full">
                                        <ScrollArea className="h-full border border-border bg-card rounded-[1.5rem] p-6 shadow-inner">
                                            {renderGuardrailRemediation()}
                                            {renderContext(approval.contextSnapshot)}
                                        </ScrollArea>
                                    </TabsContent>

                                    <TabsContent value="diff" className="mt-0 h-full flex flex-col">
                                        <div className="text-xs text-muted-foreground mb-2 flex items-center gap-2">
                                            <GitCompare className="w-4 h-4" />
                                            Compare AI output (left) with your edits (right). Green = added, red = removed.
                                        </div>
                                        <ResizablePanelGroup direction="horizontal" className="flex-1 min-h-[280px]">
                                            <ResizablePanel defaultSize={50} minSize={30}>
                                                <div className="h-full flex flex-col p-4 border border-border rounded-l-[1.5rem] bg-muted/30">
                                                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground mb-3 px-2">AI Generated Output</div>
                                                    <pre className="flex-1 font-mono text-[11px] p-4 overflow-auto bg-background text-foreground/80 rounded-xl shadow-inner border border-border">
                                                        {originalOutput}
                                                    </pre>
                                                </div>
                                            </ResizablePanel>
                                            <ResizableHandle withHandle />
                                            <ResizablePanel defaultSize={50} minSize={30}>
                                                <div className="h-full flex flex-col p-4 border border-border border-l-0 rounded-r-[1.5rem] bg-muted/30">
                                                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-primary mb-3 px-2">User Corrected Delta</div>
                                                    <JsonDiffViewer original={originalOutput} modified={editableOutput} className="flex-1 border-border bg-background" />
                                                </div>
                                            </ResizablePanel>
                                        </ResizablePanelGroup>
                                        <div className="mt-4 flex flex-col gap-3">
                                            <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground mb-1 ml-1">Live Patch Editor</Label>
                                            <Textarea
                                                className="flex-1 font-mono text-[11px] h-32 resize-none bg-background border-border rounded-2xl p-4 focus-visible:ring-primary/50 text-foreground"
                                                value={editableOutput}
                                                onChange={(e) => setEditableOutput(e.target.value)}
                                                spellCheck={false}
                                                placeholder="Modify the JSON..."
                                            />
                                        </div>
                                    </TabsContent>

                                    <TabsContent value="edit" className="mt-0 h-full flex flex-col">
                                        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground mb-3 flex items-center gap-2 ml-1">
                                            <Terminal className="w-3 h-3" />
                                            Direct Context Modification Protocol
                                        </div>
                                        <Textarea
                                            className="flex-1 font-mono text-[12px] bg-background border-border rounded-[2rem] p-8 leading-relaxed resize-none shadow-inner focus-visible:ring-primary/30 text-foreground"
                                            value={editableOutput}
                                            onChange={(e) => setEditableOutput(e.target.value)}
                                            spellCheck={false}
                                        />
                                    </TabsContent>

                                    {approval.baselineSnapshot && (
                                        <TabsContent value="baseline-diff" className="mt-0 h-full flex flex-col gap-4">
                                            <div className="flex items-center justify-between px-2">
                                                <div className="flex items-center gap-3">
                                                    <Badge variant="outline" className="bg-indigo-500/10 text-indigo-400 border-indigo-500/20 uppercase tracking-[0.3em] text-[9px] font-black px-3">
                                                        Baseline: {approval.baselineLabel || 'Gold Standard'}
                                                    </Badge>
                                                    <GitCompare className="w-4 h-4 text-primary/40" />
                                                    <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 uppercase tracking-[0.3em] text-[9px] font-black px-3">
                                                        Proposal: Current Execution
                                                    </Badge>
                                                </div>
                                                <div className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/40 italic">
                                                    Drift Detection Mode Active
                                                </div>
                                            </div>
                                            <div className="flex-1 min-h-[400px]">
                                                <JsonDiffViewer 
                                                    original={baselineOutput} 
                                                    modified={originalOutput}
                                                    className="h-full border-indigo-500/20 bg-indigo-500/[0.02] rounded-[1.5rem]" 
                                                />
                                            </div>
                                        </TabsContent>
                                    )}
                                </>
                            )}
                        </div>
                    </Tabs>

                    <div className="space-y-3 mt-6 px-8 pb-8">
                        <Label className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground ml-1">Comments (Optional)</Label>
                        <Textarea
                            placeholder="Add reason for approval or rejection..."
                            value={comments}
                            onChange={(e) => setComments(e.target.value)}
                            className="h-24 resize-none bg-background border-border rounded-2xl focus-visible:ring-primary/50 text-sm py-4 px-5"
                            readOnly={isResolved}
                        />
                    </div>
                </div>

                <DialogFooter className="p-10 pt-6 border-t border-border bg-muted/20 relative z-10">
                    <div className="flex items-center justify-between w-full">
                        <div className="flex items-center gap-2">
                            <Button 
                                variant="outline" 
                                size="sm" 
                                className="h-10 px-4 rounded-xl font-bold uppercase text-[10px] tracking-wider border-indigo-500/30 bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 transition-all gap-1.5"
                                onClick={() => {
                                    if (approval?.id) {
                                        // Route rather than reload; the dialog is inside the SPA
                                        // that already serves the deliberation room.
                                        setLocation(`/workspace/chat/deliberation-${approval.id}`);
                                    }
                                }}
                            >
                                <Swords className="w-4 h-4 text-indigo-400" />
                                Deliberate in Room
                            </Button>
                            <Button 
                                variant="outline" 
                                size="sm" 
                                className="h-10 px-6 rounded-xl font-black uppercase text-[10px] tracking-widest border-border hover:bg-muted transition-all"
                                onClick={() => handleSnooze(1)}
                                disabled={isSubmitting || isSnoozing || isResolved}
                            >
                                Snooze 1h
                            </Button>
                            <Button 
                                variant="outline" 
                                size="sm" 
                                className="h-10 px-6 rounded-xl font-black uppercase text-[10px] tracking-widest border-border hover:bg-muted transition-all"
                                onClick={() => handleSnooze(24)}
                                disabled={isSubmitting || isSnoozing || isResolved}
                            >
                                Delay 24h
                            </Button>
                        </div>
                        
                        <div className="flex items-center gap-4">
                            <Button 
                                variant="ghost"
                                className="text-rose-500 hover:text-rose-600 hover:bg-rose-500/10 font-black uppercase text-[10px] tracking-widest px-8 h-12 rounded-2xl"
                                onClick={() => handleDecision('reject')}
                                disabled={isSubmitting || isResolved}
                            >
                                <XCircle className="w-4 h-4 mr-2" /> {isCaptchaRequest ? "ABORT MISSION" : "REJECT PROPOSAL"}
                            </Button>
                            <Button 
                                className="bg-primary text-primary-foreground hover:bg-primary/90 font-black uppercase text-[11px] tracking-[0.2em] px-10 h-12 rounded-2xl shadow-xl shadow-primary/20"
                                onClick={() => handleDecision('approve')}
                                disabled={isSubmitting || isResolved || isFormStage}
                                title={isFormStage ? "Submit the stage's answers above to complete this request." : undefined}
                            >
                                <CheckCircle2 className="w-4 h-4 mr-2" /> {isCaptchaRequest ? "SUBMIT ANSWER" : isFormStage ? "SUBMIT THE STAGE ABOVE" : "AUTHORIZE EXECUTION"}
                            </Button>
                        </div>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
