
import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
    MessageSquare, 
    Rocket, 
    Zap, 
    ShieldCheck, 
    AlertCircle, 
    CheckCircle2, 
    ChevronRight,
    Sparkles,
    Send
} from "lucide-react";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Progress } from "@domain-ui/core/ui/components/ui/progress";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useQueryClient } from "@tanstack/react-query";

interface MissionReviewProps {
    missionRunId: number;
    missionId: number;
    context: any;
}

export function MissionReviewComponent({ missionRunId, missionId, context }: MissionReviewProps) {
    const [feedback, setFeedback] = useState("");
    const [isResuming, setIsResuming] = useState(false);
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const phase = context?.phase || 'WAITING_FOR_ORDERS';
    const wave = context?.current_wave || 1;
    const maxWaves = context?.max_waves || 10;
    const progress = (wave / maxWaves) * 100;

    const handleResume = async () => {
        setIsResuming(true);
        try {
            // 1. Submit feedback to mission chat/blackboard if provided
            if (feedback.trim()) {
                await apiRequest("POST", `/api/missions/${missionId}/chat`, {
                    message: `[DIRECTIVE] User Feedback for Next Wave: ${feedback}`,
                    role: 'user'
                });
            }

            // 2. Resume the mission
            await apiRequest("POST", `/api/missions/${missionRunId}/resume`);
            
            toast({
                title: "Orders Received",
                description: "The Mission Strategist is re-aligning the next wave based on your guidance.",
            });

            // Refresh data
            queryClient.invalidateQueries({ queryKey: [`/api/missions/${missionId}`] });
            queryClient.invalidateQueries({ queryKey: [`/api/mission-runs?missionId=${missionId}`] });
        } catch (err: any) {
            toast({
                variant: "destructive",
                title: "Transmission Failed",
                description: err.message,
            });
        } finally {
            setIsResuming(false);
        }
    };

    if (phase !== 'WAITING_FOR_ORDERS') return null;

    return (
        <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full mt-8 overflow-hidden rounded-3xl border border-amber-500/20 bg-background/40 backdrop-blur-xl shadow-2xl shadow-amber-500/5"
        >
            {/* Header section with glass effect */}
            <div className="p-8 border-b border-amber-500/10 bg-gradient-to-r from-amber-500/10 to-transparent">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-2xl bg-amber-500/20 flex items-center justify-center border border-amber-500/30">
                            <Sparkles className="w-6 h-6 text-amber-500 animate-pulse" />
                        </div>
                        <div>
                            <h2 className="text-2xl font-black tracking-tighter text-foreground uppercase italic">
                                Tactical <span className="text-amber-500">Review</span>
                            </h2>
                            <p className="text-xs text-amber-500/60 uppercase tracking-widest font-bold">
                                Wave {wave} Evaluation Complete • Institutional Oversight Required
                            </p>
                        </div>
                    </div>
                    <Badge className="bg-amber-500 text-background font-bold px-3 py-1">
                        PAUSED FOR ORDERS
                    </Badge>
                </div>

                <div className="grid grid-cols-3 gap-6 mt-8">
                    <div className="p-4 rounded-2xl bg-foreground/5 border border-foreground/10">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">Mission Progress</p>
                        <div className="flex items-end gap-2 mb-2">
                            <span className="text-2xl font-bold text-foreground leading-none">{Math.round(progress)}%</span>
                            <span className="text-xs text-muted-foreground mb-1">of target</span>
                        </div>
                        <Progress value={progress} className="h-1.5 bg-foreground/10" indicatorClassName="bg-amber-500" />
                    </div>
                    <div className="p-4 rounded-2xl bg-foreground/5 border border-foreground/10">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">Current Wave</p>
                        <div className="flex items-end gap-2">
                            <span className="text-2xl font-bold text-foreground leading-none">{wave}</span>
                            <span className="text-xs text-muted-foreground mb-1">/ {maxWaves} Cycles</span>
                        </div>
                    </div>
                    <div className="p-4 rounded-2xl bg-foreground/5 border border-foreground/10">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">Alignment Score</p>
                        <div className="flex items-center gap-2">
                            <span className="text-2xl font-bold text-emerald-500 leading-none">94</span>
                            <ShieldCheck className="w-4 h-4 text-emerald-500" />
                        </div>
                    </div>
                </div>
            </div>

            {/* Content Body */}
            <div className="p-8">
                <div className="space-y-6">
                    <div>
                        <label className="flex items-center gap-2 text-xs font-bold text-foreground/70 uppercase tracking-widest mb-3">
                            <MessageSquare className="w-4 h-4 text-amber-500" />
                            Commander's Directive
                        </label>
                        <div className="relative group">
                            <div className="absolute -inset-0.5 bg-gradient-to-r from-amber-500/20 to-orange-500/20 rounded-2xl blur opacity-30 group-focus-within:opacity-100 transition duration-500"></div>
                            <Textarea 
                                placeholder="Refine the mission's trajectory... (e.g., 'Focus more on visual aesthetics' or 'Optimize the database schema before proceeding')"
                                className="relative w-full h-32 bg-card/50 border-foreground/10 rounded-2xl p-4 text-foreground placeholder:text-foreground/20 focus:border-amber-500/50 focus:ring-0 transition-all resize-none"
                                value={feedback}
                                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setFeedback(e.target.value)}
                            />
                        </div>
                        <div className="flex flex-wrap gap-2 mt-3">
                            {[
                                "Focus on visual aesthetics & styling",
                                "Add comprehensive test coverage",
                                "Optimize database query performance",
                                "Proceed with execution"
                            ].map((s, idx) => (
                                <button
                                    key={idx}
                                    type="button"
                                    onClick={() => setFeedback(prev => prev ? `${prev}\n${s}` : s)}
                                    className="text-[10px] bg-foreground/5 hover:bg-foreground/10 border border-foreground/10 hover:border-amber-500/30 rounded-xl px-3 py-1.5 text-muted-foreground hover:text-foreground transition-all font-semibold uppercase tracking-wider"
                                >
                                    + {s}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="flex items-center justify-between pt-4">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <AlertCircle className="w-4 h-4" />
                            <span>Resuming will trigger the next <strong>Rolling Wave</strong> cycle immediately.</span>
                        </div>
                        <Button 
                            className="bg-amber-500 hover:bg-amber-600 text-background font-black px-8 h-12 rounded-2xl shadow-lg shadow-amber-500/20 group transition-all"
                            onClick={handleResume}
                            disabled={isResuming}
                        >
                            {isResuming ? (
                                <>
                                    <Zap className="w-5 h-5 mr-2 animate-spin" />
                                    TRANSMITTING...
                                </>
                            ) : (
                                <>
                                    <Send className="w-5 h-5 mr-2 group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
                                    RESUME MISSION
                                </>
                            )}
                        </Button>
                    </div>
                </div>
            </div>

            {/* Decorative background element */}
            <div className="absolute top-0 right-0 -translate-y-1/2 translate-x-1/2 w-64 h-64 bg-amber-500/5 blur-[100px] pointer-events-none rounded-full" />
        </motion.div>
    );
}
