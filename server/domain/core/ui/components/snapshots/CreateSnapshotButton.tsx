import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@domain-ui/core/ui/components/ui/dialog';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Textarea } from '@domain-ui/core/ui/components/ui/textarea';
import { Checkbox } from '@domain-ui/core/ui/components/ui/checkbox';
import { Camera, Loader2 } from 'lucide-react';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';

interface CreateSnapshotButtonProps {
    entityType: 'job_output' | 'knowledge_node' | 'pipeline_step';
    entityId: number;
    jobId?: number;
    data: any;
    defaultLabel?: string;
}

export function CreateSnapshotButton({
    entityType,
    entityId,
    jobId,
    data,
    defaultLabel,
}: CreateSnapshotButtonProps) {
    const [open, setOpen] = useState(false);
    const [label, setLabel] = useState(defaultLabel || '');
    const [description, setDescription] = useState('');
    const [isPrimary, setIsPrimary] = useState(false);
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const createSnapshotMutation = useMutation({
        mutationFn: async () => {
            // Ensure data is an object
            const snapshotData = typeof data === 'string' ? JSON.parse(data) : data;

            await apiRequest('POST', '/api/snapshots', {
                entityType,
                entityId,
                jobId,
                data: snapshotData,
                label: label || `Snapshot ${new Date().toLocaleString()}`,
                description,
                isPrimary,
            });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['snapshots'] });
            toast({
                title: 'Snapshot Created',
                description: 'Baseline snapshot has been saved successfully.',
            });
            setOpen(false);
            // Reset form
            setLabel(defaultLabel || '');
            setDescription('');
            setIsPrimary(false);
        },
        onError: (error: any) => {
            toast({
                title: 'Error',
                description: error.message || 'Failed to create snapshot',
                variant: 'destructive',
            });
        },
    });

    const handleCreate = () => {
        try {
            // Validate data is JSON
            if (typeof data === 'string') {
                JSON.parse(data);
            }
            createSnapshotMutation.mutate();
        } catch (e) {
            toast({
                title: 'Invalid Data',
                description: 'Output content must be valid JSON to be snapshotted.',
                variant: 'destructive',
            });
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                    <Camera className="w-4 h-4 mr-2" />
                    Snapshot
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Create Baseline Snapshot</DialogTitle>
                    <DialogDescription>
                        Save the current output as a baseline for future comparisons.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="label" className="text-right">
                            Label
                        </Label>
                        <Input
                            id="label"
                            value={label}
                            onChange={(e) => setLabel(e.target.value)}
                            placeholder="e.g., Q1 Success Baseline"
                            className="col-span-3"
                        />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="description" className="text-right">
                            Description
                        </Label>
                        <Textarea
                            id="description"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Optional notes..."
                            className="col-span-3"
                        />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <div className="text-right">
                            <Checkbox
                                id="isPrimary"
                                checked={isPrimary}
                                onCheckedChange={(checked) => setIsPrimary(checked === true)}
                            />
                        </div>
                        <Label htmlFor="isPrimary" className="col-span-3 cursor-pointer">
                            Set as Primary Baseline
                        </Label>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => setOpen(false)}>
                        Cancel
                    </Button>
                    <Button onClick={handleCreate} disabled={createSnapshotMutation.isPending}>
                        {createSnapshotMutation.isPending && (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        )}
                        Create Snapshot
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

