import React, { useState } from "react";
import { ExternalLink, Copy, Check } from "lucide-react";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import type { RendererProps } from "../registry";

export function UrlValueRenderer({ label, displayLabel, value }: RendererProps) {
    const [copied, setCopied] = useState(false);
    const url = String(value ?? "");
    let hostname = url;
    try { hostname = new URL(url).hostname.replace("www.", ""); } catch {}

    const handleCopy = () => {
        navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    return (
        <div className="flex items-center gap-2 py-1 px-2 group">
            <ExternalLink className="w-3 h-3 text-sky-400 shrink-0" />
            <span className="text-[10px] font-mono font-bold text-foreground/60">{displayLabel || label}:</span>
            <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                title={url}
                className="text-[11px] font-mono text-sky-400 hover:text-sky-300 hover:underline truncate max-w-[350px] transition-colors"
            >
                {hostname}
            </a>
            <Button
                variant="ghost"
                size="sm"
                className="h-5 w-5 p-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity hover:text-sky-400"
                onClick={handleCopy}
            >
                {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            </Button>
        </div>
    );
}
