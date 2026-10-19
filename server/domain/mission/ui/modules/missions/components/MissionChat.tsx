import { useState, useRef, useEffect } from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from "@domain-ui/core/ui/components/ui/sheet";
import { Send, Bot, User, Terminal, Rocket, Loader2, Eye, Zap, Play, Pause, CircleStop } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { useSupervisorPlanStream } from "@domain-ui/mission/ui/modules/missions/hooks/use-supervisor-plan-stream";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { parseAgentResponse } from "@domain-ui/ai/ui/modules/agent-ai";
import { RescueStatusCard } from "@domain-ui/rescue/ui/modules/rescue/components/RescueStatusCard";
import { CopilotCommandPalette } from "./CopilotCommandPalette.js";

interface MissionChatProps {
    mission: any;
}

export function MissionChat({ mission }: MissionChatProps) {
    const [input, setInput] = useState("");
    const [planSheetOpen, setPlanSheetOpen] = useState(false);
    const queryClient = useQueryClient();
    const scrollRef = useRef<HTMLDivElement>(null);
    const { toast } = useToast();
    const planStream = useSupervisorPlanStream();

    const blackboard = mission.blackboard || {};
    const messages = blackboard.messages || [];

    // Fetch active runs for this mission
    const { data: runs = [] } = useQuery<any[]>({
        queryKey: [`/api/mission-runs?missionId=${mission.id}`],
    });

    const activeRun = runs.find(r => r.status === "active" || r.status === "paused" || r.status.startsWith("waiting"));

    // Mutations for controls
    const pauseMutation = useMutation({
        mutationFn: async (runId: number) => {
            await apiRequest("POST", `/api/mission-runs/${runId}/pause`, {});
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [`/api/mission-runs?missionId=${mission.id}`] });
            toast({ title: "Mission Paused" });
        },
        onError: (err: any) => toast({ title: "Pause failed", description: err.message, variant: "destructive" })
    });

    const resumeMutation = useMutation({
        mutationFn: async (runId: number) => {
            await apiRequest("POST", `/api/mission-runs/${runId}/resume`, {});
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [`/api/mission-runs?missionId=${mission.id}`] });
            toast({ title: "Mission Resumed" });
        },
        onError: (err: any) => toast({ title: "Resume failed", description: err.message, variant: "destructive" })
    });

    const stopMutation = useMutation({
        mutationFn: async (runId: number) => {
            await apiRequest("POST", `/api/mission-runs/${runId}/terminate`, {});
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [`/api/mission-runs?missionId=${mission.id}`] });
            toast({ title: "Mission Terminated" });
        },
        onError: (err: any) => toast({ title: "Stop failed", description: err.message, variant: "destructive" })
    });

    // Auto-scroll to bottom
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    const launchMutation = useMutation({
        mutationFn: async () => {
            const res = await apiRequest("POST", `/api/missions/${mission.id}/launch-mission`);
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || "Failed to launch mission");
            }
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [`/api/missions/${mission.id}`] });
            queryClient.invalidateQueries({ queryKey: [`/api/missions?missionId=${mission.id}`] });
            queryClient.invalidateQueries({ queryKey: [`/api/missions/${mission.id}/activity`] });
            queryClient.invalidateQueries({ queryKey: ["/api/approvals"] });
            toast({
                title: "Mission Launched",
                description: "Mission created. The supervisor is now planning and executing in the background—this may take 1–2 minutes.",
            });
        },
        onError: (err: Error) => {
            toast({
                title: "Launch Failed",
                description: err.message,
                variant: "destructive",
            });
        },
    });

    const sendMutation = useMutation({
        mutationFn: async (message: string) => {
            const res = await apiRequest("POST", `/api/missions/${mission.id}/chat`, {
                message
            });
            return res.json();
        },
        onSuccess: () => {
            setInput("");
            queryClient.invalidateQueries({ queryKey: [`/api/missions/${mission.id}`] });
        },
        onError: (error: any) => {
            toast({
                title: "Failed to send message",
                description: error.message,
                variant: "destructive",
            });
        }
    });

    const handleSend = () => {
        if (!input.trim()) return;
        sendMutation.mutate(input);
    };

    const handleSelectCopilotPrompt = (prompt: string) => {
        setInput(prompt);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const handleOpenPlanPreview = (open: boolean) => {
        setPlanSheetOpen(open);
        if (open && mission.objective && planStream.status === "idle") {
            planStream.stream({ intent: mission.objective });
        } else if (!open) {
            planStream.reset();
        }
    };

    // Helper to determine if we should show secondary controls
    const showControls = !!activeRun;

    return (
        <div className="flex flex-col h-[600px] bg-background/40 rounded-md border border-border overflow-hidden">
            {/* Header / Context Status */}
            <div className="bg-foreground/5 p-3 border-b border-border flex items-center justify-between gap-2 text-xs text-muted-foreground font-mono">
                <div className="flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-primary" />
                    <span className="text-primary font-black tracking-[0.15em] uppercase text-[11px]">Mission Command</span>
                    <span className="opacity-30">::</span>
                    <Badge variant="outline" className="text-[9px] h-5 px-2 border-primary/30 text-primary font-bold uppercase tracking-wider">
                        {activeRun?.status.toUpperCase() || mission.status || 'ACTIVE'}
                    </Badge>

                    {showControls && (
                        <div className="flex items-center gap-1.5 ml-2 pl-2 border-l border-border/50">
                            {activeRun.status === "paused" ? (
                                <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-6 w-6 text-green-400 hover:text-green-700 dark:text-green-300 hover:bg-green-400/10"
                                    onClick={() => resumeMutation.mutate(activeRun.id)}
                                    disabled={resumeMutation.isPending}
                                    title="Resume Mission"
                                >
                                    <Play className="w-3.5 h-3.5" />
                                </Button>
                            ) : (
                                <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-6 w-6 text-amber-400 hover:text-amber-700 dark:text-amber-300 hover:bg-amber-400/10"
                                    onClick={() => pauseMutation.mutate(activeRun.id)}
                                    disabled={pauseMutation.isPending}
                                    title="Pause Mission"
                                >
                                    <Pause className="w-3.5 h-3.5" />
                                </Button>
                            )}
                            <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 px-2 text-[10px] text-red-400 hover:text-red-700 dark:text-red-300 hover:bg-red-400/10 border border-red-400/20"
                                onClick={() => stopMutation.mutate(activeRun.id)}
                                disabled={stopMutation.isPending}
                            >
                                <CircleStop className="w-3 h-3 mr-1" />
                                Stop mission
                            </Button>
                        </div>
                    )}
                </div>
                {mission.objective && (
                    <div className="flex items-center gap-2">
                        <Sheet open={planSheetOpen} onOpenChange={handleOpenPlanPreview}>
                            <SheetTrigger asChild>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="border-primary/40 text-primary hover:bg-primary/10 text-xs h-7"
                                    disabled={planStream.status === "streaming"}
                                >
                                    {planStream.status === "streaming" ? (
                                        <>
                                            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                            Planning...
                                        </>
                                    ) : (
                                        <>
                                            <Eye className="w-3 h-3 mr-1" />
                                            Preview Plan
                                        </>
                                    )}
                                </Button>
                            </SheetTrigger>
                            <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
                                <SheetHeader>
                                    <SheetTitle className="flex items-center gap-2">
                                        <Zap className="w-5 h-5 text-primary" />
                                        Plan Preview
                                    </SheetTitle>
                                    <SheetDescription>
                                        {planStream.status === "streaming"
                                            ? "Generating plan incrementally..."
                                            : planStream.status === "done"
                                                ? "Review the plan below, then launch when ready."
                                                : "Preview the supervisor plan before launching."}
                                    </SheetDescription>
                                </SheetHeader>
                                <div className="mt-6 space-y-4">
                                    {planStream.status === "streaming" && (
                                        <div className="space-y-2">
                                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                Planning...
                                            </div>
                                            {planStream.accumulatedText && (
                                                <pre className="text-xs font-mono bg-background/40 p-4 rounded border border-border/50 whitespace-pre-wrap max-h-[50vh] overflow-y-auto">
                                                    {planStream.accumulatedText}
                                                </pre>
                                            )}
                                        </div>
                                    )}
                                    {planStream.status === "error" && (
                                        <div className="text-sm text-red-500 bg-red-500/10 p-3 rounded border border-red-500/20">
                                            {planStream.error}
                                        </div>
                                    )}
                                    {planStream.status === "done" && planStream.plan?.tasks && (
                                        <>
                                            <div className="grid gap-3 max-h-[650px] overflow-y-auto pr-1">
                                                {Array.isArray(planStream.plan.tasks) && planStream.plan.tasks.map((task: any, idx: number) => (
                                                    <div
                                                        key={task.id}
                                                        className="flex items-start gap-3 p-4 bg-primary/5 border border-primary/20 rounded-xl"
                                                    >
                                                        <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-[10px] font-bold">
                                                            {idx + 1}
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center justify-between gap-2 mb-1">
                                                                <h4 className="font-semibold text-sm truncate">{task.name}</h4>
                                                                {task.assignedAgent && (
                                                                    <Badge variant="outline" className="text-[9px] border-primary/30 text-primary">
                                                                        {task.assignedAgent}
                                                                    </Badge>
                                                                )}
                                                            </div>
                                                            <p className="text-[11px] leading-relaxed text-muted-foreground line-clamp-2">{task.description}</p>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                            <Button
                                                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
                                                onClick={() => {
                                                    setPlanSheetOpen(false);
                                                    planStream.reset();
                                                    launchMutation.mutate();
                                                }}
                                                disabled={launchMutation.isPending}
                                            >
                                                {launchMutation.isPending ? (
                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                ) : (
                                                    <>
                                                        <Rocket className="w-4 h-4 mr-2" />
                                                        Launch Mission
                                                    </>
                                                )}
                                            </Button>
                                        </>
                                    )}
                                </div>
                            </SheetContent>
                        </Sheet>
                        <Button
                            size="sm"
                            className="bg-primary hover:bg-primary/90 text-primary-foreground text-xs h-7"
                            onClick={() => launchMutation.mutate()}
                            disabled={launchMutation.isPending}
                        >
                            {launchMutation.isPending ? (
                                <>
                                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                    Launching...
                                </>
                            ) : (
                                <>
                                    <Rocket className="w-3 h-3 mr-1" />
                                    Launch Mission
                                </>
                            )}
                        </Button>
                    </div>
                )}
            </div>

            {/* Chat Area */}
            <ScrollArea className="flex-1 p-4" ref={scrollRef}>
                <div className="space-y-4">
                    {messages.length === 0 ? (
                        <div className="text-center text-muted-foreground text-sm py-10">
                            <Bot className="w-8 h-8 mx-auto mb-2 opacity-50" />
                            <p>No mission logs recorded.</p>
                            <p className="text-xs">Send a message to initialize mission parameters.</p>
                        </div>
                    ) : (
                        Array.isArray(messages) && messages.map((msg: any, i: number) => (
                            <div
                                key={i}
                                className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
                            >
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-primary/20 text-primary' : 'bg-primary/10 border border-primary/30 text-primary'
                                    }`}>
                                    {msg.role === 'user' ? <User size={14} /> : <Terminal size={14} />}
                                </div>
                                <div className={`flex flex-col max-w-[80%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                                    <div className={`px-4 py-3 rounded-xl text-sm shadow-sm ${msg.role === 'user'
                                        ? 'bg-primary text-primary-foreground border border-primary/30'
                                        : 'bg-primary text-primary-foreground border border-border/50 leading-relaxed'
                                        }`}>
                                        {(() => {
                                            if (msg.role === 'agent') {
                                                try {
                                                    const parsed = parseAgentResponse(msg.content);
                                                    if (parsed.type === 'rescue_status') {
                                                        return <RescueStatusCard sessionId={(parsed.data as any).sessionId} />;
                                                    }
                                                } catch {
                                                    // Malformed agent response — fall through to raw content
                                                }
                                            }
                                            return typeof msg.content === 'object'
                                                ? JSON.stringify(msg.content, null, 2)
                                                : msg.content;
                                        })()}
                                    </div>
                                    <span className="text-[10px] text-muted-foreground mt-1.5 font-mono opacity-40 uppercase tracking-tighter">
                                        {msg.timestamp ? formatDistanceToNow(new Date(msg.timestamp), { addSuffix: true }) : ''}
                                        {msg.role !== 'user' && ` // MISSION_LOG_${i.toString().padStart(3, '0')}`}
                                    </span>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </ScrollArea>

            <CopilotCommandPalette
                compact
                onSelectPrompt={handleSelectCopilotPrompt}
                surface="mission_chat"
                missionId={mission.id}
                missionRunId={activeRun?.id}
            />

            {/* Input Area */}
            <div className="p-3 bg-foreground/5 border-t border-border flex gap-2">
                <Input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Enter mission directives to Command..."
                    className="bg-background/60 border-primary/20 focus-visible:ring-primary text-primary placeholder:text-primary/30"
                />
                <Button
                    onClick={handleSend}
                    disabled={sendMutation.isPending || !input.trim()}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground"
                >
                    <Send className="w-4 h-4" />
                </Button>
            </div>
        </div>
    );
}


