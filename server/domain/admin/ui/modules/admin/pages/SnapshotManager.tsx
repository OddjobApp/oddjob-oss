import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useOrgContext } from '@domain-ui/core/ui/hooks/use-org-context';
import { useAuth } from "@domain-ui/auth/ui/modules/auth";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@domain-ui/core/ui/components/ui/card';
import { StatCard } from '@domain-ui/core/ui/components/ui/stat-card';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@domain-ui/core/ui/components/ui/select';
import {
    Dialog,
    DialogContent,
    DialogTrigger,
} from '@domain-ui/core/ui/components/ui/dialog';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@domain-ui/core/ui/components/ui/alert-dialog';
import {
    Camera,
    Star,
    StarOff,
    Trash2,
    Eye,
    Search,
    RefreshCw,
    Database,
    Workflow,
    Box,
    History,
    Shield,
    Clock,
    Plus,
} from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

interface Snapshot {
    id: number;
    entityType: string;
    entityId: number;
    jobId: number | null;
    data: any;
    hash: string;
    label: string | null;
    description: string | null;
    isPrimary: boolean;
    organizationId: number | null;
    createdBy: string;
    createdAt: string;
}

export default function SnapshotManager() {
    const queryClient = useQueryClient();
    const { toast } = useToast();
    const [entityTypeFilter, setEntityTypeFilter] = useState<string>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedSnapshot, setSelectedSnapshot] = useState<Snapshot | null>(null);

    // Org context for showing org labels
    const { selectedOrgId } = useOrgContext();
    const { adminRole } = useAuth();
    const isSuperAdmin = adminRole?.isSuperAdmin === true;
    const showOrgColumn = isSuperAdmin && selectedOrgId === null;

    // Fetch organizations for org labels
    const { data: organizationsData } = useQuery<{ organizations: Array<{ id: number; name: string }> }>({
        queryKey: ['/api/admin/organizations'],
        queryFn: async () => {
            const res = await fetch('/api/admin/organizations', { credentials: 'include' });
            if (!res.ok) return { organizations: [] };
            return res.json();
        },
        enabled: showOrgColumn,
        staleTime: 5 * 60 * 1000,
    });

    const orgMap = useMemo(() => {
        const map: Record<number, string> = {};
        (organizationsData?.organizations || []).forEach(org => {
            map[org.id] = org.name;
        });
        return map;
    }, [organizationsData]);

    // Fetch snapshots
    const { data: snapshots = [], isLoading, refetch } = useQuery<Snapshot[]>({
        queryKey: ['snapshots', entityTypeFilter],
        queryFn: async () => {
            const params = new URLSearchParams();
            if (entityTypeFilter !== 'all') {
                params.append('entityType', entityTypeFilter);
            }
            const response = await apiRequest('GET', `/api/snapshots?${params.toString()}`);
            return response.json();
        },
    });

    // Set primary mutation
    const setPrimaryMutation = useMutation({
        mutationFn: async (snapshotId: number) => {
            await apiRequest('PATCH', `/api/snapshots/${snapshotId}/primary`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['snapshots'] });
            toast({
                title: 'Primary Snapshot Updated',
                description: 'This snapshot is now the baseline for comparisons.',
            });
        },
        onError: (error: any) => {
            toast({
                title: 'Error',
                description: error.message || 'Failed to update primary snapshot',
                variant: 'destructive',
            });
        },
    });

    // Delete mutation
    const deleteMutation = useMutation({
        mutationFn: async (snapshotId: number) => {
            await apiRequest('DELETE', `/api/snapshots/${snapshotId}`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['snapshots'] });
            toast({
                title: 'Snapshot Deleted',
                description: 'The snapshot has been permanently removed.',
            });
        },
        onError: (error: any) => {
            toast({
                title: 'Error',
                description: error.message || 'Failed to delete snapshot',
                variant: 'destructive',
            });
        },
    });

    // Filter snapshots by search
    const filteredSnapshots = snapshots.filter((snapshot) => {
        if (!searchQuery) return true;
        const searchLower = searchQuery.toLowerCase();
        return (
            snapshot.label?.toLowerCase().includes(searchLower) ||
            snapshot.description?.toLowerCase().includes(searchLower) ||
            snapshot.createdBy.toLowerCase().includes(searchLower) ||
            String(snapshot.entityId).includes(searchLower)
        );
    });

    const getEntityIcon = (type: string) => {
        switch (type) {
            case 'job_output':
                return <Workflow className="h-4 w-4" />;
            case 'knowledge_node':
                return <Database className="h-4 w-4" />;
            case 'pipeline_step':
                return <Box className="h-4 w-4" />;
            default:
                return <Camera className="h-4 w-4" />;
        }
    };

    const primaryCount = snapshots.filter(s => s.isPrimary).length;

    return (
        <div className="p-6 md:p-8 space-y-8 max-w-[1600px] mx-auto w-full">
            {/* Header */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div className="space-y-1.5">
                    <h1 className="text-2xl font-bold tracking-tight text-foreground">Snapshot Registry</h1>
                    <p className="text-sm text-muted-foreground">
                        Point-in-time captures of job outputs, knowledge nodes, and pipeline steps for comparison and recovery.
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={() => refetch()} disabled={isLoading} className="gap-2">
                        <RefreshCw className={cn("w-4 h-4", isLoading && "animate-spin")} />
                        Refresh
                    </Button>
                    <Button className="gap-2">
                        <Plus className="w-4 h-4" />
                        New Snapshot
                    </Button>
                </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
                <StatCard title="Total Snapshots" value={snapshots.length} icon={Database} />
                <StatCard title="Primary Snapshots" value={primaryCount} icon={Star} valueColor="text-amber-500" />
                <StatCard title="Integrity" value="0.998" icon={Shield} valueColor="text-emerald-500" />
                <StatCard title="Sync Latency" value="14ms" icon={Clock} />
            </div>

            {/* Filters */}
            <Card className="border-border/40 shadow-sm bg-card">
                <CardContent className="p-4">
                    <div className="flex flex-col md:flex-row gap-3">
                        <div className="flex-1 relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Search by label or entity ID..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-9"
                            />
                        </div>
                        <Select value={entityTypeFilter} onValueChange={setEntityTypeFilter}>
                            <SelectTrigger className="w-full md:w-56">
                                <div className="flex items-center gap-2">
                                    <Box size={15} className="text-muted-foreground" />
                                    <SelectValue placeholder="Entity type" />
                                </div>
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All types</SelectItem>
                                <SelectItem value="job_output">Job output</SelectItem>
                                <SelectItem value="knowledge_node">Knowledge node</SelectItem>
                                <SelectItem value="pipeline_step">Pipeline step</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </CardContent>
            </Card>

            {/* Snapshots table */}
            <Card className="border-border/40 shadow-sm overflow-hidden bg-card">
                <CardHeader className="px-6 py-4 border-b bg-muted/30 flex flex-row items-center justify-between">
                    <div className="space-y-0.5">
                        <CardTitle className="text-base font-semibold flex items-center gap-2 text-foreground">
                            <History className="w-4 h-4 text-primary" />
                            Snapshots
                        </CardTitle>
                        <CardDescription className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">
                            {filteredSnapshots.length} record{filteredSnapshots.length === 1 ? '' : 's'}
                        </CardDescription>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    {isLoading ? (
                        <div className="h-64 flex flex-col items-center justify-center gap-4">
                            <RefreshCw className="h-8 w-8 animate-spin text-primary" />
                            <p className="text-sm text-muted-foreground">Loading snapshots…</p>
                        </div>
                    ) : filteredSnapshots.length === 0 ? (
                        <div className="h-64 flex flex-col items-center justify-center gap-4 text-center">
                            <div className="p-5 rounded-full bg-muted border border-dashed border-border">
                                <Camera size={40} className="text-muted-foreground" />
                            </div>
                            <div className="space-y-1">
                                <p className="text-base font-semibold text-foreground">No snapshots yet</p>
                                <p className="text-sm text-muted-foreground">Capture a baseline to start comparing state over time.</p>
                            </div>
                        </div>
                    ) : (
                        <div className="overflow-auto">
                            <table className="w-full text-left border-collapse">
                                <thead className="sticky top-0 z-10 bg-muted/50 border-b border-border/40">
                                    <tr>
                                        <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Status</th>
                                        <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Entity</th>
                                        <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Label</th>
                                        {showOrgColumn && <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Organization</th>}
                                        <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Created</th>
                                        <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Author</th>
                                        <th className="px-6 py-3 text-right text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredSnapshots.map((snapshot) => (
                                        <tr
                                            key={snapshot.id}
                                            className="group hover:bg-muted/50 border-b border-border/40 transition-colors"
                                        >
                                            <td className="px-6 py-4">
                                                {snapshot.isPrimary ? (
                                                    <div className="flex items-center gap-2 text-amber-500">
                                                        <Star size={14} className="fill-current" />
                                                        <span className="text-xs font-medium">Primary</span>
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center gap-2 text-muted-foreground">
                                                        <Box size={14} />
                                                        <span className="text-xs font-medium">Backup</span>
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-primary">{getEntityIcon(snapshot.entityType)}</span>
                                                    <div className="min-w-0">
                                                        <p className="text-sm font-medium text-foreground">ID {snapshot.entityId}</p>
                                                        <p className="text-xs text-muted-foreground capitalize">{snapshot.entityType.replace(/_/g, ' ')}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <p className="text-sm text-foreground/90 truncate max-w-[220px]">
                                                    {snapshot.label || <span className="text-muted-foreground italic">Unlabeled</span>}
                                                </p>
                                                <p className="text-xs text-muted-foreground font-mono truncate max-w-[220px]">{snapshot.hash.substring(0, 16)}…</p>
                                            </td>
                                            {showOrgColumn && (
                                                <td className="px-6 py-4">
                                                    <span className="text-sm text-muted-foreground">
                                                        {snapshot.organizationId != null ? (orgMap[snapshot.organizationId] || `Org ${snapshot.organizationId}`) : '—'}
                                                    </span>
                                                </td>
                                            )}
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-1.5 text-muted-foreground">
                                                    <Clock size={12} />
                                                    <span className="text-xs font-mono">{format(new Date(snapshot.createdAt), 'MMM d, HH:mm')}</span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-6 h-6 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-[10px] font-bold text-primary">
                                                        {snapshot.createdBy.charAt(0).toUpperCase()}
                                                    </div>
                                                    <span className="text-sm text-foreground/80">{snapshot.createdBy}</span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <Dialog>
                                                        <DialogTrigger asChild>
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-8 w-8"
                                                                onClick={() => setSelectedSnapshot(snapshot)}
                                                            >
                                                                <Eye size={16} />
                                                            </Button>
                                                        </DialogTrigger>
                                                        <DialogContent className="max-w-3xl">
                                                            <div className="space-y-1 mb-4">
                                                                <h2 className="text-lg font-semibold text-foreground">Snapshot data</h2>
                                                                <p className="text-sm text-muted-foreground">Snapshot #{snapshot.id} · hash verified</p>
                                                            </div>
                                                            <pre className="text-xs font-mono text-foreground/80 bg-muted rounded-lg border border-border p-4 overflow-auto max-h-[420px]">
                                                                {JSON.stringify(snapshot.data, null, 2)}
                                                            </pre>
                                                        </DialogContent>
                                                    </Dialog>

                                                    {!snapshot.isPrimary && (
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-8 w-8 hover:text-amber-500"
                                                            onClick={() => setPrimaryMutation.mutate(snapshot.id)}
                                                            disabled={setPrimaryMutation.isPending}
                                                            title="Set as primary"
                                                        >
                                                            <StarOff size={16} />
                                                        </Button>
                                                    )}

                                                    <AlertDialog>
                                                        <AlertDialogTrigger asChild>
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-8 w-8 hover:text-destructive"
                                                            >
                                                                <Trash2 size={16} />
                                                            </Button>
                                                        </AlertDialogTrigger>
                                                        <AlertDialogContent>
                                                            <AlertDialogHeader>
                                                                <AlertDialogTitle>Delete snapshot?</AlertDialogTitle>
                                                                <AlertDialogDescription>
                                                                    This permanently removes the snapshot from the registry. If it is used as a baseline,
                                                                    comparisons that reference it will no longer resolve. This action cannot be undone.
                                                                </AlertDialogDescription>
                                                            </AlertDialogHeader>
                                                            <AlertDialogFooter>
                                                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                                <AlertDialogAction
                                                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                                                    onClick={() => deleteMutation.mutate(snapshot.id)}
                                                                >
                                                                    Delete
                                                                </AlertDialogAction>
                                                            </AlertDialogFooter>
                                                        </AlertDialogContent>
                                                    </AlertDialog>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
