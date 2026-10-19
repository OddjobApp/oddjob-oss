import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import { TriageCenter, type RecoveryOption } from "@domain-ui/rescue/ui/modules/rescue/components/TriageCenter";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock, Inbox, Loader2, Shield, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDecisionStore } from "../../stores/decision.store";
import { approvalReviewFields, isApprovalEnvelope } from "@shared/approval-args";

interface ApprovalRequest {
    id: number;
    pipelineName: string;
    stepName: string;
    createdAt: string;
    contextSnapshot: any;
    pipelineExecutionId: number;
    status?: string;
    comments?: string | null;
    modifiedOutput?: any;
    toolName?: string | null;
}

interface RescueSession {
    id: number;
    missionRunId: number;
    status: string;
    serviceType: string;
    triageSummary?: string;
    recoveryOptions: RecoveryOption[];
    createdAt: string;
}

/**
 * Compact Decision-Inbox surface embedded inside the Oddjob assistant panel.
 * Keeps review and approval in-panel so the user does not have to jump to the
 * standalone Decision Inbox for common approve/reject work.
 */
export function AssistantApprovals({ onResumedOutcome }: { onResumedOutcome?: (payload: { outcome: string; tool?: string }) => void } = {}) {
    const { toast } = useToast();
    const [selected, setSelected] = useState<ApprovalRequest | null>(null);
    const [comments, setComments] = useState("");
    const [submitting, setSubmitting] = useState<"approved" | "rejected" | null>(null);
    const [showRaw, setShowRaw] = useState(false);
    const initializeDecisionStore = useDecisionStore((state) => state.initialize);

    const { data: rawApprovals, isLoading, refetch } = useQuery<ApprovalRequest[]>({
        queryKey: ["/api/approvals"],
    });
    const { data: rawRescue, refetch: refetchRescue } = useQuery<RescueSession[]>({
        queryKey: ["/api/rescue/sessions"],
    });
    const approvals = Array.isArray(rawApprovals) ? rawApprovals : [];
    const rescue = Array.isArray(rawRescue) ? rawRescue : [];
    const actionableRescue = rescue.filter(r => r?.status === "REQUESTED" && Array.isArray(r.recoveryOptions) && r.recoveryOptions.length > 0);

    // Re-sync the header badge whenever the approvals list changes.
    // When all items are handled (total === 0), initialize() pulls a fresh
    // count from the server so the Sparkles badge in the header clears.
    const total = approvals.length + actionableRescue.length;
    useEffect(() => {
        if (total === 0) {
            initializeDecisionStore();
        }
    }, [total]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleRecovery = async (r: RescueSession, opt: RecoveryOption) => {
        try {
            await apiRequest("POST", `/api/rescue/sessions/${r.id}/recovery/${encodeURIComponent(opt.id)}`, {});
            toast({ title: "Recovery initiated", description: `Executing ${opt.label}…` });
            setTimeout(async () => {
                await refetchRescue();
                // Re-sync header badge after rescue action resolves
                initializeDecisionStore();
            }, 1000);
        } catch (e: any) {
            toast({ title: "Recovery failed", description: e.message, variant: "destructive" });
            refetchRescue();
        }
    };

    const handleDismiss = async (r: RescueSession) => {
        try {
            await apiRequest("POST", `/api/rescue/sessions/${r.id}/cancel`, { reason: "Dismissed from assistant" });
            toast({ title: "Triage dismissed" });
            await refetchRescue();
            // Re-sync header badge after dismissal
            initializeDecisionStore();
        } catch (e: any) {
            toast({ title: "Dismiss failed", description: e.message, variant: "destructive" });
        }
    };

    const reviewApproval = (approval: ApprovalRequest) => {
        setSelected(approval);
        setComments(approval.comments || "");
        setShowRaw(false);
    };

    const handleDecision = async (decision: "approved" | "rejected") => {
        if (!selected) return;
        setSubmitting(decision);
        try {
            const res = await apiRequest("POST", `/api/approvals/${selected.id}/decision`, {
                decision,
                comments,
            });
            // For an approved Copilot agent-tool action the server re-runs the agent
            // and returns the outcome inline (see approval.service.processDecision).
            // Hand it to the parent so it appears live in the chat thread.
            let resumedOutcome: string | undefined;
            let resumedTool: string | undefined;
            try {
                const body = await res.json();
                resumedOutcome = body?.resumedOutcome;
                resumedTool = body?.resumedTool;
            } catch { /* non-JSON / empty body — nothing to surface */ }

            toast({
                title: decision === "approved" ? "Decision approved" : "Decision rejected",
                description: resumedOutcome
                    ? "Action carried out — see the result in chat."
                    : (selected.stepName || selected.pipelineName || "Approval request processed."),
                variant: decision === "approved" ? "default" : "destructive",
            });
            if (decision === "approved" && resumedOutcome) {
                onResumedOutcome?.({ outcome: resumedOutcome, tool: resumedTool });
            }
            setSelected(null);
            setComments("");
            await refetch();
            // Re-sync the header badge count after each decision.
            // If the queue is now empty the useEffect above also fires initialize(),
            // but calling it here ensures the store is updated even mid-queue.
            initializeDecisionStore();
        } catch (e: any) {
            toast({
                title: "Decision failed",
                description: e?.message || "Unable to submit this decision.",
                variant: "destructive",
            });
        } finally {
            setSubmitting(null);
        }
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-10 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading approvals…
            </div>
        );
    }

    if (total === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
                <CheckCircle2 className="h-8 w-8 mb-3 text-emerald-400/70" />
                <p className="text-sm font-medium text-foreground">All clear</p>
                <p className="text-xs mt-1">No pending approvals or triage.</p>
            </div>
        );
    }

    if (selected) {
        return (
            <InlineApprovalReview
                approval={selected}
                comments={comments}
                onCommentsChange={setComments}
                showRaw={showRaw}
                onToggleRaw={() => setShowRaw(value => !value)}
                onBack={() => setSelected(null)}
                onApprove={() => handleDecision("approved")}
                onReject={() => handleDecision("rejected")}
                isApproving={submitting === "approved"}
                isRejecting={submitting === "rejected"}
            />
        );
    }

    return (
        <div className="space-y-4">
            {approvals.length > 0 && (
                <div className="space-y-2">
                    <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                        <Inbox className="h-3.5 w-3.5" /> Pending approvals
                        <Badge variant="outline" className="ml-auto text-[10px]">{approvals.length}</Badge>
                    </div>
                    {approvals.map(a => (
                        <div key={a.id} className="rounded-xl border border-foreground/10 bg-foreground/5 p-3">
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <p className="text-sm font-medium text-foreground truncate">{a.stepName || a.pipelineName}</p>
                                    <p className="text-xs text-muted-foreground truncate">{a.pipelineName}</p>
                                    <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
                                        <Clock className="h-3 w-3" />{new Date(a.createdAt).toLocaleString()}
                                    </p>
                                </div>
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    className="shrink-0"
                                    onClick={() => reviewApproval(a)}
                                >
                                    Review
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {actionableRescue.length > 0 && (
                <div className="space-y-2">
                    <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                        <Shield className="h-3.5 w-3.5" /> Recovery / triage
                        <Badge variant="outline" className="ml-auto text-[10px]">{actionableRescue.length}</Badge>
                    </div>
                    {actionableRescue.map(r => (
                        <div key={r.id} className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-2">
                            <TriageCenter
                                summary={r.triageSummary || "Mission requires strategic intervention."}
                                options={r.recoveryOptions}
                                onSelectOption={(o) => handleRecovery(r, o)}
                                onDismiss={() => handleDismiss(r)}
                            />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function InlineApprovalReview({
    approval,
    comments,
    onCommentsChange,
    showRaw,
    onToggleRaw,
    onBack,
    onApprove,
    onReject,
    isApproving,
    isRejecting,
}: {
    approval: ApprovalRequest;
    comments: string;
    onCommentsChange: (value: string) => void;
    showRaw: boolean;
    onToggleRaw: () => void;
    onBack: () => void;
    onApprove: () => void;
    onReject: () => void;
    isApproving: boolean;
    isRejecting: boolean;
}) {
    const context = approval.contextSnapshot ?? approval.modifiedOutput ?? {};
    const summary = summarizeApprovalContext(context);
    const isSubmitting = isApproving || isRejecting;

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" className="h-8 px-2 text-foreground hover:bg-foreground/10" onClick={onBack}>
                    <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                    Queue
                </Button>
                <Badge variant="outline" className="ml-auto border-amber-400/30 bg-amber-400/10 text-[10px] uppercase tracking-wider text-amber-700 dark:text-amber-200">
                    Inline review
                </Badge>
            </div>

            <div className="rounded-2xl border border-foreground/10 bg-foreground/[0.04] p-4">
                <div className="flex items-start gap-3">
                    <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 p-2 text-amber-700 dark:text-amber-200">
                        <AlertTriangle className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Decision request</p>
                        <h3 className="mt-1 text-base font-bold leading-tight text-foreground">{approval.stepName || approval.pipelineName}</h3>
                        <p className="mt-1 truncate text-xs text-muted-foreground">{approval.pipelineName}</p>
                        <p className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {new Date(approval.createdAt).toLocaleString()}
                        </p>
                    </div>
                </div>

                <div className="mt-4 grid gap-3">
                    {summary.map(item => (
                        <div key={item.label} className={cn(
                            "rounded-xl border p-3",
                            item.emphasis === "risk"
                                ? "border-amber-400/20 bg-amber-400/5"
                                : "border-foreground/10 bg-background/40"
                        )}>
                            <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-muted-foreground">{item.label}</p>
                            <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground">{item.value}</p>
                        </div>
                    ))}
                </div>

                <button
                    type="button"
                    onClick={onToggleRaw}
                    className="mt-3 text-[10px] font-bold uppercase tracking-[0.16em] text-indigo-700 dark:text-indigo-300 hover:text-indigo-700 dark:text-indigo-200"
                >
                    {showRaw ? "Hide raw context" : "Show raw context"}
                </button>
                {showRaw && (
                    <pre className="mt-3 max-h-56 overflow-auto rounded-xl border border-foreground/10 bg-background p-3 text-[10px] leading-relaxed text-foreground">
                        {safeJson(context)}
                    </pre>
                )}
            </div>

            <div className="rounded-2xl border border-foreground/10 bg-background/60 p-4">
                <label className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Comments</label>
                <Textarea
                    value={comments}
                    onChange={(event) => onCommentsChange(event.target.value)}
                    placeholder="Optional reason or instruction for the audit trail..."
                    className="mt-2 min-h-24 resize-none rounded-xl border-foreground/10 bg-card text-sm text-foreground placeholder:text-muted-foreground"
                    disabled={isSubmitting}
                />
            </div>

            <div className="grid grid-cols-2 gap-2 pb-2">
                <Button
                    variant="ghost"
                    className="h-11 border border-rose-400/20 bg-rose-500/10 text-rose-700 dark:text-rose-200 hover:bg-rose-500/20 hover:text-rose-100"
                    onClick={onReject}
                    disabled={isSubmitting}
                >
                    {isRejecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <XCircle className="mr-2 h-4 w-4" />}
                    Reject
                </Button>
                <Button
                    className="h-11 bg-emerald-600 text-foreground hover:bg-emerald-500"
                    onClick={onApprove}
                    disabled={isSubmitting}
                >
                    {isApproving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                    Approve
                </Button>
            </div>
        </div>
    );
}

function summarizeApprovalContext(context: any): Array<{ label: string; value: string; emphasis?: "risk" }> {
    if (!context || typeof context !== "object") {
        return [{ label: "Request", value: String(context || "No context was provided.") }];
    }

    const data = context.context && typeof context.context === "object" ? { ...context, ...context.context } : context;

    // Approval envelopes carry their reviewable content in args; everything
    // else on the envelope is transport. Render the fields, not the JSON.
    const envelope = data.toolArgs && typeof data.toolArgs === "object" ? data.toolArgs : (isApprovalEnvelope(data) ? data : null);
    const envelopeFields = approvalReviewFields(envelope);
    if (envelopeFields) {
        const items: Array<{ label: string; value: string; emphasis?: "risk" }> = envelopeFields.map(f => ({ label: f.label, value: f.value }));
        const tool = data.tool || data.toolName || (envelope as any).actionName;
        if (tool) items.splice(Math.min(items.length, 2), 0, { label: "Tool", value: String(tool) });
        return items.slice(0, 8);
    }

    const items: Array<{ label: string; value: string; emphasis?: "risk" }> = [];
    const add = (label: string, value: unknown, emphasis?: "risk") => {
        const text = value == null ? "" : typeof value === "string" ? value : JSON.stringify(value, null, 2);
        if (text.trim()) items.push({ label, value: text, emphasis });
    };

    add("Planned action", data.description || data.message || data.command || data.goal || data.final_product || data.deliverable || data.code || (data.toolArgs as any)?.code || (data.toolArgs as any)?.command);
    add("Reasoning", data.reasoning || data.thought_process || data.hypothesis || data.reason);
    add("Risk", data.risk || data.riskLevel || data.severity, "risk");
    add("Tool", data.tool || data.toolName || data.action || data.dynamicAction?.action);
    add("Parameters", data.params || data.toolArgs || data.dynamicAction?.action_details);

    if (items.length === 0) {
        add("Context", data);
    }

    return items.slice(0, 5);
}

function safeJson(value: unknown): string {
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

export default AssistantApprovals;
