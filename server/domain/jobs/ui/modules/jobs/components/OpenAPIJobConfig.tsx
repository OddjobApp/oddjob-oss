
import React, { useState } from 'react';
import { 
    Globe, 
    Shield, 
    Key, 
    Activity, 
    Link as LinkIcon, 
    Database, 
    Cpu,
    Zap,
    AlertCircle
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@domain-ui/core/ui/components/ui/select";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Separator } from "@domain-ui/core/ui/components/ui/separator";

interface OpenAPIJobConfigProps {
    config: {
        specId: number;
        operationId: string;
        parameters: Record<string, any>;
        credentialId?: number;
    };
    onChange: (config: any) => void;
    availableVariables?: any[];
}

export default function OpenAPIJobConfig({ config, onChange, availableVariables = [] }: OpenAPIJobConfigProps) {
    const [selectedSpec, setSelectedSpec] = useState<any>(null);

    // Ensure config is safe
    const safeConfig = {
        ...config,
        specId: config.specId || 0,
        operationId: config.operationId || "",
        parameters: config.parameters || {},
        credentialId: config.credentialId,
    };

    const updateConfig = (updates: Partial<typeof safeConfig>) => {
        onChange({ ...safeConfig, ...updates });
    };

    const updateParam = (key: string, value: any) => {
        updateConfig({
            parameters: {
                ...safeConfig.parameters,
                [key]: value
            }
        });
    };

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            <div className="flex items-center gap-4">
                <div className="p-3 bg-blue-500/10 rounded-2xl border border-blue-500/20 shadow-inner">
                    <Globe className="w-6 h-6 text-blue-500" />
                </div>
                <div>
                    <h3 className="text-sm font-black uppercase tracking-widest leading-none">Universal API Interface</h3>
                    <p className="text-[10px] text-muted-foreground mt-1 text-balance">Invoke external services via OpenAPI/Swagger specifications with auto-injection.</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Spec & Operation */}
                <Card className="border-border/40 bg-muted/5 group hover:border-blue-500/20 transition-colors">
                    <CardHeader className="pb-3 border-b border-border/10 bg-muted/10">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Database className="w-3.5 h-3.5 text-blue-500" />
                                <CardTitle className="text-[10px] font-black uppercase tracking-widest">Protocol Definition</CardTitle>
                            </div>
                            <Badge variant="outline" className="text-[8px] font-mono opacity-60">ADMIN MANAGED</Badge>
                        </div>
                    </CardHeader>
                    <CardContent className="p-5 space-y-4">
                        <div className="space-y-2">
                            <Label className="text-[9px] uppercase font-black tracking-widest opacity-50">API Specification</Label>
                            <Select value={String(safeConfig.specId)} onValueChange={(v) => updateConfig({ specId: parseInt(v) })}>
                                <SelectTrigger className="h-9 bg-background border-border/40 font-bold text-xs">
                                    <SelectValue placeholder="Select API Spec..." />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="0">--- SELECT AN API ---</SelectItem>
                                    <SelectItem value="1">Weather API (Global)</SelectItem>
                                    <SelectItem value="2">Google Maps Core</SelectItem>
                                    <SelectItem value="3">Jira Cloud Integration</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label className="text-[9px] uppercase font-black tracking-widest opacity-50">Operation (Endpoint)</Label>
                            <Input 
                                className="h-9 text-xs font-mono bg-background" 
                                placeholder="e.g. get_current_weather"
                                value={safeConfig.operationId}
                                onChange={(e) => updateConfig({ operationId: e.target.value })}
                            />
                        </div>
                    </CardContent>
                </Card>

                {/* Authentication */}
                <Card className="border-border/40 bg-muted/5 group hover:border-amber-500/20 transition-colors">
                    <CardHeader className="pb-3 border-b border-border/10 bg-muted/10">
                        <div className="flex items-center gap-2">
                            <Shield className="w-3.5 h-3.5 text-amber-500" />
                            <CardTitle className="text-[10px] font-black uppercase tracking-widest">Access Control</CardTitle>
                        </div>
                    </CardHeader>
                    <CardContent className="p-5 space-y-4">
                        <div className="space-y-2">
                            <Label className="text-[9px] uppercase font-black tracking-widest opacity-50">Credentials (Vault)</Label>
                            <Select value={String(safeConfig.credentialId || "0")} onValueChange={(v) => updateConfig({ credentialId: parseInt(v) || undefined })}>
                                <SelectTrigger className="h-9 bg-background border-border/40 font-bold text-xs ring-offset-amber-500">
                                    <SelectValue placeholder="Automatic Selection" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="0">System Default (Injected)</SelectItem>
                                    <SelectItem value="101">Admin API Key</SelectItem>
                                    <SelectItem value="202">OAuth Client (GCP)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="p-3 rounded-xl bg-amber-500/5 border border-amber-500/10 flex items-start gap-3">
                            <Key className="w-3.5 h-3.5 text-amber-500 mt-0.5" />
                            <p className="text-[9px] text-amber-700/80 leading-relaxed font-medium">Selected credentials will be auto-injected into headers or query parameters as defined by the spec.</p>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Parameter Mapping */}
            <Card className="border-border/40 bg-muted/5">
                <CardHeader className="pb-4 border-b bg-muted/20">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Cpu className="w-3.5 h-3.5 text-blue-500" />
                            <CardTitle className="text-[10px] font-black uppercase tracking-widest">Parameter Nexus</CardTitle>
                        </div>
                        <div className="flex gap-2">
                            <Badge className="bg-background text-[9px] font-mono border-border/40">MAPPED: {Object.keys(safeConfig.parameters).length}</Badge>
                            <Badge className="bg-blue-500/10 text-blue-500 text-[9px] border-blue-500/20">DYNAMIC: ON</Badge>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-6">
                    {safeConfig.operationId ? (
                        <div className="space-y-4">
                            {/* In a real app, we would fetch params from spec. For now, we allow adding manual mappings */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {Object.entries(safeConfig.parameters).map(([key, val]) => (
                                    <div key={key} className="space-y-1.5 p-3 rounded-xl bg-background border border-border/60 hover:border-blue-500/30 transition-all">
                                        <div className="flex items-center justify-between mb-1">
                                            <Label className="text-[9px] font-black uppercase tracking-tight text-muted-foreground">{key}</Label>
                                            <Button variant="ghost" size="icon" className="h-5 w-5 text-muted-foreground/30 hover:text-destructive" onClick={() => {
                                                const p = { ...safeConfig.parameters };
                                                delete p[key];
                                                updateConfig({ parameters: p });
                                            }}>
                                                <Zap className="w-3 h-3 fill-current" />
                                            </Button>
                                        </div>
                                        <Input 
                                            className="h-8 text-[11px] font-mono bg-muted/30" 
                                            value={String(val)} 
                                            onChange={(e) => updateParam(key, e.target.value)}
                                        />
                                    </div>
                                ))}
                            </div>
                            
                            <Button 
                                variant="outline" 
                                size="sm" 
                                className="w-full border-dashed text-[10px] uppercase font-black tracking-widest py-6 bg-transparent hover:bg-blue-500/5 hover:border-blue-500/30 transition-all"
                                onClick={() => updateParam(`param_${Math.random().toString(36).substring(7)}`, "")}
                            >
                                <Activity className="w-3 h-3 mr-2 text-blue-500" />
                                Add Manual Variable Mapping
                            </Button>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center py-12 text-center opacity-40">
                            <AlertCircle className="w-8 h-8 mb-3" />
                            <h4 className="text-[10px] font-black uppercase tracking-widest">No Operation Selected</h4>
                            <p className="text-[9px] max-w-[200px] mt-1">Select an API specification and operation above to configure parameter mappings.</p>
                        </div>
                    )}
                </CardContent>
            </Card>

            <div className="p-4 rounded-xl bg-muted/20 border border-blue-500/10 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-500/10 rounded-lg">
                        <LinkIcon className="w-4 h-4 text-blue-500" />
                    </div>
                    <div>
                        <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground block">Teleport Mode</span>
                        <p className="text-[9px] text-muted-foreground">Responses are auto-indexed into the mission blackboard.</p>
                    </div>
                </div>
                <Badge variant="secondary" className="px-4 py-1 text-[9px] font-black uppercase bg-background">v3.5 GHOST</Badge>
            </div>
        </div>
    );
}
