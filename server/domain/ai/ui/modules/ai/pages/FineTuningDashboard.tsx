import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle
} from "@domain-ui/core/ui/components/ui/card";
import { StatCard } from "@domain-ui/core/ui/components/ui/stat-card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@domain-ui/core/ui/components/ui/table";
import {
    Brain,
    Database,
    Zap,
    Upload,
    Plus,
    Play,
    History,
    Activity,
    Cpu,
    Trash2,
    Search,
    Loader2
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";

export default function FineTuningDashboard() {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [searchTerm, setSearchTerm] = useState("");

    const {
        data: realDatasets,
        isLoading,
        isError,
        error
    } = useQuery<any[]>({
        queryKey: ["/api/fine-tuning/datasets"],
        retry: 1,
        refetchOnWindowFocus: false
    });

    const { data: stats } = useQuery<any>({
        queryKey: ["/api/fine-tuning/stats"],
        retry: 1,
        refetchOnWindowFocus: false
    });

    const datasets = React.useMemo(() => {
        return realDatasets || [];
    }, [realDatasets]);

    const createDatasetMutation = useMutation({
        mutationFn: async (data: { name: string, description?: string }) => {
            const res = await apiRequest("POST", "/api/fine-tuning/datasets", data);
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/fine-tuning/datasets"] });
            toast({ title: "Dataset created", description: "A new dataset is ready to collect training examples." });
        },
        onError: (err: any) => {
            toast({
                title: "Creation failed",
                description: err.message || "Failed to create the dataset.",
                variant: "destructive"
            });
        }
    });

    const deleteDatasetMutation = useMutation({
        mutationFn: async (id: number) => {
            await apiRequest("DELETE", `/api/fine-tuning/datasets/${id}`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/fine-tuning/datasets"] });
            toast({ title: "Dataset deleted", description: "The dataset and all its examples have been removed." });
        },
        onError: (err: any) => {
            toast({
                title: "Delete failed",
                description: err.message || "Failed to delete the dataset.",
                variant: "destructive"
            });
        }
    });

    const startTrainingMutation = useMutation({
        mutationFn: async (id: number) => {
            const res = await apiRequest("POST", `/api/fine-tuning/datasets/${id}/train`, {});
            return res.json();
        },
        onSuccess: (data) => {
            toast({
                title: "Training started",
                description: `Run ${data.runId || ''} has been queued.`
            });
        },
        onError: (err: any) => {
            toast({
                title: "Failed to start training",
                description: err.message || "Failed to start the training run.",
                variant: "destructive"
            });
        }
    });

    const [isCreating, setIsCreating] = useState(false);
    const [newName, setNewName] = useState("");
    const [newDescription, setNewDescription] = useState("");

    const filteredDatasets = datasets?.filter(d =>
        d.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        d.description?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="p-6 md:p-8 space-y-8 max-w-[1600px] mx-auto w-full">
            {/* Header */}
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div className="space-y-1.5">
                    <h1 className="text-2xl font-bold tracking-tight text-foreground">Fine-Tuning</h1>
                    <p className="text-sm text-muted-foreground">
                        Manage training datasets and LoRA adapters for model-specific tuning.
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                            placeholder="Search datasets…"
                            className="w-[240px] pl-9"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <Button className="gap-2" onClick={() => setIsCreating(true)}>
                        <Plus className="w-4 h-4" /> New Dataset
                    </Button>
                </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
                <StatCard title="Total Datasets" value={stats?.totalDatasets ?? 0} icon={Database} />
                <StatCard title="Examples Processed" value={stats?.totalExamples ?? 0} icon={Brain} />
                <StatCard
                    title="Active Training"
                    value={stats?.activeTraining ?? 0}
                    icon={Cpu}
                    valueColor={(stats?.activeTraining ?? 0) > 0 ? "text-emerald-500" : "text-foreground"}
                />
                <StatCard title="Adapters Deployed" value={stats?.adaptersDeployed ?? 0} icon={Zap} valueColor="text-amber-500" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Left: Dataset list */}
                <div className="lg:col-span-8">
                    <Card className="border-border/40 shadow-sm overflow-hidden bg-card">
                        <CardHeader className="px-6 py-4 border-b bg-muted/30 flex flex-row items-center justify-between">
                            <div className="space-y-0.5">
                                <CardTitle className="text-base font-semibold flex items-center gap-2 text-foreground">
                                    <History className="w-4 h-4 text-primary" /> Datasets
                                </CardTitle>
                                <CardDescription className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">
                                    Model-specific training corpora
                                </CardDescription>
                            </div>
                            <Badge variant="outline" className="text-[10px] font-bold uppercase tracking-widest">
                                {datasets?.length ?? 0} {datasets?.length === 1 ? 'entry' : 'entries'}
                            </Badge>
                        </CardHeader>
                        <CardContent className="p-0">

                            {isLoading && (!datasets || datasets.length === 0) ? (
                                <div className="p-16 text-center space-y-4">
                                    <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
                                    <p className="text-sm text-muted-foreground">Loading datasets…</p>
                                </div>
                            ) : isError ? (
                                <div className="p-16 text-center space-y-4">
                                    <div className="w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center mx-auto text-destructive">
                                        <Activity className="w-7 h-7" />
                                    </div>
                                    <div className="space-y-1">
                                        <p className="text-base font-semibold text-foreground">Couldn't load datasets</p>
                                        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                                            {error instanceof Error ? error.message : "The service returned an unexpected response."}
                                        </p>
                                    </div>
                                    <Button
                                        variant="outline"
                                        onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/fine-tuning/datasets"] })}
                                    >
                                        Retry
                                    </Button>
                                </div>
                            ) : datasets?.length === 0 ? (
                                <div className="p-16 text-center space-y-4">
                                    <div className="w-16 h-16 rounded-full bg-muted border border-dashed border-border flex items-center justify-center mx-auto">
                                        <Database className="w-7 h-7 text-muted-foreground" />
                                    </div>
                                    <div className="space-y-1">
                                        <p className="text-base font-semibold text-foreground">No datasets yet</p>
                                        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                                            Create a dataset to start collecting model-specific training examples.
                                        </p>
                                    </div>
                                    <Button variant="outline" className="gap-2" onClick={() => setIsCreating(true)}>
                                        <Plus className="w-4 h-4" /> Create first dataset
                                    </Button>
                                </div>
                            ) : (
                                <Table>
                                    <TableHeader className="bg-muted/50">
                                        <TableRow className="border-border/40 hover:bg-transparent">
                                            <TableHead className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground pl-6">Name</TableHead>
                                            <TableHead className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground text-center">Examples</TableHead>
                                            <TableHead className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Age</TableHead>
                                            <TableHead className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground text-right pr-6">Actions</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {filteredDatasets?.map((d) => (
                                            <TableRow key={d.id} className="border-border/40 group hover:bg-muted/50 transition-colors">
                                                <TableCell className="pl-6 py-4">
                                                    <div className="flex flex-col gap-0.5">
                                                        <span className="text-sm font-medium text-foreground">{d.name}</span>
                                                        <span className="text-xs text-muted-foreground truncate max-w-[260px]">{d.description || "No description"}</span>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    <Badge variant="outline" className="font-mono text-xs text-muted-foreground">
                                                        {d.exampleCount ?? 0}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell>
                                                    <span className="text-sm text-muted-foreground">
                                                        {d.createdAt ? formatDistanceToNow(new Date(d.createdAt), { addSuffix: true }) : "Unknown"}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="text-right pr-6">
                                                    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <Button
                                                            size="icon"
                                                            variant="ghost"
                                                            className="h-8 w-8"
                                                            title="Import examples"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                toast({ title: "Import", description: "Bulk import is available via the CLI." });
                                                            }}
                                                        >
                                                            <Upload className="w-4 h-4" />
                                                        </Button>
                                                        <Button
                                                            size="icon"
                                                            variant="ghost"
                                                            className="h-8 w-8 hover:text-primary"
                                                            title="Start training"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                if (!isNaN(parseInt(d.id))) {
                                                                    startTrainingMutation.mutate(parseInt(d.id));
                                                                } else {
                                                                    toast({ title: "Sample dataset", description: "Sample datasets can't be used for training. Create a real dataset first." });
                                                                }
                                                            }}
                                                            disabled={startTrainingMutation.isPending}
                                                        >
                                                            {startTrainingMutation.isPending && startTrainingMutation.variables === parseInt(d.id) ? (
                                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                            ) : (
                                                                <Play className="w-4 h-4" />
                                                            )}
                                                        </Button>
                                                        <Button
                                                            size="icon"
                                                            variant="ghost"
                                                            className="h-8 w-8 hover:text-destructive"
                                                            title="Delete dataset"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                if (!isNaN(parseInt(d.id))) {
                                                                    if (confirm("Delete this dataset and all its examples? This can't be undone.")) {
                                                                        deleteDatasetMutation.mutate(parseInt(d.id));
                                                                    }
                                                                } else {
                                                                    toast({ title: "Sample dataset", description: "Sample datasets are protected from deletion." });
                                                                }
                                                            }}
                                                            disabled={deleteDatasetMutation.isPending}
                                                        >
                                                            {deleteDatasetMutation.isPending && deleteDatasetMutation.variables === parseInt(d.id) ? (
                                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                            ) : (
                                                                <Trash2 className="w-4 h-4" />
                                                            )}
                                                        </Button>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            )}
                        </CardContent>
                    </Card>
                </div>

                {/* Right: Training activity */}
                <div className="lg:col-span-4 space-y-6">
                    <Card className="border-border/40 shadow-sm overflow-hidden bg-card">
                        <CardHeader className="px-6 py-4 border-b bg-muted/30">
                            <CardTitle className="text-base font-semibold flex items-center gap-2 text-foreground">
                                <Activity className={cn("w-4 h-4 text-primary", (stats?.activeTraining ?? 0) > 0 && "animate-pulse")} /> Training Activity
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-6 space-y-6">
                            {(stats?.activeTraining ?? 0) > 0 ? (
                                <>
                                    <div className="p-4 rounded-lg bg-muted/40 border border-border/40 space-y-4">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                                                <span className="text-sm font-medium text-foreground">Training run A1</span>
                                            </div>
                                            <Badge variant="outline" className="text-emerald-600 border-emerald-500/30 bg-emerald-500/10 text-[10px] font-bold uppercase tracking-widest">Phase 2/3</Badge>
                                        </div>

                                        <div className="space-y-2">
                                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                                                <span>Loss convergence</span>
                                                <span className="text-primary font-mono">0.0248 Δ</span>
                                            </div>
                                            <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                                                <div className="h-full bg-primary w-[68%]" />
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="p-3 rounded-lg bg-background border border-border/40">
                                                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Epoch</p>
                                                <p className="text-sm font-semibold text-foreground">08 / 12</p>
                                            </div>
                                            <div className="p-3 rounded-lg bg-background border border-border/40">
                                                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Batch size</p>
                                                <p className="text-sm font-semibold text-foreground">128 seq</p>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="space-y-3">
                                        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Latest checkpoints</span>
                                        <div className="space-y-2">
                                            {[
                                                { label: "Adapter v1.2", status: "Stable", date: "2h ago" },
                                                { label: "Adapter v1.1", status: "Failed", date: "5h ago", error: true },
                                                { label: "Gold baseline", status: "Verified", date: "1d ago", primary: true },
                                            ].map(cp => (
                                                <div key={cp.label} className="flex items-center justify-between p-3 rounded-lg border border-border/40 bg-muted/20 hover:bg-muted/40 transition-colors">
                                                    <div className="flex flex-col gap-0.5">
                                                        <span className={cn("text-sm font-medium", cp.primary ? "text-amber-500" : "text-foreground")}>{cp.label}</span>
                                                        <span className="text-xs text-muted-foreground">{cp.date}</span>
                                                    </div>
                                                    <Badge variant="outline" className={cn(
                                                        "text-[10px] font-bold uppercase tracking-widest",
                                                        cp.error ? "text-destructive border-destructive/30 bg-destructive/10" :
                                                        cp.primary ? "text-amber-600 border-amber-500/30 bg-amber-500/10" :
                                                        "text-emerald-600 border-emerald-500/30 bg-emerald-500/10"
                                                    )}>
                                                        {cp.status}
                                                    </Badge>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </>
                            ) : (
                                <div className="py-10 text-center space-y-3">
                                    <div className="w-14 h-14 rounded-full bg-muted border border-dashed border-border flex items-center justify-center mx-auto">
                                        <Activity className="w-7 h-7 text-muted-foreground" />
                                    </div>
                                    <div className="space-y-1">
                                        <p className="text-sm font-semibold text-foreground">No active runs</p>
                                        <p className="text-sm text-muted-foreground max-w-[240px] mx-auto">
                                            Start a training run to see real-time progress here.
                                        </p>
                                    </div>
                                </div>
                            )}

                            <Button variant="outline" className="w-full gap-2">
                                <History className="w-4 h-4" /> View training logs
                            </Button>
                        </CardContent>
                    </Card>

                    {/* How it works */}
                    <Card className="border-border/40 shadow-sm overflow-hidden bg-card">
                        <CardHeader className="px-6 py-4 border-b bg-muted/30">
                            <CardTitle className="text-base font-semibold text-foreground">How LoRA tuning works</CardTitle>
                        </CardHeader>
                        <CardContent className="p-6">
                            <div className="relative pl-7 space-y-6">
                                <div className="absolute left-[9px] top-2 bottom-2 w-px bg-border" />
                                {[
                                    { title: "Collect examples", desc: "Aggregate input/output pairs from your knowledge base or feedback loops.", color: "bg-blue-500" },
                                    { title: "Optimize (PEFT)", desc: "Initialize LoRA rank-decomposition matrices for lightweight tuning.", color: "bg-purple-500" },
                                    { title: "Fuse adapter", desc: "Merge tuned weights back into the reasoning engine for real-time use.", color: "bg-primary" },
                                ].map((s) => (
                                    <div key={s.title} className="relative">
                                        <div className={cn("absolute -left-[23px] top-1 w-3 h-3 rounded-full border-2 border-background", s.color)} />
                                        <div className="space-y-0.5">
                                            <p className="text-sm font-medium text-foreground">{s.title}</p>
                                            <p className="text-xs text-muted-foreground leading-relaxed">{s.desc}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>

            {/* Create modal */}
            {isCreating && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
                    <div
                        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
                        onClick={() => setIsCreating(false)}
                    />
                    <div className="relative w-full max-w-lg bg-card border border-border rounded-xl shadow-lg">
                        <div className="p-6 space-y-6">
                            <div className="flex items-center gap-3">
                                <div className="p-2.5 rounded-lg bg-primary/10 border border-primary/20">
                                    <Database className="w-5 h-5 text-primary" />
                                </div>
                                <div className="space-y-0.5">
                                    <h2 className="text-lg font-semibold text-foreground">New dataset</h2>
                                    <p className="text-sm text-muted-foreground">Create a training corpus for model tuning.</p>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div className="space-y-1.5">
                                    <label className="text-sm font-medium text-foreground">Name</label>
                                    <Input
                                        placeholder="e.g. customer-service-v4"
                                        value={newName}
                                        onChange={(e) => setNewName(e.target.value)}
                                        autoFocus
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-sm font-medium text-foreground">Description <span className="text-muted-foreground font-normal">(optional)</span></label>
                                    <textarea
                                        placeholder="What is this dataset for?"
                                        className="w-full h-24 bg-background border border-input rounded-md p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
                                        value={newDescription}
                                        onChange={(e) => setNewDescription(e.target.value)}
                                    />
                                </div>
                            </div>

                            <div className="flex justify-end gap-2">
                                <Button
                                    variant="ghost"
                                    onClick={() => setIsCreating(false)}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    disabled={!newName || createDatasetMutation.isPending}
                                    onClick={() => {
                                        createDatasetMutation.mutate(
                                            { name: newName, description: newDescription || undefined },
                                            {
                                                onSuccess: () => {
                                                    setIsCreating(false);
                                                    setNewName("");
                                                    setNewDescription("");
                                                }
                                            }
                                        );
                                    }}
                                >
                                    {createDatasetMutation.isPending ? "Creating…" : "Create dataset"}
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
