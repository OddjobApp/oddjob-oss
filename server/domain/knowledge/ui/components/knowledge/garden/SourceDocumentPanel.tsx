/**
 * Source Document Panel Component
 * 
 * A split-screen panel for Knowledge Garden that shows the source
 * document context with extracted entities highlighted.
 */

import { X, FileText, ExternalLink, Clock, GitBranch } from "lucide-react";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import { Separator } from "@domain-ui/core/ui/components/ui/separator";

import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import styles from "./SourceDocumentPanel.module.css";

import { JsonTableView } from "@domain-ui/core/ui/components/shared/JsonTableView";

function tryParseJSON(jsonString: string) {
    try {
        const o = JSON.parse(jsonString);
        if (o && typeof o === "object") {
            return o;
        }
    } catch (e) { }
    return null;
}



interface ExtractionSource {
    type: string;
    pipelineExecutionId?: number;
    stepOrder?: number;
    sourceText?: string;
    position?: { start: number; end: number };
    jobId?: number;
    timestamp?: string;
}

interface KnowledgeNode {
    id: number;
    label: string;
    name: string;
    externalId?: string | null;
    data: Record<string, any>;
    extractionSources?: ExtractionSource[];
    confidenceScore?: number | null;
    pipelineExecutionId?: number | null;
    createdAt: string;
}

interface SourceDocumentPanelProps {
    node: KnowledgeNode;
    onClose: () => void;
    className?: string;
}

/**
 * Highlight the entity name within source text
 */
function HighlightedText({ text, highlight }: { text: string; highlight: string }) {
    if (!highlight || !text) {
        return <span>{text}</span>;
    }

    const parts = text.split(new RegExp(`(${escapeRegExp(highlight)})`, 'gi'));

    return (
        <span>
            {parts.map((part, i) =>
                part.toLowerCase() === highlight.toLowerCase() ? (
                    <mark key={i} className="bg-yellow-200 dark:bg-yellow-800 px-0.5 rounded">
                        {part}
                    </mark>
                ) : (
                    <span key={i}>{part}</span>
                )
            )}
        </span>
    );
}

