import React from "react";
import { Hash, Type } from "lucide-react";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import type { RendererProps } from "../registry";

function statusClass(v: unknown): string {
    if (typeof v === "boolean") return v ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/5" : "border-red-500/30 text-red-400 bg-red-500/5";
    if (typeof v === "string") {
        const l = v.toLowerCase();
        if (/success|completed|done|passed|active|healthy/.test(l)) return "border-emerald-500/30 text-emerald-400";
        if (/fail|error|critical|rejected/.test(l)) return "border-red-500/30 text-red-400";
        if (/pending|waiting|running|progress|paused/.test(l)) return "border-amber-500/30 text-amber-400";
    }
    return "border-border/50 text-muted-foreground";
}

export function StatusScalarRenderer({ label, displayLabel, value }: RendererProps) {
    const display = value === null || value === undefined ? "null" : String(value);
    const isNumber = typeof value === "number";

    return (
        <div className="flex items-center gap-2 py-1 px-2">
            <div className="w-3 shrink-0">
                {isNumber
                    ? <Hash className="w-2.5 h-2.5 text-green-400/60" />
                    : <Type className="w-2.5 h-2.5 text-amber-400/60" />}
            </div>
            <span className="text-[10px] font-mono font-bold text-foreground/60 shrink-0">{displayLabel || label}:</span>
            {isNumber ? (
                <span className="text-[10px] font-mono font-bold text-green-400">{display}</span>
            ) : (
                <Badge variant="outline" className={`text-[9px] h-4 px-1.5 font-mono ${statusClass(value)}`}>
                    {display}
                </Badge>
            )}
        </div>
    );
}
