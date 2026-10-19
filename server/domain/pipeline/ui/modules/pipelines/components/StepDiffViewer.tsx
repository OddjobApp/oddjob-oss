/**
 * StepDiffViewer Component
 * 
 * Fetches and displays the diff for a pipeline step execution.
 * Used in the Pipeline Execution Detail page.
 */

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@domain-ui/core/ui/components/ui/dialog';
import { GitCompare, RefreshCw } from 'lucide-react';
import { DiffViewer, type DiffResult } from '@domain-ui/core/ui/components/shared/DiffViewer';
import { apiRequest } from '@/lib/queryClient';

interface StepDiffViewerProps {
    stepExecutionId: number;
    stepName: string;
}

interface DiffResponse extends DiffResult {
    baselineExecutionId?: number;
    currentExecutionId?: number;
    message?: string;
}

export function StepDiffViewer({ stepExecutionId, stepName }: StepDiffViewerProps) {
    const [open, setOpen] = useState(false);

    const { data: diffData, isLoading, error, refetch } = useQuery<DiffResponse>({
        queryKey: ['step-diff', stepExecutionId],
        queryFn: async () => {
            const response = await apiRequest('GET', `/api/diff/step-execution/${stepExecutionId}`);
            return response.json();
        },
        enabled: open, // Only fetch when dialog is open
        staleTime: 60000, // Cache for 1 minute
    });

    const hasChanges = diffData?.hasChanges ?? false;
    const changeCount = diffData?.changeCount ?? 0;

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-1.5">
                    <GitCompare className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">View Changes</span>
                    {hasChanges && (
                        <Badge variant="secondary" className="h-5 px-1.5 ml-1">
                            {changeCount}
                        </Badge>
                    )}
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <GitCompare className="h-5 w-5" />
                        Changes: {stepName}
                    </DialogTitle>
                    <DialogDescription>
                        Comparing current output against previous successful run
                    </DialogDescription>
                </DialogHeader>

                {isLoading ? (
                    <div className="flex items-center justify-center py-12">
                        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                        <span className="ml-2 text-muted-foreground">Loading diff...</span>
                    </div>
                ) : error ? (
                    <div className="text-center py-8 text-destructive">
                        <p>Failed to load diff</p>
                        <Button variant="outline" size="sm" onClick={() => refetch()} className="mt-4">
                            <RefreshCw className="h-4 w-4 mr-2" />
                            Retry
                        </Button>
                    </div>
                ) : diffData?.message ? (
                    <div className="text-center py-12 text-muted-foreground">
                        <GitCompare className="h-12 w-12 mx-auto mb-4 opacity-50" />
                        <p>{diffData.message}</p>
                    </div>
                ) : diffData ? (
                    <div className="space-y-4">
                        {diffData.baselineExecutionId && (
                            <div className="text-xs text-muted-foreground">
                                Comparing execution #{diffData.currentExecutionId} against #{diffData.baselineExecutionId}
                            </div>
                        )}
                        <DiffViewer
                            diff={diffData}
                            title={`Changes in ${stepName}`}
                            showRawView={true}
                        />
                    </div>
                ) : null}
            </DialogContent>
        </Dialog>
    );
}

export default StepDiffViewer;
