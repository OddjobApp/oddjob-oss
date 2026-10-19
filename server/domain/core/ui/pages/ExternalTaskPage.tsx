import React, { useState } from "react";
import { useSearch } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Alert, AlertDescription } from "@domain-ui/core/ui/components/ui/alert";
import { Skeleton } from "@domain-ui/core/ui/components/ui/skeleton";
import { AlertCircle, CheckCircle2, Mail, Sparkles } from "lucide-react";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import type { FormSchema } from "@domain-ui/core/ui/components/shared/FormRenderer";
import { StudioForm } from "@/modules/forms/StudioForm";
import { FormStageTask, type StageTask } from "@/modules/forms/FormStageTask";
import DiffViewer from "@domain-ui/core/ui/components/shared/DiffViewer";

interface TaskResponse {
  status: "otp_required" | "ready";
  email?: string;
  formId?: number;
  formName?: string;
  schema?: FormSchema;
  /** A stage of a cycle's Form Studio response, in place of a whole form. */
  formStudioStage?: { requestStatus: string; view: StageTask };
  themeConfig?: {
    logoUrl?: string;
    primaryColor?: string;
    accentColor?: string;
    companyName?: string;
    backgroundUrl?: string;
  };
  executionId?: string;
    jobContext?: {
    jobId: number;
    jobName: string;
    jobType: string;
    output: any;
    diff?: any; // Reactive Intelligence: Semantic changes
    stepOrder: number;
    executedAt: string | null;
  };
}

const DEMO_TASK: TaskResponse = {
  status: "ready",
  email: "approver@oddjob.agency",
  executionId: "hil-demo-take-approval-1042",
  schema: {
    fields: [
      {
        key: "decision",
        type: "radio",
        label: "Cryptographic Gate Decision",
        options: [
          { label: "Approve Take & Authorize Release", value: "approve" },
          { label: "Request Re-Take with Adjusted Seed", value: "retake" },
          { label: "Reject & Escalate to Creative Director", value: "reject" },
        ],
        defaultValue: "approve",
        required: true,
      },
      {
        key: "tokenCapConfirmation",
        type: "boolean",
        label: "I confirm that execution spend is within the project ceiling",
        defaultValue: "true",
        required: true,
      },
      {
        key: "forensicAuditNotes",
        type: "textarea",
        label: "Audit Ledger Notes",
        description: "Cryptographically recorded in the immutable audit log for compliance.",
        placeholder: "Approved conformance for SCENE-01 The Breakthrough...",
        defaultValue: "Visual review satisfactory. Keyframe alignment and motion dynamics verified.",
      },
    ],
  },
  jobContext: {
    jobId: 1042,
    jobName: "Film Production: SCENE-01 The Breakthrough",
    jobType: "media_take_render",
    stepOrder: 2,
    executedAt: new Date().toISOString(),
    output: {
      scene: "SCENE-01 - The Breakthrough",
      shot: "Shot 2 of 3 (Framing: 5x, Macro)",
      workflow: "Wan 2.1 Image-to-Video (Local)",
      spend: "within project ceiling",
      safety_check: "Compliant with SMT Verification Gate",
      resolution: "1280x720 @ 30fps",
    },
  },
  themeConfig: {
    companyName: "Oddjob HIL Safety Portal",
    primaryColor: "#4F46E5",
    accentColor: "#10B981",
  },
};

