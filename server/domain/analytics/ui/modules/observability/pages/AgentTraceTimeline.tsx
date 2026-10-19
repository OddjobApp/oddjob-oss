import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@domain-ui/core/ui/components/ui/tabs";
import { Loader2, Brain, Wrench, ArrowRight, Clock, Hash, Smartphone, Terminal } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";

interface AgentSession {
    sessionId: string;
    lastActive: string;
    stepCount: number;
}

interface KnowledgeNode {
    id: number;
    label: string;
    data: {
        thought?: string;
        toolName?: string;
        toolInput?: any;
        toolOutput?: any;
        sessionId?: string;
        iteration?: number;
    };
    createdAt: string;
}

interface TraceData {
    nodes: KnowledgeNode[];
    edges: any[];
}

export function AgentTraceTimeline() {
    const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

    // Fetch Sessions
    const { data: sessions = [], isLoading: isLoadingSessions } = useQuery<AgentSession[]>({
        queryKey: ["/api/knowledge-graph/forensics/agent-sessions"],
        queryFn: async () => {
            const res = await apiRequest("GET", "/api/knowledge-graph/forensics/agent-sessions");
            return res.json();
        },
    });

    // Fetch Trace for selected session
    const { data: trace, isLoading: isLoadingTrace } = useQuery<TraceData>({
        queryKey: ["/api/knowledge-graph/forensics/trace", selectedSessionId],
        queryFn: async () => {
            if (!selectedSessionId) return { nodes: [], edges: [] };
            const res = await apiRequest("GET", `/api/knowledge-graph/forensics/trace/${selectedSessionId}`);
            return res.json();
        },
        enabled: !!selectedSessionId,
    });

    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 h-[calc(100vh-200px)]">
            {/* Session List */}
            <Card className="md:col-span-1 border-r-0 rounded-r-none h-full flex flex-col glass-panel shadow-xl">
                <CardHeader className="border-b bg-white/50 dark:bg-card/50">
                    <CardTitle className="text-lg font-bold flex items-center gap-2">
                        <Terminal className="w-5 h-5 text-primary" />
                        Agent Sessions
                    </CardTitle>
                    <CardDescription>Select a session to view its reasoning trace</CardDescription>
                </CardHeader>
                <CardContent className="flex-1 overflow-hidden p-0">
                    <ScrollArea className="h-full">
                        {isLoadingSessions ? (
                            <div className="flex justify-center p-8"><Loader2 className="animate-spin text-primary w-8 h-8 opacity-50" /></div>
                        ) : sessions.length === 0 ? (
                            <div className="text-center p-8 text-muted-foreground italic">No agent sessions found.</div>
                        ) : (
                            <div className="divide-y divide-white/10">
                                {sessions.map((session) => (
                                    <button
                                        key={session.sessionId}
                                        onClick={() => setSelectedSessionId(session.sessionId)}
                                        className={cn(
                                            "w-full text-left p-4 hover:bg-white/40 dark:hover:bg-muted/40 transition-all focus:bg-white/40 outline-none relative overflow-hidden group",
                                            selectedSessionId === session.sessionId ? "bg-white/60 dark:bg-muted/60" : ""
                                        )}
                                    >
                                        {selectedSessionId === session.sessionId && (
                                            <motion.div layoutId="active-session" className="absolute left-0 top-0 bottom-0 w-1 bg-primary" />
                                        )}
                                        <div className="flex justify-between items-start mb-1">
                                            <span className="font-semibold truncate block max-w-[180px] text-sm" title={session.sessionId}>
                                                {session.sessionId}
                                            </span>
                                            <Badge variant="secondary" className="text-[10px] font-bold tracking-tight px-1.5 h-4">
                                                {session.stepCount} STEPS
                                            </Badge>
                                        </div>
                                        <div className="flex items-center text-[10px] text-muted-foreground uppercase font-medium tracking-wider">
                                            <Clock className="w-3 h-3 mr-1" />
                                            {formatDistanceToNow(new Date(session.lastActive), { addSuffix: true })}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </ScrollArea>
                </CardContent>
            </Card>

            {/* Trace Timeline */}
            <Card className="md:col-span-2 border-l-0 rounded-l-none h-full flex flex-col glass-panel shadow-2xl">
                <CardHeader className="bg-white/70 dark:bg-card/70 border-b backdrop-blur-sm sticky top-0 z-20">
                    <CardTitle className="text-lg flex items-center font-bold tracking-tight">
                        {selectedSessionId ? (
                            <>
                                <Hash className="w-4 h-4 mr-2 text-primary opacity-50" />
                                <span className="opacity-50">TRACE:</span>
                                <span className="ml-2 font-mono text-base">{selectedSessionId}</span>
                            </>
                        ) : "Timeline View"}
                    </CardTitle>
                </CardHeader>
                <CardContent className="flex-1 overflow-hidden p-0 relative">
                    {!selectedSessionId ? (
                        <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
                            <Smartphone className="w-12 h-12 mb-4 opacity-20" />
                            <p>Select a session to view timeline</p>
                        </div>
                    ) : isLoadingTrace ? (
                        <div className="h-full flex items-center justify-center">
                            <Loader2 className="animate-spin w-8 h-8 text-muted-foreground" />
                        </div>
                    ) : (
                        <ScrollArea className="h-full p-6 bg-muted/30 dark:bg-card/30">
                            <AnimatePresence mode="popLayout">
                                <div className="relative border-l-2 border-white/20 dark:border-white/5 ml-4 space-y-12 pl-8 pb-20">
                                    {trace?.nodes.map((node, idx) => {
                                        const isThought = !!node.data.thought;
                                        const isTool = !!node.data.toolName;

                                        return (
                                            <motion.div
                                                key={node.id}
                                                initial={{ opacity: 0, x: -20 }}
                                                animate={{ opacity: 1, x: 0 }}
                                                transition={{ delay: idx * 0.05 }}
                                                className="relative group"
                                            >
                                                {/* Timeline Dot */}
                                                <div className={cn(
                                                    "absolute -left-[41px] top-4 w-6 h-6 rounded-full border-4 border-white dark:border-slate-900 shadow-lg flex items-center justify-center z-10 transition-transform group-hover:scale-110",
                                                    isThought ? "bg-amber-400 neon-glow-amber" : "bg-blue-500 neon-glow-blue"
                                                )}>
                                                    {isThought && <Brain className="w-3 h-3 text-foreground" />}
                                                    {isTool && <Wrench className="w-3 h-3 text-foreground" />}
                                                </div>

                                                {/* Card */}
                                                <div className="glass-panel rounded-xl shadow-xl overflow-hidden hover:shadow-2xl transition-all border-white/30 dark:border-white/10 group-hover:translate-x-1">
                                                    <div className="flex justify-between items-center px-4 py-2 bg-white/40 dark:bg-muted/40 border-b border-white/20 dark:border-white/5">
                                                        <Badge variant={isThought ? "secondary" : "default"} className={cn(
                                                            "text-[10px] font-black tracking-widest px-2 py-0.5",
                                                            isThought && "bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/30",
                                                            isTool && "bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-500/30"
                                                        )}>
                                                            {isThought ? "THOUGHT" : "TOOL USE"}
                                                        </Badge>
                                                        <span className="text-[10px] font-mono text-muted-foreground font-bold uppercase tracking-widest tabular-nums italic">
                                                            {new Date(node.createdAt).toLocaleTimeString()}
                                                        </span>
                                                    </div>

                                                    <div className="p-4 space-y-4">
                                                        {isThought && (
                                                            <div className="relative">
                                                                <div className="absolute -left-2 top-0 bottom-0 w-1 bg-amber-400/30 rounded-full" />
                                                                <p className="text-foreground/80 dark:text-foreground/70 leading-relaxed font-serif text-base italic pl-4">
                                                                    {node.data.thought}
                                                                </p>
                                                            </div>
                                                        )}

                                                        {isTool && (
                                                            <div className="space-y-4">
                                                                <div className="flex items-center gap-2">
                                                                    <span className="font-mono text-xs font-black bg-primary/10 text-primary px-3 py-1 rounded-full border border-primary/20 shadow-sm flex items-center gap-2">
                                                                        <Hash className="w-3 h-3" />
                                                                        {node.data.toolName}
                                                                    </span>
                                                                </div>

                                                                {/* Tool Input */}
                                                                {node.data.toolInput && (
                                                                    <div className="rounded-lg overflow-hidden border border-white/10 shadow-inner bg-card/5">
                                                                        <div className="bg-muted/10 px-3 py-1 flex justify-between items-center border-b border-white/5">
                                                                            <span className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">Input Parameters</span>
                                                                        </div>
                                                                        <div className="max-h-60 overflow-auto">
                                                                            <SyntaxHighlighter
                                                                                language="json"
                                                                                style={vscDarkPlus}
                                                                                customStyle={{ margin: 0, padding: '1rem', background: 'transparent', fontSize: '11px' }}
                                                                            >
                                                                                {JSON.stringify(node.data.toolInput, null, 2)}
                                                                            </SyntaxHighlighter>
                                                                        </div>
                                                                    </div>
                                                                )}

                                                                {/* Tool Output */}
                                                                {node.data.toolOutput && (
                                                                    <div className="rounded-lg overflow-hidden border border-white/20 dark:border-white/5 shadow-2xl bg-card">
                                                                        <div className="bg-foreground/5 px-3 py-1 flex justify-between items-center border-b border-white/5">
                                                                            <span className="text-[9px] font-black text-blue-400 uppercase tracking-widest">Execution Output</span>
                                                                            <div className="flex gap-1">
                                                                                <div className="w-2 h-2 rounded-full bg-red-500/50" />
                                                                                <div className="w-2 h-2 rounded-full bg-amber-500/50" />
                                                                                <div className="w-2 h-2 rounded-full bg-green-500/50" />
                                                                            </div>
                                                                        </div>
                                                                        <div className="max-h-80 overflow-auto">
                                                                            <SyntaxHighlighter
                                                                                language="json"
                                                                                style={vscDarkPlus}
                                                                                customStyle={{ margin: 0, padding: '1rem', background: 'transparent', fontSize: '11px' }}
                                                                            >
                                                                                {typeof node.data.toolOutput === 'string'
                                                                                    ? node.data.toolOutput
                                                                                    : JSON.stringify(node.data.toolOutput, null, 2)}
                                                                            </SyntaxHighlighter>
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </motion.div>
                                        );
                                    })}

                                    {trace?.nodes.length === 0 && (
                                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-muted-foreground italic p-12 text-center text-sm">
                                            No trace events recorded for this session.
                                        </motion.div>
                                    )}
                                </div>
                            </AnimatePresence>
                        </ScrollArea>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
