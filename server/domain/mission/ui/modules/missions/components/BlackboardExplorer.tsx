import React, { useState, useEffect } from "react";
import { 
    ChevronRight, 
    ChevronDown, 
    Package, 
    FileJson, 
    Hash, 
    Type, 
    Braces, 
    Pencil, 
    Brain, 
    Sparkles, 
    MessageSquare, 
    Bot, 
    User,
    Clock,
    FileText,
    Terminal
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { formatDeliverable } from "@/lib/mission-utils";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@domain-ui/core/ui/components/ui/dialog";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@domain-ui/core/ui/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { ContentAdaptiveRenderer } from "./blackboard/index";

interface BlackboardExplorerProps {
    data: any;
    /** Durable mission context (Mission Variables) - editable when missionId provided */
    missionContext?: Record<string, unknown>;
    /** Mission ID for editing mission variables via PUT /api/missions/:id */
    missionId?: number | null;
    /** Mission team/group ID for cache invalidation (legacy name was missionId) */
    missionTeamId?: number;
    level?: number;
}

const ValueIcon = ({ value }: { value: any }) => {
    if (Array.isArray(value)) return <Braces className="w-3 h-3 text-blue-400" />;
    if (value === null) return <Hash className="w-3 h-3 text-muted-foreground" />;

    switch (typeof value) {
        case "object": return <Package className="w-3 h-3 text-purple-400" />;
        case "number": return <Hash className="w-3 h-3 text-green-400" />;
        case "string": return <Type className="w-3 h-3 text-amber-400" />;
        default: return <FileJson className="w-3 h-3 text-muted-foreground" />;
    }
};

const MAX_DEPTH = 6;

const BlackboardItem = ({ 
    label, 
    displayLabel,
    value: initialValue, 
    level = 0, 
    missionId 
}: { 
    label: string; 
    displayLabel?: string;
    value: any; 
    level?: number;
    missionId?: number | null;
}) => {
    const [isOpen, setIsOpen] = useState(level < 2); // Collapse deeper nodes by default
    const [value, setValue] = useState(initialValue);
    const [isLoading, setIsLoading] = useState(false);
    const { toast } = useToast();

    // Re-sync if initialValue changes (e.g. from a poll)
    useEffect(() => {
        setValue(initialValue);
    }, [initialValue]);

    const isObject = value !== null && typeof value === "object" && !Array.isArray(value);
    const isArray = Array.isArray(value);
    const hasChildren = isObject || isArray;
    const isTruncated = typeof value === 'string' && value.startsWith('[TRUNCATED:');

    if (level > MAX_DEPTH) {
        return (
            <div className="ml-4 border-l border-border pl-2 py-1 text-[10px] text-muted-foreground italic">
                Max depth reached ({MAX_DEPTH})
            </div>
        );
    }

    const toggle = () => setIsOpen(!isOpen);

    const handleLoadFull = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!missionId) return;
        
        setIsLoading(true);
        try {
            const res = await apiRequest("GET", `/api/missions/${missionId}/blackboard/${label}`);
            if (!res.ok) throw new Error("Failed to fetch full content");
            const data = await res.json();
            setValue(data.value);
            toast({ title: "Full content loaded" });
        } catch (err: any) {
            toast({ title: "Load failed", description: err.message, variant: "destructive" });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className={cn("flex flex-col", level > 0 && "ml-4 border-l border-border pl-2")}>
            <div
                className={cn(
                    "group flex items-center gap-2 py-1 px-2 rounded hover:bg-muted transition-colors cursor-default",
                    hasChildren && "cursor-pointer"
                )}
                onClick={hasChildren ? toggle : undefined}
            >
                {hasChildren ? (
                    isOpen ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />
                ) : (
                    <div className="w-3" />
                )}

                <ValueIcon value={value} />

                <span className="text-xs font-mono font-bold text-foreground/80">
                    {displayLabel || label}:
                </span>

                {!hasChildren && (
                    <div className="flex items-center gap-2 overflow-hidden">
                        <span className={cn(
                            "text-xs font-mono truncate max-w-[400px]",
                            typeof value === "string" ? "text-amber-700 dark:text-amber-300/80" : "text-green-400/80",
                            isTruncated && "text-muted-foreground italic"
                        )}>
                            {JSON.stringify(value)}
                        </span>
                        {isTruncated && (
                            <Button 
                                variant="outline" 
                                size="sm" 
                                className="h-5 px-2 text-[9px] uppercase font-black tracking-tighter border-primary/30 hover:bg-primary/10"
                                onClick={handleLoadFull}
                                disabled={isLoading}
                            >
                                {isLoading ? "Loading..." : "Load Full"}
                            </Button>
                        )}
                    </div>
                )}

                {isArray && !isOpen && (
                    <Badge variant="outline" className="h-4 text-[9px] px-1 border-border/50 text-muted-foreground">
                        Array[{value.length}]
                    </Badge>
                )}
            </div>

            {hasChildren && isOpen && (
                <div className="mt-0.5">
                    {Object.entries(value).map(([k, v]) => (
                        <BlackboardItem key={k} label={k} value={v} level={level + 1} missionId={missionId} />
                    ))}
                </div>
            )}
        </div>
    );
};