export default function ExternalTaskPage() {
  // Fix #29: use wouter's useSearch hook instead of window.location.search
  const searchString = useSearch();
  const token = new URLSearchParams(searchString).get("token");
  const isDemo = !token || token === "demo";

  const [otpCode, setOtpCode] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const { toast } = useToast();

  const navigateBackToWorkspace = () => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.assign("/workspace/chat/crew-film-studio-alpha?orgId=291");
    }
  };

  // Fetch task data
  const { data: serverTaskData, isLoading, error, refetch } = useQuery<TaskResponse>({
    queryKey: ["/api/external/task", token],
    queryFn: async () => {
      if (!token) throw new Error("Token is required");
      const res = await fetch(`/api/external/task?token=${encodeURIComponent(token)}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to load task");
      }
      return res.json();
    },
    enabled: !!token && !isDemo,
    retry: false,
  });

  const taskData = isDemo ? DEMO_TASK : serverTaskData;

  // Request OTP mutation
  const requestOtpMutation = useMutation({
    mutationFn: async () => {
      if (!token || !taskData?.email) throw new Error("Missing token or email");
      const res = await fetch("/api/external/otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token, email: taskData.email }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to send OTP");
      }
      return res.json();
    },
    // Fix #28: replace alert() with toast
    onSuccess: () => {
      toast({
        title: "Code sent",
        description: "A verification code has been sent to your email. Check your inbox.",
      });
    },
    onError: (err: any) => {
      toast({
        title: "Failed to send code",
        description: err.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  // Verify OTP mutation
  const verifyOtpMutation = useMutation({
    mutationFn: async (code: string) => {
      if (!token || !taskData?.email) throw new Error("Missing token or email");
      const res = await fetch("/api/external/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token, email: taskData.email, code }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Invalid OTP code");
      }
      return res.json();
    },
    onSuccess: () => {
      refetch();
    },
  });

  // Submit form mutation
  const submitMutation = useMutation({
    mutationFn: async (responses: Record<string, any>) => {
      if (isDemo) {
        return { success: true };
      }
      if (!token) throw new Error("Missing token");
      const res = await fetch("/api/external/task/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token, responses }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to submit form");
      }
      return res.json();
    },
    onSuccess: () => {
      setSubmitted(true);
    },
  });

  // Mask email for display
  const maskEmail = (email: string) => {
    const [local, domain] = email.split("@");
    if (!local || !domain) return email;
    const masked = local[0] + "***" + local[local.length - 1];
    return `${masked}@${domain}`;
  };

  if (isLoading && !isDemo) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted p-4">
        <Card className="max-w-md w-full">
          <CardContent className="p-6 space-y-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-32 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error && !isDemo) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted p-4">
        <Card className="max-w-md w-full">
          <CardContent className="p-6 text-center space-y-4">
            <div className="bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-900/30 rounded-lg p-6 text-center">
               <AlertCircle className="h-12 w-12 text-orange-600 mx-auto mb-4" />
               <h3 className="text-lg font-bold text-orange-900 dark:text-orange-200 mb-2">Task Unavailable</h3>
               <p className="text-orange-800 dark:text-orange-300 text-sm">
                Unable to load this task. The link may have expired or been replaced by a newer version.
               </p>
            </div>
            <Button
              variant="outline"
              onClick={navigateBackToWorkspace}
            >
              Return to Workspace
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Success state
  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted p-4">
        <Card className="max-w-md w-full">
          <CardContent className="p-6 text-center space-y-4">
            <CheckCircle2 className="w-16 h-16 mx-auto text-green-600" />
            <h2 className="text-2xl font-bold text-green-900 dark:text-green-300">Thank You!</h2>
            <p className="text-green-800 dark:text-green-200">
              {isDemo
                ? "Cryptographic sign-off simulated successfully in S.C.O.R.E. sandbox mode."
                : "Your response has been submitted successfully."}
            </p>
            <Button
              className="mt-4"
              onClick={navigateBackToWorkspace}
            >
              Return to Workspace
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // OTP Required state
  if (taskData?.status === "otp_required") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle>Identity Verification</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              We need to verify your identity. A verification code has been sent to:
            </p>
            <div className="flex items-center gap-2 p-3 bg-muted rounded-md">
              <Mail className="w-4 h-4 text-muted-foreground" />
              <span className="font-mono">{maskEmail(taskData.email || "")}</span>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Enter 6-digit code</label>
              <Input
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                maxLength={6}
                className="text-center text-2xl tracking-widest"
              />
            </div>

            {verifyOtpMutation.isError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  {verifyOtpMutation.error instanceof Error
                    ? verifyOtpMutation.error.message
                    : "Invalid code"}
                </AlertDescription>
              </Alert>
            )}

            <div className="flex gap-2">
              <Button
                onClick={() => requestOtpMutation.mutate()}
                variant="outline"
                disabled={requestOtpMutation.isPending}
                className="flex-1"
              >
                {requestOtpMutation.isPending ? "Sending..." : "Resend Code"}
              </Button>
              <Button
                onClick={() => verifyOtpMutation.mutate(otpCode)}
                disabled={otpCode.length !== 6 || verifyOtpMutation.isPending}
                className="flex-1"
              >
                {verifyOtpMutation.isPending ? "Verifying..." : "Verify"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // A stage of a cycle's Form Studio response: only this person's stage, and what
  // they may see of earlier ones. Its results show in place after submitting.
  if (taskData?.status === "ready" && taskData.formStudioStage) {
    const stage = taskData.formStudioStage;
    return (
      <main className="min-h-screen bg-muted/30 px-4 py-10">
        <div className="mx-auto w-full max-w-2xl rounded-xl border bg-card p-6 shadow-sm">
          <FormStageTask
            task={stage.view}
            onSubmit={stage.requestStatus === "pending" ? async (inputs) => {
              const res = await fetch("/api/external/task/submit", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ token, responses: { inputs } }),
              });
              const body = await res.json().catch(() => ({}));
              if (!res.ok) throw new Error(body?.error?.message ?? body?.message ?? "Your answers could not be submitted. Try again.");
              return { view: body.formStudioStage.view };
            } : undefined}
          />
        </div>
      </main>
    );
  }

  // Ready state - Show form
  if (taskData?.status === "ready" && taskData.schema) {
    const themeConfig = taskData.themeConfig || {};
    const primaryColor = themeConfig.primaryColor || "#4F46E5";
    const accentColor = themeConfig.accentColor || "#10B981";
    const backgroundUrl = themeConfig.backgroundUrl || "https://images.unsplash.com/photo-1639322537228-f710d846310a?auto=format&fit=crop&q=80&w=2000";

    return (
      <div className="min-h-screen bg-background py-8 px-4 font-sans text-foreground relative overflow-hidden">
        {/* Dynamic Background */}
        <div className="fixed inset-0 z-0 opacity-20 pointer-events-none dynamic-bg" />
        <div className="fixed inset-0 z-0 bg-gradient-to-b from-[#020617]/40 via-[#020617]/80 to-[#020617] pointer-events-none" />

        <style dangerouslySetInnerHTML={{ __html: `
          :root {
            --primary: ${primaryColor};
            --accent: ${accentColor};
            --primary-foreground: #ffffff;
            --ring: ${primaryColor};
          }
          .dynamic-bg {
            background-image: url("${backgroundUrl}");
            background-size: cover;
            background-position: center;
            animation: pulse-bg 20s ease-in-out infinite;
          }
          @keyframes pulse-bg {
            0% { transform: scale(1); opacity: 0.15; }
            50% { transform: scale(1.05); opacity: 0.25; }
            100% { transform: scale(1); opacity: 0.15; }
          }
          @keyframes scanning {
            0% { transform: translateY(-100%); opacity: 0; }
            50% { opacity: 0.5; }
            100% { transform: translateY(400%); opacity: 0; }
          }
          .scan-line {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 2px;
            background: linear-gradient(to right, transparent, ${primaryColor}, transparent);
            animation: scanning 4s linear infinite;
            z-index: 20;
          }
          .glass-panel {
            background: rgba(15, 23, 42, 0.6);
            backdrop-filter: blur(12px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37);
            transition: transform 0.3s ease, box-shadow 0.3s ease, border-color 0.3s ease;
          }
          .glass-panel:hover {
            border-color: rgba(255, 255, 255, 0.2);
            box-shadow: 0 12px 48px 0 rgba(0, 0, 0, 0.5);
          }
          .custom-scrollbar::-webkit-scrollbar {
            width: 4px;
          }
          .custom-scrollbar::-webkit-scrollbar-track {
            background: rgba(0, 0, 0, 0.1);
          }
          .custom-scrollbar::-webkit-scrollbar-thumb {
            background: ${primaryColor}44;
            border-radius: 10px;
          }
          .custom-scrollbar::-webkit-scrollbar-thumb:hover {
            background: ${primaryColor}88;
          }
          
          button.bg-primary {
            background-color: ${primaryColor} !important;
          }
          .text-accent {
            color: ${accentColor} !important;
          }
        ` }} />
        
        <div className="max-w-3xl mx-auto space-y-6 relative z-10">
          {isDemo && (
            <div className="flex items-center justify-between rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-4 py-2.5 text-xs text-indigo-200 shadow-sm backdrop-blur-md">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-indigo-400 shrink-0" />
                <span><strong>Interactive HIL Safety Sandbox</strong> · Demonstrating cryptographic gate sign-off</span>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs border-indigo-500/40 text-indigo-300 hover:bg-indigo-500/20"
                onClick={navigateBackToWorkspace}
              >
                ← Return to Workspace
              </Button>
            </div>
          )}
          {/* Header with branding */}
          <div className="glass-panel rounded-xl p-8 text-center relative overflow-hidden group">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[var(--primary)] to-transparent opacity-50" />
            <div className="scan-line opacity-0 group-hover:opacity-100 transition-opacity" />
            {themeConfig.logoUrl ? (
              <div className="flex justify-center mb-6">
                <img
                  src={themeConfig.logoUrl}
                  alt={themeConfig.companyName || "Company"}
                  className="h-16 w-auto object-contain drop-shadow-[0_0_8px_rgba(255,255,255,0.3)]"
                />
              </div>
            ) : (
              <div className="w-16 h-16 bg-muted rounded-lg flex items-center justify-center mx-auto mb-6 border border-border">
                <CheckCircle2 className="w-8 h-8 primary-icon" />
              </div>
            )}
            
            <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-b from-white to-slate-400 bg-clip-text text-transparent">
              {themeConfig.companyName || "Oddjob Governance"}
            </h1>
            <p className="mt-2 text-muted-foreground font-medium uppercase tracking-[0.2em] text-xs">
              Secure Approval Portal
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-2 space-y-6">
              {/* Job Execution Context */}
              {taskData.jobContext && (
                <div className="glass-panel rounded-xl overflow-hidden">
                  <div className="px-6 py-4 border-b border-foreground/10 bg-foreground/5 flex justify-between items-center">
                    <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground">
                      Request Details
                    </h2>
                    <span className="px-2 py-1 bg-muted rounded text-[10px] font-mono text-muted-foreground border border-border">
                      ID: {taskData.executionId?.slice(0, 8)}
                    </span>
                  </div>
                  <div className="p-6">
                    {taskData.jobContext.diff && taskData.jobContext.diff.hasChanges ? (
                      <div className="space-y-4">
                        <div className="flex items-center gap-2 text-amber-400 text-xs font-bold uppercase tracking-widest">
                          <AlertCircle className="w-4 h-4" />
                          Proposed Changes
                        </div>
                        <DiffViewer 
                          diff={taskData.jobContext.diff} 
                          current={taskData.jobContext.output}
                          title="Review Changes"
                          showRawView={false}
                        />
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
                          Information
                        </div>
                        <div className="grid grid-cols-1 gap-4">
                          {typeof taskData.jobContext.output === 'object' && taskData.jobContext.output !== null ? (
                            Object.entries(taskData.jobContext.output).map(([key, value]) => {
                              // Skip internal keys or large objects
                              if (key.startsWith('_') || typeof value === 'function') return null;
                              return (
                                <div key={key} className="p-4 bg-card/50 rounded-lg border border-foreground/5">
                                  <div className="text-[10px] text-muted-foreground uppercase font-bold mb-1 tracking-tight">{key.replace(/_/g, ' ')}</div>
                                  <div className="text-sm text-foreground break-words font-medium">
                                    {typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
                                  </div>
                                </div>
                              );
                            })
                          ) : (
                            <div className="p-4 bg-card/50 rounded-lg border border-foreground/5 text-foreground italic">
                              {String(taskData.jobContext.output || "No data provided")}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Form Section */}
              <div className="glass-panel rounded-xl overflow-hidden border-t-2 decision-protocol-border" data-testid="hil-form-container">
                <div className="px-6 py-4 border-b border-foreground/10 bg-foreground/5">
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground">
                    Required Action
                  </h2>
                </div>
                <div className="p-6">
                  <StudioForm
                    schema={taskData.schema}
                    onSubmit={async (data) => {
                      if (isDemo) {
                        setSubmitted(true);
                        return;
                      }
                      await submitMutation.mutateAsync(data);
                    }}
                    submitLabel="Confirm & Approve"
                    themeConfig={themeConfig}
                    disabled={submitMutation.isPending}
                    context={taskData.jobContext}
                  />
                  
                  {submitMutation.isError && (
                    <Alert variant="destructive" className="mt-6 bg-red-950/50 border-red-900/50 text-red-700 dark:text-red-200">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>
                        {submitMutation.error instanceof Error
                          ? submitMutation.error.message
                          : "Action failed: Please try again."}
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-6">
              {/* Instructions / Info Panel */}
              <div className="glass-panel rounded-xl p-6 space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  Instructions
                </h3>
                <div className="space-y-3 text-sm text-foreground">
                  <p className="leading-relaxed">
                    Please review the information provided on the left. Your decision will be logged and applied to the current operation.
                  </p>
                  <div className="pt-4 border-t border-foreground/10 space-y-2">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-muted-foreground">APPROVER</span>
                      <span className="font-mono">{maskEmail(taskData.email || "")}</span>
                    </div>
                    {taskData.jobContext?.executedAt && (
                      <div className="flex justify-between text-[11px]">
                        <span className="text-muted-foreground">RECEIVED</span>
                        <span className="font-mono">{new Date(taskData.jobContext.executedAt).toLocaleTimeString()}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Security Seal */}
              <div className="glass-panel rounded-xl p-4 flex items-center gap-3 bg-emerald-950/20 border-emerald-900/30">
                <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-500">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                </div>
                <div className="text-[10px] font-bold uppercase tracking-tighter text-emerald-500/80">
                  Verified Secure Connection
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
