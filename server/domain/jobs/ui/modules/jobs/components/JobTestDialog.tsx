import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@domain-ui/core/ui/components/ui/dialog";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Switch } from "@domain-ui/core/ui/components/ui/switch";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle
} from "@domain-ui/core/ui/components/ui/card";
import { Play, Loader2, CheckCircle, XCircle, Database, Zap } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface JobTestDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    jobId: number;
    /** Pre-enable schema capture mode (e.g. opened from Schemas tab) */
    defaultCaptureSchemas?: boolean;
    /** Called after a successful run that captured schemas */
    onSchemasCaptured?: () => void;
}

export default function JobTestDialog({ open, onOpenChange, jobId, defaultCaptureSchemas = false, onSchemasCaptured }: JobTestDialogProps) {
    const [testInput, setTestInput] = useState("");
    const [results, setResults] = useState<any[]>([]);
    const [captureInputSchema, setCaptureInputSchema] = useState(defaultCaptureSchemas);
    const [captureOutputSchema, setCaptureOutputSchema] = useState(defaultCaptureSchemas);
    const queryClient = useQueryClient();

    const testMutation = useMutation({
        mutationFn: async (input: string) => {
            const res = await apiRequest("POST", `/api/jobs/${jobId}/test`, {
                input,
                captureInputSchema,
                captureOutputSchema,
            });
            if (!res.ok) throw new Error("Test failed");
            return res.json();
        },
        onSuccess: (data) => {
            setResults(prev => [...prev, data]);
            if ((captureInputSchema || captureOutputSchema) && data.success) {
                // Invalidate job query so schemas refresh in AgentSchemasTab
                queryClient.invalidateQueries({ queryKey: [`/api/jobs/${jobId}`] });
                onSchemasCaptured?.();
            }
        }
    });

    const runTest = () => {
        testMutation.mutate(testInput);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-3xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Play className="w-5 h-5" />
                        Test Job Execution
                    </DialogTitle>
                    <DialogDescription>
                        Run this job with test input to verify configuration and output.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="test-input">Test Input (JSON or text)</Label>
                        <Textarea
                            id="test-input"
                            value={testInput}
                            onChange={(e) => setTestInput(e.target.value)}
                            placeholder='{"param": "value"}'
                            rows={4}
                            className="font-mono text-sm"
                        />
                    </div>

                    {/* Schema capture options */}
                    <div className="rounded-lg border border-border/50 bg-muted/20 p-3 space-y-2">
                        <div className="flex items-center gap-2 mb-1">
                            <Database className="w-3.5 h-3.5 text-muted-foreground" />
                            <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Schema Capture</span>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="flex items-center gap-2">
                                <Switch
                                    id="capture-input"
                                    checked={captureInputSchema}
                                    onCheckedChange={setCaptureInputSchema}
                                />
                                <Label htmlFor="capture-input" className="text-xs font-normal cursor-pointer">
                                    Capture Input Schema
                                </Label>
                            </div>
                            <div className="flex items-center gap-2">
                                <Switch
                                    id="capture-output"
                                    checked={captureOutputSchema}
                                    onCheckedChange={setCaptureOutputSchema}
                                />
                                <Label htmlFor="capture-output" className="text-xs font-normal cursor-pointer">
                                    Capture Output Schema
                                </Label>
                            </div>
                        </div>
                        {(captureInputSchema || captureOutputSchema) && (
                            <p className="text-[10px] text-muted-foreground/60">
                                On success, captured schemas will be saved to the job and visible in the Schemas tab.
                            </p>
                        )}
                    </div>

                    <div className="flex justify-end">
                        <Button
                            onClick={runTest}
                            disabled={testMutation.isPending}
                            className="gap-2"
                        >
                            {testMutation.isPending ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                                <Play className="w-4 h-4" />
                            )}
                            Run Test
                        </Button>
                    </div>

                    {results.length > 0 && (
                        <div className="space-y-3">
                            <h3 className="text-sm font-semibold">Test Results</h3>
                            <div className="space-y-3">
                                {results.map((result, index) => (
                                    <Card key={index}>
                                        <CardHeader className="pb-3">
                                            <div className="flex items-center justify-between">
                                                <CardTitle className="text-sm font-medium">
                                                    Test Run #{index + 1}
                                                </CardTitle>
                                                <div className="flex items-center gap-2">
                                                    <Badge variant={result.success ? "default" : "destructive"} className="gap-1">
                                                        {result.success ? (
                                                            <CheckCircle className="w-3 h-3" />
                                                        ) : (
                                                            <XCircle className="w-3 h-3" />
                                                        )}
                                                        {result.success ? "Success" : "Failed"}
                                                    </Badge>
                                                    {result.success && (captureInputSchema || captureOutputSchema) && (
                                                        <Badge variant="outline" className="gap-1 text-emerald-600 border-emerald-300 bg-emerald-50 text-[10px]">
                                                            <Database className="w-3 h-3" /> Schemas Captured
                                                        </Badge>
                                                    )}
                                                </div>
                                            </div>
                                        </CardHeader>
                                        <CardContent className="space-y-3">
                                            <div className="space-y-1">
                                                <Label className="text-xs text-muted-foreground">Output</Label>
                                                <pre className="text-xs bg-muted p-3 rounded overflow-x-auto whitespace-pre-wrap">
                                                    {result.output || "No output"}
                                                </pre>
                                            </div>

                                            {result.error && (
                                                <div className="space-y-1">
                                                    <Label className="text-xs text-destructive">Error</Label>
                                                    <p className="text-xs text-destructive">{result.error}</p>
                                                </div>
                                            )}

                                            {result.metadata && (
                                                <div className="grid grid-cols-2 gap-3 text-xs">
                                                    {result.metadata.tokensUsed && (
                                                        <div className="space-y-1">
                                                            <Label className="text-xs text-muted-foreground">Tokens</Label>
                                                            <p className="text-xs font-mono">{result.metadata.tokensUsed}</p>
                                                        </div>
                                                    )}
                                                    {result.metadata.statusCode !== undefined && (
                                                        <div className="space-y-1">
                                                            <Label className="text-xs text-muted-foreground">Status Code</Label>
                                                            <p className="text-xs font-mono">{result.metadata.statusCode}</p>
                                                        </div>
                                                    )}
                                                    {result.metadata.statusText && (
                                                        <div className="space-y-1">
                                                            <Label className="text-xs text-muted-foreground">Status</Label>
                                                            <p className="text-xs font-mono">{result.metadata.statusText}</p>
                                                        </div>
                                                    )}
                                                    {result.metadata.method && (
                                                        <div className="space-y-1">
                                                            <Label className="text-xs text-muted-foreground">Method</Label>
                                                            <p className="text-xs font-mono">{result.metadata.method}</p>
                                                        </div>
                                                    )}
                                                    {result.metadata.url && (
                                                        <div className="space-y-1 col-span-2">
                                                            <Label className="text-xs text-muted-foreground">URL</Label>
                                                            <p className="text-xs font-mono break-all">{result.metadata.url}</p>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </CardContent>
                                    </Card>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                <DialogFooter className="mt-4">
                    <Button
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                    >
                        Close
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
