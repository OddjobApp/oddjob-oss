import React from "react";
import { Braces, Hash, Type } from "lucide-react";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import type { RendererProps } from "../registry";

function ValuePill({ v }: { v: unknown }) {
    if (v === null || v === undefined) {
        return <span className="text-[10px] font-mono text-muted-foreground/50 italic">null</span>;
    }
    if (typeof v === "boolean") {
        return (
            <span className={`text-[10px] font-mono font-bold ${v ? "text-emerald-400" : "text-red-400"}`}>
                {String(v)}
            </span>
        );
    }
    if (typeof v === "number") {
        return <span className="text-[10px] font-mono text-green-400">{v}</span>;
    }
    if (typeof v === "string" && v.length < 80) {
        const isStatus = /^(success|failed|error|pending|active|completed|running|paused)$/i.test(v);
        if (isStatus) {
            const color = /success|completed|active/.test(v.toLowerCase()) ? "border-emerald-500/30 text-emerald-400"
                : /failed|error/.test(v.toLowerCase()) ? "border-red-500/30 text-red-400"
                : "border-amber-500/30 text-amber-400";
            return <Badge variant="outline" className={`text-[9px] h-4 px-1.5 ${color}`}>{v}</Badge>;
        }
        return <span className="text-[10px] font-mono text-amber-300/80">{JSON.stringify(v)}</span>;
    }
    // Nested object — inline summary
    return (
        <span className="text-[10px] font-mono text-purple-400/70">
            {`{${Object.keys(v as object).slice(0, 3).join(", ")}${Object.keys(v as object).length > 3 ? "…" : ""}}`}
        </span>
    );
}

export function KeyValueMapRenderer({ label, displayLabel, value }: RendererProps) {
    const entries = Object.entries(value as Record<string, unknown>);

    return (
        <div className="space-y-1.5">
            <div className="flex items-center gap-2">
                <Braces className="w-3.5 h-3.5 text-purple-400" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-purple-400">
                    {displayLabel || label}
                </span>
                <Badge variant="outline" className="text-[9px] h-4 border-purple-400/30 text-purple-400/70">
                    {entries.length} key{entries.length !== 1 ? "s" : ""}
                </Badge>
            </div>
            <div className="grid grid-cols-1 gap-0.5 max-h-[300px] overflow-y-auto scrollbar-thin scrollbar-thumb-purple-500/20">
                {entries.map(([k, v]) => (
                    <div key={k} className="flex items-center gap-2 py-1 px-2 rounded hover:bg-muted/30 transition-colors group">
                        <div className="w-3 shrink-0">
                            {typeof v === "number" ? <Hash className="w-2.5 h-2.5 text-green-400/60" />
                                : typeof v === "string" ? <Type className="w-2.5 h-2.5 text-amber-400/60" />
                                : <Braces className="w-2.5 h-2.5 text-purple-400/60" />}
                        </div>
                        <span className="text-[10px] font-mono font-bold text-foreground/60 shrink-0 w-32 truncate" title={k}>{k}</span>
                        <ValuePill v={v} />
                    </div>
                ))}
            </div>
        </div>
    );
}
