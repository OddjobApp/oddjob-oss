import React, { useState } from "react";
import { AlertTriangle, ChevronRight, ChevronDown } from "lucide-react";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import type { RendererProps } from "../registry";

export function ErrorObjectRenderer({ label, displayLabel, value }: RendererProps) {
    const [stackOpen, setStackOpen] = useState(false);
    const err = value as Record<string, unknown>;
    const message = String(err.message ?? "Unknown error");
    const stack = typeof err.stack === "string" ? err.stack : null;
    const code = err.code != null ? String(err.code) : null;
    const name = typeof err.name === "string" ? err.name : "Error";

    return (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-red-500/20">
                <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-red-400 flex-1">
                    {displayLabel || label}
                </span>
                <Badge variant="outline" className="text-[9px] h-4 border-red-500/30 text-red-400">{name}</Badge>
                {code && (
                    <Badge variant="outline" className="text-[9px] h-4 border-red-500/20 text-red-700 dark:text-red-300/70 font-mono">{code}</Badge>
                )}
            </div>
            <div className="p-3 space-y-2">
                <p className="text-xs font-mono text-red-700 dark:text-red-200/90 leading-relaxed">{message}</p>
                {stack && (
                    <div>
                        <button
                            className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-muted-foreground hover:text-red-400 transition-colors"
                            onClick={() => setStackOpen(o => !o)}
                        >
                            {stackOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                            Stack trace
                        </button>
                        {stackOpen && (
                            <pre className="mt-1.5 text-[9px] font-mono text-muted-foreground whitespace-pre-wrap break-all max-h-[200px] overflow-auto scrollbar-thin scrollbar-thumb-red-500/20 p-2 rounded bg-background/40 border border-border/30">
                                {stack}
                            </pre>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