const DeliverableCard = ({ value }: { value: string }) => (
    <div className="relative group overflow-hidden rounded-xl border border-primary/30 bg-card p-5 shadow-2xl shadow-primary/5">
        <div className="absolute top-0 right-0 p-3 opacity-20 transition-opacity group-hover:opacity-40">
            <Sparkles className="w-12 h-12 text-primary" />
        </div>
        <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-primary/20 border border-primary/30">
                <FileText className="w-5 h-5 text-primary" />
            </div>
            <div>
                <h3 className="text-sm font-bold uppercase tracking-widest text-primary">Primary Deliverable</h3>
                <p className="text-[10px] text-muted-foreground uppercase font-medium">Mission Artifact Detected</p>
            </div>
        </div>
        <div className="prose prose-sm dark:prose-invert max-w-none">
            <div className="text-sm leading-relaxed text-foreground/90 bg-card p-4 rounded-lg border border-border/50 font-sans">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {formatDeliverable(value) || ""}
                </ReactMarkdown>
            </div>
        </div>
    </div>
);

const CommunicationFeed = ({ messages }: { messages: any[] }) => (
    <div className="space-y-4">
        <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-blue-400" />
                <span className="text-xs font-bold uppercase tracking-widest text-blue-400">Communication Log</span>
            </div>
            <Badge variant="outline" className="text-[9px] h-4 border-blue-400/30 text-blue-400">
                {messages.length} Units
            </Badge>
        </div>
        <div className="space-y-3 max-h-[400px] overflow-y-auto px-1 scrollbar-thin scrollbar-thumb-muted-foreground/20">
            {messages.map((msg, i) => {
                const isAssistant = msg.role === 'assistant';
                const Icon = isAssistant ? Bot : User;
                
                return (
                    <div key={msg.id || i} className={cn(
                        "flex gap-3 p-3 rounded-lg border transition-colors",
                        isAssistant ? "bg-blue-500/5 border-blue-500/20" : "bg-primary/5 border-primary/20"
                    )}>
                        <div className={cn(
                            "flex-shrink-0 w-8 h-8 rounded-full border flex items-center justify-center",
                            isAssistant ? "bg-blue-500/10 border-blue-500/20 text-blue-400" : "bg-card border-primary/30 text-primary"
                        )}>
                            <Icon className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0 space-y-1">
                            <div className="flex items-center justify-between">
                                <span className={cn(
                                    "text-[10px] font-bold uppercase tracking-wider",
                                    isAssistant ? "text-blue-400" : "text-primary"
                                )}>
                                    {msg.sender || (isAssistant ? "Agent" : "User")}
                                </span>
                                {msg.timestamp && (
                                    <span className="text-[9px] text-muted-foreground flex items-center gap-1">
                                        <Clock className="w-2 h-2" />
                                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                )}
                            </div>
                            <p className="text-xs text-foreground/90 leading-normal whitespace-pre-wrap italic">
                                "{msg.content}"
                            </p>
                        </div>
                    </div>
                );
            })}
        </div>
    </div>
);

