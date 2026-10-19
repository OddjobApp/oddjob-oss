
import React, { useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import { 
  CheckCircle2, 
  ArrowRight, 
  Rocket, 
  Sparkles, 
  Layout, 
  Loader2,
  AlertCircle,
  MessageSquare,
  FileCode2,
  ChevronDown,
  ChevronUp
} from "lucide-react";
import { cn } from "@/lib/utils";

interface WaveGovernancePanelProps {
  jobId: string;
  run: any;
  wavePlan?: any;
  onActionComplete?: () => void;
}

export default function WaveGovernancePanel({ jobId, run, wavePlan, onActionComplete }: WaveGovernancePanelProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [digestExpanded, setDigestExpanded] = useState(true);

  // Extract wave info from run status or mission context
  const forgeStatus = run?.missionContext?.forgeStatus || {};
  const currentWaveId = forgeStatus.currentWaveId || 1;
  const nextWaveId = forgeStatus.nextWaveId || (currentWaveId + 1);
  const canFinishEarly = forgeStatus.canFinishEarly ?? true;

  // Derive completed tasks from the wavePlan for the current wave
  const completedWaveTasks = React.useMemo(() => {
    if (!wavePlan?.waves) return [];
    const currentWave = wavePlan.waves.find((w: any) => w.id === currentWaveId || w.waveNumber === currentWaveId);
    if (!currentWave) return wavePlan.waves[currentWaveId - 1]?.tasks || [];
    return currentWave.tasks || [];
  }, [wavePlan, currentWaveId]);

  const waves = [
    { id: 1, title: "MMF", description: "Minimum Viable Functionality", icon: Layout },
    { id: 2, title: "Expansion", description: "Functional Depth & Integration", icon: Rocket },
    { id: 3, title: "Polish", description: "Aesthetic Excellence & UX", icon: Sparkles },
  ];


  const sendFeedback = (message: string) => {
    if (!feedback.trim() || !run?.missionId) return;
    apiRequest("POST", `/api/missions/${run.missionId}/chat`, { message, role: 'user' }).catch(() => {});
  };

  const handleApprove = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await apiRequest("POST", `/api/apps/forge/${jobId}/approve-wave`, { waveId: nextWaveId });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to approve wave");
      }
      sendFeedback(`[DIRECTIVE] Commander Feedback for Wave ${nextWaveId}: ${feedback}`);
      setFeedback("");
      onActionComplete?.();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFinish = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await apiRequest("POST", `/api/apps/forge/${jobId}/finish-early`, {});
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to finalize forge");
      }
      sendFeedback(`[DIRECTIVE] Finalization Directives: ${feedback}`);
      setFeedback("");
      onActionComplete?.();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Show the panel when the forge is suspended for wave review.
  const forgeWaveStatus = run?.missionContext?.forgeStatus?.status;
  const isWaveGate = run?.status === "awaiting_wave_approval" ||
    (run?.status === "paused" && forgeWaveStatus === "awaiting_wave_approval");
  if (!isWaveGate) return null;

  const nextActionLabel = nextWaveId <= 3 ? `Approve Phase ${nextWaveId}` : "Approve Next Phase";

  return (
    <Card className="border-amber-500/30 bg-background/40 backdrop-blur-xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 shadow-2xl shadow-amber-500/5">
      <CardHeader className="pb-3 border-b border-amber-500/10 bg-gradient-to-r from-amber-500/10 to-transparent">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center border border-amber-500/30">
              <CheckCircle2 className="w-5 h-5 text-amber-500" />
            </div>
            <div>
              <CardTitle className="text-lg font-black tracking-tighter text-foreground uppercase italic">
                Phase <span className="text-amber-500">{currentWaveId}</span> Ready For Review
              </CardTitle>
              <CardDescription className="text-xs text-amber-500/60 font-bold uppercase tracking-wider">
                Review the latest work, share feedback, and decide what happens next
              </CardDescription>
            </div>
          </div>
          <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/20 animate-pulse font-bold tracking-widest text-[9px] uppercase px-3 py-1">
            APPROVAL REQUIRED
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-6 space-y-6">
        {/* Wave Status Tracker */}
        <div className="grid grid-cols-3 gap-4">
          {waves.map((wave) => {
            const Icon = wave.icon;
            const isCompleted = wave.id <= currentWaveId;
            const isCurrent = wave.id === currentWaveId;

            return (
              <div 
                key={wave.id} 
                className={cn(
                  "relative p-4 rounded-2xl border transition-all duration-300",
                  isCurrent ? "bg-amber-500/10 border-amber-500/30 ring-1 ring-amber-500/20 shadow-[0_0_15px_rgba(245,158,11,0.05)]" : 
                  isCompleted ? "bg-emerald-500/5 border-emerald-500/20 opacity-60" :
                  "bg-foreground/5 border-white/5 opacity-30"
                )}
              >
                <div className="flex flex-col items-center text-center gap-2">
                  <div className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center border transition-all",
                    isCompleted ? "bg-emerald-500/20 text-emerald-500 border-emerald-500/30" : "bg-foreground/10 text-foreground border-white/10"
                  )}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-[10px] font-black uppercase tracking-widest">{wave.title}</p>
                    <p className="text-[8px] text-muted-foreground uppercase leading-tight">{wave.description}</p>
                  </div>
                  {isCompleted && (
                    <div className="absolute top-2 right-2">
                      <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Wave Digest — What was accomplished */}
        {completedWaveTasks.length > 0 && (
          <div className="bg-emerald-500/5 border border-emerald-500/15 rounded-2xl overflow-hidden">
            <button
              type="button"
              onClick={() => setDigestExpanded(v => !v)}
              className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-emerald-500/5 transition-colors"
            >
              <div className="flex items-center gap-2">
                <FileCode2 className="w-4 h-4 text-emerald-500" />
                <span className="text-xs font-black text-emerald-400 uppercase tracking-widest">
                  Phase {currentWaveId} Completed Work
                </span>
                <Badge variant="outline" className="text-[9px] bg-emerald-500/10 text-emerald-500 border-emerald-500/20 font-mono">
                  {completedWaveTasks.length} tasks
                </Badge>
              </div>
              {digestExpanded ? (
                <ChevronUp className="w-4 h-4 text-emerald-500/50" />
              ) : (
                <ChevronDown className="w-4 h-4 text-emerald-500/50" />
              )}
            </button>
            {digestExpanded && (
              <div className="px-5 pb-4 space-y-2">
                {completedWaveTasks.map((task: any, idx: number) => (
                  <div
                    key={idx}
                    className={cn(
                      "flex items-start gap-3 px-3 py-2.5 rounded-xl border text-xs transition-all",
                      task.status === "completed" || task.status === "done"
                        ? "bg-emerald-500/5 border-emerald-500/15 opacity-90"
                        : task.status === "failed"
                          ? "bg-red-500/5 border-red-500/15"
                          : "bg-foreground/[0.03] border-white/[0.06]"
                    )}
                  >
                    <CheckCircle2 className={cn(
                      "w-3.5 h-3.5 mt-0.5 shrink-0",
                      task.status === "completed" || task.status === "done" ? "text-emerald-500" : "text-foreground/20"
                    )} />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-foreground/80 truncate">{task.title || task.name || `Task ${idx + 1}`}</p>
                      {task.description && (
                        <p className="text-foreground/40 mt-0.5 text-[10px] leading-relaxed line-clamp-2">{task.description}</p>
                      )}
                    </div>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[9px] uppercase font-bold tracking-wider shrink-0",
                        task.status === "completed" || task.status === "done"
                          ? "text-emerald-500 border-emerald-500/20 bg-emerald-500/10"
                          : task.status === "failed"
                            ? "text-red-400 border-red-500/20 bg-red-500/10"
                            : "text-foreground/30 border-white/10"
                      )}
                    >
                      {task.status || "built"}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Action Panel */}
        <div className="bg-background/40 rounded-2xl p-6 border border-white/5 flex flex-col items-center text-center space-y-6">
          <div className="space-y-1">
            <h3 className="text-lg font-bold text-foreground uppercase tracking-tighter">Choose What Happens Next</h3>
            <p className="text-sm text-muted-foreground max-w-md">
              Review the latest output. Approve the next phase for additional refinement, or publish the current result now.
            </p>
          </div>

          {/* Commander Directive Input */}
          <div className="w-full max-w-md text-left space-y-2">
            <label className="flex items-center gap-2 text-xs font-bold text-foreground/70 uppercase tracking-widest">
              <MessageSquare className="w-4 h-4 text-amber-500" />
              Reviewer Notes
            </label>
            <div className="relative group">
              <div className="absolute -inset-0.5 bg-gradient-to-r from-amber-500/20 to-orange-500/20 rounded-2xl blur opacity-30 group-focus-within:opacity-100 transition duration-500"></div>
              <Textarea 
                placeholder="Request changes or give approval context, for example 'Tighten the executive summary' or 'Publish this version today.'"
                className="relative w-full h-24 bg-card/50 border-white/10 rounded-2xl p-4 text-foreground placeholder:text-foreground/20 focus:border-amber-500/50 focus:ring-0 transition-all resize-none text-sm"
                value={feedback}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setFeedback(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              {[
                "Clarify business summary",
                "Reduce delivery risk",
                "Improve customer-facing polish",
                "Approved as is"
              ].map((s, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setFeedback(prev => prev ? `${prev}\n${s}` : s)}
                  className="text-[9px] bg-foreground/5 hover:bg-foreground/10 border border-white/10 hover:border-amber-500/30 rounded-xl px-2.5 py-1 text-muted-foreground hover:text-foreground transition-all font-bold uppercase tracking-widest"
                >
                  + {s}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-4 w-full max-w-md">
            {nextWaveId <= 3 && (
              <Button 
                onClick={handleApprove}
                disabled={isSubmitting}
                className="flex-1 bg-amber-500 hover:bg-amber-600 text-black font-black uppercase tracking-widest text-xs h-12 rounded-xl shadow-lg shadow-amber-500/10"
              >
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ArrowRight className="w-4 h-4 mr-2" />}
                {nextActionLabel}
              </Button>
            )}
            
            {canFinishEarly && (
              <Button 
                onClick={handleFinish}
                variant="outline"
                disabled={isSubmitting}
                className="flex-1 border-white/20 hover:bg-foreground/5 font-black uppercase tracking-widest text-xs h-12 rounded-xl"
              >
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Rocket className="w-4 h-4 mr-2" />}
                Publish Current Result
              </Button>
            )}
          </div>

          {error && (
            <div className="flex items-center gap-2 text-red-500 text-xs font-bold uppercase mt-2">
              <AlertCircle className="w-3 h-3" />
              {error}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
