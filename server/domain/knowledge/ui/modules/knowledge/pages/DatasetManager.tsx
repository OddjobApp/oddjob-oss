import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@domain-ui/core/ui/components/ui/table";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogFooter
} from "@domain-ui/core/ui/components/ui/dialog";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Plus, Database, Search, Loader2, Sparkles, ArrowRight, Layers, Activity, Filter, FolderKanban } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { Dataset } from "@shared/schema/datasets";

import { apiRequest } from "@/lib/queryClient";

const container = {
    hidden: { opacity: 0 },
    show: {
        opacity: 1,
        transition: {
            staggerChildren: 0.05
        }
    }
};

const item = {
    hidden: { opacity: 0, y: 10 },
    show: { opacity: 1, y: 0 }
};

export default function DatasetManager() {
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [filterTab, setFilterTab] = useState<"all" | "mission" | "cycle" | "collections">("all");
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const { data: datasets, isLoading } = useQuery<Dataset[]>({
        queryKey: ["/api/datasets"],
        queryFn: async () => {
            const res = await apiRequest("GET", "/api/datasets");
            return res.json();
        }
    });

    const { data: collections } = useQuery<any[]>({
        queryKey: ["/api/collections"],
        queryFn: async () => {
            try {
                const res = await apiRequest("GET", "/api/collections");
                return res.json();
            } catch {
                return [];
            }
        }
    });

    const createMutation = useMutation({
        mutationFn: async (data: { name: string, description: string }) => {
            const res = await apiRequest("POST", "/api/datasets", data);
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/datasets"] });
            setIsCreateOpen(false);
            toast({ title: "Success", description: "Dataset created successfully" });
        },
        onError: (err) => {
            toast({ title: "Error", description: err.message, variant: "destructive" });
        }
    });

    const filteredDatasets = (datasets || []).filter((d: any) => {
        const matchesQuery =
            d.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            d.description?.toLowerCase().includes(searchQuery.toLowerCase());
        if (!matchesQuery) return false;
        if (filterTab === "mission") return !!d.missionId;
        if (filterTab === "cycle") return !!d.cycleId;
        return true;
    });

    const handleCreate = (e: React.FormEvent) => {
        e.preventDefault();
        const formData = new FormData(e.target as HTMLFormElement);
        createMutation.mutate({
            name: formData.get("name") as string,
            description: formData.get("description") as string
        });
    };

    return (
        <motion.div 
            initial="hidden"
            animate="show"
            variants={container}
            className="space-y-6 p-4 pb-24 md:space-y-8 md:p-6 md:pb-6 w-full animate-page-in"
        >
            <div className="relative overflow-hidden rounded-2xl p-5 bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 border border-white/10 shadow-2xl md:p-8">
                <div className="absolute top-0 right-0 hidden p-8 opacity-10 pointer-events-none sm:block">
                    <Database size={160} />
                </div>
                <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                            <Sparkles className="h-5 w-5 text-indigo-400 animate-pulse" />
                            <span className="text-xs font-bold tracking-widest uppercase text-indigo-400">Data Engineering</span>
                        </div>
                        <h1 className="text-3xl font-extrabold tracking-tight mb-2 text-foreground bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400 md:text-4xl">
                            Central Data Repository
                        </h1>
                        <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed md:text-lg">
                            Orchestrate structured intelligence. Manage high-fidelity data collections for neural fine-tuning and autonomous pipeline processing.
                        </p>
                    </div>
                    <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                        <DialogTrigger asChild>
                            <Button size="lg" className="holographic-card w-full border-indigo-500/30 hover:border-indigo-400 shadow-lg shadow-indigo-500/20 group sm:w-auto">
                                <Plus className="mr-2 h-5 w-5 group-hover:rotate-90 transition-transform duration-300" /> 
                                Create New Dataset
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="glass-panel-deep border-white/10 backdrop-blur-2xl">
                            <DialogHeader>
                                <DialogTitle className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-indigo-400">
                                    Initialize Dataset
                                </DialogTitle>
                            </DialogHeader>
                            <form onSubmit={handleCreate} className="space-y-6 pt-4">
                                <div className="space-y-2">
                                    <Label htmlFor="name" className="text-foreground/70">Identifier Name</Label>
                                    <Input 
                                        id="name" 
                                        name="name" 
                                        placeholder="e.g. CORE_CUSTOMER_SENTIMENT_ALPHA" 
                                        className="bg-black/40 border-white/10 text-foreground placeholder:text-muted-foreground focus:ring-indigo-500/50"
                                        required 
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="description" className="text-foreground/70">Semantic Context (Optional)</Label>
                                    <Textarea 
                                        id="description" 
                                        name="description" 
                                        placeholder="Define the scope and utility of this data collection..." 
                                        className="bg-black/40 border-white/10 text-foreground placeholder:text-muted-foreground min-h-[100px] focus:ring-indigo-500/50"
                                    />
                                </div>
                                <DialogFooter>
                                    <Button type="submit" disabled={createMutation.isPending} className="w-full bg-indigo-600 hover:bg-indigo-500 text-foreground transition-all">
                                        {createMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Deploy Dataset"}
                                    </Button>
                                </DialogFooter>
                            </form>
                        </DialogContent>
                    </Dialog>
                </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex w-full items-center gap-3 bg-white/5 dark:bg-black/20 p-2 rounded-xl backdrop-blur-sm border border-white/5 md:max-w-md">
                    <Search className="h-5 w-5 text-muted-foreground ml-2" />
                    <Input
                        placeholder="Search synthetic archives & collections..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="border-none bg-transparent focus-visible:ring-0 text-foreground/85 placeholder:text-muted-foreground"
                    />
                </div>

                <div className="flex flex-wrap items-center gap-1.5 p-1 bg-white/5 dark:bg-black/40 rounded-xl border border-white/10">
                    <Button
                        variant={filterTab === "all" ? "secondary" : "ghost"}
                        size="sm"
                        onClick={() => setFilterTab("all")}
                        className="text-xs rounded-lg gap-1 font-semibold"
                    >
                        <Database className="w-3.5 h-3.5" /> All Archives ({datasets?.length || 0})
                    </Button>
                    <Button
                        variant={filterTab === "mission" ? "secondary" : "ghost"}
                        size="sm"
                        onClick={() => setFilterTab("mission")}
                        className="text-xs rounded-lg gap-1 font-semibold"
                    >
                        <FolderKanban className="w-3.5 h-3.5 text-indigo-400" /> By Mission
                    </Button>
                    <Button
                        variant={filterTab === "cycle" ? "secondary" : "ghost"}
                        size="sm"
                        onClick={() => setFilterTab("cycle")}
                        className="text-xs rounded-lg gap-1 font-semibold"
                    >
                        <Activity className="w-3.5 h-3.5 text-amber-400" /> By Cycle
                    </Button>
                    <Button
                        variant={filterTab === "collections" ? "secondary" : "ghost"}
                        size="sm"
                        onClick={() => setFilterTab("collections")}
                        className="text-xs rounded-lg gap-1 font-semibold"
                    >
                        <Layers className="w-3.5 h-3.5 text-emerald-400" /> Smart Collections ({collections?.length || 0})
                    </Button>
                </div>
            </div>

            <div className="glass-panel overflow-hidden transition-all duration-500 hover:border-white/20 group">
                <div className="space-y-3 p-3 md:hidden">
                    {isLoading ? (
                        <div className="flex min-h-48 flex-col items-center justify-center gap-4 rounded-xl border border-white/5 bg-black/20">
                            <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
                            <span className="text-muted-foreground font-mono text-sm tracking-widest animate-pulse">Loading...</span>
                        </div>
                    ) : filteredDatasets.length === 0 ? (
                        <div className="flex min-h-48 flex-col items-center justify-center gap-2 rounded-xl border border-white/5 bg-black/20 text-center">
                            <Database className="h-12 w-12 text-foreground mb-2" />
                            <p className="text-lg font-medium text-muted-foreground">Archive matches returned null</p>
                            <p className="text-sm text-muted-foreground">Initialize a new dataset to begin structured ingestion.</p>
                        </div>
                    ) : (
                        filteredDatasets.map((dataset) => (
                            <motion.div
                                key={dataset.id}
                                variants={item}
                                layout
                                className="rounded-xl border border-white/10 bg-foreground/[0.03] p-4"
                            >
                                <div className="flex items-start gap-3">
                                    <div className="h-10 w-10 rounded-lg bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20 shrink-0">
                                        <Database className="h-5 w-5 text-indigo-400" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate font-bold text-foreground/85">{dataset.name}</p>
                                        <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-tighter">DATASET_ID: {dataset.id}</p>
                                    </div>
                                </div>
                                <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">
                                    {dataset.description || "NO_SEMANTIC_CONTEXT_DEFINED"}
                                </p>
                                <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/10 pt-3">
                                    <span className="font-mono text-[11px] text-muted-foreground">
                                        {format(new Date(dataset.createdAt), "yyyy-MM-dd")}
                                    </span>
                                    <Link href={`/knowledge/datasets/${dataset.id}`}>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="bg-indigo-500/5 hover:bg-indigo-500/20 text-indigo-400 hover:text-indigo-700 dark:text-indigo-300 border border-indigo-500/10 hover:border-indigo-500/30 transition-all font-bold"
                                        >
                                            Open
                                            <ArrowRight className="ml-2 h-4 w-4" />
                                        </Button>
                                    </Link>
                                </div>
                            </motion.div>
                        ))
                    )}
                </div>

                <div className="hidden md:block">
                <Table>
                    <TableHeader className="bg-white/5 dark:bg-black/40">
                        <TableRow className="hover:bg-transparent border-white/5">
                            <TableHead className="py-4 text-muted-foreground font-bold uppercase tracking-wider text-xs">Dataset Entity</TableHead>
                            <TableHead className="py-4 text-muted-foreground font-bold uppercase tracking-wider text-xs">Conceptual Context</TableHead>
                            <TableHead className="py-4 text-muted-foreground font-bold uppercase tracking-wider text-xs">Temporal Hash</TableHead>
                            <TableHead className="py-4 text-muted-foreground font-bold uppercase tracking-wider text-xs text-right">Operational Port</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        <AnimatePresence mode="popLayout">
                            {isLoading ? (
                                <TableRow className="hover:bg-transparent border-white/5">
                                    <TableCell colSpan={4} className="h-48 text-center">
                                        <div className="flex flex-col items-center justify-center gap-4">
                                            <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
                                            <span className="text-muted-foreground font-mono text-sm tracking-widest animate-pulse">Loading...</span>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ) : filteredDatasets.length === 0 ? (
                                <TableRow className="hover:bg-transparent border-white/5">
                                    <TableCell colSpan={4} className="h-48 text-center text-muted-foreground">
                                        <div className="flex flex-col items-center justify-center gap-2">
                                            <Database className="h-12 w-12 text-foreground mb-2" />
                                            <p className="text-lg font-medium text-muted-foreground">Archive matches returned null</p>
                                            <p className="text-sm text-muted-foreground">Initialize a new dataset to begin structured ingestion.</p>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ) : (
                                filteredDatasets.map((dataset) => (
                                    <motion.tr 
                                        key={dataset.id}
                                        variants={item}
                                        layout
                                        className="group transition-colors hover:bg-white/5 dark:hover:bg-white/5 border-white/5"
                                    >
                                        <TableCell className="py-5">
                                            <div className="flex items-center gap-4">
                                                <div className="h-10 w-10 rounded-lg bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20 group-hover:bg-indigo-500/20 transition-all">
                                                    <Database className="h-5 w-5 text-indigo-400" />
                                                </div>
                                                <div className="flex flex-col">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-bold text-foreground/85 group-hover:text-foreground transition-colors">{dataset.name}</span>
                                                        {(dataset as any).missionId && (
                                                            <Badge variant="outline" className="border-indigo-500/40 text-indigo-400 bg-indigo-500/10 text-[9px]">
                                                                Mission #{(dataset as any).missionId}
                                                            </Badge>
                                                        )}
                                                        {(dataset as any).cycleId && (
                                                            <Badge variant="outline" className="border-amber-500/40 text-amber-400 bg-amber-500/10 text-[9px]">
                                                                Cycle #{(dataset as any).cycleId}
                                                            </Badge>
                                                        )}
                                                    </div>
                                                    <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-tighter">DATASET_ID: {dataset.id}</span>
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell className="max-w-md py-5">
                                            <p className="text-muted-foreground text-sm line-clamp-1 group-hover:text-foreground/70 transition-colors">
                                                {dataset.description || "NO_SEMANTIC_CONTEXT_DEFINED"}
                                            </p>
                                        </TableCell>
                                        <TableCell className="py-5 font-mono text-xs text-muted-foreground">
                                            {format(new Date(dataset.createdAt), "yyyy-MM-dd 'T' HH:mm:ss")}
                                        </TableCell>
                                        <TableCell className="py-5 text-right">
                                            <Link href={`/knowledge/datasets/${dataset.id}`}>
                                                <Button 
                                                    variant="ghost" 
                                                    size="sm" 
                                                    className="bg-indigo-500/5 hover:bg-indigo-500/20 text-indigo-400 hover:text-indigo-700 dark:text-indigo-300 border border-indigo-500/10 hover:border-indigo-500/30 transition-all font-bold"
                                                >
                                                    ACCESS_EXPLORER
                                                </Button>
                                            </Link>
                                        </TableCell>
                                    </motion.tr>
                                ))
                            )}
                        </AnimatePresence>
                    </TableBody>
                </Table>
                </div>
            </div>
        </motion.div>
    );
}

