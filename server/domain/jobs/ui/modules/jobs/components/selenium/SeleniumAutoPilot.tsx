import React, { useState, useEffect, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { 
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@domain-ui/core/ui/components/ui/dialog";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@domain-ui/core/ui/components/ui/tabs";
import { Sparkles, Loader2, Play, Square, RotateCcw, Save, Trash2, Clock, CheckCircle, XCircle, MousePointer, Keyboard, Camera, ArrowRight } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

interface SeleniumStep {
    action: string;
    selector?: string;
    value?: string;
    optional?: boolean;
    reasoning?: string;
}

interface AutopilotSession {
    sessionId: string;
    status: "started" | "running" | "completed" | "failed" | "stopped";
    startUrl: string;
    goal: string;
    steps: SeleniumStep[];
    startTime: Date;
    durationMs?: number;
}

interface SeleniumAutoPilotProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    jobId: number;
}

export default function SeleniumAutoPilot({ open, onOpenChange, jobId }: SeleniumAutoPilotProps) {
    const [autoPilotUrl, setAutoPilotUrl] = useState("");
    const [autoPilotGoal, setAutoPilotGoal] = useState("");
    const [activeTab, setActiveTab] = useState("configure");
    const [session, setSession] = useState<AutopilotSession | null>(null);
    const [isRecording, setIsRecording] = useState(false);
    const [selectedStepIndices, setSelectedStepIndices] = useState<number[]>([]);
    const stepsEndRef = useRef<HTMLDivElement>(null);

    // Start autopilot session
    const startSessionMutation = useMutation({
        mutationFn: async ({ url, goal }: { url: string; goal: string }) => {
            const res = await apiRequest("POST", "/api/agents/selenium/start", { url, goal });
            if (!res.ok) throw new Error("Failed to start autopilot session");
            return res.json();
        },
        onSuccess: (data) => {
            setSession({
                sessionId: data.sessionId,
                status: "started",
                startUrl: data.startUrl,
                goal: data.goal,
                steps: [],
                startTime: new Date(),
            });
            setActiveTab("record");
        }
    });

    // Execute autopilot
    const executeMutation = useMutation({
        mutationFn: async (sessionId: string) => {
            const res = await apiRequest("POST", `/api/agents/selenium/${sessionId}/execute`, { datasetId: jobId });
            if (!res.ok) throw new Error("Failed to execute autopilot");
            return res.json();
        },
        onSuccess: (data) => {
            setSession(prev => prev ? {
                ...prev,
                status: data.status === "completed" ? "completed" : "failed",
                steps: data.steps || [],
                durationMs: data.durationMs,
            } : null);
            setIsRecording(false);
        },
        onError: () => {
            setSession(prev => prev ? { ...prev, status: "failed" } : null);
            setIsRecording(false);
        }
    });

    // Stop and save session
    const stopSessionMutation = useMutation({
        mutationFn: async ({ sessionId, excludedIndices }: { sessionId: string; excludedIndices: number[] }) => {
            const res = await apiRequest("POST", `/api/agents/selenium/${sessionId}/stop`, { excludedStepIndices: excludedIndices });
            if (!res.ok) throw new Error("Failed to stop session");
            return res.json();
        },
        onSuccess: (data) => {
            setSession(prev => prev ? {
                ...prev,
                status: "stopped",
                steps: data.steps || [],
                durationMs: data.durationMs,
            } : null);
        }
    });

    // Replay session
    const replayMutation = useMutation({
        mutationFn: async (sessionId: string) => {
            const res = await apiRequest("POST", `/api/agents/selenium/replay/${sessionId}`, {});
            if (!res.ok) throw new Error("Failed to start replay");
            return res.json();
        },
        onSuccess: (data) => {
            setSession({
                sessionId: data.replaySessionId,
                status: "started",
                startUrl: data.startUrl,
                goal: `Replay of ${data.originalSessionId}`,
                steps: [],
                startTime: new Date(),
            });
            setActiveTab("record");
            // Auto-start replay execution
            setTimeout(() => executeMutation.mutate(data.replaySessionId), 100);
        }
    });

    // Poll for steps during recording
    const stepsQuery = useQuery({
        queryKey: ["selenium-steps", session?.sessionId],
        queryFn: async () => {
            if (!session?.sessionId) return null;
            const res = await apiRequest("GET", `/api/agents/selenium/${session.sessionId}/steps`);
            if (!res.ok) return null;
            return res.json();
        },
        enabled: !!session?.sessionId && isRecording,
        refetchInterval: 2000,
    });

    // Update steps from polling
    useEffect(() => {
        if (stepsQuery.data?.steps) {
            setSession(prev => prev ? {
                ...prev,
                steps: stepsQuery.data.steps,
            } : null);
        }
    }, [stepsQuery.data]);

    // Auto-scroll to bottom of steps
    useEffect(() => {
        stepsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [session?.steps]);

    const startAutoPilot = () => {
        let normalizedUrl = autoPilotUrl.trim();
        if (!/^https?:\/\//i.test(normalizedUrl)) {
            normalizedUrl = `https://${normalizedUrl}`;
        }
        startSessionMutation.mutate({ url: normalizedUrl, goal: autoPilotGoal });
    };

    const startRecording = () => {
        setIsRecording(true);
        if (session?.sessionId) {
            executeMutation.mutate(session.sessionId);
        }
    };

    const stopRecording = () => {
        if (session?.sessionId) {
            stopSessionMutation.mutate({ sessionId: session.sessionId, excludedIndices: selectedStepIndices });
        }
    };

    const toggleStepSelection = (index: number) => {
        setSelectedStepIndices(prev => 
            prev.includes(index) 
                ? prev.filter(i => i !== index)
                : [...prev, index]
        );
    };

    const getStepIcon = (action: string) => {
        switch (action) {
            case "click": return <MousePointer className="w-4 h-4" />;
            case "type": return <Keyboard className="w-4 h-4" />;
            case "goto": return <ArrowRight className="w-4 h-4" />;
            case "screenshot": return <Camera className="w-4 h-4" />;
            default: return <CheckCircle className="w-4 h-4" />;
        }
    };

    const getStepColor = (action: string) => {
        switch (action) {
            case "click": return "bg-blue-500/20 text-blue-400";
            case "type": return "bg-green-500/20 text-green-400";
            case "goto": return "bg-purple-500/20 text-purple-400";
            case "screenshot": return "bg-amber-500/20 text-amber-400";
            default: return "bg-muted/20 text-muted-foreground";
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className={cn(
                "transition-all duration-300",
                activeTab === "record" ? "sm:max-w-4xl" : "sm:max-w-md"
            )}>
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Sparkles className="w-5 h-5 text-blue-600" />
                        Agentic Auto-Pilot
                        {session && (
                            <Badge variant={session.status === "completed" ? "default" : session.status === "failed" ? "destructive" : "secondary"}>
                                {session.status}
                            </Badge>
                        )}
                    </DialogTitle>
                    <DialogDescription>
                        {activeTab === "configure" 
                            ? "Describe your goal, and the AI Agent will browse the site to achieve it."
                            : `Recording session: ${session?.sessionId.slice(0, 20)}...`
                        }
                    </DialogDescription>
                </DialogHeader>

                <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                    <TabsList className={cn("grid w-full", activeTab === "configure" ? "hidden" : "grid-cols-2")}>
                        <TabsTrigger value="configure">Configure</TabsTrigger>
                        <TabsTrigger value="record">Record & Steps</TabsTrigger>
                    </TabsList>

                    <TabsContent value="configure" className="space-y-4 pt-2">
                        <div className="space-y-2">
                            <Label>Start URL</Label>
                            <Input
                                placeholder="https://example.com"
                                value={autoPilotUrl}
                                onChange={e => setAutoPilotUrl(e.target.value)}
                                disabled={startSessionMutation.isPending}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Goal Description</Label>
                            <Textarea
                                placeholder="e.g. Search for 'Oddjob documentation', click the first result, and find the 'Installation' section."
                                value={autoPilotGoal}
                                onChange={e => setAutoPilotGoal(e.target.value)}
                                rows={3}
                                disabled={startSessionMutation.isPending}
                            />
                        </div>
                        <div className="flex justify-end pt-2 gap-2">
                            {session && (
                                <Button variant="outline" onClick={() => setActiveTab("record")}>
                                    View Recording
                                </Button>
                            )}
                            <Button 
                                onClick={startAutoPilot} 
                                disabled={!autoPilotUrl || !autoPilotGoal || startSessionMutation.isPending}
                            >
                                {startSessionMutation.isPending ? (
                                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Starting...</>
                                ) : session ? (
                                    "New Session"
                                ) : (
                                    "Start Agent"
                                )}
                            </Button>
                        </div>
                    </TabsContent>

                    <TabsContent value="record" className="space-y-4">
                        {session ? (
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                                {/* Session Info */}
                                <div className="lg:col-span-1 space-y-3">
                                    <div className="p-3 bg-muted/50 rounded-lg space-y-2">
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs text-muted-foreground">Status</span>
                                            <Badge variant={session.status === "completed" ? "default" : session.status === "failed" ? "destructive" : "secondary"}>
                                                {session.status}
                                            </Badge>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs text-muted-foreground">Steps</span>
                                            <span className="text-sm font-medium">{session.steps.length}</span>
                                        </div>
                                        {session.durationMs && (
                                            <div className="flex items-center justify-between">
                                                <span className="text-xs text-muted-foreground">Duration</span>
                                                <span className="text-sm font-medium">{Math.round(session.durationMs / 1000)}s</span>
                                            </div>
                                        )}
                                        <div className="flex items-center gap-2 pt-2">
                                            <Clock className="w-3 h-3 text-muted-foreground" />
                                            <span className="text-xs text-muted-foreground">
                                                {session.startTime.toLocaleTimeString()}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Controls */}
                                    <div className="flex flex-col gap-2">
                                        {!isRecording && session.status === "started" && (
                                            <Button onClick={startRecording} className="w-full">
                                                <Play className="w-4 h-4 mr-2" />
                                                Start Recording
                                            </Button>
                                        )}
                                        {isRecording && (
                                            <Button onClick={stopRecording} variant="destructive" className="w-full" disabled={stopSessionMutation.isPending}>
                                                <Square className="w-4 h-4 mr-2" />
                                                {stopSessionMutation.isPending ? "Saving..." : "Stop & Save"}
                                            </Button>
                                        )}
                                        {(session.status === "completed" || session.status === "stopped") && (
                                            <Button 
                                                onClick={() => replayMutation.mutate(session.sessionId)} 
                                                variant="outline" 
                                                className="w-full"
                                                disabled={replayMutation.isPending}
                                            >
                                                <RotateCcw className="w-4 h-4 mr-2" />
                                                {replayMutation.isPending ? "Starting Replay..." : "Replay Session"}
                                            </Button>
                                        )}
                                        <Button 
                                            onClick={() => setActiveTab("configure")} 
                                            variant="ghost" 
                                            className="w-full"
                                        >
                                            Back to Configure
                                        </Button>
                                    </div>
                                </div>

                                {/* Steps Feed */}
                                <div className="lg:col-span-2">
                                    <ScrollArea className="h-[400px] border rounded-lg p-4">
                                        {session.steps.length === 0 ? (
                                            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                                                {isRecording ? (
                                                    <>
                                                        <Loader2 className="w-8 h-8 animate-spin mb-2" />
                                                        <p className="text-sm">Recording in progress...</p>
                                                    </>
                                                ) : (
                                                    <>
                                                        <Camera className="w-8 h-8 mb-2" />
                                                        <p className="text-sm">No steps recorded yet</p>
                                                        <p className="text-xs">Click "Start Recording" to begin</p>
                                                    </>
                                                )}
                                            </div>
                                        ) : (
                                            <div className="space-y-2">
                                                <AnimatePresence>
                                                    {session.steps.map((step, index) => (
                                                        <motion.div
                                                            key={index}
                                                            initial={{ opacity: 0, y: 10 }}
                                                            animate={{ opacity: 1, y: 0 }}
                                                            exit={{ opacity: 0, y: -10 }}
                                                            className={cn(
                                                                "flex items-start gap-3 p-2 rounded-lg border transition-colors",
                                                                selectedStepIndices.includes(index) && "bg-destructive/10 border-destructive/30",
                                                                !selectedStepIndices.includes(index) && "hover:bg-muted/50"
                                                            )}
                                                            onClick={() => toggleStepSelection(index)}
                                                        >
                                                            <div className={cn("p-1.5 rounded", getStepColor(step.action))}>
                                                                {getStepIcon(step.action)}
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <div className="flex items-center gap-2">
                                                                    <span className="text-xs font-medium uppercase tracking-wide">
                                                                        {step.action}
                                                                    </span>
                                                                    {step.optional && (
                                                                        <Badge variant="outline" className="text-[10px] h-4">Optional</Badge>
                                                                    )}
                                                                </div>
                                                                {step.selector && (
                                                                    <p className="text-xs text-muted-foreground truncate font-mono">
                                                                        {step.selector}
                                                                    </p>
                                                                )}
                                                                {step.value && step.value !== "HIDDEN_CAPTCHA_SOL" && (
                                                                    <p className="text-xs text-muted-foreground truncate">
                                                                        {step.value}
                                                                    </p>
                                                                )}
                                                                {step.reasoning && (
                                                                    <p className="text-xs text-muted-foreground mt-1 italic">
                                                                        {step.reasoning}
                                                                    </p>
                                                                )}
                                                            </div>
                                                            {selectedStepIndices.includes(index) && (
                                                                <Trash2 className="w-4 h-4 text-destructive" />
                                                            )}
                                                        </motion.div>
                                                    ))}
                                                </AnimatePresence>
                                                <div ref={stepsEndRef} />
                                            </div>
                                        )}
                                    </ScrollArea>
                                    {selectedStepIndices.length > 0 && (
                                        <p className="text-xs text-muted-foreground mt-2">
                                            {selectedStepIndices.length} step(s) marked for exclusion. Click "Stop & Save" to exclude them.
                                        </p>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center p-8 text-muted-foreground">
                                <Camera className="w-12 h-12 mb-4" />
                                <p className="text-sm">No active session</p>
                                <Button 
                                    onClick={() => setActiveTab("configure")} 
                                    variant="outline" 
                                    className="mt-4"
                                >
                                    Configure & Start
                                </Button>
                            </div>
                        )}
                    </TabsContent>
                </Tabs>
            </DialogContent>
        </Dialog>
    );
}
