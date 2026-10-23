import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Progress } from '@domain-ui/core/ui/components/ui/progress';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Play, AlertCircle, Loader2, CheckCircle2, Clock } from "lucide-react";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@domain-ui/core/ui/components/ui/tooltip";
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@domain-ui/core/ui/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@domain-ui/core/ui/components/ui/select';

interface ExtractionProgressProps {
    documentId: number;
    schemaId?: number; // Needed to start extraction
    compact?: boolean;
    initialStatus?: string | null;
    initialProgress?: number | null;
}

export function KnowledgeExtractionProgress({ 
    documentId, 
    schemaId, 
    compact = false,
    initialStatus = null,
    initialProgress = null
}: ExtractionProgressProps) {
    const { toast } = useToast();
    const [startDialogOpen, setStartDialogOpen] = useState(false);
    const [isStarting, setIsStarting] = useState(false);
    const [selectedSchemaId, setSelectedSchemaId] = useState<string>(schemaId ? String(schemaId) : "");

    // Poll for status
    const { data: extraction, isLoading, error, refetch } = useQuery({
        queryKey: ['/api/knowledge-extraction/document', documentId],
        queryFn: async () => {
            try {
                const res = await apiRequest('GET', `/api/knowledge-extraction/document/${documentId}`);
                if (res.status === 404) return null;
                const data = await res.json();
                return data;
            } catch (e) {
                console.error("Failed to fetch extraction status:", e);
                return null;
            }
        },
        // Load result counts even when the document list supplies a terminal status.
        staleTime: 0,
        refetchOnWindowFocus: true,
        initialData: initialStatus ? { status: initialStatus, progress: initialProgress || 0 } : undefined,
        refetchInterval: (query) => {
            const status = query.state.data?.status;
            return status === 'queued' || status === 'processing' ? 2000 : false;
        },
    });

    // Fetch schemas if needed
    const { data: schemas = [] } = useQuery<any[]>({
        queryKey: ['/api/knowledge/schema'],
        queryFn: async () => {
            const res = await apiRequest('GET', '/api/knowledge/schema');
            return res.json();
        },
        enabled: startDialogOpen && !schemaId,
    });

    const startExtraction = async (e?: React.MouseEvent) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }

        const idToUse = schemaId || (selectedSchemaId ? parseInt(selectedSchemaId) : null);

        if (!idToUse) {
            toast({ title: "Schema required", description: "Please select a schema to use for extraction.", variant: "destructive" });
            return;
        }

        setIsStarting(true);
        try {
            const res = await apiRequest('POST', '/api/knowledge-extraction', {
                documentId,
                schemaId: idToUse,
                priority: 5
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.message || "Failed to start extraction");
            }

            toast({ title: "Extraction Started", description: "Job queued successfully." });
            setStartDialogOpen(false);
            refetch();
        } catch (e: any) {
            console.error("[Extraction] Error starting:", e);
            toast({ title: "Failed to start", description: e.message, variant: "destructive" });
        } finally {
            setIsStarting(false);
        }
    };

    const extractionDialog = (
                <Dialog open={startDialogOpen} onOpenChange={setStartDialogOpen}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Run Knowledge Extraction</DialogTitle>
                            <DialogDescription>
                                Analyze this document and extract entities/relationships into the Knowledge Graph.
                            </DialogDescription>
                        </DialogHeader>

                        {!schemaId && (
                            <div className="py-4">
                                <label className="text-sm font-medium mb-1 block">Extraction Schema</label>
                                <Select value={selectedSchemaId} onValueChange={setSelectedSchemaId}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select a schema..." />
                                    </SelectTrigger>
                                    <SelectContent position="popper" className="z-popover">
                                        {schemas.map((s: any) => (
                                            <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                                        ))}
                                        {schemas.length === 0 && (
                                            <div className="px-2 py-1 text-xs text-muted-foreground">
                                                No schemas found. Create one in Schemas.
                                            </div>
                                        )}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}

                        <DialogFooter>
                            <Button variant="outline" onClick={() => setStartDialogOpen(false)}>Cancel</Button>
                            <Button
                                onClick={startExtraction}
                                disabled={isStarting}
                            >
                                {isStarting ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Starting...
                                    </>
                                ) : "Start Extraction"}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
    );

    if (isLoading) return <div className="text-muted-foreground text-xs">Loading status...</div>;

    if (!extraction) {
        // No extraction run yet
        return (
            <div className="flex items-center gap-2">
                {compact ? (
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setStartDialogOpen(true)} title="Start Extraction">
                        <Play className="h-3 w-3" />
                    </Button>
                ) : (
                    <Button variant="outline" size="sm" onClick={() => setStartDialogOpen(true)}>
                        <Play className="h-3 w-3 mr-1" /> Extract
                    </Button>
                )}

                {extractionDialog}
            </div>
        );
    }

    const { status, progress, progressMessage, error: extractionError, nodesExtracted } = extraction;

    if (status === 'completed') {
        return (
            <div className="flex items-center gap-2">
                <Badge variant="outline" className="bg-muted text-foreground border-border gap-1 pr-3">
                    <CheckCircle2 className="w-3 h-3" />
                    {nodesExtracted === 0 ? 'No entities found' : typeof nodesExtracted === 'number' ? `${nodesExtracted} entities` : 'Extracted'}
                </Badge>
                <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground" onClick={() => setStartDialogOpen(true)}>
                    Re-run
                </Button>
                {extractionDialog}
            </div>
        );
    }

    if (status === 'failed') {
        return (
            <div className="flex items-center gap-2">
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Badge variant="destructive" className="gap-1 cursor-help">
                                <AlertCircle className="w-3 h-3" />
                                Failed
                            </Badge>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-[300px] break-words">
                            <p>{extractionError || "Extraction failed. Click to retry."}</p>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setStartDialogOpen(true)}>
                    <Play className="h-3 w-3" />
                </Button>
                {extractionDialog}
            </div>
        );
    }

    if (status === 'cancelled') {
        return (
            <div className="flex items-center gap-1.5">
                <Badge variant="outline" className="bg-muted text-muted-foreground border-border gap-1 text-[11px]">
                    <Clock className="w-3 h-3 text-muted-foreground" />
                    Cancelled
                </Badge>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" title="Start Extraction" onClick={() => setStartDialogOpen(true)}>
                    <Play className="h-3 w-3 text-muted-foreground" />
                </Button>
                {extractionDialog}
            </div>
        );
    }

    // Processing or queued
    return (
        <div className={`flex flex-col gap-1 ${compact ? 'w-24' : 'w-full max-w-[200px]'}`}>
            <div className="flex justify-between text-xs mb-1">
                <span className="flex items-center gap-1 font-medium text-primary">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    {status === 'queued' ? 'Queued' : 'Extracting...'}
                </span>
                <span>{progress}%</span>
            </div>
            <Progress value={progress} className="h-1.5" />
            {!compact && progressMessage && (
                <div className="text-[10px] text-muted-foreground truncate" title={progressMessage}>
                    {progressMessage}
                </div>
            )}
        </div>
    );
}

