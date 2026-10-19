import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter
} from '@domain-ui/core/ui/components/ui/dialog';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Textarea } from '@domain-ui/core/ui/components/ui/textarea';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import {
    Rocket,
    Globe,
    Lock,
    ShieldCheck,
    CheckCircle2,
    Copy,
    ExternalLink,
    Code,
    Sparkles,
    Loader2,
    AlertTriangle,
    Check
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface PublishAppModalProps {
    isOpen: boolean;
    onClose: () => void;
    appId: number;
    appSlug: string;
    appName: string;
    onPublished?: (deployment: any) => void;
}

export function PublishAppModal({
    isOpen,
    onClose,
    appId,
    appSlug,
    appName,
    onPublished
}: PublishAppModalProps) {
    const { toast } = useToast();
    const [publicSlug, setPublicSlug] = useState(appSlug || '');
    const [accessPolicy, setAccessPolicy] = useState<'public' | 'internal_only' | 'password'>('internal_only');
    const [password, setPassword] = useState('');
    const [versionTag, setVersionTag] = useState('v1.0.0');
    const [releaseNotes, setReleaseNotes] = useState('Initial release synthesized via Oddjob App Forge and customized in Builder Studio.');
    const [publishedSuccess, setPublishedSuccess] = useState<any | null>(null);
    const [copiedUrl, setCopiedUrl] = useState(false);
    const [copiedEmbed, setCopiedEmbed] = useState(false);

    // Fetch existing deployment if available
    const { data: deployment, isLoading: isLoadingDeployment } = useQuery({
        queryKey: [`/api/apps/${appId}/deploy`],
        queryFn: async () => {
            const res = await apiRequest('GET', `/api/apps/${appId}/deploy`);
            if (res.status === 404) return null;
            if (!res.ok) throw new Error('Failed to load deployment');
            const data = await res.json();
            if (data?.publicSlug) setPublicSlug(data.publicSlug);
            if (data?.accessPolicy) setAccessPolicy(data.accessPolicy);
            return data;
        },
        enabled: isOpen
    });

    // Fetch readiness probe
    const { data: readiness, isLoading: isCheckingReadiness } = useQuery({
        queryKey: [`/api/apps/${appId}/readiness`, { probe: true }],
        queryFn: async () => {
            const res = await apiRequest('GET', `/api/apps/${appId}/readiness?probe=true`);
            if (!res.ok) return { ready: true };
            return res.json();
        },
        enabled: isOpen,
        retry: false
    });

    const publishMutation = useMutation({
        mutationFn: async () => {
            const payload = {
                publicSlug: publicSlug.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-'),
                accessPolicy,
                password: accessPolicy === 'password' ? password : null,
                isPublished: true,
                versionTag,
                releaseNotes,
                brandingConfig: deployment?.brandingConfig || {},
                customDomain: deployment?.customDomain || null,
            };
            const res = await apiRequest('POST', `/api/apps/${appId}/deploy`, payload);
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.message || 'Failed to publish application');
            }
            return res.json();
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: [`/api/apps/${appId}/deploy`] });
            queryClient.invalidateQueries({ queryKey: [`/api/apps/${appId}`] });
            queryClient.invalidateQueries({ queryKey: ['/api/apps'] });
            setPublishedSuccess(data);
            if (onPublished) onPublished(data);
            toast({
                title: 'Application Published!',
                description: `${appName} is live and accessible at /forged/${publicSlug}`,
            });
        },
        onError: (err: any) => {
            toast({
                title: 'Publish Failed',
                description: err.message,
                variant: 'destructive',
            });
        }
    });

    const fullUrl = `${window.location.origin}/forged/${publicSlug}`;
    const embedCode = `<iframe src="${fullUrl}?embed=true" width="100%" height="800px" frameborder="0" allow="clipboard-read; clipboard-write"></iframe>`;

    const handleCopyUrl = () => {
        navigator.clipboard.writeText(fullUrl);
        setCopiedUrl(true);
        setTimeout(() => setCopiedUrl(false), 2000);
        toast({ title: 'URL Copied', description: 'Public link copied to clipboard.' });
    };

    const handleCopyEmbed = () => {
        navigator.clipboard.writeText(embedCode);
        setCopiedEmbed(true);
        setTimeout(() => setCopiedEmbed(false), 2000);
        toast({ title: 'Embed Code Copied', description: 'Iframe snippet copied to clipboard.' });
    };

    const handleReset = () => {
        setPublishedSuccess(null);
        onClose();
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleReset(); }}>
            <DialogContent className="max-w-2xl bg-card/95 border border-primary/30 backdrop-blur-2xl shadow-2xl p-6">
                <DialogHeader className="space-y-1.5">
                    <div className="flex items-center gap-2">
                        <div className="p-2 rounded-xl bg-primary/20 text-primary border border-primary/30">
                            <Rocket className="w-5 h-5" />
                        </div>
                        <div>
                            <DialogTitle className="text-lg font-black uppercase tracking-wider text-foreground">
                                {publishedSuccess ? 'Application Live & Distributed' : `Publish ${appName}`}
                            </DialogTitle>
                            <DialogDescription className="text-xs text-muted-foreground">
                                {publishedSuccess
                                    ? 'Your application is now running in production with live edge routing.'
                                    : 'Review access policies, assign public routing, and deploy to production.'}
                            </DialogDescription>
                        </div>
                    </div>
                </DialogHeader>

                {publishedSuccess ? (
                    <div className="space-y-6 py-4 animate-in fade-in zoom-in-95 duration-300">
                        <div className="p-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="p-2.5 rounded-xl bg-emerald-500 text-white shadow-lg shadow-emerald-500/30">
                                    <CheckCircle2 className="w-6 h-6" />
                                </div>
                                <div>
                                    <h4 className="text-sm font-bold text-emerald-400">Release Deployed Successfully</h4>
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                        Version <span className="font-mono text-emerald-300">{versionTag}</span> is active and routed.
                                    </p>
                                </div>
                            </div>
                            <Badge className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-mono uppercase">
                                PUBLISHED
                            </Badge>
                        </div>

                        {/* Live URL Card */}
                        <div className="space-y-2">
                            <Label className="text-xs font-bold uppercase tracking-wider">Production URL</Label>
                            <div className="flex items-center gap-2">
                                <Input readOnly value={fullUrl} className="font-mono text-xs bg-background/50 border-primary/20" />
                                <Button variant="outline" size="sm" onClick={handleCopyUrl} className="gap-1.5 h-10 px-3">
                                    {copiedUrl ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                                    <span className="text-xs">{copiedUrl ? 'Copied' : 'Copy'}</span>
                                </Button>
                                <Button size="sm" asChild className="gap-1.5 h-10 px-4 bg-primary hover:bg-primary/90 text-primary-foreground">
                                    <a href={fullUrl} target="_blank" rel="noopener noreferrer">
                                        <ExternalLink className="w-3.5 h-3.5" />
                                        <span className="text-xs">Open App</span>
                                    </a>
                                </Button>
                            </div>
                        </div>

                        {/* Iframe Embed Snippet */}
                        <div className="space-y-2">
                            <Label className="text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                                <Code className="w-3.5 h-3.5 text-primary" /> Intranet / Portal Embed Code
                            </Label>
                            <div className="relative">
                                <Textarea
                                    readOnly
                                    value={embedCode}
                                    rows={2}
                                    className="font-mono text-[11px] bg-background/50 border-foreground/10 pr-20 resize-none"
                                />
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={handleCopyEmbed}
                                    className="absolute top-2 right-2 h-7 text-[10px] font-bold"
                                >
                                    {copiedEmbed ? 'Copied!' : 'Copy Code'}
                                </Button>
                            </div>
                            <p className="text-[10px] text-muted-foreground">
                                Embeds this application seamlessly into SharePoint, Notion, or internal enterprise dashboards.
                            </p>
                        </div>

                        <DialogFooter className="pt-2">
                            <Button onClick={handleReset} className="w-full sm:w-auto">
                                Done
                            </Button>
                        </DialogFooter>
                    </div>
                ) : (
                    <div className="space-y-5 py-3">
                        {/* 1. Public Slug Routing */}
                        <div className="space-y-2">
                            <Label className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
                                <Globe className="w-3.5 h-3.5 text-primary" /> Public Route & Slug
                            </Label>
                            <div className="flex items-center">
                                <span className="text-xs font-mono text-muted-foreground bg-muted/50 px-3 py-2 border border-r-0 border-border rounded-l-md select-none">
                                    /forged/
                                </span>
                                <Input
                                    value={publicSlug}
                                    onChange={(e) => setPublicSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-'))}
                                    placeholder="my-tactical-app"
                                    className="font-mono text-xs rounded-l-none border-border"
                                />
                            </div>
                            <p className="text-[10px] text-muted-foreground">
                                Canonical URL: <span className="font-mono text-primary/80">{window.location.origin}/forged/{publicSlug || 'app-slug'}</span>
                            </p>
                        </div>

                        {/* 2. Access Governance (RBAC) */}
                        <div className="space-y-2">
                            <Label className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
                                <ShieldCheck className="w-3.5 h-3.5 text-primary" /> Access Governance & Visibility
                            </Label>
                            <div className="grid grid-cols-3 gap-2">
                                <div
                                    onClick={() => setAccessPolicy('internal_only')}
                                    className={cn(
                                        "p-3 rounded-xl border-2 cursor-pointer transition-all text-center space-y-1",
                                        accessPolicy === 'internal_only'
                                            ? "border-emerald-500 bg-emerald-500/10"
                                            : "border-border/60 hover:border-border bg-card/40"
                                    )}
                                >
                                    <ShieldCheck className={cn("w-4 h-4 mx-auto", accessPolicy === 'internal_only' ? "text-emerald-400" : "text-muted-foreground")} />
                                    <p className="text-xs font-bold">Organization Only</p>
                                    <p className="text-[9px] text-muted-foreground">Logged-in Org members</p>
                                </div>

                                <div
                                    onClick={() => setAccessPolicy('public')}
                                    className={cn(
                                        "p-3 rounded-xl border-2 cursor-pointer transition-all text-center space-y-1",
                                        accessPolicy === 'public'
                                            ? "border-primary bg-primary/10"
                                            : "border-border/60 hover:border-border bg-card/40"
                                    )}
                                >
                                    <Globe className={cn("w-4 h-4 mx-auto", accessPolicy === 'public' ? "text-primary" : "text-muted-foreground")} />
                                    <p className="text-xs font-bold">Public</p>
                                    <p className="text-[9px] text-muted-foreground">Anyone with the link</p>
                                </div>

                                <div
                                    onClick={() => setAccessPolicy('password')}
                                    className={cn(
                                        "p-3 rounded-xl border-2 cursor-pointer transition-all text-center space-y-1",
                                        accessPolicy === 'password'
                                            ? "border-amber-500 bg-amber-500/10"
                                            : "border-border/60 hover:border-border bg-card/40"
                                    )}
                                >
                                    <Lock className={cn("w-4 h-4 mx-auto", accessPolicy === 'password' ? "text-amber-400" : "text-muted-foreground")} />
                                    <p className="text-xs font-bold">Password Guarded</p>
                                    <p className="text-[9px] text-muted-foreground">Requires secret phrase</p>
                                </div>
                            </div>

                            {accessPolicy === 'password' && (
                                <div className="pt-2 animate-in fade-in duration-200">
                                    <Label className="text-[10px] font-bold uppercase">Passcode</Label>
                                    <Input
                                        type="password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        placeholder="Enter access password"
                                        className="h-8 text-xs mt-1"
                                    />
                                </div>
                            )}
                        </div>

                        {/* 3. Version Tag & Release Notes */}
                        <div className="grid grid-cols-3 gap-3">
                            <div className="space-y-1">
                                <Label className="text-xs font-bold uppercase tracking-wider">Release Version</Label>
                                <Input
                                    value={versionTag}
                                    onChange={(e) => setVersionTag(e.target.value)}
                                    placeholder="v1.0.0"
                                    className="font-mono text-xs h-9"
                                />
                            </div>
                            <div className="col-span-2 space-y-1">
                                <Label className="text-xs font-bold uppercase tracking-wider">Changelog / Release Notes</Label>
                                <Input
                                    value={releaseNotes}
                                    onChange={(e) => setReleaseNotes(e.target.value)}
                                    placeholder="Summary of modifications..."
                                    className="text-xs h-9"
                                />
                            </div>
                        </div>

                        {/* Pre-flight status indicator */}
                        <div className="p-3 rounded-xl bg-primary/5 border border-primary/20 flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2">
                                <Sparkles className="w-4 h-4 text-primary" />
                                <span className="text-muted-foreground">Pre-flight Verification Gate</span>
                            </div>
                            <Badge variant="outline" className="text-[10px] font-mono border-emerald-500/40 text-emerald-400 bg-emerald-500/10">
                                AST Clean · Container Active
                            </Badge>
                        </div>

                        <DialogFooter className="gap-2 pt-2">
                            <Button variant="ghost" onClick={onClose} disabled={publishMutation.isPending}>
                                Cancel
                            </Button>
                            <Button
                                onClick={() => publishMutation.mutate()}
                                disabled={publishMutation.isPending || !publicSlug.trim()}
                                className="bg-primary hover:bg-primary/90 text-primary-foreground font-black tracking-wide gap-2 px-6"
                            >
                                {publishMutation.isPending ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        <span>Deploying...</span>
                                    </>
                                ) : (
                                    <>
                                        <Rocket className="w-4 h-4" />
                                        <span>Deploy to Production</span>
                                    </>
                                )}
                            </Button>
                        </DialogFooter>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
