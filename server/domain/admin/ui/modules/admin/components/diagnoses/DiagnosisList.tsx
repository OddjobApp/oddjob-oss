
import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@domain-ui/core/ui/components/ui/table";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@domain-ui/core/ui/components/ui/dropdown-menu";
import { Bot, Bug, Clock, Search, Database, Download, FileJson, ShieldCheck, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { Dialog, DialogContent } from "@domain-ui/core/ui/components/ui/dialog";
import { DiagnosisDetail } from './DiagnosisDetail.js';
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";

interface Diagnosis {
    diagnosisId: string;
    errorMessage: string;
    errorCode?: string;
    httpStatus?: number;
    jobType?: string;
    matchedPatternId?: string;
    aiDiagnosis?: {
        summary: string;
        confidence: number;
    };
    recommendations?: any[];
    createdAt: string;
    fixSuccessful?: boolean;
}

export function DiagnosisList() {
    const [selectedDiagnosisId, setSelectedDiagnosisId] = useState<string | null>(null);
    const { toast } = useToast();

    const { data: diagnoses, isLoading, refetch } = useQuery<Diagnosis[]>({
        queryKey: ['admin', 'diagnoses'],
        queryFn: async () => {
            const res = await fetch('/api/admin/diagnoses?limit=50');
            if (!res.ok) throw new Error('Failed to fetch diagnoses');
            return res.json();
        }
    });

    const clearFixedMutation = async () => {
        try {
            const res = await fetch('/api/admin/diagnoses/clear-fixed', { method: 'DELETE' });
            const data = await res.json();
            if (data.success) {
                toast({ 
                    title: 'Cleanup Complete', 
                    description: data.message || `Cleared ${data.count} fixed incidents.` 
                });
                refetch();
            } else {
                throw new Error(data.message || 'Failed to clear fixed issues');
            }
        } catch (err: any) {
            toast({ 
                title: 'Cleanup Failed', 
                description: err.message,
                variant: 'destructive'
            });
        }
    };

    const clearAllMutation = async () => {
        if (!confirm("Are you sure you want to clear ALL incidents? This action cannot be undone.")) return;
        try {
            const res = await fetch('/api/admin/diagnoses/clear-all', { method: 'DELETE' });
            const data = await res.json();
            if (data.success) {
                toast({ 
                    title: 'System Purged', 
                    description: data.message || `Cleared ${data.count} incidents.` 
                });
                refetch();
            } else {
                throw new Error(data.message || 'Failed to clear incidents');
            }
        } catch (err: any) {
            toast({ 
                title: 'Purge Failed', 
                description: err.message,
                variant: 'destructive'
            });
        }
    };

    const exportAsMarkdown = useCallback(() => {
        if (!diagnoses?.length) return;
        const ts = new Date().toISOString();
        const lines: string[] = [
            `# Oddjob System Incident Report`,
            `**Exported:** ${ts}`,
            `**Total incidents:** ${diagnoses.length}`,
            ``,
            `---`,
            ``,
            `## Instructions for AI Agent`,
            `The following incidents were captured by the Oddjob error diagnosis engine.`,
            `Each entry includes the raw error, AI root-cause analysis, matched patterns, and recommended fixes.`,
            `Please review each incident, identify systemic issues, and suggest or apply code fixes.`,
            ``,
            `---`,
            ``,
        ];

        diagnoses.forEach((item, idx) => {
            lines.push(`## Incident ${idx + 1} — ${item.errorCode ?? 'ERR'} (HTTP ${item.httpStatus ?? '?'})`);
            lines.push(`- **ID:** \`${item.diagnosisId}\``);
            lines.push(`- **Time:** ${format(new Date(item.createdAt), 'MMM d yyyy, HH:mm:ss')}`);
            lines.push(`- **Job Type:** ${item.jobType ?? 'unknown'}`);
            lines.push(`- **Error:** ${item.errorMessage}`);
            if (item.fixSuccessful) {
                lines.push(`- **Status:** ✅ FIXED`);
            }
            if (item.aiDiagnosis) {
                lines.push(``);
                lines.push(`### AI Analysis (confidence: ${Math.round(item.aiDiagnosis.confidence * 100)}%)`);
                lines.push(`**Summary:** ${item.aiDiagnosis.summary}`);
            }
            if (item.matchedPatternId) {
                lines.push(`- **Matched Pattern:** \`${item.matchedPatternId}\``);
            }
            if (item.recommendations?.length) {
                lines.push(``);
                lines.push(`### Recommendations`);
                item.recommendations.forEach((rec: any, i: number) => {
                    lines.push(`${i + 1}. **${rec.title}** — ${rec.description}${rec.canAutoApply ? ' *(auto-fixable)*' : ''}`);
                });
            }
            lines.push(``);
        });

        const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `oddjob-diagnoses-${ts.slice(0, 10)}.md`;
        a.click();
        URL.revokeObjectURL(url);
        toast({ title: 'Exported', description: `${diagnoses.length} incidents exported as Markdown.` });
    }, [diagnoses, toast]);

    const exportAsJson = useCallback(() => {
        if (!diagnoses?.length) return;
        const ts = new Date().toISOString();
        const blob = new Blob([JSON.stringify({ exportedAt: ts, totalCount: diagnoses.length, incidents: diagnoses }, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `oddjob-diagnoses-${ts.slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        toast({ title: 'Exported', description: `${diagnoses.length} incidents exported as JSON.` });
    }, [diagnoses, toast]);

    if (isLoading) {
        return <div className="p-8 text-center text-muted-foreground">Loading diagnoses...</div>;
    }

    const fixedCount = diagnoses?.filter(d => d.fixSuccessful).length || 0;

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">System Incidents</h2>
                    <p className="text-muted-foreground">
                        AI-powered analysis of server errors and failures.
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <Button 
                        variant="secondary" 
                        size="sm" 
                        className="gap-1.5 border-green-500/30 bg-green-500/5 hover:bg-green-500/15 text-green-600 dark:text-green-400 font-bold"
                        onClick={clearFixedMutation}
                        disabled={fixedCount === 0}
                    >
                        <ShieldCheck className="w-4 h-4" />
                        Clear Fixed ({fixedCount})
                    </Button>
                    <Button 
                        variant="ghost" 
                        size="sm" 
                        className="gap-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        onClick={clearAllMutation}
                        disabled={!diagnoses?.length}
                    >
                        <Trash2 className="w-4 h-4" />
                        Clear All
                    </Button>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm" className="gap-1.5" disabled={!diagnoses?.length}>
                                <Download className="w-4 h-4" />
                                Export Incidents
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={exportAsMarkdown} className="gap-2">
                                <Download className="w-4 h-4" />
                                Export as Markdown <span className="text-xs text-muted-foreground ml-1">(for Claude / AI agents)</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={exportAsJson} className="gap-2">
                                <FileJson className="w-4 h-4" />
                                Export as JSON <span className="text-xs text-muted-foreground ml-1">(machine-readable)</span>
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Recent Diagnoses</CardTitle>
                    <CardDescription>
                        Real-time feed of detected errors and their automatic root cause analysis.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-[180px]">Time</TableHead>
                                    <TableHead className="w-[100px]">Status</TableHead>
                                    <TableHead>Error</TableHead>
                                    <TableHead className="w-[150px]">Job Type</TableHead>
                                    <TableHead className="w-[100px]">Analysis</TableHead>
                                    <TableHead className="w-[100px]">Action</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {diagnoses?.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={6} className="h-24 text-center">
                                            No incidents recorded.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    diagnoses?.map((item) => (
                                        <TableRow key={item.diagnosisId}>
                                            <TableCell className="font-mono text-xs">
                                                {format(new Date(item.createdAt), 'MMM d, HH:mm:ss')}
                                            </TableCell>
                                            <TableCell>
                                                <Badge
                                                    variant={item.fixSuccessful ? "outline" : (item.httpStatus && item.httpStatus >= 500 ? "destructive" : "secondary")}
                                                    className={item.fixSuccessful ? "border-green-500/50 text-green-600 bg-green-500/10" : ""}
                                                >
                                                    {item.fixSuccessful ? "FIXED" : (item.httpStatus || 'ERR')}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="max-w-[300px] truncate" title={item.errorMessage}>
                                                {item.errorMessage}
                                            </TableCell>
                                            <TableCell>
                                                {item.jobType ? (
                                                    <Badge variant="outline">{item.jobType}</Badge>
                                                ) : (
                                                    <span className="text-muted-foreground text-xs">-</span>
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-1">
                                                    {item.aiDiagnosis ? (
                                                        <Badge variant="default" className="bg-purple-600 hover:bg-purple-700">
                                                            <Bot className="w-3 h-3 mr-1" /> AI
                                                        </Badge>
                                                    ) : item.matchedPatternId ? (
                                                        <Badge variant="secondary">
                                                            <Database className="w-3 h-3 mr-1" /> Pattern
                                                        </Badge>
                                                    ) : (
                                                        <span className="text-muted-foreground text-xs">Pending</span>
                                                    )}
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => setSelectedDiagnosisId(item.diagnosisId)}
                                                >
                                                    View
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>

            <Dialog open={!!selectedDiagnosisId} onOpenChange={(open) => !open && setSelectedDiagnosisId(null)}>
                <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
                    {selectedDiagnosisId && <DiagnosisDetail diagnosisId={selectedDiagnosisId} />}
                </DialogContent>
            </Dialog>
        </div>
    );
}