function escapeRegExp(string: string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Format source type for display
 */
function formatSourceType(type: string): string {
    const typeMap: Record<string, string> = {
        'pipeline_step': 'Pipeline Output',
        'api_response': 'API Response',
        'document': 'Document',
        'manual': 'Manual Entry',
    };
    return typeMap[type] || type;
}

export function SourceDocumentPanel({ node, onClose, className }: SourceDocumentPanelProps) {
    const sources = node.extractionSources || [];
    const hasSourceContext = sources.some(s => s.sourceText);

    return (
        <div className={cn(
            "flex flex-col h-full border-l glass-panel-deep shadow-2xl z-50",
            className
        )}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b bg-background/20 backdrop-blur-xl">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-primary/10 rounded-lg border border-primary/20">
                        <FileText className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                        <h3 className="font-bold text-xs uppercase tracking-[0.2em] text-foreground">Source Context</h3>
                        <p className="text-[8px] font-bold text-muted-foreground uppercase tracking-widest leading-none mt-1">Telemetry Origin</p>
                    </div>
                </div>
                <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 hover:bg-destructive/10 hover:text-destructive transition-colors rounded-full">
                    <X className="h-4 w-4" />
                </Button>
            </div>

            {/* Content */}
            <ScrollArea className="flex-1">
                <div className="p-4 space-y-4">
                    {/* Entity Summary */}
                    <div className="p-5 rounded-2xl border border-foreground/10 holographic-card">
                        <div className="flex items-center gap-3 mb-3">
                            <Badge className="bg-primary/20 text-primary border-primary/30 text-[9px] font-bold uppercase tracking-widest py-1 px-3 h-auto">
                                {node.label}
                            </Badge>
                            <span className="font-black text-foreground italic uppercase tracking-tight">{node.name}</span>
                        </div>
                        {node.externalId && (
                            <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest font-mono mb-2">
                                SIG: <span className="text-primary font-black opacity-80">{node.externalId}</span>
                            </div>
                        )}
                        {node.confidenceScore !== null && node.confidenceScore !== undefined && (
                            <div className="space-y-2 mt-4">
                                <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest">
                                    <span className="text-muted-foreground">Signal Accuracy</span>
                                    <span className={cn(
                                        "tabular-nums",
                                        node.confidenceScore >= 0.8 ? "text-primary" :
                                            node.confidenceScore >= 0.5 ? "text-amber-500" : "text-rose-500"
                                    )}>
                                        {Math.round(node.confidenceScore * 100)}%
                                    </span>
                                </div>
                                <div className="h-1.5 w-full bg-muted/30 rounded-full overflow-hidden border border-foreground/5">
                                    <motion.div
                                        className={cn(
                                            "h-full transition-all duration-1000 ease-out animate-pulse-glow",
                                            styles.dynamicWidth,
                                            node.confidenceScore >= 0.8 ? "bg-primary shadow-[0_0_10px_rgba(var(--primary),0.5)]" :
                                                node.confidenceScore >= 0.5 ? "bg-amber-500" : "bg-rose-500"
                                        )}
                                        initial={{ width: 0 }}
                                        animate={{ width: `${node.confidenceScore * 100}%` }}
                                        transition={{ duration: 1, ease: "easeOut" }}
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    <Separator />

                    {/* Extraction Sources */}
                    <div>
                        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                            Extraction Sources ({sources.length})
                        </h4>

                        {sources.length > 0 ? (
                            <div className="space-y-3">
                                {sources.map((source, idx) => (
                                    <div key={idx} className="p-3 rounded-lg border bg-background">
                                        {/* Source header */}
                                        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                                            <GitBranch className="h-3 w-3" />
                                            <span>{formatSourceType(source.type)}</span>
                                            {source.pipelineExecutionId && (
                                                <>
                                                    <span>•</span>
                                                    <span>Run #{source.pipelineExecutionId}</span>
                                                </>
                                            )}
                                            {source.stepOrder !== undefined && (
                                                <>
                                                    <span>•</span>
                                                    <span>Step {source.stepOrder}</span>
                                                </>
                                            )}
                                        </div>

                                        {/* Source Text or JSON Table */}
                                        {(() => {
                                            const jsonContent = source.sourceText ? tryParseJSON(source.sourceText) : null;

                                            if (jsonContent) {
                                                return (
                                                    <div className="mt-4 border border-foreground/5 rounded-xl overflow-hidden shadow-2xl bg-background/40 backdrop-blur-xl">
                                                        <div className="px-4 py-2 bg-foreground/5 border-b border-foreground/5 text-[9px] font-black text-muted-foreground uppercase tracking-[0.2em] flex justify-between items-center">
                                                            <div className="flex items-center gap-2">
                                                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                                                <span>Structured Payload</span>
                                                            </div>
                                                            <div className="flex gap-1">
                                                                <div className="w-2 h-2 rounded-full bg-foreground/10" />
                                                                <div className="w-2 h-2 rounded-full bg-foreground/10" />
                                                            </div>
                                                        </div>
                                                        <div className="p-1 font-mono text-[11px] semantic-density-container">
                                                            <JsonTableView data={jsonContent} />
                                                        </div>
                                                    </div>
                                                );
                                            }

                                            return source.sourceText ? (
                                                <div className="text-sm leading-relaxed font-sans text-foreground/80 bg-foreground/[0.02] p-4 rounded-xl border border-foreground/5 italic">
                                                    <HighlightedText
                                                        text={source.sourceText}
                                                        highlight={node.name}
                                                    />
                                                </div>
                                            ) : (
                                                <div className="text-sm text-muted-foreground italic p-4 bg-muted/10 rounded-xl">
                                                    Source telemetry not captured
                                                </div>
                                            );
                                        })()}

                                        {/* Timestamp */}
                                        {source.timestamp && (
                                            <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                                                <Clock className="h-3 w-3" />
                                                <span>{new Date(source.timestamp).toLocaleString()}</span>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-center py-8 text-muted-foreground">
                                <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
                                <p className="text-sm">No source context available</p>
                                <p className="text-xs mt-1">
                                    This entity may have been created manually or from a pipeline that didn't capture source text.
                                </p>
                            </div>
                        )}
                    </div>

                    {/* Entity Data Preview */}
                    {node.data && Object.keys(node.data).length > 0 && (
                        <>
                            <Separator />
                            <div>
                                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                                    Entity Properties
                                </h4>
                                <div className="p-3 rounded-lg border bg-background">
                                    <div className="overflow-hidden">
                                        <JsonTableView data={node.data} />
                                    </div>
                                </div>
                            </div>
                        </>
                    )}

                    {/* Pipeline Link */}
                    {node.pipelineExecutionId && (
                        <>
                            <Separator />
                            <Button variant="outline" className="w-full" asChild>
                                <a href={`/pipeline-executions/${node.pipelineExecutionId}`}>
                                    <ExternalLink className="h-4 w-4 mr-2" />
                                    View Pipeline Execution
                                </a>
                            </Button>
                        </>
                    )}
                </div>
            </ScrollArea>

            {/* Footer */}
            <div className="border-t px-4 py-2 bg-background/50">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Created: {new Date(node.createdAt).toLocaleDateString()}</span>
                    <span>ID: {node.id}</span>
                </div>
            </div>
        </div>
    );
}

export default SourceDocumentPanel;
