import React from "react";
import type { RendererProps } from "../registry";

export function EmptyValueRenderer({ label, displayLabel }: RendererProps) {
    return (
        <div className="flex items-center gap-2 py-1 px-2 opacity-40">
            <div className="w-3" />
            <span className="text-[10px] font-mono font-bold text-foreground/50">{displayLabel || label}:</span>
            <span className="text-[10px] font-mono italic text-muted-foreground">(empty)</span>
        </div>
    );
}
