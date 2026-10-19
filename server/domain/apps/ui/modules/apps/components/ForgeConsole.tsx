import React, { useRef, useEffect } from 'react';
import { Terminal, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { ScrollArea } from '@domain-ui/core/ui/components/ui/scroll-area';
import { cn } from '@/lib/utils';

export interface ForgeLog {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
}

interface ForgeConsoleProps {
  logs: ForgeLog[];
  status: 'idle' | 'running' | 'completed' | 'failed';
}

export function ForgeConsole({ logs, status }: ForgeConsoleProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      const scrollContainer = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, [logs]);

  return (
    <div className="rounded-xl border border-foreground/10 bg-background overflow-hidden shadow-2xl flex flex-col h-[400px] relative">
      {status === 'running' && <div className="absolute inset-0 scanline-overlay z-20 opacity-30 px-px pointer-events-none" />}
      
      <div className="flex items-center justify-between px-4 py-2 border-b border-foreground/5 bg-foreground/5 relative z-30 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-primary" />
          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-primary/80">Forge Telemetry Console</span>
        </div>
        <div className="flex items-center gap-3">
          {status === 'running' && (
            <div className="flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin text-primary" />
              <span className="text-[9px] font-black text-primary uppercase tracking-widest">Active Assembler</span>
            </div>
          )}
          {status === 'completed' && (
             <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3 h-3 text-emerald-500" />
              <span className="text-[9px] font-black text-emerald-500 uppercase tracking-widest">Deployment Ready</span>
            </div>
          )}
          {status === 'failed' && (
             <div className="flex items-center gap-1.5">
              <AlertCircle className="w-3 h-3 text-destructive" />
              <span className="text-[9px] font-black text-destructive uppercase tracking-widest">Process Fault</span>
            </div>
          )}
          <div className="flex gap-1.5 ml-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500/50 shadow-[0_0_5px_rgba(16,185,129,0.5)]" />
            <div className="w-2 h-2 rounded-full bg-primary/50 shadow-[0_0_5px_rgba(var(--primary),0.5)]" />
          </div>
        </div>
      </div>
      
      <ScrollArea className="flex-1 p-4 font-mono text-[11px] relative z-10" ref={scrollRef}>
        <div className="space-y-1.5">
          {logs.length === 0 && (
            <div className="text-foreground/10 italic text-[10px] uppercase font-bold tracking-widest">Awaiting assembly ignition sequence...</div>
          )}
          {logs.map((log, i) => (
            <div key={i} className="flex gap-4 leading-relaxed group animate-in slide-in-from-left-2 duration-300">
              <span className="text-foreground/20 shrink-0 select-none font-black">[{log.timestamp}]</span>
              <span className={cn(
                "font-black shrink-0 uppercase text-[8px] tracking-widest px-1.5 py-0.5 rounded border flex items-center justify-center h-4 mt-0.5 min-w-[65px]",
                log.level === 'info' && "bg-primary/5 text-primary/80 border-primary/20",
                log.level === 'warn' && "bg-amber-500/5 text-amber-500/80 border-amber-500/20",
                log.level === 'error' && "bg-red-500/5 text-red-500/80 border-red-500/20",
                log.level === 'success' && "bg-emerald-500/5 text-emerald-500/80 border-emerald-500/20 shadow-[0_0_10px_rgba(16,185,129,0.1)]"
              )}>
                {log.level}
              </span>
              <span className={cn(
                "break-words whitespace-pre-wrap tracking-tight flex-1",
                log.level === 'error' ? "text-red-400 font-bold" : 
                log.level === 'success' ? "text-emerald-400 font-bold" : 
                "text-foreground"
              )}>
                {log.message}
              </span>
            </div>
          ))}
          {status === 'running' && (
            <div className="flex gap-4 animate-pulse">
              <span className="text-foreground/5 font-black">[--:--:--]</span>
              <div className="h-4 w-4 bg-primary/10 rounded mt-0.5" />
              <div className="h-4 w-32 bg-foreground/5 rounded mt-0.5" />
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
