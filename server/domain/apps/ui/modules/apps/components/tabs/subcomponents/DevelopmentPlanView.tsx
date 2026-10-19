import React, { useState } from 'react';
import { ScrollArea } from '@domain-ui/core/ui/components/ui/scroll-area';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Textarea } from '@domain-ui/core/ui/components/ui/textarea';
import { 
    CheckCircle2, 
    Circle, 
    Layout, 
    Database, 
    Shield, 
    Zap, 
    ArrowRight,
    Trophy,
    Target,
    Compass,
    AlertCircle,
    Edit3,
    Plus,
    Trash2,
    Save,
    Rocket,
    Loader2,
    Search,
    Settings,
    FileText,
    Activity
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

interface DevelopmentPlan {
    overview: string;
    phases: {
        name: string;
        description: string;
        tasks: string[];
    }[];
    techStack: string[];
    integrationStrategy?: string;
    uxDescription?: string;
    mockStrategy?: Record<string, string>;
    waves?: {
        id: string;
        name: string;
        objective: string;
        focus: string[];
    }[];
}

interface DevelopmentPlanViewProps {
    plan?: DevelopmentPlan;
    onApprove?: (plan: DevelopmentPlan) => void;
    onSkipToBuild?: () => void;
    isApproving?: boolean;
    governanceActive?: boolean;
}

export function DevelopmentPlanView({ 
    plan: initialPlan, 
    onApprove, 
    onSkipToBuild, 
    isApproving,
    governanceActive = false 
}: DevelopmentPlanViewProps) {
    const [plan, setPlan] = useState<DevelopmentPlan | undefined>(initialPlan);
    const [isEditing, setIsEditing] = useState(false);

    // Sync state if initialPlan changes from parent (e.g. SSE update)
    // Only sync if the user is not actively editing to prevent loss of local changes
    React.useEffect(() => {
        if (initialPlan && !isEditing) {
            setPlan(initialPlan);
        }
    }, [initialPlan, isEditing]);

    if (!plan) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px] p-12 text-center space-y-6 animate-in fade-in zoom-in-95 duration-500">
                <div className="relative">
                    <div className="absolute inset-0 bg-primary/20 blur-2xl rounded-full" />
                    <div className="relative p-6 rounded-3xl bg-card/40 border border-foreground/10 shadow-2xl backdrop-blur-xl">
                        <Compass className="w-14 h-14 text-primary animate-pulse-glow" />
                    </div>
                </div>
                <div className="space-y-2">
                    <h3 className="text-lg font-black uppercase tracking-[0.2em] text-foreground">Blueprint Signal Lost</h3>
                    <p className="text-[11px] text-muted-foreground max-w-[320px] leading-relaxed font-medium mx-auto italic">
                        The AI Architect is still drafting the strategic manifest. Telemetry will stabilize once the first iteration is projected.
                    </p>
                </div>
                <div className="pt-4">
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-foreground/5 border border-foreground/10">
                        <Loader2 className="w-3 h-3 text-primary animate-spin" />
                        <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Awaiting Neural Link...</span>
                    </div>
                </div>
            </div>
        );
    }

    const updatePhase = (phaseIdx: number, updates: Partial<DevelopmentPlan['phases'][0]>) => {
        setPlan(prev => {
            if (!prev) return prev;
            const newPhases = [...prev.phases];
            newPhases[phaseIdx] = { ...newPhases[phaseIdx], ...updates };
            return { ...prev, phases: newPhases };
        });
    };

    const updateTask = (phaseIdx: number, taskIdx: number, value: string) => {
        setPlan(prev => {
            if (!prev) return prev;
            const newPhases = [...prev.phases];
            const newTasks = [...newPhases[phaseIdx].tasks];
            newTasks[taskIdx] = value;
            newPhases[phaseIdx] = { ...newPhases[phaseIdx], tasks: newTasks };
            return { ...prev, phases: newPhases };
        });
    };

    const addTask = (phaseIdx: number) => {
        setPlan(prev => {
            if (!prev) return prev;
            const newPhases = [...prev.phases];
            newPhases[phaseIdx] = { 
                ...newPhases[phaseIdx], 
                tasks: [...newPhases[phaseIdx].tasks, "New Task Component"] 
            };
            return { ...prev, phases: newPhases };
        });
    };

    const removeTask = (phaseIdx: number, taskIdx: number) => {
        setPlan(prev => {
            if (!prev) return prev;
            const newPhases = [...prev.phases];
            const newTasks = newPhases[phaseIdx].tasks.filter((_, i) => i !== taskIdx);
            newPhases[phaseIdx] = { ...newPhases[phaseIdx], tasks: newTasks };
            return { ...prev, phases: newPhases };
        });
    };

    return (
        <ScrollArea className="h-full pr-4">
            <div className="p-1 space-y-8 pb-20">
                {/* Header / Overview */}
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <div className="p-2.5 bg-primary/10 rounded-xl shadow-[0_0_20px_hsl(var(--primary)/0.2)] border border-primary/20">
                                <Target className="w-5 h-5 text-primary" />
                            </div>
                            <div>
                                <h4 className="text-xs font-black uppercase tracking-[0.1em] text-foreground">Strategic Blueprint</h4>
                                <div className="flex items-center gap-2 mt-0.5">
                                    <p className="text-[10px] text-muted-foreground italic font-medium">Neural Projection v1.0</p>
                                    {governanceActive && (
                                        <Badge variant="outline" className="h-4 px-1.5 text-[8px] border-emerald-500/30 text-emerald-400 bg-emerald-500/5 animate-pulse flex items-center gap-1 font-black uppercase">
                                            <Shield className="w-2 h-2" /> Auto-Pilot Active
                                        </Badge>
                                    )}
                                </div>
                            </div>
                        </div>
                        <Button 
                            variant="outline" 
                            size="sm" 
                            onClick={() => setIsEditing(!isEditing)}
                            className={cn(
                                "text-[10px] font-black uppercase tracking-widest h-8 px-4 rounded-lg border-foreground/10 transition-all duration-300",
                                isEditing ? "bg-primary/20 border-primary/50 text-primary shadow-[0_0_15px_hsl(var(--primary)/0.2)]" : "bg-foreground/5 hover:bg-foreground/10 text-muted-foreground hover:text-foreground"
                            )}
                        >
                            {isEditing ? <><Save className="w-3.5 h-3.5 mr-2" /> Commit Changes</> : <><Edit3 className="w-3.5 h-3.5 mr-2" /> Modify Strategy</>}
                        </Button>
                    </div>
                    
                    <div className="p-5 rounded-2xl bg-card/50 border border-foreground/10 backdrop-blur-sm relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-2 opacity-5 pointer-events-none group-hover:opacity-10 transition-opacity">
                            <Compass className="w-12 h-12" />
                        </div>
                        {isEditing ? (
                            <Textarea 
                                value={plan.overview}
                                onChange={(e) => setPlan({ ...plan, overview: e.target.value })}
                                className="text-[11px] bg-background/40 border-foreground/10 min-h-[100px] text-foreground focus:border-primary/50 transition-colors"
                                placeholder="Describe the high-level mission objective..."
                            />
                        ) : (
                            <p className="text-[11px] leading-relaxed text-foreground font-medium">
                                {plan.overview}
                            </p>
                        )}
                    </div>
                </div>

                {/* UX & Integration Strategy */}
                {(plan.uxDescription || plan.integrationStrategy || isEditing) && (
                    <div className="space-y-4">
                        <div className="flex items-center gap-2">
                            <Zap className="w-3.5 h-3.5 text-amber-400" />
                            <span className="text-[10px] font-black uppercase tracking-widest">Experience & Logic</span>
                        </div>
                        <div className="grid gap-3">
                            {(plan.uxDescription || isEditing) && (
                                <div className="p-3 rounded-xl bg-indigo-500/5 border border-indigo-500/10 space-y-2">
                                    <div className="flex items-center gap-2 text-indigo-400">
                                        <Layout className="w-3 h-3" />
                                        <span className="text-[9px] font-black uppercase tracking-widest">UX/UI Narrative</span>
                                    </div>
                                    {isEditing ? (
                                        <Textarea 
                                            value={plan.uxDescription}
                                            onChange={(e) => setPlan({ ...plan, uxDescription: e.target.value })}
                                            className="text-[10px] bg-background/50 border-foreground/5 min-h-[60px]"
                                            placeholder="Describe the user experience goals..."
                                        />
                                    ) : (
                                        <p className="text-[10px] leading-relaxed text-muted-foreground">
                                            {plan.uxDescription}
                                        </p>
                                    )}
                                </div>
                            )}
                            {(plan.integrationStrategy || isEditing) && (
                                <div className="p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/10 space-y-2">
                                    <div className="flex items-center gap-2 text-emerald-400">
                                        <Database className="w-3 h-3" />
                                        <span className="text-[9px] font-black uppercase tracking-widest">System Integration</span>
                                    </div>
                                    {isEditing ? (
                                        <Textarea 
                                            value={plan.integrationStrategy}
                                            onChange={(e) => setPlan({ ...plan, integrationStrategy: e.target.value })}
                                            className="text-[10px] bg-background/50 border-foreground/5 min-h-[60px]"
                                            placeholder="Describe how the app integrates with platform services..."
                                        />
                                    ) : (
                                        <p className="text-[10px] leading-relaxed text-muted-foreground">
                                            {plan.integrationStrategy}
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Build Sequence */}
                <div className="space-y-4">
                    <div className="flex items-center gap-2">
                        <Trophy className="w-3.5 h-3.5 text-primary" />
                        <span className="text-[10px] font-black uppercase tracking-widest">Build Sequence</span>
                    </div>
                    <div className="space-y-4">
                        {plan.phases.map((phase, idx) => (
                            <div key={idx} className="relative pl-6 space-y-2">
                                {/* Connector line */}
                                {idx < plan.phases.length - 1 && (
                                    <div className="absolute left-[7px] top-6 bottom-[-16px] w-[2px] bg-foreground/5" />
                                )}
                                
                                <div className="absolute left-0 top-1 w-4 h-4 rounded-full bg-card border border-foreground/20 flex items-center justify-center">
                                    <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                                </div>

                                <div className="space-y-1">
                                    {isEditing ? (
                                        <div className="flex flex-col gap-2 mb-2">
                                            <Input 
                                                value={phase.name}
                                                onChange={(e) => updatePhase(idx, { name: e.target.value })}
                                                className="h-7 text-[11px] font-black uppercase bg-foreground/5 border-foreground/10"
                                            />
                                            <Input 
                                                value={phase.description}
                                                onChange={(e) => updatePhase(idx, { description: e.target.value })}
                                                className="h-7 text-[10px] italic bg-foreground/5 border-foreground/10"
                                            />
                                        </div>
                                    ) : (
                                        <>
                                            <h5 className="text-[11px] font-black uppercase tracking-wide text-foreground">{phase.name}</h5>
                                            <p className="text-[10px] text-muted-foreground italic">{phase.description}</p>
                                        </>
                                    )}
                                </div>

                                <div className="space-y-1.5 pt-1">
                                    {phase.tasks.map((task, tidx) => (
                                        <motion.div 
                                            key={tidx}
                                            initial={{ opacity: 0, x: -10 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            transition={{ delay: tidx * 0.05 }}
                                            className="flex items-start gap-2.5 group"
                                        >
                                            <div className="mt-1 flex-shrink-0">
                                                <CheckCircle2 className="w-3 h-3 text-emerald-500/40 group-hover:text-emerald-500 transition-colors" />
                                            </div>
                                            {isEditing ? (
                                                <div className="flex items-center gap-2 flex-1">
                                                    <Input 
                                                        value={task}
                                                        onChange={(e) => updateTask(idx, tidx, e.target.value)}
                                                        className="h-6 text-[10px] bg-transparent border-foreground/5 focus:border-primary/30 py-0"
                                                    />
                                                    <button 
                                                        onClick={() => removeTask(idx, tidx)}
                                                        className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                                                        title="Remove Task"
                                                    >
                                                        <Trash2 className="w-3 h-3" />
                                                    </button>
                                                </div>
                                            ) : (
                                                <span className="text-[10px] text-muted-foreground leading-tight group-hover:text-foreground transition-colors">
                                                    {task}
                                                </span>
                                            )}
                                        </motion.div>
                                    ))}
                                    {isEditing && (
                                        <Button 
                                            variant="ghost" 
                                            size="sm" 
                                            onClick={() => addTask(idx)}
                                            className="h-6 px-2 text-[9px] font-black uppercase tracking-tighter text-primary/60 hover:text-primary hover:bg-primary/5"
                                        >
                                            <Plus className="w-3 h-3 mr-1" /> Add Component/Task
                                        </Button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Tech Stack Chips */}
                <div className="space-y-4">
                    <div className="flex items-center gap-2">
                        <Shield className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-[10px] font-black uppercase tracking-widest">Materialized Stack</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        {plan.techStack.map((tech, tidx) => (
                            <Badge 
                                key={tidx} 
                                variant="outline" 
                                className="bg-foreground/5 border-foreground/5 text-[9px] uppercase tracking-tighter text-muted-foreground hover:text-primary transition-colors"
                            >
                                {tech}
                            </Badge>
                        ))}
                    </div>
                </div>

                {/* Wave-Based Strategy */}
                {plan.waves && plan.waves.length > 0 && (
                    <div className="space-y-4">
                        <div className="flex items-center gap-2">
                            <Activity className="w-3.5 h-3.5 text-amber-500" />
                            <span className="text-[10px] font-black uppercase tracking-widest">Wave-Based Assembly Strategy</span>
                        </div>
                        <div className="grid gap-3">
                            {plan.waves.map((wave, wIdx) => (
                                <div key={wave.id} className="p-4 rounded-2xl bg-foreground/5 border border-foreground/10 space-y-3 relative overflow-hidden group">
                                    <div className="absolute top-0 right-0 p-2 opacity-10 pointer-events-none group-hover:scale-110 transition-transform">
                                        <Badge variant="outline" className="text-[14px] font-black opacity-20 border-none">0{wIdx + 1}</Badge>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-[10px] font-black text-primary">
                                            W{wIdx + 1}
                                        </div>
                                        <div className="space-y-0.5">
                                            <h6 className="text-[11px] font-black uppercase tracking-tight text-foreground">{wave.name}</h6>
                                            <p className="text-[9px] text-muted-foreground font-medium italic">{wave.objective}</p>
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5 pt-1">
                                        {wave.focus.map((f, fi) => (
                                            <Badge key={fi} variant="secondary" className="bg-foreground/5 text-[8px] uppercase tracking-widest border-foreground/5 text-muted-foreground">
                                                {f}
                                            </Badge>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                        <p className="text-[9px] text-muted-foreground italic mt-2 leading-relaxed">
                            Each wave represents a surgical drafting gateway. The forge will suspend execution after each wave for human review and steering.
                        </p>
                    </div>
                )}

                {/* Integration TODOs */}
                {plan.mockStrategy && Object.keys(plan.mockStrategy).length > 0 && (
                    <div className="space-y-4">
                        <div className="flex items-center gap-2">
                            <AlertCircle className="w-3.5 h-3.5 text-orange-500" />
                            <span className="text-[10px] font-black uppercase tracking-widest">Integration TODOs</span>
                        </div>
                        <div className="space-y-2">
                            {Object.entries(plan.mockStrategy).map(([service, reason]) => (
                                <div key={service} className="p-3 rounded-xl border border-orange-500/20 bg-orange-500/5 flex items-start gap-3">
                                    <div className="mt-0.5">
                                        <div className="w-3 h-3 rounded-full border border-orange-500/50 flex items-center justify-center">
                                            <div className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
                                        </div>
                                    </div>
                                    <div className="space-y-1">
                                        <h6 className="text-[10px] font-black uppercase tracking-tight text-orange-400">{service} (Mocked)</h6>
                                        <p className="text-[9px] text-muted-foreground italic leading-relaxed">{reason}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {onApprove && (
                    <div className="pt-4 border-t border-foreground/10 space-y-3">
                        <div className="flex gap-2">
                            <Button
                                onClick={() => onApprove(plan)}
                                disabled={isApproving}
                                className="flex-1 font-black uppercase tracking-wider"
                            >
                                {isApproving ? "Approving..." : "Approve Blueprint & Begin Build"}
                            </Button>
                            {onSkipToBuild && (
                                <Button
                                    variant="outline"
                                    onClick={onSkipToBuild}
                                    title="Skip all remaining reviews and start assembly"
                                    className="border-primary/20 hover:bg-primary/5 text-primary"
                                >
                                    <Rocket className="w-4 h-4" />
                                </Button>
                            )}
                        </div>
                        <p className="text-[10px] text-muted-foreground text-center italic">
                            Approve the strategy above to proceed to technical architecture design.
                        </p>
                    </div>
                )}
            </div>
        </ScrollArea>
    );
}
