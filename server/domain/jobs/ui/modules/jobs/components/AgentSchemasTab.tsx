import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import TestAndCapture from "@domain-ui/pipeline/ui/modules/pipelines/components/TestAndCapture";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Switch } from "@domain-ui/core/ui/components/ui/switch";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@domain-ui/core/ui/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@domain-ui/core/ui/components/ui/tabs";
import {
    Save,
    Plus,
    Trash2,
    Database,
    ArrowDownToLine,
    ArrowUpFromLine,
    Wand2,
    Info,
    Key,
    Link2,
    FlaskConical,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import ParameterSchemaEditor from "@domain-ui/core/ui/components/shared/ParameterSchemaEditor";
import { SchemaMappingEditor } from "@domain-ui/core/ui/components/shared/SchemaMappingEditor";
import type { JobParameter, FieldDefinition, JobInputSchema, JobOutputSchema } from "@shared/schema/jobs/types";
import type { OutputStorageSettings } from "@shared/schema/jobs/table";

interface AgentSchemasTabProps {
    jobId: number;
}

// ────────────────────────────────────────────────────────────────────────────
// FieldDefinition inline editor
// ────────────────────────────────────────────────────────────────────────────

interface FieldRowProps {
    fieldName: string;
    definition: FieldDefinition;
    onChange: (name: string, def: FieldDefinition) => void;
    onRename: (oldName: string, newName: string) => void;
    onRemove: (name: string) => void;
}

function FieldRow({ fieldName, definition, onChange, onRename, onRemove }: FieldRowProps) {
    const [editingName, setEditingName] = useState(fieldName);

    const update = (patch: Partial<FieldDefinition>) => {
        onChange(fieldName, { ...definition, ...patch });
    };

    return (
        <div className="group grid grid-cols-[200px_120px_80px_80px_1fr_36px] gap-2 items-center p-2 rounded-lg border border-border/50 bg-muted/20 hover:bg-muted/40 transition-colors">
            {/* Field name */}
            <Input
                value={editingName}
                className="h-7 text-xs font-mono bg-background"
                onChange={e => setEditingName(e.target.value)}
                onBlur={() => {
                    if (editingName !== fieldName) onRename(fieldName, editingName);
                }}
            />
            {/* Type */}
            <Select value={definition.type} onValueChange={val => update({ type: val })}>
                <SelectTrigger className="h-7 text-xs">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {["string", "number", "boolean", "object", "array", "date", "json", "any"].map(t => (
                        <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
            {/* Required */}
            <div className="flex items-center gap-1.5">
                <Switch
                    id={`req-${fieldName}`}
                    checked={definition.required ?? false}
                    onCheckedChange={v => update({ required: v })}
                    className="scale-75"
                />
                <Label htmlFor={`req-${fieldName}`} className="text-[10px] text-muted-foreground">Req</Label>
            </div>
            {/* Key flags */}
            <div className="flex items-center gap-1">
                <button
                    type="button"
                    title="Primary key"
                    onClick={() => update({ isKey: !definition.isKey })}
                    className={`p-1 rounded transition-colors ${definition.isKey ? "text-amber-500 bg-amber-50" : "text-muted-foreground/40 hover:text-muted-foreground"}`}
                >
                    <Key className="w-3 h-3" />
                </button>
                <button
                    type="button"
                    title="Foreign key"
                    onClick={() => update({ isForeignKey: !definition.isForeignKey })}
                    className={`p-1 rounded transition-colors ${definition.isForeignKey ? "text-blue-500 bg-blue-50" : "text-muted-foreground/40 hover:text-muted-foreground"}`}
                >
                    <Link2 className="w-3 h-3" />
                </button>
            </div>
            {/* Description */}
            <Input
                value={definition.description ?? ""}
                placeholder="Description..."
                className="h-7 text-xs bg-background"
                onChange={e => update({ description: e.target.value })}
            />
            {/* Remove */}
            <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground/40 hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => onRemove(fieldName)}
            >
                <Trash2 className="w-3.5 h-3.5" />
            </Button>
        </div>
    );
}

interface SchemaEditorProps {
    label: string;
    capturedAt?: string;
    schemaDef: Record<string, FieldDefinition>;
    sampleData?: any;
    onChange: (schemaDef: Record<string, FieldDefinition>) => void;
}

function SchemaDefEditor({ label, capturedAt, schemaDef, sampleData, onChange }: SchemaEditorProps) {
    const [newFieldName, setNewFieldName] = useState("");

    const handleAdd = () => {
        const name = newFieldName.trim();
        if (!name || schemaDef[name]) return;
        onChange({ ...schemaDef, [name]: { type: "string", required: false } });
        setNewFieldName("");
    };

    const handleChange = (fieldName: string, def: FieldDefinition) => {
        onChange({ ...schemaDef, [fieldName]: def });
    };

    const handleRename = (oldName: string, newName: string) => {
        const trimmed = newName.trim();
        if (!trimmed || trimmed === oldName || schemaDef[trimmed]) return;
        const updated: Record<string, FieldDefinition> = {};
        for (const [k, v] of Object.entries(schemaDef)) {
            updated[k === oldName ? trimmed : k] = v;
        }
        onChange(updated);
    };

    const handleRemove = (fieldName: string) => {
        const updated = { ...schemaDef };
        delete updated[fieldName];
        onChange(updated);
    };

    const fields = Object.entries(schemaDef);

    return (
        <div className="space-y-3">
            {capturedAt && (
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60">
                    <Info className="w-3 h-3" />
                    <span>Last captured {new Date(capturedAt).toLocaleDateString()} at {new Date(capturedAt).toLocaleTimeString()}</span>
                </div>
            )}

            {/* Column headers */}
            {fields.length > 0 && (
                <div className="grid grid-cols-[200px_120px_80px_80px_1fr_36px] gap-2 px-2">
                    {["Field Name", "Type", "Required", "Flags", "Description", ""].map(h => (
                        <span key={h} className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50">{h}</span>
                    ))}
                </div>
            )}

            <div className="space-y-1.5">
                {fields.map(([name, def]) => (
                    <FieldRow
                        key={name}
                        fieldName={name}
                        definition={def}
                        onChange={handleChange}
                        onRename={handleRename}
                        onRemove={handleRemove}
                    />
                ))}
                {fields.length === 0 && (
                    <div className="py-10 border border-dashed rounded-xl text-center space-y-1">
                        <Database className="w-8 h-8 mx-auto text-muted-foreground/20" />
                        <p className="text-[11px] text-muted-foreground/50">No {label.toLowerCase()} fields defined.</p>
                        <p className="text-[10px] text-muted-foreground/40">Run the agent once to auto-capture, or add manually below.</p>
                    </div>
                )}
            </div>

            {/* Add field row */}
            <div className="flex gap-2 pt-1">
                <Input
                    placeholder="field_name"
                    value={newFieldName}
                    className="h-8 text-xs font-mono max-w-[200px]"
                    onChange={e => setNewFieldName(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") handleAdd(); }}
                />
                <Button variant="outline" size="sm" className="h-8 text-xs font-bold uppercase tracking-widest gap-1.5" onClick={handleAdd}>
                    <Plus className="w-3.5 h-3.5" /> Add Field
                </Button>
            </div>

            {/* Sample data preview */}
            {sampleData && (
                <details className="group">
                    <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50 hover:text-muted-foreground transition-colors list-none flex items-center gap-1.5 pt-2">
                        <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
                        Sample Data Preview
                    </summary>
                    <pre className="mt-2 p-3 rounded-lg bg-muted/30 text-[10px] font-mono overflow-auto max-h-40 border border-border/50">
                        {JSON.stringify(sampleData, null, 2)}
                    </pre>
                </details>
            )}
        </div>
    );
}

// ────────────────────────────────────────────────────────────────────────────
// Main component
// ────────────────────────────────────────────────────────────────────────────

export function AgentSchemasTab({ jobId }: AgentSchemasTabProps) {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const { data: job, isLoading } = useQuery<any>({
        queryKey: [`/api/jobs/${jobId}`],
    });

    // Local draft state
    const [parameterSchema, setParameterSchema] = useState<JobParameter[]>([]);
    const [inputSchema, setInputSchema] = useState<JobInputSchema>({ capturedAt: "", sampleInput: null, schemaDef: {} });
    const [outputSchema, setOutputSchema] = useState<JobOutputSchema>({ capturedAt: "", sampleOutput: null, schemaDef: {} });
    const [outputStorageSettings, setOutputStorageSettings] = useState<OutputStorageSettings>({} as any);

    useEffect(() => {
        if (!job) return;
        setParameterSchema(Array.isArray(job.parameterSchema) ? job.parameterSchema : []);
        setInputSchema(job.inputSchema ?? { capturedAt: "", sampleInput: null, schemaDef: {} });
        setOutputSchema(job.outputSchema ?? { capturedAt: "", sampleOutput: null, schemaDef: {} });
        setOutputStorageSettings(job.outputStorageSettings ?? {});
    }, [job]);

    const saveMutation = useMutation({
        mutationFn: async (payload: any) => {
            const res = await apiRequest("PUT", `/api/jobs/${jobId}`, payload);
            if (!res.ok) throw new Error("Save failed");
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [`/api/jobs/${jobId}`] });
            toast({ title: "Schemas Saved", description: "Schema definitions have been updated." });
        },
        onError: (err: any) => {
            toast({ title: "Save Failed", description: err.message, variant: "destructive" });
        },
    });

    const handleSave = () => {
        saveMutation.mutate({
            parameterSchema,
            inputSchema: inputSchema.schemaDef && Object.keys(inputSchema.schemaDef).length > 0
                ? { ...inputSchema, capturedAt: inputSchema.capturedAt || new Date().toISOString() }
                : null,
            outputSchema: outputSchema.schemaDef && Object.keys(outputSchema.schemaDef).length > 0
                ? { ...outputSchema, capturedAt: outputSchema.capturedAt || new Date().toISOString() }
                : null,
            outputStorageSettings,
        });
    };

    // Keys available to SchemaMappingEditor come from outputSchema.schemaDef
    const outputSchemaKeys = Object.keys(outputSchema?.schemaDef ?? {});

    if (isLoading) {
        return (
            <div className="flex items-center justify-center p-12 text-[10px] font-bold uppercase tracking-widest text-muted-foreground animate-pulse">
                Loading Schema Data...
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Sub-tabs */}
            <Tabs defaultValue="parameters">
                <div className="flex items-center justify-between mb-1">
                    <TabsList className="bg-muted/40 border h-9">
                        <TabsTrigger value="parameters" className="text-[10px] uppercase font-black tracking-widest px-4 gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                            <Database className="w-3 h-3" /> Parameters
                        </TabsTrigger>
                        <TabsTrigger value="input" className="text-[10px] uppercase font-black tracking-widest px-4 gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                            <ArrowDownToLine className="w-3 h-3" /> Input Schema
                        </TabsTrigger>
                        <TabsTrigger value="output" className="text-[10px] uppercase font-black tracking-widest px-4 gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                            <ArrowUpFromLine className="w-3 h-3" /> Output Schema
                        </TabsTrigger>
                        <TabsTrigger value="transforms" className="text-[10px] uppercase font-black tracking-widest px-4 gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                            <Wand2 className="w-3 h-3" /> Transformations
                        </TabsTrigger>
                        <TabsTrigger value="dryrun" className="text-[10px] uppercase font-black tracking-widest px-4 gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                            <FlaskConical className="w-3 h-3" /> Dry Run
                        </TabsTrigger>
                    </TabsList>

                    <Button
                        className="h-9 text-[10px] font-black uppercase tracking-widest gap-2"
                        onClick={handleSave}
                        disabled={saveMutation.isPending}
                    >
                        <Save className="w-3.5 h-3.5" />
                        {saveMutation.isPending ? "Saving..." : "Save Schemas"}
                    </Button>
                </div>

                {/* ── Parameters ── */}
                <TabsContent value="parameters" className="mt-0">
                    <Card className="border-border shadow-md">
                        <CardHeader className="border-b bg-muted/20 py-4">
                            <div className="flex items-start justify-between">
                                <div>
                                    <CardTitle className="text-xs font-black uppercase tracking-widest">Input Parameters</CardTitle>
                                    <CardDescription className="text-[11px] mt-0.5">
                                        Define named parameters this agent accepts when triggered programmatically or via API.
                                    </CardDescription>
                                </div>
                                <Badge variant="outline" className="text-[9px] font-black uppercase tracking-widest px-2 border-primary/20 text-primary bg-primary/5">
                                    {parameterSchema.length} param{parameterSchema.length !== 1 ? "s" : ""}
                                </Badge>
                            </div>
                        </CardHeader>
                        <CardContent className="p-6">
                            <ParameterSchemaEditor
                                parameters={parameterSchema}
                                onChange={setParameterSchema}
                            />
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* ── Input Schema ── */}
                <TabsContent value="input" className="mt-0">
                    <Card className="border-border shadow-md">
                        <CardHeader className="border-b bg-muted/20 py-4">
                            <div className="flex items-start justify-between">
                                <div>
                                    <CardTitle className="text-xs font-black uppercase tracking-widest flex items-center gap-2">
                                        <ArrowDownToLine className="w-3.5 h-3.5 text-blue-500" />
                                        Input Schema
                                    </CardTitle>
                                    <CardDescription className="text-[11px] mt-0.5">
                                        Define the expected structure of data flowing into this agent. Auto-populated from run captures.
                                    </CardDescription>
                                </div>
                                <Badge variant="outline" className="text-[9px] font-black uppercase tracking-widest px-2 border-blue-500/20 text-blue-600 bg-blue-500/5">
                                    {Object.keys(inputSchema?.schemaDef ?? {}).length} fields
                                </Badge>
                            </div>
                        </CardHeader>
                        <CardContent className="p-6">
                            <SchemaDefEditor
                                label="Input"
                                capturedAt={inputSchema?.capturedAt}
                                schemaDef={inputSchema?.schemaDef ?? {}}
                                sampleData={inputSchema?.sampleInput}
                                onChange={schemaDef => setInputSchema(prev => ({ ...prev, schemaDef }))}
                            />
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* ── Output Schema ── */}
                <TabsContent value="output" className="mt-0">
                    <Card className="border-border shadow-md">
                        <CardHeader className="border-b bg-muted/20 py-4">
                            <div className="flex items-start justify-between">
                                <div>
                                    <CardTitle className="text-xs font-black uppercase tracking-widest flex items-center gap-2">
                                        <ArrowUpFromLine className="w-3.5 h-3.5 text-emerald-500" />
                                        Output Schema
                                    </CardTitle>
                                    <CardDescription className="text-[11px] mt-0.5">
                                        Define the shape of data produced by this agent. Used for downstream pipeline validation.
                                    </CardDescription>
                                </div>
                                <Badge variant="outline" className="text-[9px] font-black uppercase tracking-widest px-2 border-emerald-500/20 text-emerald-600 bg-emerald-500/5">
                                    {Object.keys(outputSchema?.schemaDef ?? {}).length} fields
                                </Badge>
                            </div>
                        </CardHeader>
                        <CardContent className="p-6">
                            <SchemaDefEditor
                                label="Output"
                                capturedAt={outputSchema?.capturedAt}
                                schemaDef={outputSchema?.schemaDef ?? {}}
                                sampleData={outputSchema?.sampleOutput}
                                onChange={schemaDef => setOutputSchema(prev => ({ ...prev, schemaDef }))}
                            />
                            {outputSchema?.suggestedLabel && (
                                <div className="mt-4 p-3 bg-amber-50 border border-amber-200/60 rounded-lg text-xs text-amber-700 flex items-center gap-2">
                                    <Info className="w-3.5 h-3.5 shrink-0" />
                                    Suggested label column: <span className="font-mono font-bold">{outputSchema.suggestedLabel}</span>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* ── Transformations ── */}
                <TabsContent value="transforms" className="mt-0">
                    <Card className="border-border shadow-md">
                        <CardHeader className="border-b bg-muted/20 py-4">
                            <div className="flex items-start justify-between">
                                <div>
                                    <CardTitle className="text-xs font-black uppercase tracking-widest flex items-center gap-2">
                                        <Wand2 className="w-3.5 h-3.5 text-violet-500" />
                                        Output Transformations
                                    </CardTitle>
                                    <CardDescription className="text-[11px] mt-0.5">
                                        Configure field mapping, renaming, type coercion, and data hygiene rules applied to agent output before storage.
                                    </CardDescription>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="p-6 space-y-6">
                            {/* Storage trigger */}
                            <div className="grid grid-cols-3 gap-4">
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-black uppercase tracking-widest opacity-60">Store On Status</Label>
                                    <Select
                                        value={outputStorageSettings?.storeOnStatus ?? "success"}
                                        onValueChange={v => setOutputStorageSettings(prev => ({ ...prev, storeOnStatus: v as any }))}
                                    >
                                        <SelectTrigger className="h-8 text-xs">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="success">Success only</SelectItem>
                                            <SelectItem value="failure">Failure only</SelectItem>
                                            <SelectItem value="both">Success + Failure</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-black uppercase tracking-widest opacity-60">Min Output Length</Label>
                                    <Input
                                        type="number"
                                        className="h-8 text-xs"
                                        placeholder="0"
                                        value={outputStorageSettings?.minLength ?? ""}
                                        onChange={e => setOutputStorageSettings(prev => ({
                                            ...prev,
                                            minLength: e.target.value ? parseInt(e.target.value) : undefined,
                                        }))}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-black uppercase tracking-widest opacity-60">Require Non-Empty</Label>
                                    <div className="flex items-center gap-2 h-8">
                                        <Switch
                                            checked={outputStorageSettings?.requireNonEmpty ?? true}
                                            onCheckedChange={v => setOutputStorageSettings(prev => ({ ...prev, requireNonEmpty: v }))}
                                        />
                                        <span className="text-xs text-muted-foreground">
                                            {outputStorageSettings?.requireNonEmpty ?? true ? "Enabled" : "Disabled"}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* Chunking settings */}
                            <div className="p-4 rounded-lg border border-border/50 bg-muted/10 space-y-3">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-widest">Chunking</p>
                                        <p className="text-[10px] text-muted-foreground/60 mt-0.5">Split large outputs into overlapping chunks for knowledge storage.</p>
                                    </div>
                                    <Switch
                                        checked={outputStorageSettings?.chunking?.enabled ?? true}
                                        onCheckedChange={v => setOutputStorageSettings(prev => ({
                                            ...prev,
                                            chunking: { enabled: v, chunkSize: prev.chunking?.chunkSize ?? 800, chunkOverlap: prev.chunking?.chunkOverlap ?? 150 },
                                        }))}
                                    />
                                </div>
                                {outputStorageSettings?.chunking?.enabled && (
                                    <div className="grid grid-cols-2 gap-4 pt-1">
                                        <div className="space-y-1.5">
                                            <Label className="text-[10px] font-bold uppercase tracking-widest opacity-50">Chunk Size (chars)</Label>
                                            <Input
                                                type="number"
                                                className="h-8 text-xs"
                                                value={outputStorageSettings.chunking?.chunkSize ?? 800}
                                                onChange={e => setOutputStorageSettings(prev => ({
                                                    ...prev,
                                                    chunking: { ...prev.chunking!, chunkSize: parseInt(e.target.value) || 800 },
                                                }))}
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label className="text-[10px] font-bold uppercase tracking-widest opacity-50">Overlap (chars)</Label>
                                            <Input
                                                type="number"
                                                className="h-8 text-xs"
                                                value={outputStorageSettings.chunking?.chunkOverlap ?? 150}
                                                onChange={e => setOutputStorageSettings(prev => ({
                                                    ...prev,
                                                    chunking: { ...prev.chunking!, chunkOverlap: parseInt(e.target.value) || 150 },
                                                }))}
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Schema mapping */}
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-widest">Field Mapping &amp; Hygiene</p>
                                        <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                                            Map output fields to storage columns, rename, coerce types, and define deduplication rules.
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {(outputStorageSettings?.schemaMapping?.columns?.length ?? 0) > 0 && (
                                            <Badge variant="outline" className="text-[9px] font-black uppercase tracking-widest px-2 border-violet-500/20 text-violet-600 bg-violet-500/5">
                                                {outputStorageSettings.schemaMapping!.columns!.length} mapped
                                            </Badge>
                                        )}
                                        <SchemaMappingEditor
                                            availableKeys={outputSchemaKeys}
                                            initialMapping={outputStorageSettings?.schemaMapping as any}
                                            sampleData={outputSchema?.sampleOutput ?? undefined}
                                            title="Configure Output Field Mapping"
                                            description="Select which output fields to store, rename them, set types, and apply transforms."
                                            onSave={(config) => {
                                                setOutputStorageSettings(prev => ({
                                                    ...prev,
                                                    schemaMapping: config as any,
                                                }));
                                            }}
                                            trigger={
                                                <Button variant="outline" size="sm" className="h-8 text-[10px] font-black uppercase tracking-widest gap-1.5">
                                                    <Wand2 className="w-3.5 h-3.5" />
                                                    {(outputStorageSettings?.schemaMapping?.columns?.length ?? 0) > 0 ? "Edit Mapping" : "Configure Mapping"}
                                                </Button>
                                            }
                                        />
                                    </div>
                                </div>

                                {/* Mapping summary */}
                                {(outputStorageSettings?.schemaMapping?.columns?.length ?? 0) > 0 ? (
                                    <div className="rounded-lg border border-border/50 overflow-hidden">
                                        <div className="grid grid-cols-[1fr_1fr_80px_80px] gap-2 px-3 py-1.5 bg-muted/30 border-b">
                                            {["Source Field", "Target Column", "Type", "Transform"].map(h => (
                                                <span key={h} className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50">{h}</span>
                                            ))}
                                        </div>
                                        {outputStorageSettings.schemaMapping!.columns!.slice(0, 8).map((col: any, i: number) => (
                                            <div key={i} className="grid grid-cols-[1fr_1fr_80px_80px] gap-2 px-3 py-1.5 border-b border-border/30 last:border-0 hover:bg-muted/20 transition-colors">
                                                <span className="text-[10px] font-mono truncate">{col.jsonPath}</span>
                                                <span className="text-[10px] font-mono text-muted-foreground truncate">{col.datasetKey || col.jsonPath}</span>
                                                <Badge variant="secondary" className="text-[9px] h-4 px-1.5 w-fit">{col.type}</Badge>
                                                {col.transform && col.transform !== "none" ? (
                                                    <Badge variant="outline" className="text-[9px] h-4 px-1.5 w-fit text-orange-600 border-orange-300">{col.transform}</Badge>
                                                ) : (
                                                    <span className="text-[10px] text-muted-foreground/30">—</span>
                                                )}
                                            </div>
                                        ))}
                                        {outputStorageSettings.schemaMapping!.columns!.length > 8 && (
                                            <div className="px-3 py-1.5 text-[10px] text-muted-foreground/50 bg-muted/10">
                                                +{outputStorageSettings.schemaMapping!.columns!.length - 8} more fields…
                                            </div>
                                        )}
                                    </div>
                                ) : outputSchemaKeys.length === 0 ? (
                                    <div className="py-8 border border-dashed rounded-xl text-center space-y-1">
                                        <Wand2 className="w-8 h-8 mx-auto text-muted-foreground/20" />
                                        <p className="text-[11px] text-muted-foreground/50">No output schema fields detected.</p>
                                        <p className="text-[10px] text-muted-foreground/40">Define fields in the Output Schema tab first, then configure mapping here.</p>
                                    </div>
                                ) : (
                                    <div className="py-6 border border-dashed rounded-xl text-center space-y-1">
                                        <p className="text-[11px] text-muted-foreground/50">No field mapping configured — all output fields will be stored as-is.</p>
                                        <p className="text-[10px] text-muted-foreground/40">{outputSchemaKeys.length} field{outputSchemaKeys.length !== 1 ? "s" : ""} available to map.</p>
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* ── Dry Run & Capture ── */}
                <TabsContent value="dryrun" className="mt-0">
                    <Card className="border-border shadow-md">
                        <CardHeader className="border-b bg-muted/20 py-4">
                            <CardTitle className="text-xs font-black uppercase tracking-widest flex items-center gap-2">
                                <FlaskConical className="w-3.5 h-3.5 text-primary" /> Dry Run &amp; Schema Capture
                            </CardTitle>
                            <CardDescription className="text-[11px]">
                                Execute a test run against live systems and auto-capture the input/output schema from the actual response. Use "Save Schema" to persist the result.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="p-6">
                            <TestAndCapture
                                jobId={jobId}
                                jobType={job?.type ?? "ai_agent"}
                                parameterSchema={parameterSchema.length > 0 ? { parameters: parameterSchema } : undefined}
                            />
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}
