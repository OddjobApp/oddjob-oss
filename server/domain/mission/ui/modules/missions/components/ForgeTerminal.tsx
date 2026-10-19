
import { Card, CardContent, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Terminal, Copy, Trash2, Maximize2, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { useEffect, useRef } from "react";

interface ForgeLog {
    timestamp: string;
    type: "stdout" | "stderr" | "system" | "error";
    content: string;
}

interface ForgeTerminalProps {
    logs: ForgeLog[];
    onClear?: () => void;
}

export function ForgeTerminal({ logs, onClear }: ForgeTerminalProps) {
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [logs]);

    return (
        <Card className="bg-background border-foreground/10 h-full flex flex-col font-mono text-[13px] overflow-hidden shadow-2xl">
            <CardHeader className="py-2 px-4 border-b border-foreground/5 bg-foreground/5 flex flex-row items-center justify-between">
                <div className="flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-emerald-500" />
                    <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
                        Forge Build Output
                    </CardTitle>
                </div>
                <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground" onClick={onClear}>
                        <Trash2 className="w-3 h-3" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground">
                        <Maximize2 className="w-3 h-3" />
                    </Button>
                </div>
            </CardHeader>
            <CardContent 
                ref={scrollRef}
                className="flex-1 p-4 overflow-y-auto space-y-1 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent"
            >
                {logs.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full text-foreground/20 select-none">
                        <Terminal className="w-12 h-12 mb-4 opacity-5" />
                        <p className="uppercase tracking-[0.2em] text-[10px] font-black">Waiting for co-pilot signals...</p>
                    </div>
                )}
                {logs.map((log, idx) => {
                    const isError = log.type === 'stderr' || log.type === 'error';
                    const isSystem = log.type === 'system';
                    
                    return (
                        <div key={idx} className="flex gap-3 leading-relaxed group">
                            <span className="text-foreground/20 shrink-0 select-none">
                                {new Date(log.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </span>
                            <div className="flex-1 break-all">
                                {isSystem ? (
                                    <span className="text-blue-400 font-bold">
                                        [FORGE] {log.content}
                                    </span>
                                ) : isError ? (
                                    <span className="text-red-400">
                                        <AlertCircle className="w-3 h-3 inline mr-1 mb-0.5" />
                                        {log.content}
                                    </span>
                                ) : (
                                    <span className="text-foreground/90">
                                        {log.content}
                                    </span>
                                )}
                            </div>
                        </div>
                    );
                })}
                <div className="h-4" /> {/* Bottom padding */}
            </CardContent>
            <div className="px-4 py-1 border-t border-foreground/5 bg-foreground/5 flex items-center justify-between text-[9px] uppercase tracking-tighter text-foreground/30 font-bold">
                <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Interactive Shield-Shell Active
                </div>
                <div>
                    Build Stack: Node20-Slim / Next.js
                </div>
            </div>
        </Card>
    );
}
