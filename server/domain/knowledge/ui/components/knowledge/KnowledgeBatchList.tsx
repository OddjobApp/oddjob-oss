
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@domain-ui/core/ui/components/ui/card';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Progress } from '@domain-ui/core/ui/components/ui/progress';
import { CheckCircle2, XCircle, Clock, Loader2, Play, AlertCircle } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@domain-ui/core/ui/components/ui/table';
import { formatDistanceToNow } from 'date-fns';
import { ExtractionBatch } from "@shared/schema/knowledge-extraction";

export function KnowledgeBatchList() {
    const { data: batches = [], isLoading, error } = useQuery<ExtractionBatch[]>({
        queryKey: ['/api/knowledge-extraction/batch'],
        queryFn: async () => {
            const res = await apiRequest('GET', '/api/knowledge-extraction/batch');
            return res.json();
        },
        refetchInterval: (query) => {
            const data = query.state.data as ExtractionBatch[] | undefined;
            const hasRunning = data?.some(b => b.status === 'running' || b.status === 'pending');
            return hasRunning ? 2000 : 10000;
        }
    });

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'completed': return <CheckCircle2 className="w-4 h-4 text-green-500" />;
            case 'failed': return <XCircle className="w-4 h-4 text-red-500" />;
            case 'running': return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
            case 'pending': return <Clock className="w-4 h-4 text-muted-foreground" />;
            default: return <AlertCircle className="w-4 h-4 text-muted-foreground" />;
        }
    };

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'completed': return <Badge variant="secondary" className="bg-green-100 text-green-800 hover:bg-green-100">Completed</Badge>;
            case 'failed': return <Badge variant="destructive">Failed</Badge>;
            case 'running': return <Badge variant="default" className="bg-blue-100 text-blue-800 hover:bg-blue-100">Processing</Badge>;
            case 'pending': return <Badge variant="outline">Queued</Badge>;
            default: return <Badge variant="secondary">{status}</Badge>;
        }
    };

    if (isLoading) {
        return <div className="p-4 text-center text-muted-foreground">Loading batches...</div>;
    }

    if (error) {
        return (
            <div className="p-4 text-center border rounded-lg border-destructive/50 bg-destructive/10 text-destructive">
                <AlertCircle className="w-8 h-8 mx-auto mb-2" />
                <p className="font-medium">Failed to load batches</p>
                <p className="text-sm opacity-90">{(error as Error).message || "Please check your connection or try logging in again."}</p>
            </div>
        );
    }

    if (batches.length === 0) {
        return (
            <div className="p-8 text-center border rounded-lg border-dashed text-muted-foreground bg-muted/25">
                <Play className="w-10 h-10 mx-auto mb-3 opacity-20" />
                <p>No extraction batches found.</p>
                <p className="text-sm">Select multiple documents to start a bulk extraction.</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="space-y-3 md:hidden">
                {batches.map((batch) => (
                    <div key={batch.id} className="rounded-lg border bg-card/60 p-3">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <p className="truncate text-sm font-medium">{batch.name}</p>
                                {batch.description && (
                                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{batch.description}</p>
                                )}
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                                {getStatusIcon(batch.status)}
                                {getStatusBadge(batch.status)}
                            </div>
                        </div>
                        <div className="mt-4 space-y-1">
                            <Progress value={batch.progress} className="h-2" />
                            <div className="flex justify-between text-xs text-muted-foreground">
                                <span>{batch.progress}%</span>
                                <span>{batch.status === 'running' ? 'Running' : formatDistanceToNow(new Date(batch.createdAt), { addSuffix: true })}</span>
                            </div>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-3 border-t pt-3 text-xs">
                            <div>
                                <p className="text-muted-foreground">Documents</p>
                                <p className="mt-1 font-medium">{batch.processedDocuments} / {batch.totalDocuments}</p>
                            </div>
                            <div className="text-right">
                                <p className="text-muted-foreground">Result</p>
                                <p className="mt-1 font-medium">{batch.successfulDocuments} OK, {batch.failedDocuments} Failed</p>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            <div className="hidden md:block">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Batch Name</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Progress</TableHead>
                        <TableHead>Documents</TableHead>
                        <TableHead className="text-right">Created</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {batches.map((batch) => (
                        <TableRow key={batch.id}>
                            <TableCell className="font-medium">
                                {batch.name}
                                {batch.description && <p className="text-xs text-muted-foreground truncate max-w-[200px]">{batch.description}</p>}
                            </TableCell>
                            <TableCell>
                                <div className="flex items-center gap-2">
                                    {getStatusIcon(batch.status)}
                                    {getStatusBadge(batch.status)}
                                </div>
                            </TableCell>
                            <TableCell className="max-w-[150px]">
                                <div className="space-y-1">
                                    <Progress value={batch.progress} className="h-2" />
                                    <div className="text-xs text-muted-foreground flex justify-between">
                                        <span>{batch.progress}%</span>
                                        <span>{batch.status === 'running' ? 'Running' : ''}</span>
                                    </div>
                                </div>
                            </TableCell>
                            <TableCell>
                                <div className="text-sm">
                                    <span className="font-semibold">{batch.processedDocuments}</span> / {batch.totalDocuments}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                    {batch.successfulDocuments} OK, {batch.failedDocuments} Failed
                                </div>
                            </TableCell>
                            <TableCell className="text-right text-muted-foreground text-sm">
                                {formatDistanceToNow(new Date(batch.createdAt), { addSuffix: true })}
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
            </div>
        </div>
    );
}
