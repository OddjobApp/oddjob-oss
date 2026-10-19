/**
 * Thin wrapper that maps RendererProps to the original BlackboardItem interface.
 * Used as the json_tree fallback — zero regression risk.
 */
import React, { useState, useEffect } from "react";
import {
    ChevronRight, ChevronDown, Package, FileJson, Hash, Type, Braces,
} from "lucide-react";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import type { RendererProps } from "../registry";

const ValueIcon = ({ value }: { value: unknown }) => {
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

function BlackboardItemInner({
    label, displayLabel, value: initialValue, level = 0, missionId,
}: {
    label: string; displayLabel?: string; value: unknown; level?: number; missionId?: number | null;
}) {
    const [isOpen, setIsOpen] = useState(level < 2);
    const [value, setValue] = useState(initialValue);
    const [isLoading, setIsLoading] = useState(false);
    const { toast } = useToast();

    useEffect(() => { setValue(initialValue); }, [initialValue]);

    const isObject = value !== null && typeof value === "object" && !Array.isArray(value);
    const isArray = Array.isArray(value);
    const hasChildren = isObject || isArray;
    const isTruncated = typeof value === "string" && value.startsWith("[TRUNCATED:");

    if (level > MAX_DEPTH) {
        return <div className="ml-4 border-l border-border pl-2 py-1 text-[10px] text-muted-foreground italic">Max depth reached</div>;
    }

    const handleLoadFull = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!missionId) return;
        setIsLoading(true);
        try {
            const res = await apiRequest("GET", `/api/missions/${missionId}/blackboard/${label}`);
            if (!res.ok) throw new Error("Failed to fetch");
            const data = await res.json();
            setValue(data.value);
            toast({ title: "Full content loaded" });
        } catch (err: any) {
            toast({ title: "Load failed", description: err.message, variant: "destructive" });
        } finally { setIsLoading(false); }
    };

    return (
        <div className={cn("flex flex-col", level > 0 && "ml-4 border-l border-border pl-2")}>
            <div
                className={cn("group flex items-center gap-2 py-1 px-2 rounded hover:bg-muted transition-colors cursor-default", hasChildren && "cursor-pointer")}
                onClick={hasChildren ? () => setIsOpen(o => !o) : undefined}
            >
                {hasChildren ? (
                    isOpen ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />
                ) : <div className="w-3" />}
                <ValueIcon value={value} />
                <span className="text-xs font-mono font-bold text-foreground/80">{displayLabel || label}:</span>
                {!hasChildren && (
                    <div className="flex items-center gap-2 overflow-hidden">
                        <span className={cn("text-xs font-mono truncate max-w-[400px]", typeof value === "string" ? "text-amber-300/80" : "text-green-400/80", isTruncated && "text-muted-foreground italic")}>
                            {JSON.stringify(value)}
                        </span>
                        {isTruncated && (
                            <Button variant="outline" size="sm" className="h-5 px-2 text-[9px] uppercase font-black tracking-tighter border-primary/30 hover:bg-primary/10" onClick={handleLoadFull} disabled={isLoading}>
                                {isLoading ? "Loading…" : "Load Full"}
                            </Button>
                        )}
                    </div>
                )}
                {isArray && !isOpen && (
                    <Badge variant="outline" className="h-4 text-[9px] px-1 border-border/50 text-muted-foreground">
                        Array[{(value as unknown[]).length}]
                    </Badge>
                )}
            </div>
            {hasChildren && isOpen && (
                <div className="mt-0.5">
                    {Object.entries(value as object).map(([k, v]) => (
                        <BlackboardItemInner key={k} label={k} value={v} level={level + 1} missionId={missionId} />
                    ))}
                </div>
            )}
        </div>
    );
}

export function BlackboardItemFallback({ label, displayLabel, value, missionId, onLoadFull }: RendererProps) {
    return <BlackboardItemInner label={label} displayLabel={displayLabel} value={value} level={0} missionId={missionId} />;
}
