
import { useState, useMemo } from 'react';
import { Link } from 'wouter';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useOrgContext } from '@domain-ui/core/ui/hooks/use-org-context';
import { useAuth } from "@domain-ui/auth/ui/modules/auth";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@domain-ui/core/ui/components/ui/card';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Textarea } from '@domain-ui/core/ui/components/ui/textarea';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import type { FineTuningDataset } from "@shared/schema/training";
import { Database, Plus, Trash2, Building2 } from 'lucide-react';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';

export default function DatasetsPage() {
    const { toast } = useToast();
    const [isCreating, setIsCreating] = useState(false);
    const [newDataset, setNewDataset] = useState({ name: '', description: '' });

    // Org context for showing org labels
    const { selectedOrgId } = useOrgContext();
    const { adminRole } = useAuth();
    const isSuperAdmin = adminRole?.isSuperAdmin === true;
    const showOrgBadge = isSuperAdmin && selectedOrgId === null;

    // Fetch organizations for org labels
    const { data: organizationsData } = useQuery<{ organizations: Array<{ id: number; name: string }> }>({
        queryKey: ['/api/admin/organizations'],
        queryFn: async () => {
            const res = await fetch('/api/admin/organizations', { credentials: 'include' });
            if (!res.ok) return { organizations: [] };
            return res.json();
        },
        enabled: showOrgBadge,
        staleTime: 5 * 60 * 1000,
    });
    const orgMap = useMemo(() => {
        const map: Record<number, string> = {};
        (organizationsData?.organizations || []).forEach(org => {
            map[org.id] = org.name;
        });
        return map;
    }, [organizationsData]);

    const { data: datasets, isLoading } = useQuery<FineTuningDataset[]>({
        queryKey: ['/api/fine-tuning/datasets'],
        queryFn: async () => {
            // Assuming this endpoint exists based on schema, if not we'd need to create it server-side.
            // For now, mirroring standard structure.
            const res = await apiRequest('GET', '/api/fine-tuning/datasets');
            return res.json();
        },
    });

    const createMutation = useMutation({
        mutationFn: async () => {
            const res = await apiRequest('POST', '/api/fine-tuning/datasets', newDataset);
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['/api/fine-tuning/datasets'] });
            setIsCreating(false);
            setNewDataset({ name: '', description: '' });
            toast({ title: 'Dataset created successfully' });
        },
        onError: (error: Error) => {
            toast({ title: 'Failed to create dataset', description: error.message, variant: 'destructive' });
        },
    });

    const deleteMutation = useMutation({
        mutationFn: async (id: number) => {
            await apiRequest('DELETE', `/api/fine-tuning/datasets/${id}`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['/api/fine-tuning/datasets'] });
            toast({ title: 'Dataset deleted' });
        },
    });

    return (
        <div className="space-y-6 max-w-none mx-auto p-4 md:p-12">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-semibold flex items-center gap-2">
                        <Database className="w-6 h-6 text-indigo-600" />
                        Datasets
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Manage training datasets (Golden Records) for fine-tuning and evaluation.
                    </p>
                </div>
                <Button onClick={() => setIsCreating(!isCreating)}>
                    {isCreating ? 'Cancel' : <><Plus className="w-4 h-4 mr-2" /> New Dataset</>}
                </Button>
            </div>

            {isCreating && (
                <Card className="border-indigo-100 bg-indigo-50/50">
                    <CardHeader>
                        <CardTitle className="text-lg">Create New Dataset</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="name">Dataset Name</Label>
                            <Input
                                id="name"
                                value={newDataset.name}
                                onChange={(e) => setNewDataset({ ...newDataset, name: e.target.value })}
                                placeholder="e.g. JIRA Classification V1"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="description">Description</Label>
                            <Textarea
                                id="description"
                                value={newDataset.description}
                                onChange={(e) => setNewDataset({ ...newDataset, description: e.target.value })}
                                placeholder="What is this dataset for?"
                            />
                        </div>
                        <Button
                            onClick={() => createMutation.mutate()}
                            disabled={!newDataset.name || createMutation.isPending}
                        >
                            {createMutation.isPending ? 'Creating...' : 'Create Dataset'}
                        </Button>
                    </CardContent>
                </Card>
            )}

            {isLoading ? (
                <div className="text-center py-12 text-muted-foreground">Loading datasets...</div>
            ) : datasets?.length === 0 ? (
                <Card>
                    <CardContent className="py-12 text-center text-muted-foreground">
                        No datasets found. Create one to get started.
                    </CardContent>
                </Card>
            ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {datasets?.map((dataset) => (
                        <Card key={dataset.id} className="group relative overflow-hidden transition-all hover:shadow-md">
                            <CardHeader className="pb-3">
                                <div className="flex justify-between items-start">
                                    <CardTitle className="text-base font-medium truncate pr-8" title={dataset.name}>
                                        <Link href={`/knowledge/fine-tuning/datasets/${dataset.id}`} className="hover:underline cursor-pointer">
                                            {dataset.name}
                                        </Link>
                                    </CardTitle>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 absolute top-4 right-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                                        onClick={() => {
                                            if (confirm('Are you sure you want to delete this dataset?')) {
                                                deleteMutation.mutate(dataset.id);
                                            }
                                        }}
                                    >
                                        <Trash2 className="w-4 h-4 text-red-500" />
                                    </Button>
                                </div>
                                <CardDescription className="line-clamp-2 min-h-[40px]">
                                    {dataset.description || "No description provided."}
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                {showOrgBadge && (
                                    <div className="mb-2">
                                        {(dataset as any).organizationId ? (
                                            <Badge variant="outline" className="text-xs font-normal">
                                                <Building2 className="w-3 h-3 mr-1" />
                                                {orgMap[(dataset as any).organizationId] || `Org #${(dataset as any).organizationId}`}
                                            </Badge>
                                        ) : (
                                            <span className="text-xs text-muted-foreground">Global</span>
                                        )}
                                    </div>
                                )}
                                <div className="flex items-center justify-between text-xs text-muted-foreground mt-2">
                                    <span>ID: {dataset.id}</span>
                                    <span>{new Date(dataset.createdAt).toLocaleDateString()}</span>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );
}

