
import React from 'react';
import { 
    FolderInput, 
    Search, 
    Settings, 
    Database, 
    FileArchive, 
    Trash2, 
    Move,
    FileSearch,
    List,
    Layers,
    Binary
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@domain-ui/core/ui/components/ui/select";
import { Switch } from "@domain-ui/core/ui/components/ui/switch";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Separator } from "@domain-ui/core/ui/components/ui/separator";

interface FolderImportJobConfigProps {
    config: {
        folderPath: string;
        pattern: string;
        recursive: boolean;
        mode: "list_only" | "read_content" | "ingest_dataset";
        encoding: "utf8" | "base64" | "data_uri";
        extractArchives: boolean;
        postProcessAction: "none" | "move" | "delete";
        moveDestination?: string;
        maxBatchSize: number;
        onBadRecord: "skip" | "fail_fast";
    };
    onChange: (config: any) => void;
}

export default function FolderImportJobConfig({ config, onChange }: FolderImportJobConfigProps) {
    // Ensure config is safe
    const safeConfig = {
        ...config,
        folderPath: config.folderPath || "",
        pattern: config.pattern || "**/*",
        recursive: config.recursive || false,
        mode: config.mode || "list_only",
        encoding: config.encoding || "utf8",
        extractArchives: config.extractArchives || false,
        postProcessAction: config.postProcessAction || "none",
        maxBatchSize: config.maxBatchSize || 100,
        onBadRecord: config.onBadRecord || "skip",
    };

    const updateConfig = (updates: Partial<typeof safeConfig>) => {
        onChange({ ...safeConfig, ...updates });
    };

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            <div className="flex items-center gap-4">
                <div className="p-3 bg-cyan-500/10 rounded-2xl border border-cyan-500/20">
                    <FolderInput className="w-6 h-6 text-cyan-500" />
                </div>
                <div>
                    <h3 className="text-sm font-black uppercase tracking-widest leading-none">Ingestion Vector (Folder Import)</h3>
                    <p className="text-[10px] text-muted-foreground mt-1">High-throughput scanning and ingestion of filesystem resources into the Oddjob nexus.</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Scanner Configuration */}
                <Card className="border-border/40 bg-muted/5">
                    <CardHeader className="pb-3 bg-muted/20 border-b">
                        <div className="flex items-center gap-2">
                            <Search className="w-3.5 h-3.5 text-cyan-500" />
                            <CardTitle className="text-[10px] font-black uppercase tracking-widest">Scanner Matrix</CardTitle>
                        </div>
                    </CardHeader>
                    <CardContent className="p-5 space-y-4">
                        <div className="space-y-2">
                            <Label className="text-[9px] uppercase font-black tracking-widest opacity-50">Local Path</Label>
                            <Input 
                                className="h-9 text-xs font-mono bg-background" 
                                placeholder="e.g. storage/imports/scans"
                                value={safeConfig.folderPath}
                                onChange={(e) => updateConfig({ folderPath: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label className="text-[9px] uppercase font-black tracking-widest opacity-50">Glob Pattern</Label>
                            <Input 
                                className="h-9 text-xs font-mono bg-background border-cyan-500/10 focus-visible:border-cyan-500/30 font-bold" 
                                placeholder="**/*.{json,csv}"
                                value={safeConfig.pattern}
                                onChange={(e) => updateConfig({ pattern: e.target.value })}
                            />
                        </div>
                        <div className="flex items-center justify-between pt-2">
                            <div className="space-y-0.5">
                                <Label className="text-[9px] uppercase font-bold">Deep Scan (Recursive)</Label>
                                <p className="text-[8px] text-muted-foreground italic">Traverse all subdirectories.</p>
                            </div>
                            <Switch 
                                checked={safeConfig.recursive}
                                onCheckedChange={(v) => updateConfig({ recursive: v })}
                            />
                        </div>
                    </CardContent>
                </Card>

                {/* Processing Mode */}
                <Card className="border-border/40 bg-muted/5">
                    <CardHeader className="pb-3 bg-muted/20 border-b">
                        <div className="flex items-center gap-2">
                            <Database className="w-3.5 h-3.5 text-cyan-500" />
                            <CardTitle className="text-[10px] font-black uppercase tracking-widest">Processing Logic</CardTitle>
                        </div>
                    </CardHeader>
                    <CardContent className="p-5 space-y-4">
                        <div className="space-y-2">
                            <Label className="text-[9px] uppercase font-black tracking-widest opacity-50">Ingestion Mode</Label>
                            <Select value={safeConfig.mode} onValueChange={(v: any) => updateConfig({ mode: v })}>
                                <SelectTrigger className="h-9 bg-background">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="list_only">Index Filenames Only</SelectItem>
                                    <SelectItem value="read_content">Read Full Content</SelectItem>
                                    <SelectItem value="ingest_dataset">Hydrate Dataset (Bulk)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label className="text-[9px] uppercase font-black tracking-widest opacity-50">Binary Decoding</Label>
                            <Select value={safeConfig.encoding} onValueChange={(v: any) => updateConfig({ encoding: v })}>
                                <SelectTrigger className="h-9 bg-background">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="utf8">Plain Text (UTF-8)</SelectItem>
                                    <SelectItem value="base64">Base64 Encoded</SelectItem>
                                    <SelectItem value="data_uri">Data URI (Assets)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Post-Process Actions */}
            <Card className="border-border/40 bg-muted/5 overflow-hidden">
                <CardHeader className="pb-3 border-b bg-muted/20 flex flex-row items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Move className="w-3.5 h-3.5 text-cyan-500" />
                        <CardTitle className="text-[10px] font-black uppercase tracking-widest">Post-Ingestion Lifecycle</CardTitle>
                    </div>
                    <Badge variant="outline" className="text-[8px] font-mono opacity-60">PHASE STABILIZED</Badge>
                </CardHeader>
                <CardContent className="p-6">
                    <div className="flex flex-col md:flex-row gap-6">
                        <div className="flex-1 space-y-4">
                            <div className="space-y-2">
                                <Label className="text-[9px] uppercase font-black tracking-widest opacity-50">Cleanup Action</Label>
                                <div className="grid grid-cols-3 gap-2">
                                    <Button 
                                        variant={safeConfig.postProcessAction === 'none' ? 'default' : 'outline'} 
                                        className="h-8 text-[9px] uppercase font-bold"
                                        onClick={() => updateConfig({ postProcessAction: 'none' })}
                                    >
                                        Retain
                                    </Button>
                                    <Button 
                                        variant={safeConfig.postProcessAction === 'move' ? 'default' : 'outline'} 
                                        className="h-8 text-[9px] uppercase font-bold"
                                        onClick={() => updateConfig({ postProcessAction: 'move' })}
                                    >
                                        Archive
                                    </Button>
                                    <Button 
                                        variant={safeConfig.postProcessAction === 'delete' ? 'destructive' : 'outline'} 
                                        className="h-8 text-[9px] uppercase font-bold"
                                        onClick={() => updateConfig({ postProcessAction: 'delete' })}
                                    >
                                        Purge
                                    </Button>
                                </div>
                            </div>
                            {safeConfig.postProcessAction === 'move' && (
                                <div className="space-y-2 animate-in slide-in-from-left-2 duration-300">
                                    <Label className="text-[9px] uppercase font-black tracking-widest opacity-50">Move Destination</Label>
                                    <Input 
                                        className="h-9 text-xs font-mono bg-background" 
                                        placeholder="e.g. storage/archive/processed"
                                        value={safeConfig.moveDestination}
                                        onChange={(e) => updateConfig({ moveDestination: e.target.value })}
                                    />
                                </div>
                            )}
                        </div>
                        
                        <Separator orientation="vertical" className="hidden md:block h-24" />
                        
                        <div className="flex-1 space-y-4">
                            <div className="flex items-center justify-between p-3 rounded-xl bg-background border border-border/40">
                                <div className="flex items-center gap-3">
                                    <FileArchive className="w-4 h-4 text-cyan-500" />
                                    <div className="space-y-0.5">
                                        <Label className="text-[10px] uppercase font-black tracking-widest">Unpack Archives</Label>
                                        <p className="text-[8px] text-muted-foreground">Auto-extract .zip and .tgz</p>
                                    </div>
                                </div>
                                <Switch 
                                    checked={safeConfig.extractArchives}
                                    onCheckedChange={(v) => updateConfig({ extractArchives: v })}
                                />
                            </div>
                            <div className="flex items-center justify-between p-3 rounded-xl bg-background border border-border/40">
                                <div className="flex items-center gap-3">
                                    <Settings className="w-4 h-4 text-muted-foreground" />
                                    <div className="space-y-0.5">
                                        <Label className="text-[10px] uppercase font-black tracking-widest">Batch Threshold</Label>
                                    </div>
                                </div>
                                <Input 
                                    type="number" 
                                    className="w-16 h-7 text-[10px] font-mono p-1 text-center" 
                                    value={safeConfig.maxBatchSize}
                                    onChange={(e) => updateConfig({ maxBatchSize: parseInt(e.target.value) || 1 })}
                                />
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <div className="p-4 rounded-xl bg-cyan-500/5 border border-cyan-500/10 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-cyan-500/10 rounded-lg">
                        <Binary className="w-4 h-4 text-cyan-500" />
                    </div>
                    <div>
                        <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground block">Memory Isolation</span>
                        <p className="text-[9px] text-muted-foreground italic">Parallel ingestion streams are memory-governed by the Kernel.</p>
                    </div>
                </div>
                <Badge variant="secondary" className="px-4 py-1 text-[9px] font-black uppercase bg-background">MACH 3.1 READY</Badge>
            </div>
        </div>
    );
}