export function BlackboardExplorer({ data, missionContext, missionId, missionTeamId }: BlackboardExplorerProps) {
    const { toast } = useToast();
    const [editJson, setEditJson] = useState("");
    const [isSystemOpen, setIsSystemOpen] = useState(false);
    
    const missionVars = missionContext ?? {};
    const ctxMaxSteps = (missionVars.maxSteps as number | undefined) ?? 100;
    const [maxSteps, setMaxSteps] = useState<number | "">(ctxMaxSteps);

    useEffect(() => {
        setMaxSteps(ctxMaxSteps);
    }, [ctxMaxSteps]);

    const blackboard = data && typeof data === "object" ? data as Record<string, any> : {};
    
    // Extraction filters
    const result = blackboard.result || blackboard.high_value_deliverable;
    const messages = Array.isArray(blackboard.messages) ? blackboard.messages : null;
    const sharedMemories = Array.isArray(blackboard.sharedMemories) ? blackboard.sharedMemories : [];
    
    const stepOutputs = Object.fromEntries(
        Object.entries(blackboard).filter(([k]) => k.startsWith("step_"))
    );
    
    const toolOutputs = Object.fromEntries(
        Object.entries(blackboard).filter(([k]) => k.startsWith("tool_output_"))
    );
    
    const technicalKeys = ["maxSteps", "mission_id", "mission_team_id", "pipeline_id", "run_id", "status"];
    const otherKeys = Object.fromEntries(
        Object.entries({ ...missionVars, ...blackboard }).filter(([k]) => {
            if (k === "result" || k === "high_value_deliverable" || k === "messages" || k === "sharedMemories") return false;
            if (k.startsWith("step_") || k.startsWith("tool_output_")) return false;
            return true;
        })
    );

    const hasContent = result || messages || sharedMemories.length > 0 || Object.keys(toolOutputs).length > 0;
    const hasTechnical = Object.keys(otherKeys).length > 0 || Object.keys(stepOutputs).length > 0;

    const handleSaveEdit = async () => {
        if (!missionId) return;
        try {
            const parsed = JSON.parse(editJson) as Record<string, unknown>;
            await apiRequest("PUT", `/api/missions/${missionId}`, { missionContext: parsed });
            queryClient.invalidateQueries({ queryKey: [`/api/missions?missionId=${missionTeamId}`] });
            queryClient.invalidateQueries({ queryKey: [`/api/missions/${missionId}`] });
            toast({ title: "Mission variables updated" });
        } catch (err: any) {
            toast({ title: "Failed to update", description: err.message, variant: "destructive" });
        }
    };

    const handleSaveMaxSteps = async () => {
        if (!missionId || maxSteps === "" || maxSteps < 50) return;
        try {
            const next = { ...otherKeys, ...missionVars, maxSteps: Number(maxSteps) };
            await apiRequest("PUT", `/api/missions/${missionId}`, { missionContext: next });
            queryClient.invalidateQueries({ queryKey: [`/api/missions?missionId=${missionTeamId}`] });
            queryClient.invalidateQueries({ queryKey: [`/api/missions/${missionId}`] });
            toast({ title: "Max loops updated", description: `Supervisor will use up to ${maxSteps} iterations.` });
        } catch (err: any) {
            toast({ title: "Failed to update", description: err.message, variant: "destructive" });
        }
    };

    if (!hasContent && !hasTechnical && !missionId) {
        return (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground italic text-center">
                <div className="relative mb-4">
                    <Package className="w-12 h-12 opacity-5 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                    <Brain className="w-8 h-8 opacity-10 animate-pulse" />
                </div>
                <p className="text-sm font-medium">Mission Blackboard Offline</p>
                <p className="text-[10px] uppercase tracking-widest mt-2 opacity-50">Syncing with Unified Intelligence...</p>
            </div>
        );
    }

    return (
        <div className="cinematic-container space-y-6 max-h-[700px] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-muted-foreground/20">
            {/* Primary Result Section */}
            {result && (
                <ContentAdaptiveRenderer
                    label={blackboard.result !== undefined ? "result" : "high_value_deliverable"}
                    value={result}
                    missionId={missionId}
                    forceType="markdown_document"
                />
            )}

            {/* Communication Feed */}
            {messages && messages.length > 0 && (
                <CommunicationFeed messages={messages} />
            )}

            {/* Shared Memories */}
            {sharedMemories.length > 0 && (
                <div className="space-y-3">
                    <div className="flex items-center gap-2">
                        <Brain className="w-4 h-4 text-primary" />
                        <span className="text-xs font-bold uppercase tracking-widest text-primary">
                            Collective Observations
                        </span>
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                        {[...sharedMemories].reverse().slice(0, 5).map((m, i) => (
                            <div
                                key={i}
                                className="p-3 rounded-lg bg-card border border-border/50 text-left hover:border-primary/30 transition-colors"
                            >
                                <div className="flex items-center justify-between mb-1">
                                    <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-primary/30 text-primary">
                                        {m.source || "Sensor"}
                                    </Badge>
                                    <span className="text-[9px] text-muted-foreground uppercase font-mono">
                                        {m.timestamp ? new Date(m.timestamp).toLocaleTimeString() : ""}
                                    </span>
                                </div>
                                <p className="text-xs text-foreground/80 leading-snug">{m.observation || "(empty signal)"}</p>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Tool Outputs (Dynamic Orchestrator) */}
            {Object.keys(toolOutputs).length > 0 && (
                <div className="space-y-4">
                    <div className="flex items-center gap-2">
                        <Terminal className="w-4 h-4 text-emerald-400" />
                        <span className="text-xs font-bold uppercase tracking-widest text-emerald-400">
                            Capability Outputs
                        </span>
                    </div>
                    <div className="space-y-3">
                        {Object.entries(toolOutputs).reverse().map(([k, v]) => {
                            const name = k.replace(/^tool_output_/, '').replace(/_\d+$/, '');
                            const timestamp = k.split('_').pop();
                            const isNumericTimestamp = timestamp && /^\d+$/.test(timestamp);
                            
                            return (
                                <div key={k} className="p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/20 shadow-sm transition-all hover:bg-emerald-500/10">
                                    <div className="flex items-center justify-between mb-3 pb-2 border-b border-emerald-500/10">
                                        <Badge variant="outline" className="text-[10px] h-5 px-2 border-emerald-500/30 text-emerald-400 uppercase font-black tracking-tighter">
                                            {name}
                                        </Badge>
                                        <span className="text-[9px] text-muted-foreground font-mono flex items-center gap-1">
                                            <Clock className="w-2.5 h-2.5" />
                                            {isNumericTimestamp ? new Date(parseInt(timestamp)).toLocaleTimeString() : ""}
                                        </span>
                                    </div>
                                    <div className="max-h-[300px] overflow-y-auto scrollbar-thin scrollbar-thumb-emerald-500/20 rounded-lg">
                                        <ContentAdaptiveRenderer label={k} displayLabel="result" value={v} missionId={missionId} />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Mission Controls */}
            {missionId && (
                <div className="flex items-center justify-between gap-4 p-3 rounded-lg bg-card border border-border shadow-inner">
                    <div className="flex items-center gap-2">
                        <Terminal className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/80">Loop Threshold</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <Input
                            id="maxSteps"
                            type="number"
                            min={50}
                            max={500}
                            className="h-7 w-16 text-xs font-mono bg-background border-border focus-visible:ring-primary/50"
                            value={maxSteps}
                            onChange={(e) => setMaxSteps(e.target.value === "" ? "" : Math.max(10, parseInt(e.target.value, 10) || 10))}
                        />
                        <Button size="sm" variant="outline" className="h-7 px-3 text-[10px] uppercase font-bold tracking-tighter hover:bg-card border-border" onClick={handleSaveMaxSteps} disabled={maxSteps === "" || maxSteps < 10}>
                            Update
                        </Button>
                    </div>
                </div>
            )}

            {/* Technical Explorer (Collapsible) */}
            <Collapsible open={isSystemOpen} onOpenChange={setIsSystemOpen} className="space-y-2">
                <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="w-full flex items-center justify-between h-8 px-2 hover:bg-accent hover:text-accent-foreground group">
                        <div className="flex items-center gap-2">
                            <FileJson className="w-4 h-4 text-muted-foreground group-hover:text-amber-400 transition-colors" />
                            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground group-hover:text-foreground">System State</span>
                        </div>
                        {isSystemOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-4 pt-2">
                    <div className="p-4 rounded-lg bg-card border border-border backdrop-blur-sm">
                        <div className="flex items-center justify-between mb-4">
                            <span className="text-[10px] font-medium uppercase text-muted-foreground font-mono">technical.context.v1</span>
                            {missionId && (
                                <Dialog onOpenChange={(open) => open && setEditJson(JSON.stringify({ ...missionVars, ...otherKeys }, null, 2))}>
                                    <DialogTrigger asChild>
                                        <Button size="sm" variant="ghost" className="h-6 px-2 text-muted-foreground hover:text-primary">
                                            <Pencil className="w-3 h-3 mr-2" />
                                            <span className="text-[9px] uppercase font-bold tracking-widest">Edit</span>
                                        </Button>
                                    </DialogTrigger>
                                    <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col bg-background border-border">
                                        <DialogHeader>
                                            <DialogTitle className="text-primary tracking-tight">Manual Context Override</DialogTitle>
                                            <DialogDescription className="text-muted-foreground text-xs">
                                                Advanced bypass: Directly modify the mission blackboard state. Use with caution.
                                            </DialogDescription>
                                        </DialogHeader>
                                        <textarea
                                            className="flex-1 min-h-[350px] font-mono text-xs p-4 rounded-lg bg-card border border-border text-primary/90 resize-none focus:outline-none focus:border-primary/50 scrollbar-thin scrollbar-thumb-zinc-800"
                                            title="Edit Mission Variables JSON"
                                            value={editJson}
                                            onChange={(e) => setEditJson(e.target.value)}
                                            spellCheck={false}
                                        />
                                        <DialogFooter className="pt-4 border-t border-border">
                                            <Button onClick={handleSaveEdit} className="bg-primary text-primary-foreground hover:bg-primary/80">Commit Changes</Button>
                                        </DialogFooter>
                                    </DialogContent>
                                </Dialog>
                            )}
                        </div>
                        
                        <div className="space-y-4">
                            {Object.keys(otherKeys).length > 0 && (
                                <div className="space-y-2">
                                    <span className="text-[9px] font-bold uppercase tracking-widest text-amber-400 opacity-80">Variables</span>
                                    {Object.entries(otherKeys).map(([k, v]) => (
                                        <ContentAdaptiveRenderer key={k} label={k} value={v} missionId={missionId} />
                                    ))}
                                </div>
                            )}
                            
                            {Object.keys(stepOutputs).length > 0 && (
                                <div className="space-y-2">
                                    <span className="text-[9px] font-bold uppercase tracking-widest text-blue-400 opacity-80">Step Cache</span>
                                    {Object.entries(stepOutputs).map(([k, v]) => (
                                        <BlackboardItem key={k} label={k} value={v} missionId={missionId} />
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </CollapsibleContent>
            </Collapsible>
        </div>
    );
}

