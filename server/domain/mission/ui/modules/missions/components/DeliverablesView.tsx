import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { CheckCircle2, Circle, Clock, Package, ExternalLink, FileText, Layout, Copy, X, Loader2, Download } from "lucide-react";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import { Progress } from "@domain-ui/core/ui/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@domain-ui/core/ui/components/ui/dialog";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface DeliverablesViewProps {
    mission: any;
    run?: any;
}

export function DeliverablesView({ mission, run }: DeliverablesViewProps) {
    const blackboard = mission?.blackboard || {};
    const [dbDeliverables, setDbDeliverables] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedDeliverable, setSelectedDeliverable] = useState<{ name: string; content: string } | null>(null);
    const [copied, setCopied] = useState(false);
    const [previewTab, setPreviewTab] = useState<'formatted' | 'raw'>('formatted');

    useEffect(() => {
        if (selectedDeliverable) {
            setPreviewTab('formatted');
        }
    }, [selectedDeliverable]);

    useEffect(() => {
        if (!mission?.id) return;
        setLoading(true);
        fetch(`/api/missions/${mission.id}/deliverables`)
            .then(res => res.json())
            .then(data => {
                setDbDeliverables(Array.isArray(data) ? data : []);
                setLoading(false);
            })
            .catch(err => {
                console.error("Failed to fetch deliverables", err);
                setLoading(false);
            });
    }, [mission?.id]);

    const expectedFromBlackboard = blackboard.expected_deliverables || blackboard.deliverables || [];
    const expectedFromRun = (run?.missionContext as any)?.deliverables || [];
    
    // De-duplicate and normalize expected deliverables
    const expectedDeliverables = Array.from(new Set([
        ...(Array.isArray(expectedFromBlackboard) ? expectedFromBlackboard : []),
        ...(Array.isArray(expectedFromRun) ? expectedFromRun : [])
    ]));
    
    // Combine expected deliverables with DB deliverables
    // Map expected to a common format
    const combinedDeliverables = [
        ...dbDeliverables.map(d => ({
            id: d.id,
            name: d.name,
            content: d.content,
            status: 'completed',
            type: d.type || 'report',
            isFromDb: true
        })),
        ...(Array.isArray(expectedDeliverables) ? expectedDeliverables : [])
            .filter(name => !dbDeliverables.some(d => d.name === name))
            .map(name => ({
                name,
                status: getStatus(name),
                content: getContent(name),
                isFromDb: false
            }))
    ];

    // Check if a key matching the deliverable (slugified) exists in the blackboard.
    function getStatus(name: string) {
        const slug = name.toLowerCase().replace(/\s+/g, '_');
        if (blackboard[slug] || blackboard[`${slug}_url`] || blackboard[`${slug}_path`]) {
            return 'completed';
        }
        return 'pending';
    };

    function getContent(name: string): string {
        const slug = name.toLowerCase().replace(/\s+/g, '_');
        const val = blackboard[slug] || blackboard[`${slug}_url`] || blackboard[`${slug}_path`];
        if (typeof val === 'string') return val;
        return JSON.stringify(val, null, 2);
    };

    const handleCopy = (text: string) => {
        navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    const handleDownload = () => {
        if (!selectedDeliverable) return;
        const blob = new Blob([selectedDeliverable.content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = selectedDeliverable.name.replace(/\s+/g, '_') + '.txt'; // Default to txt, would be better to detect extension
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const renderFormattedContent = (content: string) => {
        if (!content) return null;

        // Image URL detection
        if (content.match(/^https?:\/\/.*\.(png|jpg|jpeg|gif|webp)$/i)) {
            return (
                <div className="flex justify-center items-center h-full">
                    <img src={content} alt="Deliverable" className="max-w-full max-h-[60vh] object-contain rounded-lg border border-foreground/10 shadow-2xl" />
                </div>
            );
        }

        // PDF URL detection
        if (content.match(/^https?:\/\/.*\.pdf$/i)) {
            return (
                <iframe src={content} className="w-full h-[60vh] rounded-lg border border-foreground/10 bg-card" title="PDF Deliverable" />
            );
        }

        // CSV detection (basic heuristic: starts with CSV-like headers and has multiple lines, no obvious markdown like # or -)
        const lines = content.trim().split('\n');
        if (lines.length > 1 && lines[0].includes(',') && !content.includes('##') && !content.includes('```')) {
            const isCsv = lines.every(line => line.includes(',') || line.trim() === '');
            if (isCsv) {
                return (
                    <div className="overflow-x-auto rounded-lg border border-foreground/10">
                        <table className="w-full text-sm text-left">
                            <thead className="text-xs uppercase bg-foreground/5 text-foreground">
                                <tr>
                                    {lines[0].split(',').map((header, i) => (
                                        <th key={i} className="px-6 py-3 border-b border-foreground/10">{header.trim()}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {lines.slice(1).filter(l => l.trim()).map((line, i) => (
                                    <tr key={i} className="border-b border-foreground/5 bg-background/20 hover:bg-foreground/5">
                                        {line.split(',').map((cell, j) => (
                                            <td key={j} className="px-6 py-4">{cell.trim()}</td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                );
            }
        }

        // Fallback to Markdown
        return (
            <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed text-foreground/90 font-sans">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {content}
                </ReactMarkdown>
            </div>
        );
    };

    if (loading) {
        return (
            <div className="h-[400px] flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        );
    }

    if (combinedDeliverables.length === 0) {
        return (
            <div className="h-[650px] flex flex-col items-center justify-center text-center p-12 bg-background/40 backdrop-blur-md rounded-xl border border-primary/20">
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-6 shadow-[0_0_20px_rgba(217,119,6,0.1)]">
                    <Package className="w-8 h-8 text-primary/40" />
                </div>
                <h3 className="text-xl font-bold text-foreground mb-2 tracking-tight">No Deliverables Target</h3>
                <p className="text-muted-foreground max-w-sm text-sm">
                    This mission doesn't have explicit deliverables defined.
                    Add <code className="text-primary bg-primary/5 px-1.5 py-0.5 rounded border border-primary/20">[Target Product: Your Item]</code> to the mission objective to enable automated tracking.
                </p>
            </div>
        );
    }

    const completedCount = combinedDeliverables.filter((d: any) => d.status === 'completed').length;
    const progress = (completedCount / (combinedDeliverables.length > 0 ? combinedDeliverables.length : 1)) * 100;

    return (
        <>
        <Card className="bg-background/40 backdrop-blur-md border-primary/20 min-h-[650px] flex flex-col overflow-hidden">
            <CardHeader className="border-b border-border bg-foreground/[0.02]">
                <div className="flex items-center justify-between">
                    <div className="space-y-1">
                        <div className="flex items-center gap-2">
                            <Layout className="w-5 h-5 text-primary" />
                            <CardTitle className="text-xl font-black tracking-tight uppercase italic">Mission Deliverables</CardTitle>
                        </div>
                        <CardDescription>Targeted outcomes and automated work products.</CardDescription>
                    </div>
                    <div className="text-right">
                        <div className="text-2xl font-black text-primary tracking-tighter shadow-sm">
                            {completedCount}<span className="text-muted-foreground text-sm font-normal"> / {combinedDeliverables.length}</span>
                        </div>
                        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Delivery Rate</div>
                    </div>
                </div>
                <Progress value={progress} className="h-1 mt-4 bg-foreground/5" indicatorClassName="bg-primary shadow-[0_0_10px_rgba(217,119,6,0.5)]" />
            </CardHeader>

            <CardContent className="flex-1 p-0 overflow-hidden">
                <ScrollArea className="h-[530px] p-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {combinedDeliverables.map((item: any, i: number) => {
                            const isCompleted = item.status === 'completed';

                            return (
                                <div
                                    key={i}
                                    className={`group relative p-4 rounded-xl border transition-all duration-300 hover:scale-[1.02] ${isCompleted
                                        ? 'bg-emerald-500/5 border-emerald-500/20 hover:border-emerald-500/40 shadow-[0_0_15px_rgba(16,185,129,0.05)]'
                                        : 'bg-foreground/5 border-border hover:border-primary/30 shadow-lg'
                                        }`}
                                >
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="flex items-center gap-3">
                                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${isCompleted ? 'bg-emerald-500/20 shadow-[0_0_10px_rgba(16,185,129,0.2)]' : 'bg-primary/10'
                                                }`}>
                                                {isCompleted ? (
                                                    <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                                                ) : (
                                                    <Package className="w-5 h-5 text-primary" />
                                                )}
                                            </div>
                                            <div>
                                                <h4 className="font-bold text-foreground tracking-tight">{item.name}</h4>
                                                <div className="flex items-center gap-2 mt-1">
                                                    <Badge
                                                        variant="outline"
                                                        className={`text-[8px] uppercase tracking-tighter h-4 px-1 ${isCompleted
                                                            ? 'border-emerald-500/30 text-emerald-500 bg-emerald-500/10'
                                                            : 'border-border text-muted-foreground bg-muted/20'
                                                            }`}
                                                    >
                                                        {isCompleted ? (item.isFromDb ? 'Verified Asset' : 'Validated') : 'In Queue'}
                                                    </Badge>
                                                    {!isCompleted && (
                                                        <span className="flex items-center gap-1 text-[9px] text-muted-foreground italic">
                                                            <Clock size={10} />
                                                            Pending synthesis
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        {isCompleted && (
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8 text-emerald-500 hover:bg-emerald-500/20 border border-transparent hover:border-emerald-500/20"
                                                onClick={() => setSelectedDeliverable({ name: item.name, content: item.content })}
                                            >
                                                <ExternalLink size={14} />
                                            </Button>
                                        )}
                                    </div>

                                    {isCompleted && (
                                        <div className="mt-4 pt-4 border-t border-emerald-500/10 flex items-center justify-between">
                                            <div className="flex items-center gap-4 text-[10px] text-emerald-500/70 font-bold uppercase tracking-widest">
                                                <FileText size={12} />
                                                <span>{item.isFromDb ? 'Direct File' : 'Audit Asset'}</span>
                                            </div>
                                            <span className="text-[10px] font-mono text-emerald-500/50">#{item.isFromDb ? 'SYNCED-FILE' : 'AUTO-SYNCED'}</span>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </ScrollArea>
            </CardContent>

            <div className="p-4 border-t border-border bg-foreground/[0.01] flex items-center justify-between text-[10px] uppercase tracking-widest font-bold text-muted-foreground/50">
                <div className="flex items-center gap-4">
                    <span className="flex items-center gap-1.5"><Circle size={8} fill="currentColor" className="text-primary" /> Auto-sync enabled</span>
                    <span className="flex items-center gap-1.5 font-bold text-emerald-500/80"><Circle size={8} fill="currentColor" className="text-emerald-500" /> Multi-Step Verified</span>
                </div>
                <div className="font-mono">Oddjob v3.0.0-alpha</div>
            </div>
        </Card>

        {/* Deliverable Content Modal */}
        <Dialog open={!!selectedDeliverable} onOpenChange={() => setSelectedDeliverable(null)}>
            <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col bg-background border-emerald-500/20">
                <DialogHeader className="flex-shrink-0">
                    <div className="flex items-center justify-between">
                        <div>
                            <DialogTitle className="text-lg font-black uppercase italic tracking-tight flex items-center gap-2">
                                <FileText className="w-5 h-5 text-emerald-500" />
                                {selectedDeliverable?.name}
                            </DialogTitle>
                            <DialogDescription className="text-xs text-muted-foreground mt-1">
                                Auto-synced deliverable from mission blackboard
                            </DialogDescription>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="flex bg-foreground/5 p-0.5 rounded-lg border border-foreground/10 mr-2">
                                <button
                                    onClick={() => setPreviewTab('formatted')}
                                    className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${
                                        previewTab === 'formatted' 
                                            ? 'bg-emerald-500 text-background shadow-lg shadow-emerald-500/20' 
                                            : 'text-muted-foreground hover:text-foreground'
                                    }`}
                                >
                                    Document Preview
                                </button>
                                <button
                                    onClick={() => setPreviewTab('raw')}
                                    className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${
                                        previewTab === 'raw' 
                                            ? 'bg-emerald-500 text-background shadow-lg shadow-emerald-500/20' 
                                            : 'text-muted-foreground hover:text-foreground'
                                    }`}
                                >
                                    Source
                                </button>
                            </div>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="text-muted-foreground hover:text-foreground gap-2"
                                onClick={handleDownload}
                            >
                                <Download size={14} />
                                Download
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="text-muted-foreground hover:text-foreground gap-2"
                                onClick={() => handleCopy(selectedDeliverable?.content || '')}
                            >
                                <Copy size={14} />
                                {copied ? 'Copied!' : 'Copy'}
                            </Button>
                        </div>
                    </div>
                </DialogHeader>
                <ScrollArea className="flex-1 mt-4 rounded-lg border border-border bg-background/30 p-4">
                    {previewTab === 'formatted' ? (
                        renderFormattedContent(selectedDeliverable?.content || "")
                    ) : (
                        <pre className="text-sm text-muted-foreground whitespace-pre-wrap font-mono leading-relaxed">
                            {selectedDeliverable?.content}
                        </pre>
                    )}
                </ScrollArea>
            </DialogContent>
        </Dialog>
        </>
    );
}
