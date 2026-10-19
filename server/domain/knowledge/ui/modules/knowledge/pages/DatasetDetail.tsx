
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { Loader2, Plus, ArrowLeft, Trash2, Save } from "lucide-react";
import type { FineTuningDataset, FineTuningExample } from "@shared/schema/training";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@domain-ui/core/ui/components/ui/dialog";
import { Upload, Download, FileText } from "lucide-react";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@domain-ui/core/ui/components/ui/table";

export default function DatasetDetail() {
    const { id } = useParams();
    const [, setLocation] = useLocation();
    const { toast } = useToast();
    const [isAddingMode, setIsAddingMode] = useState(false);
    const [newExample, setNewExample] = useState({ input: "", output: "" });

    // Fetch Dataset Info
    const { data: dataset, isLoading: isLoadingDataset } = useQuery<FineTuningDataset>({
        queryKey: [`/api/fine-tuning/datasets/${id}`],
        queryFn: async () => {
            // We reusing the list endpoint client-side filtering or assume we might need a detail endpoint.
            // Actually, standard pattern often has list or detail. 
            // Let's assume we can fetch list and find it, or if there's a detail endpoint. 
            // Based on my routes changes, I didn't add a specific GET /datasets/:id, only DELETE.
            // So I should probably add GET /datasets/:id or just fetch all and filter.
            // Fetching all is inefficient but works for now as I verified the LIST endpoint exists.
            const res = await apiRequest("GET", "/api/fine-tuning/datasets");
            const all = await res.json();
            return all.find((d: any) => d.id === parseInt(id!));
        },
    });

    // Fetch Examples
    const { data: examples, isLoading: isLoadingExamples } = useQuery<FineTuningExample[]>({
        queryKey: [`/api/fine-tuning/datasets/${id}/examples`],
        queryFn: async () => {
            const res = await apiRequest("GET", `/api/fine-tuning/datasets/${id}/examples`);
            // If fetching fails it might be because the dataset was just deleted or doesn't exist
            if (!res.ok) throw new Error("Failed to fetch examples");
            return res.json();
        },
        enabled: !!id,
    });

    const createExampleMutation = useMutation({
        mutationFn: async () => {
            const res = await apiRequest("POST", `/api/fine-tuning/datasets/${id}/examples`, newExample);
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [`/api/fine-tuning/datasets/${id}/examples`] });
            setNewExample({ input: "", output: "" });
            setIsAddingMode(false);
            toast({ title: "Example added successfully" });
        },
        onError: (error: Error) => {
            toast({ title: "Failed to add example", description: error.message, variant: "destructive" });
        },
    });

    const deleteExampleMutation = useMutation({
        mutationFn: async (exampleId: number) => {
            await apiRequest("DELETE", `/api/fine-tuning/examples/${exampleId}`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [`/api/fine-tuning/datasets/${id}/examples`] });
            toast({ title: "Example deleted" });
        },
    });

    const importMutation = useMutation({
        mutationFn: async (jsonlData: string) => {
            const res = await apiRequest("POST", `/api/fine-tuning/datasets/${id}/examples/import`, { data: jsonlData });
            return res.json();
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: [`/api/fine-tuning/datasets/${id}/examples`] });
            toast({ title: "Import successful", description: data.message });
            setImportDialogOpen(false);
        },
        onError: (error: Error) => {
            toast({ title: "Import failed", description: error.message, variant: "destructive" });
        }
    });

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const content = event.target?.result as string;
            importMutation.mutate(content);
        };
        reader.readAsText(file);
    };

    const handleExport = () => {
        window.open(`/api/fine-tuning/datasets/${id}/export`, '_blank');
    };

    const [importDialogOpen, setImportDialogOpen] = useState(false);

    if (isLoadingDataset) {
        return <div className="flex items-center justify-center min-h-screen text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading dataset...</div>;
    }

    if (!dataset) {
        return (
            <div className="p-8 text-center">
                <h2 className="text-xl font-bold mb-4">Dataset not found</h2>
                <Button onClick={() => setLocation("/knowledge/fine-tuning")}>Back to Fine-Tuning</Button>
            </div>
        );
    }

    return (
        <div className="space-y-6 container mx-auto px-4 py-6 pb-24 max-w-[2000px] sm:pb-6">
            <div className="flex items-start gap-3 sm:items-center sm:gap-4">
                <Button variant="ghost" size="icon" onClick={() => setLocation("/knowledge/fine-tuning")}>
                    <ArrowLeft className="h-4 w-4" />
                </Button>
                <div className="min-w-0">
                    <h1 className="text-2xl font-semibold">{dataset.name}</h1>
                    <p className="text-sm text-muted-foreground">{dataset.description || "No description provided."}</p>
                </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-lg font-medium flex items-center gap-2">
                    Examples
                    <Badge variant="secondary">{examples?.length || 0}</Badge>
                </h2>
                <Button onClick={() => setIsAddingMode(!isAddingMode)} className="w-full sm:w-auto">
                    {isAddingMode ? "Cancel" : <><Plus className="w-4 h-4 mr-2" /> Add Example</>}
                </Button>
            </div>

            <div className="flex flex-col gap-2 mb-6 sm:flex-row">
                <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
                    <DialogTrigger asChild>
                        <Button variant="outline" size="sm" className="w-full sm:w-auto">
                            <Upload className="w-4 h-4 mr-2" /> Import JSONL
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Import Examples</DialogTitle>
                        </DialogHeader>
                        <div className="py-6 text-center">
                            <Label htmlFor="file-upload" className="cursor-pointer flex flex-col items-center justify-center border-2 border-dashed border-border rounded-lg p-12 hover:bg-muted transition-colors">
                                <FileText className="w-12 h-12 text-muted-foreground mb-4" />
                                <span className="text-sm font-medium text-foreground">Click to upload .jsonl file</span>
                                <span className="text-xs text-muted-foreground mt-1">OpenAI Chat format supported</span>
                                <Input
                                    id="file-upload"
                                    type="file"
                                    accept=".jsonl,.json,.txt"
                                    className="hidden"
                                    onChange={handleFileUpload}
                                />
                            </Label>
                            {importMutation.isPending && (
                                <div className="mt-4 flex items-center justify-center text-sm text-indigo-600">
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Importing...
                                </div>
                            )}
                        </div>
                    </DialogContent>
                </Dialog>

                <Button variant="outline" size="sm" onClick={handleExport} className="w-full sm:w-auto">
                    <Download className="w-4 h-4 mr-2" /> Export JSONL
                </Button>
            </div>

            {isAddingMode && (
                <Card className="border-indigo-100 bg-indigo-50/50">
                    <CardHeader>
                        <CardTitle className="text-base">New Example</CardTitle>
                        <CardDescription>Manually add a training example</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-2">
                                <Label htmlFor="input">Input (Prompt)</Label>
                                <Textarea
                                    id="input"
                                    placeholder="The user input or prompt..."
                                    value={newExample.input}
                                    onChange={(e) => setNewExample({ ...newExample, input: e.target.value })}
                                    className="min-h-[150px] font-mono text-xs"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="output">Output (Completion)</Label>
                                <Textarea
                                    id="output"
                                    placeholder="The expected verified output..."
                                    value={newExample.output}
                                    onChange={(e) => setNewExample({ ...newExample, output: e.target.value })}
                                    className="min-h-[150px] font-mono text-xs"
                                />
                            </div>
                        </div>
                        <div className="flex justify-end pt-2">
                            <Button
                                onClick={() => createExampleMutation.mutate()}
                                disabled={createExampleMutation.isPending || !newExample.input || !newExample.output}
                                className="w-full sm:w-auto"
                            >
                                {createExampleMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                                Save Example
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            <Card>
                <CardContent className="p-0">
                    {isLoadingExamples ? (
                        <div className="p-8 text-center text-muted-foreground">Loading examples...</div>
                    ) : examples && examples.length > 0 ? (
                        <>
                        <div className="space-y-3 p-3 md:hidden">
                            {examples.map((ex) => (
                                <div key={ex.id} className="rounded-lg border bg-card p-3">
                                    <div className="space-y-3">
                                        <div>
                                            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Input</p>
                                            <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-xs">
                                                {ex.input.length > 300 ? ex.input.substring(0, 300) + "..." : ex.input}
                                            </pre>
                                        </div>
                                        <div>
                                            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Output</p>
                                            <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-xs">
                                                {ex.output.length > 300 ? ex.output.substring(0, 300) + "..." : ex.output}
                                            </pre>
                                        </div>
                                    </div>
                                    <div className="mt-3 flex justify-end border-t pt-2">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 text-muted-foreground hover:text-red-500"
                                            onClick={() => {
                                                if (confirm("Delete this example?")) deleteExampleMutation.mutate(ex.id);
                                            }}
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="hidden md:block">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-[40%]">Input</TableHead>
                                    <TableHead className="w-[40%]">Output</TableHead>
                                    <TableHead className="w-[10%] text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {examples.map((ex) => (
                                    <TableRow key={ex.id}>
                                        <TableCell className="align-top font-mono text-sm whitespace-pre-wrap max-h-[200px] overflow-y-auto block-truncate">
                                            {ex.input.length > 300 ? ex.input.substring(0, 300) + "..." : ex.input}
                                        </TableCell>
                                        <TableCell className="align-top font-mono text-sm whitespace-pre-wrap">
                                            {ex.output.length > 300 ? ex.output.substring(0, 300) + "..." : ex.output}
                                        </TableCell>
                                        <TableCell className="text-right align-top">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8 text-muted-foreground hover:text-red-500"
                                                onClick={() => {
                                                    if (confirm("Delete this example?")) deleteExampleMutation.mutate(ex.id);
                                                }}
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                        </div>
                        </>
                    ) : (
                        <div className="p-12 text-center text-muted-foreground">
                            No examples found in this dataset.
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

