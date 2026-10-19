import React, { useState } from "react";
import { Search, ExternalLink } from "lucide-react";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import type { RendererProps } from "../registry";

interface SearchResult {
    title?: string;
    url?: string;
    link?: string;
    snippet?: string;
    description?: string;
    content?: string;
}

export function SearchResultsRenderer({ label, displayLabel, value }: RendererProps) {
    const [showAll, setShowAll] = useState(false);
    const results = Array.isArray(value) ? (value as SearchResult[]) : [];
    const visible = showAll ? results : results.slice(0, 8);

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Search className="w-3.5 h-3.5 text-sky-400" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-sky-400">
                        {displayLabel || label}
                    </span>
                </div>
                <Badge variant="outline" className="text-[9px] h-4 border-sky-400/30 text-sky-400">
                    {results.length} result{results.length !== 1 ? "s" : ""}
                </Badge>
            </div>

            <div className="space-y-1.5 max-h-[400px] overflow-y-auto scrollbar-thin scrollbar-thumb-sky-500/20">
                {visible.map((r, i) => {
                    const url = r.url || r.link || "";
                    const title = r.title || url || `Result ${i + 1}`;
                    const snippet = r.snippet || r.description || r.content || "";
                    let hostname = "";
                    try { hostname = new URL(url).hostname.replace("www.", ""); } catch {}

                    return (
                        <div key={i} className="p-3 rounded-lg bg-card border border-border/50 hover:border-sky-400/20 transition-colors group">
                            <div className="flex items-start justify-between gap-2 mb-1">
                                <p className="text-xs font-semibold text-foreground group-hover:text-sky-300 transition-colors line-clamp-1">
                                    {title}
                                </p>
                                {url && (
                                    <a href={url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-sky-400/60 hover:text-sky-400 transition-colors" onClick={e => e.stopPropagation()}>
                                        <ExternalLink className="w-3 h-3" />
                                    </a>
                                )}
                            </div>
                            {hostname && (
                                <p className="text-[9px] font-mono text-sky-400/60 mb-1 truncate">{hostname}</p>
                            )}
                            {snippet && (
                                <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">{snippet}</p>
                            )}
                        </div>
                    );
                })}
            </div>

            {results.length > 8 && (
                <Button
                    variant="ghost"
                    size="sm"
                    className="w-full h-7 text-[10px] text-muted-foreground hover:text-sky-400"
                    onClick={() => setShowAll(s => !s)}
                >
                    {showAll ? "Show fewer" : `Show all ${results.length} results`}
                </Button>
            )}
        </div>
    );
}
