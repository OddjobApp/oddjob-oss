
import React from 'react';
import { 
    FileText, 
    Save, 
    HardDrive, 
    Cloud, 
    Globe, 
    Shield, 
    Terminal,
    Type,
    Binary,
    Settings
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@domain-ui/core/ui/components/ui/select";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Switch } from "@domain-ui/core/ui/components/ui/switch";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";

interface FileWriterJobConfigProps {
    config: {
        content: string;
        format: "raw" | "json" | "csv";
        encoding: "utf8" | "base64" | "data_uri";
        destination: "local" | "aws_s3" | "google_cloud_storage" | "azure_blob" | "google_drive" | "onedrive";
        path: string;
        credentialId?: number;
        bucket?: string;
        container?: string;
        onConflict: "overwrite" | "append" | "fail" | "rename";
        createDirs: boolean;
        acl?: string;
    };
    onChange: (config: any) => void;
    availableVariables?: any[];
}

export default function FileWriterJobConfig({ config, onChange }: FileWriterJobConfigProps) {
    // Ensure config is safe
    const safeConfig = {
        ...config,
        content: config.content || "",
        format: config.format || "raw",
        encoding: config.encoding || "utf8",
        destination: config.destination || "local",
        path: config.path || "",
        onConflict: config.onConflict || "overwrite",
        createDirs: config.createDirs !== false,
    };

    const updateConfig = (updates: Partial<typeof safeConfig>) => {
        onChange({ ...safeConfig, ...updates });
    };

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            <div className="flex items-center gap-4">
                <div className="p-3 bg-muted/10 rounded-2xl border border-border/20">
                    <FileText className="w-6 h-6 text-muted-foreground" />
                </div>
                <div>
                    <h3 className="text-sm font-black uppercase tracking-widest leading-none">Archival Unit (File Writer)</h3>
                    <p className="text-[10px] text-muted-foreground mt-1">Serialize and commit data streams to local or cloud-native storage nodes.</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Destination Config */}
                <Card className="border-border/40 bg-muted/5">
                    <CardHeader className="pb-3 bg-muted/20 border-b">
                        <div className="flex items-center gap-2">
                            <HardDrive className="w-3.5 h-3.5 text-muted-foreground" />
                            <CardTitle className="text-[10px] font-black uppercase tracking-widest">Storage Node</CardTitle>
                        </div>
                    </CardHeader>
                    <CardContent className="p-5 space-y-4">
                        <div className="space-y-2">
                            <Label className="text-[9px] uppercase font-black tracking-widest opacity-50">Target Destination</Label>
                            <Select value={safeConfig.destination} onValueChange={(v: any) => updateConfig({ destination: v })}>
                                <SelectTrigger className="h-9 bg-background">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="local">Local Filesystem (storage/)</SelectItem>
                                    <SelectItem value="aws_s3">Amazon S3</SelectItem>
                                    <SelectItem value="google_cloud_storage">Google Cloud Storage</SelectItem>
                                    <SelectItem value="google_drive">Google Drive</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label className="text-[9px] uppercase font-black tracking-widest opacity-50">Storage Path (Remote/Local)</Label>
                            <Input 
                                className="h-9 text-xs font-mono bg-background" 
                                placeholder="e.g. exports/report.json"
                                value={safeConfig.path}
                                onChange={(e) => updateConfig({ path: e.target.value })}
                            />
                        </div>
                        {(safeConfig.destination === 'aws_s3' || safeConfig.destination === 'google_cloud_storage') && (
                            <div className="space-y-2 animate-in slide-in-from-top-2 duration-300">
                                <Label className="text-[9px] uppercase font-black tracking-widest opacity-50">Bucket / Container</Label>
                                <Input 
                                    className="h-9 text-xs font-mono bg-background" 
                                    placeholder="e.g. oddjob-vault"
                                    value={safeConfig.bucket || safeConfig.container}
                                    onChange={(e) => updateConfig({ bucket: e.target.value, container: e.target.value })}
                                />
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Format & Encoding */}
                <Card className="border-border/40 bg-muted/5">
                    <CardHeader className="pb-3 bg-muted/20 border-b">
                        <div className="flex items-center gap-2">
                            <Binary className="w-3.5 h-3.5 text-muted-foreground" />
                            <CardTitle className="text-[10px] font-black uppercase tracking-widest">Serialization Matrix</CardTitle>
                        </div>
                    </CardHeader>
                    <CardContent className="p-5 space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label className="text-[9px] uppercase font-black tracking-widest opacity-50">Format</Label>
                                <Select value={safeConfig.format} onValueChange={(v: any) => updateConfig({ format: v })}>
                                    <SelectTrigger className="h-8 text-[10px] bg-background">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="raw">Raw Text</SelectItem>
                                        <SelectItem value="json">JSON Objs</SelectItem>
                                        <SelectItem value="csv">CSV Table</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label className="text-[9px] uppercase font-black tracking-widest opacity-50">Encoding</Label>
                                <Select value={safeConfig.encoding} onValueChange={(v: any) => updateConfig({ encoding: v })}>
                                    <SelectTrigger className="h-8 text-[10px] bg-background">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="utf8">UTF-8</SelectItem>
                                        <SelectItem value="base64">Base64</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label className="text-[9px] uppercase font-black tracking-widest opacity-50">Conflict Policy</Label>
                            <Select value={safeConfig.onConflict} onValueChange={(v: any) => updateConfig({ onConflict: v })}>
                                <SelectTrigger className="h-8 text-[10px] bg-background">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="overwrite">Overwrite</SelectItem>
                                    <SelectItem value="append">Append</SelectItem>
                                    <SelectItem value="rename">Auto-Rename</SelectItem>
                                    <SelectItem value="fail">Fail Fast</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="flex items-center justify-between pt-2">
                            <div className="space-y-0.5">
                                <Label className="text-[9px] uppercase font-bold">Auto-Create Dirs</Label>
                                <p className="text-[8px] text-muted-foreground italic">Create parent folders if missing.</p>
                            </div>
                            <Switch 
                                checked={safeConfig.createDirs}
                                onCheckedChange={(v) => updateConfig({ createDirs: v })}
                            />
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Content Editor */}
            <Card className="border-border/40 bg-muted/5">
                <CardHeader className="pb-3 border-b bg-muted/20 flex flex-row items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Terminal className="w-3.5 h-3.5 text-muted-foreground" />
                        <CardTitle className="text-[10px] font-black uppercase tracking-widest">Payload Synthesis</CardTitle>
                    </div>
                    <Badge variant="outline" className="text-[8px] font-mono opacity-60">SUPPORTS LIQUID</Badge>
                </CardHeader>
                <CardContent className="p-0">
                    <Textarea 
                        className="min-h-[200px] text-xs font-mono bg-background border-0 rounded-none focus-visible:ring-0 focus-visible:ring-offset-0 px-6 py-4"
                        placeholder="Commit logs or structured data here... Supports {{variable}} injection."
                        value={safeConfig.content}
                        onChange={(e) => updateConfig({ content: e.target.value })}
                    />
                </CardContent>
                <div className="p-2 px-6 bg-muted/10 border-t flex items-center justify-between">
                    <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-tight">Size: {safeConfig.content.length} Bytes</span>
                </div>
            </Card>

            {/* Credentials / Security */}
            {safeConfig.destination !== 'local' && (
                <div className="p-4 rounded-2xl bg-muted/20 border border-border/10 flex items-center justify-between animate-in fade-in duration-500">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-muted/10 rounded-lg">
                            <Shield className="w-4 h-4 text-muted-foreground" />
                        </div>
                        <div className="space-y-0.5">
                            <Label className="text-[10px] uppercase font-black tracking-widest">Vault Authentication</Label>
                            <p className="text-[9px] text-muted-foreground">Select credentials to authorize cloud access.</p>
                        </div>
                    </div>
                    <Select value={String(safeConfig.credentialId || "0")} onValueChange={(v) => updateConfig({ credentialId: parseInt(v) || undefined })}>
                        <SelectTrigger className="w-[200px] h-9 bg-background">
                            <SelectValue placeholder="System Default" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="0">--- DEFAULT ---</SelectItem>
                            <SelectItem value="10">Cloud Storage (Dev)</SelectItem>
                            <SelectItem value="11">Production Vault</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            )}
        </div>
    );
}
