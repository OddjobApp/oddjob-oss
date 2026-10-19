import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@domain-ui/core/ui/components/ui/card';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import { RefreshCw, Upload, CheckCircle2, AlertCircle, History, Terminal } from 'lucide-react';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Textarea } from '@domain-ui/core/ui/components/ui/textarea';
import { cn } from "@/lib/utils";
import type { App } from "@shared/schema/apps";

interface AppDeveloperTabProps {
    appId: number;
    app: App;
}

export function AppDeveloperTab({ appId, app }: AppDeveloperTabProps) {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [manifestUrl, setManifestUrl] = useState(app.manifestUrl || "");
    const [changelog, setChangelog] = useState("");

    const stageMutation = useMutation({
        mutationFn: async (url: string) => {
            const res = await apiRequest("POST", `/api/apps/${appId}/staging`, { manifestUrl: url });
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['/api/apps/installed'] });
            queryClient.invalidateQueries({ queryKey: ['/api/apps/fleet'] });
            toast({
                title: "Update Staged",
                description: "The manifest has been fetched and is ready for review.",
            });
        },
        onError: (err: any) => {
            toast({
                title: "Staging Failed",
                description: err.message,
                variant: "destructive"
            });
        }
    });

    const publishMutation = useMutation({
        mutationFn: async (notes: string) => {
            const res = await apiRequest("POST", `/api/apps/${appId}/publish`, { changelog: notes });
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['/api/apps/installed'] });
            queryClient.invalidateQueries({ queryKey: ['/api/apps/fleet'] });
            queryClient.invalidateQueries({ queryKey: ['/api/apps/market'] });
            setChangelog("");
            toast({
                title: "Published",
                description: "New version is now live in the marketplace.",
            });
        },
        onError: (err: any) => {
            toast({
                title: "Publish Failed",
                description: err.message,
                variant: "destructive"
            });
        }
    });

    const vNext = (app as any).vNextManifest;

    return (
        <div className="space-y-8 max-w-5xl mx-auto">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <Card className="flex flex-col glass-panel border-foreground/5 hover:border-primary/20 transition-all group overflow-hidden">
                    <CardHeader className="relative">
                        <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:opacity-10 transition-opacity">
                            <RefreshCw className="w-16 h-16" />
                        </div>
                        <CardTitle className="flex items-center gap-3 text-sm font-black uppercase tracking-[0.2em] relative z-10">
                            <RefreshCw className="h-4 w-4 text-primary" /> Stage Manifest Update
                        </CardTitle>
                        <CardDescription className="text-[11px] font-medium opacity-60 relative z-10">
                            Fetch the latest tool definitions and settings from your hosted manifest URL.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4 flex-1 relative z-10">
                        <div className="space-y-2">
                            <Label htmlFor="manifestUrl" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Manifest URL</Label>
                            <Input
                                id="manifestUrl"
                                value={manifestUrl}
                                onChange={(e) => setManifestUrl(e.target.value)}
                                placeholder="https://your-domain.com/app-manifest.json"
                                className="h-10 text-xs bg-background/20 border-foreground/5 focus:ring-primary/40 rounded-xl"
                            />
                            <p className="text-[10px] text-muted-foreground italic font-medium">
                                Oddjob will fetch this JSON to update app capabilities.
                            </p>
                        </div>
                    </CardContent>
                    <CardFooter className="border-t border-foreground/5 pt-6 bg-foreground/5">
                        <Button
                            className="w-full h-10 shadow-lg shadow-primary/20"
                            onClick={() => stageMutation.mutate(manifestUrl)}
                            disabled={stageMutation.isPending}
                        >
                            {stageMutation.isPending ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                            Fetch & Stage Draft
                        </Button>
                    </CardFooter>
                </Card>

                <Card className={cn("flex flex-col glass-panel transition-all group overflow-hidden", 
                    vNext ? 'border-primary/30 bg-primary/5 shadow-[0_0_30px_hsl(var(--primary)/0.05)]' : 'border-foreground/5 opacity-50 grayscale hover:grayscale-0'
                )}>
                    <CardHeader className="relative">
                        <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:opacity-10 transition-opacity">
                            <History className="w-16 h-16" />
                        </div>
                        <div className="flex justify-between items-start relative z-10">
                            <CardTitle className="flex items-center gap-3 text-sm font-black uppercase tracking-[0.2em]">
                                <History className="h-4 w-4 text-primary" /> Draft Version (vNext)
                            </CardTitle>
                            {vNext ? (
                                <Badge className="bg-amber-500 font-bold uppercase tracking-tighter text-[9px] h-5 shadow-lg shadow-amber-900/20">Staged</Badge>
                            ) : (
                                <Badge variant="outline" className="text-[9px] h-5 opacity-40 uppercase tracking-tighter">Empty</Badge>
                            )}
                        </div>
                        <CardDescription className="text-[11px] font-medium opacity-60">
                            Review the staged changes before making them public.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4 flex-1 relative z-10">
                        {vNext ? (
                            <div className="space-y-6">
                                <div className="p-4 bg-background/60 rounded-2xl border border-foreground/10 text-[10px] font-mono max-h-[150px] overflow-y-auto custom-scrollbar shadow-inner">
                                    <pre className="text-foreground">{JSON.stringify(vNext, null, 2)}</pre>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="changelog" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Changelog / Release Notes</Label>
                                    <Textarea
                                        id="changelog"
                                        placeholder="What's new in this version?"
                                        value={changelog}
                                        onChange={(e) => setChangelog(e.target.value)}
                                        className="h-24 bg-background/20 border-foreground/5 focus:ring-primary/40 rounded-xl text-xs custom-scrollbar"
                                    />
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center py-16 text-center">
                                <AlertCircle className="h-8 w-8 text-muted-foreground/30 mb-3" />
                                <p className="text-xs font-black uppercase tracking-widest text-muted-foreground/40">No draft staged</p>
                            </div>
                        )}
                    </CardContent>
                    <CardFooter className="border-t border-foreground/5 pt-6 bg-foreground/5">
                        <Button
                            className="w-full h-10 shadow-lg"
                            variant="default"
                            disabled={!vNext || publishMutation.isPending}
                            onClick={() => publishMutation.mutate(changelog)}
                        >
                            {publishMutation.isPending ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                            Publish to Marketplace
                        </Button>
                    </CardFooter>
                </Card>
            </div>

            <Card className="glass-panel border-foreground/5 overflow-hidden">
                <CardHeader className="border-b border-foreground/5 bg-foreground/5">
                    <CardTitle className="flex items-center gap-3 text-sm font-black uppercase tracking-[0.2em]">
                        <Terminal className="h-4 w-4 text-primary" /> Current Production Manifest
                    </CardTitle>
                    <CardDescription className="text-[11px] font-medium opacity-60">
                        Active configuration currently live for all users.
                    </CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="p-6 bg-background/40 text-slate-50 font-mono text-[10px] overflow-x-auto custom-scrollbar">
                        <div className="flex gap-6 mb-6 pb-6 border-b border-foreground/10 opacity-70">
                            <div className="flex flex-col gap-1">
                                <span className="text-primary font-black uppercase tracking-widest text-[8px]">ID Link</span>
                                <span>{app.slug}</span>
                            </div>
                            <div className="flex flex-col gap-1">
                                <span className="text-primary font-black uppercase tracking-widest text-[8px]">Current Version</span>
                                <span className="text-emerald-400 font-bold">v{app.version}</span>
                            </div>
                            <div className="flex flex-col gap-1">
                                <span className="text-primary font-black uppercase tracking-widest text-[8px]">Visibility</span>
                                <span className="uppercase">{app.isPublic ? "Public" : "Private"}</span>
                            </div>
                        </div>
                        <div className="whitespace-pre leading-relaxed text-foreground">
                            {JSON.stringify({
                                name: app.name,
                                description: app.description,
                                manifestUrl: app.manifestUrl,
                                changelog: app.changelog
                            }, null, 2)}
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

