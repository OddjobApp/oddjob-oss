
import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Progress } from '@domain-ui/core/ui/components/ui/progress';
import { Separator } from '@domain-ui/core/ui/components/ui/separator';
import { RefreshCw, Download, Trash2, Server, Globe } from 'lucide-react';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

interface OllamaModel {
    name: string;
    size: number;
    digest: string;
    details: {
        format: string;
        family: string;
        families: string[];
        parameter_size: string;
        quantization_level: string;
    };
}

export default function LocalAiSettings() {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [pullModelName, setPullModelName] = useState('');
    const [isPulling, setIsPulling] = useState(false);

    // Fetch Ollama Version / Status
    const { data: statusData, isLoading: isStatusLoading, refetch: refetchStatus } = useQuery({
        queryKey: ['/api/ollama/version'],
        queryFn: async () => {
            const res = await fetch('/api/ollama/version');
            if (!res.ok) throw new Error('Failed to fetch Ollama status');
            return res.json();
        },
        refetchInterval: 30000,
        retry: false,
    });

    // Fetch Models
    const { data: modelsData, isLoading: isModelsLoading, refetch: refetchModels } = useQuery({
        queryKey: ['/api/ollama/tags'],
        queryFn: async () => {
            const res = await fetch('/api/ollama/tags');
            if (!res.ok) throw new Error('Failed to fetch models');
            return res.json();
        },
        enabled: !!statusData, // Only fetch models if service is reachable
    });

    // Pull Model Mutation
    const pullModelMutation = useMutation({
        mutationFn: async (modelName: string) => {
            const res = await fetch('/api/ollama/pull', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: modelName }),
            });
            if (!res.ok) {
                const error = await res.json();
                throw new Error(error.message || 'Failed to start pull');
            }
            return res.json();
        },
        onSuccess: () => {
            setIsPulling(true);
            setPullModelName('');
            toast({
                title: 'Pull Started',
                description: `Model download started. Check server logs for progress.`,
            });
            // In a real implementation, we'd poll for progress or use a websocket. 
            // For now, we just simulate a "busy" state or tell user it's backgrounded.
            setTimeout(() => {
                setIsPulling(false);
                refetchModels();
            }, 5000);
        },
        onError: (error: Error) => {
            toast({
                title: 'Pull Failed',
                description: error.message,
                variant: 'destructive',
            });
        },
    });

    // Delete Model Mutation
    const deleteModelMutation = useMutation({
        mutationFn: async (modelName: string) => {
            const res = await fetch('/api/ollama/delete', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: modelName }),
            });
            if (!res.ok) throw new Error('Failed to delete model');
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['/api/ollama/tags'] });
            toast({
                title: 'Model Deleted',
                description: 'The model has been removed successfully.',
            });
        },
        onError: (error: Error) => {
            toast({
                title: 'Delete Failed',
                description: error.message,
                variant: 'destructive',
            });
        },
    });

    const formatSize = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <div className="flex items-center gap-2">
                        <Server className="w-5 h-5 text-primary" />
                        <CardTitle>Service Status</CardTitle>
                    </div>
                    <CardDescription>Connection to local Ollama instance</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex items-center justify-between">
                        <div className="space-y-1">
                            <Label>Ollama Service</Label>
                            <div className="flex items-center gap-2">
                                <span className={`h-2 w-2 rounded-full ${statusData ? 'bg-green-500' : 'bg-red-500'}`} />
                                <span className="text-sm text-muted-foreground">
                                    {isStatusLoading ? 'Checking...' : statusData ? `Connected (v${statusData.version})` : 'Disconnected'}
                                </span>
                            </div>
                        </div>
                        <Button variant="outline" size="sm" onClick={async () => {
                            const result = await refetchStatus();
                            if (result.data) {
                                toast({
                                    title: "Connection Successful",
                                    description: `Ollama v${result.data.version} is running`,
                                });
                            } else {
                                toast({
                                    title: "Connection Failed",
                                    description: "Could not connect to Ollama service. Make sure it's running.",
                                    variant: "destructive",
                                });
                            }
                        }}>
                            <RefreshCw className={`w-4 h-4 mr-2 ${isStatusLoading ? 'animate-spin' : ''}`} />
                            Check Connection
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <div className="flex items-center gap-2">
                        <Download className="w-5 h-5 text-primary" />
                        <CardTitle>Pull New Model</CardTitle>
                    </div>
                    <CardDescription>Download models from the Ollama library</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex gap-4">
                        <Input
                            placeholder="e.g. llama3, mistral, gemma:2b"
                            value={pullModelName}
                            onChange={(e) => setPullModelName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && pullModelName && pullModelMutation.mutate(pullModelName)}
                        />
                        <Button
                            onClick={() => pullModelMutation.mutate(pullModelName)}
                            disabled={!pullModelName || pullModelMutation.isPending || isPulling}
                        >
                            {pullModelMutation.isPending || isPulling ? 'Pulling...' : 'Pull Model'}
                        </Button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                        Common models: <code className="bg-muted px-1 rounded">llama3</code>, <code className="bg-muted px-1 rounded">mistral</code>, <code className="bg-muted px-1 rounded">gemma:2b</code>.
                        See <a href="https://ollama.com/library" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Ollama Library</a> for more.
                    </p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Globe className="w-5 h-5 text-primary" />
                            <CardTitle>Installed Models</CardTitle>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => refetchModels()}>
                            <RefreshCw className={`w-4 h-4 ${isModelsLoading ? 'animate-spin' : ''}`} />
                        </Button>
                    </div>
                    <CardDescription>Manage locally available models</CardDescription>
                </CardHeader>
                <CardContent>
                    {isModelsLoading ? (
                        <div className="text-center py-8 text-muted-foreground">Loading models...</div>
                    ) : !statusData ? (
                        <div className="text-center py-8 text-red-500">Ollama service not reachable.</div>
                    ) : (modelsData?.models?.length || 0) === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">No models installed.</div>
                    ) : (
                        <div className="space-y-4">
                            {modelsData.models.map((model: OllamaModel) => (
                                <div key={model.digest} className="flex items-center justify-between p-4 border rounded-lg bg-card hover:bg-accent/5 transition-colors">
                                    <div className="space-y-1">
                                        <div className="font-medium flex items-center gap-2">
                                            {model.name}
                                            <Badge variant="secondary" className="text-xs">{model.details.parameter_size}</Badge>
                                            <Badge variant="outline" className="text-xs">{model.details.quantization_level}</Badge>
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            Size: {formatSize(model.size)} • Family: {model.details.family} • Format: {model.details.format}
                                        </p>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                        onClick={() => {
                                            if (confirm(`Are you sure you want to delete ${model.name}?`)) {
                                                deleteModelMutation.mutate(model.name);
                                            }
                                        }}
                                        disabled={deleteModelMutation.isPending}
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </Button>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

