
import React from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@domain-ui/core/ui/components/ui/dialog";
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Loader2, ArrowRight } from 'lucide-react';
import { ScrollArea } from '@domain-ui/core/ui/components/ui/scroll-area';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';

interface VersionDiffDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    entityType: 'job' | 'pipeline';
    entityId: number;
    versionId: number;
    versionNumber: number;
}

interface DiffOperation {
    op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';
    path: string;
    value?: any;
    oldValue?: any; // Custom field if backend provides it, otherwise we only have new value
}

export function VersionDiffDialog({
    open,
    onOpenChange,
    entityType,
    entityId,
    versionId,
    versionNumber
}: VersionDiffDialogProps) {

    const { data: diffs, isLoading } = useQuery<DiffOperation[]>({
        queryKey: [entityType, entityId, 'versions', versionId, 'diff'],
        queryFn: async () => {
            const res = await apiRequest("GET", `/api/${entityType}s/${entityId}/versions/${versionId}/diff`);
            return res.json();
        },
        enabled: open && !!versionId,
    });

    const getOpBadge = (op: string) => {
        switch (op) {
            case 'add': return <Badge variant="default" className="bg-green-100 text-green-800">Added</Badge>;
            case 'remove': return <Badge variant="destructive">Removed</Badge>;
            case 'replace': return <Badge variant="default" className="bg-blue-100 text-blue-800">Changed</Badge>;
            default: return <Badge variant="secondary">{op}</Badge>;
        }
    };

    const formatValue = (val: any) => {
        if (typeof val === 'object') return <pre className="text-xs bg-slate-50 p-1 rounded">{JSON.stringify(val, null, 2)}</pre>;
        return String(val);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Version {versionNumber} vs Current</DialogTitle>
                    <DialogDescription>
                        Changes required to revert from Current to Version {versionNumber}.
                        (Note: This diff shows how to go *back* to this version).
                    </DialogDescription>
                </DialogHeader>

                <ScrollArea className="h-[400px] mt-4 border rounded-md p-4">
                    {isLoading ? (
                        <div className="flex justify-center p-8">
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : !diffs || diffs.length === 0 ? (
                        <div className="text-center p-8 text-muted-foreground">
                            No differences found (Identical to current).
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {diffs.map((diff, idx) => (
                                <div key={idx} className="flex flex-col gap-2 p-3 border-b last:border-0 hover:bg-slate-50">
                                    <div className="flex items-center gap-2">
                                        {getOpBadge(diff.op)}
                                        <code className="text-sm font-mono bg-slate-100 px-1 rounded text-slate-700">
                                            {diff.path}
                                        </code>
                                    </div>

                                    <div className="pl-20 text-sm">
                                        {diff.op === 'replace' && (
                                            <div className="flex items-center gap-2">
                                                <span className="text-muted-foreground">New Value:</span>
                                                <div className="font-mono text-foreground font-medium">
                                                    {formatValue(diff.value)}
                                                </div>
                                            </div>
                                        )}
                                        {diff.op === 'add' && (
                                            <div className="flex items-center gap-2">
                                                <span className="text-muted-foreground">Value:</span>
                                                <div className="font-mono text-foreground font-medium">
                                                    {formatValue(diff.value)}
                                                </div>
                                            </div>
                                        )}
                                        {diff.op === 'remove' && (
                                            <span className="text-muted-foreground italic">Property removed</span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </ScrollArea>
            </DialogContent>
        </Dialog>
    );
}
