import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogFooter
} from "@domain-ui/core/ui/components/ui/dialog";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { ArrowLeft, Plus, Loader2, Trash2, Network, Activity, Database, Zap, FileJson } from "lucide-react";
import { Dataset } from "@shared/schema/datasets";
import { apiRequest } from "@/lib/queryClient";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@domain-ui/core/ui/components/ui/tabs";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";

import { Textarea as ConfigTextarea } from "@domain-ui/core/ui/components/ui/textarea";
import KnowledgeGraph from './KnowledgeGraph.js';
import { DatasetTable } from "@domain-ui/core/ui/components/data/DatasetTable";
import { ValidationRulesEditor } from "@domain-ui/core/ui/components/data/ValidationRulesEditor";
import { DatasetSpreadsheet } from "@domain-ui/core/ui/components/data/DatasetSpreadsheet";
import { DatasetValidationRules } from "@shared/schema/datasets";

export default function DatasetDetail() {
    const params = useParams<{ id?: string }>();
    const id = params?.id;
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [jsonInput, setJsonInput] = useState("{}");
    const [configInput, setConfigInput] = useState("");
    const [knowledgeViewMode, setKnowledgeViewMode] = useState<"config" | "explorer">("explorer");
    const [dataViewMode, setDataViewMode] = useState<"table" | "spreadsheet">("table");

    const { data: dataset, isLoading: isLoadingDataset } = useQuery<Dataset>({
        queryKey: [`/api/datasets/${id}`],
        queryFn: async () => {
            const res = await apiRequest("GET", `/api/datasets/${id}`);
            if (!res.ok) throw new Error("Failed to fetch dataset");
            const data = await res.json();
            if (data.knowledgeConfig && Object.keys(data.knowledgeConfig).length > 0) {
                setConfigInput(JSON.stringify(data.knowledgeConfig, null, 2));
            } else {
                setConfigInput(JSON.stringify({
                    rules: [
                        {
                            ruleId: "example-rule",
                            name: "Example Rule",
                            entityType: "EntityType",
                            entityNamePath: "$.name",
                            externalIdPath: "$.id"
                        }
                    ]
                }, null, 2));
            }
            return data;
        },
        enabled: !!id
    });

    const addItemMutation = useMutation({
        mutationFn: async (jsonData: string) => {
            let parsed;
            try {
                parsed = JSON.parse(jsonData);
            } catch (e) {
                throw new Error("Invalid JSON format");
            }
            const res = await apiRequest("POST", `/api/datasets/${id}/items`, { data: parsed });
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [`/api/datasets/${id}/items`] });
            setIsAddOpen(false);
            setJsonInput("{}");
            toast({ title: "Success", description: "Item added successfully" });
        },
        onError: (err) => {
            toast({ title: "Error", description: err.message, variant: "destructive" });
        }
    });

    const handleDelete = async () => {
        if (!confirm("Are you sure you want to delete this dataset? This cannot be undone.")) return;
        await apiRequest("DELETE", `/api/datasets/${id}`);
        window.location.href = "/knowledge/datasets";
    };

    const updateConfigMutation = useMutation({
        mutationFn: async (configStr: string) => {
            let parsed;
            try {
                parsed = JSON.parse(configStr);
            } catch (e) {
                throw new Error("Invalid JSON configuration");
            }
            const res = await apiRequest("PATCH", `/api/datasets/${id}`, { knowledgeConfig: parsed });
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [`/api/datasets/${id}`] });
            toast({ title: "Configuration Saved", description: "Knowledge graph rules updated." });
        },
        onError: (err) => {
            toast({ title: "Error", description: err.message, variant: "destructive" });
        }
    });

    const triggerExtractionMutation = useMutation({
        mutationFn: async () => {
            const res = await apiRequest("POST", `/api/datasets/${id}/extract`);
            return res.json();
        },
        onSuccess: (data) => {
            if (data.success) {
                toast({ title: "Extraction Complete", description: `Processed: ${data.processedCount}, Errors: ${data.errorCount}` });
            } else {
                toast({ title: "Extraction Failed", description: data.message, variant: "destructive" });
            }
        },
        onError: (err) => {
            toast({ title: "Error", description: err.message, variant: "destructive" });
        }
    });

    const updateRulesMutation = useMutation({
        mutationFn: async (rules: DatasetValidationRules) => {
            const res = await apiRequest("PATCH", `/api/datasets/${id}`, { validationRules: rules });
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [`/api/datasets/${id}`] });
            toast({ title: "Rules Saved", description: "Validation rules updated successfully." });
        },
        onError: (err) => {
            toast({ title: "Error", description: err.message, variant: "destructive" });
        }
    });

    if (isLoadingDataset) return (
        <div className="h-screen w-full flex flex-col items-center justify-center bg-background overflow-hidden">
            <Loader2 className="h-12 w-12 animate-spin text-indigo-500 mb-4" />
            <span className="text-indigo-400 font-mono tracking-widest animate-pulse">INITIATING SECURE CHANNEL...</span>
        </div>
    );
    if (!dataset) return <div className="p-8 text-center text-muted-foreground">Archive not found in neural mesh.</div>;

    return (
        <div className="min-h-screen bg-background/20 animate-page-in">
            <div className="container mx-auto p-8 max-w-7xl space-y-8">
                {/* Immersive Header */}
                <div className="flex flex-col md:flex-row md:items-center gap-6 pb-2">
                    <Link href="/knowledge/datasets">
                        <Button variant="ghost" size="icon" className="rounded-xl border border-foreground/5 bg-foreground/5 hover:bg-foreground/10 text-muted-foreground hover:text-foreground transition-all">
                            <ArrowLeft className="h-5 w-5" />
                        </Button>
                    </Link>
                    <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                            <Badge variant="outline" className="bg-indigo-500/10 text-indigo-400 border-indigo-500/20 font-mono py-0 px-2 text-[10px]">
                                DATASET NODE_{id}
                            </Badge>
                            <span className="h-1 w-1 rounded-full bg-emerald-500 animate-pulse" />
                            <span className="text-[10px] font-mono text-emerald-500 uppercase tracking-tighter">Status: Active</span>
                        </div>
                        <h1 className="text-4xl font-black tracking-tight text-foreground flex items-center gap-4">
                            {dataset.name}
                            <div className="flex gap-1">
                                {dataset.tags && dataset.tags.map(tag => (
                                    <span key={tag} className="px-2 py-0.5 rounded-md bg-foreground/5 text-muted-foreground text-[10px] font-mono border border-foreground/10">
                                        {tag}
                                    </span>
                                ))}
                            </div>
                        </h1>
                        <p className="text-muted-foreground mt-1 max-w-3xl leading-relaxed">{dataset.description}</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="flex bg-foreground/5 border border-foreground/5 rounded-xl p-1 gap-1">
                             <div className="px-4 py-2 flex flex-col items-end">
                                <span className="text-[10px] font-mono text-muted-foreground uppercase">Latency</span>
                                <span className="text-sm font-bold text-foreground">14ms</span>
                             </div>
                        </div>
                        <Button variant="destructive" size="sm" onClick={handleDelete} className="bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 border border-rose-500/20 transition-all rounded-xl">
                            <Trash2 className="h-4 w-4 mr-2" /> DISPOSE ENTITY
                        </Button>
                    </div>
                </div>

                <Tabs defaultValue="data" className="w-full">
                    <TabsList className="bg-foreground/5 border border-foreground/10 p-1 rounded-xl glass-panel mb-6">
                        <TabsTrigger value="data" className="rounded-lg data-[state=active]:bg-indigo-600 data-[state=active]:text-foreground transition-all px-6">Data Items</TabsTrigger>
                        <TabsTrigger value="quality" className="rounded-lg data-[state=active]:bg-indigo-600 data-[state=active]:text-foreground transition-all px-6">Quality Gates</TabsTrigger>
                        <TabsTrigger value="knowledge" className="rounded-lg data-[state=active]:bg-indigo-600 data-[state=active]:text-foreground transition-all px-6">Knowledge Mesh</TabsTrigger>
                    </TabsList>

                    <AnimatePresence mode="wait">
                        <TabsContent value="data" className="mt-0">
                            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
                                <Card className="glass-panel border-foreground/10 bg-background/40 overflow-hidden">
                                    <CardHeader className="flex flex-row items-center justify-between border-b border-foreground/5 pb-6">
                                        <div>
                                            <div className="flex items-center gap-2 mb-1">
                                                <Database className="h-4 w-4 text-indigo-400" />
                                                <CardTitle className="text-xl font-bold text-foreground tracking-tight">Structured Explorer</CardTitle>
                                            </div>
                                            <CardDescription className="text-muted-foreground">
                                                Manage and interrogate neural training sets or operational data archives.
                                            </CardDescription>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <div className="flex bg-foreground/5 rounded-xl p-1 border border-foreground/5 h-10 items-center">
                                                <Button
                                                    variant={dataViewMode === 'table' ? 'secondary' : 'ghost'}
                                                    size="sm"
                                                    onClick={() => setDataViewMode('table')}
                                                    className="text-xs h-8 rounded-lg"
                                                >
                                                    Table
                                                </Button>
                                                <Button
                                                    variant={dataViewMode === 'spreadsheet' ? 'secondary' : 'ghost'}
                                                    size="sm"
                                                    onClick={() => setDataViewMode('spreadsheet')}
                                                    className="text-xs h-8 rounded-lg"
                                                >
                                                    Spreadsheet
                                                </Button>
                                            </div>
                                            <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
                                                <DialogTrigger asChild>
                                                    <Button className="holographic-card border-indigo-500/30 hover:border-indigo-400 shadow-indigo-500/10">
                                                        <Plus className="mr-2 h-4 w-4" /> Ingest New Item
                                                    </Button>
                                                </DialogTrigger>
                                                <DialogContent className="glass-panel-deep border-foreground/10 backdrop-blur-2xl sm:max-w-xl">
                                                    <DialogHeader>
                                                        <DialogTitle className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-indigo-400">
                                                            Ingest Data Point
                                                        </DialogTitle>
                                                    </DialogHeader>
                                                    <div className="space-y-4 pt-4">
                                                        <Textarea
                                                            className="font-mono min-h-[250px] bg-background/40 border-foreground/10 text-foreground focus:ring-indigo-500/50"
                                                            value={jsonInput}
                                                            onChange={(e) => setJsonInput(e.target.value)}
                                                            placeholder='{"key": "value"}'
                                                        />
                                                        <div className="flex items-center gap-2 p-3 rounded-lg bg-indigo-500/5 border border-indigo-500/10">
                                                            <Zap className="h-4 w-4 text-indigo-400" />
                                                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
                                                                Validation: Ready for ingestion. Arrays will be flattened.
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <DialogFooter>
                                                        <Button onClick={() => addItemMutation.mutate(jsonInput)} disabled={addItemMutation.isPending} className="w-full bg-indigo-600 hover:bg-indigo-500">
                                                            {addItemMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                                            Execute Ingestion
                                                        </Button>
                                                    </DialogFooter>
                                                </DialogContent>
                                            </Dialog>
                                        </div>
                                    </CardHeader>
                                    <CardContent className="p-0">
                                        <div className="min-h-[600px]">
                                            {dataViewMode === 'table' ? (
                                                <DatasetTable datasetId={parseInt(id!)} />
                                            ) : (
                                                <div className="p-6">
                                                    <DatasetSpreadsheet
                                                        datasetId={parseInt(id!)}
                                                        validationRules={dataset.validationRules as DatasetValidationRules}
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    </CardContent>
                                </Card>
                            </motion.div>
                        </TabsContent>

                        <TabsContent value="knowledge" className="mt-0">
                            <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.3 }}>
                                <Card className="glass-panel-deep border-foreground/10 bg-background/60 overflow-hidden">
                                    <CardHeader className="flex flex-row items-center justify-between border-b border-foreground/10 pb-6">
                                        <div>
                                            <div className="flex items-center gap-2 mb-1">
                                                <Network className="h-5 w-5 text-indigo-400" />
                                                <CardTitle className="text-xl font-bold text-foreground uppercase tracking-widest">Knowledge Mesh Genesis</CardTitle>
                                            </div>
                                            <CardDescription className="text-muted-foreground">
                                                Map structured data to the global autonomous knowledge graph.
                                            </CardDescription>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <div className="flex bg-foreground/5 rounded-xl p-1 border border-foreground/10 h-10 items-center">
                                                <Button
                                                    variant={knowledgeViewMode === 'config' ? 'secondary' : 'ghost'}
                                                    size="sm"
                                                    onClick={() => setKnowledgeViewMode('config')}
                                                    className="text-xs h-8 px-4 rounded-lg"
                                                >
                                                    Configuration
                                                </Button>
                                                <Button
                                                    variant={knowledgeViewMode === 'explorer' ? 'secondary' : 'ghost'}
                                                    size="sm"
                                                    onClick={() => setKnowledgeViewMode('explorer')}
                                                    className="text-xs h-8 px-4 rounded-lg"
                                                >
                                                    Explorer
                                                </Button>
                                            </div>
                                            <div className="w-px h-6 bg-foreground/10 mx-1" />
                                            <Button
                                                onClick={() => triggerExtractionMutation.mutate()}
                                                disabled={triggerExtractionMutation.isPending || !!(dataset.knowledgeConfig && Object.keys(dataset.knowledgeConfig as object).length === 0)}
                                                className={`neon-glow-cyan transition-all rounded-xl h-10 px-6 ${triggerExtractionMutation.isPending ? 'bg-indigo-900/50' : 'bg-indigo-600 hover:bg-indigo-500'}`}
                                            >
                                                {triggerExtractionMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Activity className="mr-2 h-4 w-4" />}
                                                Initialize Extraction
                                            </Button>
                                        </div>
                                    </CardHeader>

                                    <CardContent className="p-0">
                                        {knowledgeViewMode === 'config' ? (
                                            <div className="flex flex-col gap-4 p-8">
                                                <div className="flex justify-between items-center bg-indigo-500/5 p-4 rounded-2xl border border-indigo-500/10">
                                                    <div className="flex items-center gap-3">
                                                        <FileJson className="h-5 w-5 text-indigo-400" />
                                                        <span className="text-sm font-mono text-foreground">EXTRACTION LOGIC SCHEMA V1</span>
                                                    </div>
                                                    <Button
                                                        size="sm"
                                                        onClick={() => updateConfigMutation.mutate(configInput)}
                                                        disabled={updateConfigMutation.isPending}
                                                        className="bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-400 border border-indigo-600/20 transition-all rounded-xl"
                                                    >
                                                        {updateConfigMutation.isPending ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Zap className="mr-2 h-3 w-3" />}
                                                        COMMIT TO MESH
                                                    </Button>
                                                </div>
                                                <ConfigTextarea
                                                    className="font-mono min-h-[500px] text-sm bg-background/40 border-foreground/10 text-foreground rounded-2xl p-6 focus:ring-indigo-500/50"
                                                    value={configInput}
                                                    onChange={(e) => setConfigInput(e.target.value)}
                                                    placeholder='{"rules": []}'
                                                />
                                            </div>
                                        ) : (
                                            <div className="p-1 h-[800px]">
                                                <div className="border border-foreground/5 rounded-xl overflow-hidden h-full bg-background/40">
                                                    <KnowledgeGraph context={{ type: 'dataset', id: parseInt(id || "0") }} />
                                                </div>
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>
                            </motion.div>
                        </TabsContent>

                        <TabsContent value="quality" className="mt-0">
                            <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.3 }}>
                                <ValidationRulesEditor
                                    datasetId={parseInt(id!)}
                                    initialRules={(dataset.validationRules as DatasetValidationRules) || {}}
                                    onSave={(rules) => updateRulesMutation.mutate(rules)}
                                    isSaving={updateRulesMutation.isPending}
                                />
                            </motion.div>
                        </TabsContent>
                    </AnimatePresence>
                </Tabs>
            </div>
        </div>
    );
}

