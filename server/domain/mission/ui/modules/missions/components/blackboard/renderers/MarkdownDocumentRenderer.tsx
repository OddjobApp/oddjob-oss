import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FileText, Copy, Check, Loader2 } from "lucide-react";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import type { RendererProps } from "../registry";

export function MarkdownDocumentRenderer({ label, displayLabel, value, missionId, onLoadFull, isLoadingFull }: RendererProps) {
    const [copied, setCopied] = useState(false);
    const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    const isTruncated = text.startsWith("[TRUNCATED:");

    const handleCopy = () => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    return (
        <div className="rounded-xl border border-primary/30 bg-card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-primary/10 bg-primary/5">
                <div className="flex items-center gap-2">
                    <FileText className="w-3.5 h-3.5 text-primary" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-primary">
                        {displayLabel || label}
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    {isTruncated && onLoadFull && (
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-5 px-2 text-[9px] uppercase font-black tracking-tighter border-primary/30 hover:bg-primary/10"
                            onClick={onLoadFull}
                            disabled={isLoadingFull}
                        >
                            {isLoadingFull ? <Loader2 className="w-3 h-3 animate-spin" /> : "Load Full"}
                        </Button>
                    )}
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground" onClick={handleCopy}>
                        {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    </Button>
                </div>
            </div>
            <div className="p-4 max-h-[500px] overflow-y-auto scrollbar-thin scrollbar-thumb-primary/20">
                <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed text-foreground/90 font-sans">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {isTruncated ? text.replace(/^\[TRUNCATED:\d+\]\s*/, "") + "\n\n*— content truncated —*" : text}
                    </ReactMarkdown>
                </div>
            </div>
        </div>
    );
}
