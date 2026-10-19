
import { useState } from 'react';
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
import { AlertTriangle, Plus, Minus, Type, AlertCircle } from 'lucide-react';

interface SchemaChange {
    type: 'FIELD_ADDED' | 'FIELD_REMOVED' | 'TYPE_CHANGED' | 'NULLABILITY_CHANGED';
    path: string;
    oldValue?: string;
    newValue?: string;
    description: string;
}

interface SchemaDiffResponse {
    hasChanges: boolean;
    breakingChanges: SchemaChange[];
    nonBreakingChanges: SchemaChange[];
    failure?: string; // If diff failed or no baseline
    reason?: string;
}

export function SchemaDiffViewer({ stepExecutionId }: { stepExecutionId: number }) {
    const [isOpen, setIsOpen] = useState(false);

    const { data: diff, isLoading } = useQuery<SchemaDiffResponse>({
        queryKey: ['schema-diff', stepExecutionId],
        queryFn: async () => {
            const res = await fetch(`/api/pipeline-step-executions/${stepExecutionId}/schema-diff`);
            if (!res.ok) throw new Error('Failed to fetch schema diff');
            return res.json();
        },
        enabled: !!stepExecutionId,
    });

    if (isLoading || !diff) return null;

    // Don't show anything if no changes, unless we want to show positive confirmation
    if (!diff.hasChanges) return null;

    const totalChanges = (diff.breakingChanges?.length || 0) + (diff.nonBreakingChanges?.length || 0);
    const isbreaking = (diff.breakingChanges?.length || 0) > 0;

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <Button
                    variant="outline"
                    size="sm"
                    className={`gap-2 ${isbreaking ? 'border-amber-500 text-amber-600 hover:bg-amber-50' : 'border-blue-200 text-blue-600 hover:bg-blue-50'}`}
                >
                    {isbreaking ? <AlertTriangle className="h-3.5 w-3.5" /> : <Type className="h-3.5 w-3.5" />}
                    {isbreaking ? 'Schema Mismatch' : 'Schema Changed'}
                    <Badge variant="secondary" className="h-4 px-1 ml-1 text-[10px] min-w-[1.25rem]">{totalChanges}</Badge>
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        {isbreaking ? <AlertTriangle className="h-5 w-5 text-amber-500" /> : <Type className="h-5 w-5 text-blue-500" />}
                        Schema Output Changes
                    </DialogTitle>
                    <DialogDescription>
                        Compared to the previous successful execution of this step.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-6 py-4">
                    {diff.breakingChanges && diff.breakingChanges.length > 0 && (
                        <div className="space-y-3">
                            <h4 className="text-sm font-semibold flex items-center gap-2 text-destructive">
                                <AlertCircle className="h-4 w-4" /> Breaking Changes
                            </h4>
                            <div className="space-y-2">
                                {diff.breakingChanges.map((change, i) => (
                                    <ChangeRow key={i} change={change} variant="breaking" />
                                ))}
                            </div>
                        </div>
                    )}

                    {diff.nonBreakingChanges && diff.nonBreakingChanges.length > 0 && (
                        <div className="space-y-3">
                            <h4 className="text-sm font-semibold flex items-center gap-2 text-muted-foreground">
                                <Type className="h-4 w-4" /> Non-Breaking Changes
                            </h4>
                            <div className="space-y-2">
                                {diff.nonBreakingChanges.map((change, i) => (
                                    <ChangeRow key={i} change={change} variant="non-breaking" />
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}

function ChangeRow({ change, variant }: { change: SchemaChange, variant: 'breaking' | 'non-breaking' }) {
    let Icon = Type;
    let colorClass = "bg-muted text-foreground";

    switch (change.type) {
        case 'FIELD_ADDED':
            Icon = Plus;
            colorClass = "bg-green-100 text-green-700";
            break;
        case 'FIELD_REMOVED':
            Icon = Minus;
            colorClass = "bg-red-100 text-red-700";
            break;
        case 'TYPE_CHANGED':
            Icon = Type;
            colorClass = "bg-amber-100 text-amber-700";
            break;
    }

    return (
        <div className="flex items-start gap-3 p-3 rounded-md border text-sm">
            <div className={`p-1.5 rounded-full shrink-0 ${colorClass}`}>
                <Icon className="h-3.5 w-3.5" />
            </div>
            <div className="flex-1 space-y-1">
                <div className="font-medium font-mono text-xs">{change.path}</div>
                <p className="text-muted-foreground">{change.description}</p>
                {(change.oldValue || change.newValue) && (
                    <div className="text-xs bg-muted p-1.5 rounded flex gap-4 mt-1">
                        {change.oldValue && <div><span className="opacity-50 line-through mr-1">{change.oldValue}</span></div>}
                        {change.newValue && <div className="font-medium">→ {change.newValue}</div>}
                    </div>
                )}
            </div>
        </div>
    );
}
