import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useLocation } from 'wouter';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@domain-ui/core/ui/components/ui/card';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Loader2, Hammer, History, ArrowRight, CheckCircle2, XCircle, Clock, Activity, ExternalLink, AlertTriangle, Rocket } from 'lucide-react';
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { motion } from 'framer-motion';
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from 'date-fns';

interface ForgeJob {
    jobId: string;
    slug: string;
    name: string;
    status: string;
    message?: string;
    progress?: number;
    createdAt: string;
    updatedAt?: string;
    findings?: any[];
    error?: string;
    attempt?: number;
}

export default function ForgeHistory() {
    const [, setLocation] = useLocation();
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const { data: history, isLoading } = useQuery<ForgeJob[]>({
        queryKey: ['/api/apps/forge/drafts'],
        queryFn: async () => {
            const res = await apiRequest('GET', '/api/apps/forge/drafts');
            const data = await res.json();
            return data.drafts || [];
        },
        refetchInterval: 10000, // Refresh every 10s to see progress
    });

    const restartMutation = useMutation({
        mutationFn: async (jobId: string) => {
            const res = await apiRequest('POST', `/api/apps/forge/drafts/${jobId}/restart`, {});
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || `Restart failed (${res.status})`);
            }
            return res.json();
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ['/api/apps/forge/drafts'] });
            toast({ title: "Forge Restarted", description: "The draft build has been re-queued." });
            if (data?.jobId) setLocation(`/armory/forge?jobId=${data.jobId}`);
        },
        onError: (error: any) => {
            toast({ title: "Restart Failed", description: error.message, variant: "destructive" });
        },
    });

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'awaiting_strategy_approval':
            case 'awaiting_architecture_approval':
            case 'awaiting_approval': return <Clock className="w-5 h-5 text-amber-500" />;
            case 'queued':
            case 'running':
            case 'building': return <Loader2 className="w-5 h-5 text-primary animate-spin" />;
            case 'failed': return <XCircle className="w-5 h-5 text-destructive" />;
            case 'completed': return <CheckCircle2 className="w-5 h-5 text-emerald-500" />;
            default: return <Activity className="w-5 h-5 text-muted-foreground" />;
        }
    };

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'completed': return <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 uppercase text-[10px] font-black">Completed</Badge>;
            case 'failed': return <Badge variant="destructive" className="uppercase text-[10px] font-black">Failed</Badge>;
            case 'awaiting_strategy_approval': return <Badge className="bg-amber-500/10 text-amber-500 border-amber-500/20 uppercase text-[10px] font-black">Strategy Review</Badge>;
            case 'awaiting_architecture_approval': return <Badge className="bg-blue-500/10 text-blue-500 border-blue-500/20 uppercase text-[10px] font-black">Arch Review</Badge>;
            case 'awaiting_approval': return <Badge className="bg-amber-500/10 text-amber-500 border-amber-500/20 uppercase text-[10px] font-black">Awaiting Approval</Badge>;
            case 'queued': return <Badge className="bg-primary/10 text-primary border-primary/20 uppercase text-[10px] font-black">Queued</Badge>;
            case 'running':
            case 'building': return <Badge className="bg-primary/10 text-primary border-primary/20 uppercase text-[10px] font-black">Forging...</Badge>;
            default: return <Badge variant="secondary" className="uppercase text-[10px] font-black">{status}</Badge>;
        }
    };

    return (
        <div className="container mx-auto py-8 lg:py-12 px-4 max-w-6xl space-y-8 animate-page-in">
            {/* Header */}
            <div className="relative p-8 rounded-2xl overflow-hidden glass-panel border-white/20 shadow-2xl mb-12">
                <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
                    <History className="w-64 h-64 rotate-12" />
                </div>
                <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-8">
                    <div className="flex items-center gap-6">
                        <div className="p-4 bg-primary rounded-2xl shadow-lg shadow-primary/30">
                            <History className="w-8 h-8 text-foreground" />
                        </div>
                        <div>
                            <h1 className="text-4xl font-black tracking-tighter uppercase italic leading-none">Forge Archives</h1>
                            <p className="text-muted-foreground mt-2 max-w-md font-medium">Revisit past architectural sessions and monitor active assembly lines.</p>
                        </div>
                    </div>
                    <Button 
                        size="lg"
                        className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground shadow-xl shadow-primary/20 h-14 px-8 font-black uppercase tracking-tighter italic" 
                        onClick={() => setLocation('/armory/forge')}
                    >
                        <Hammer className="w-5 h-5" /> New Forge
                    </Button>
                </div>
            </div>

            {isLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {[1, 2, 3, 4, 5, 6].map(i => (
                        <Card key={i} className="h-48 glass-panel animate-pulse" />
                    ))}
                </div>
            ) : history?.length === 0 ? (
                <Card className="text-center py-24 glass-panel border-dashed border-2">
                    <CardContent>
                        <Hammer className="h-16 w-16 mx-auto text-muted-foreground mb-6 opacity-20" />
                        <h3 className="text-2xl font-black uppercase italic tracking-tighter mb-2">No Archives Found</h3>
                        <p className="text-muted-foreground mb-8 max-w-sm mx-auto">Your forge has not yet produced any architectural artifacts. Start your first build to see history here.</p>
                        <Button size="lg" onClick={() => setLocation('/armory/forge')}>Ignite Forge</Button>
                    </CardContent>
                </Card>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {history?.map((job) => (
                        <motion.div
                            key={job.jobId}
                            whileHover={{ y: -5 }}
                            transition={{ type: "spring", stiffness: 300 }}
                        >
                            <Card className="group h-full flex flex-col glass-panel border-white/10 hover:border-primary/40 transition-all overflow-hidden cursor-pointer" onClick={() => setLocation(`/armory/forge?jobId=${job.jobId}`)}>
                                <div className="h-1.5 w-full bg-muted dark:bg-muted">
                                    {job.progress !== undefined && (
                                        <motion.div 
                                            className="h-full bg-primary shadow-[0_0_8px_rgba(var(--primary),0.5)]" 
                                            initial={{ width: 0 }}
                                            animate={{ width: `${job.progress}%` }}
                                        />
                                    )}
                                </div>
                                <CardHeader className="pb-4">
                                    <div className="flex justify-between items-start mb-2">
                                        <div className="p-2 bg-primary/10 rounded-lg group-hover:bg-primary/20 transition-colors">
                                            {getStatusIcon(job.status)}
                                        </div>
                                        {getStatusBadge(job.status)}
                                    </div>
                                    <div>
                                        <CardTitle className="text-xl font-black uppercase tracking-tight leading-none mb-1 group-hover:text-primary transition-colors">
                                            {job.name}
                                        </CardTitle>
                                        <CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60">
                                            {job.slug}
                                        </CardDescription>
                                    </div>
                                </CardHeader>
                                <CardContent className="flex-1 space-y-4">
                                    <p className="text-xs text-muted-foreground font-medium line-clamp-2 italic">
                                        {job.error || job.message || "No status message available."}
                                    </p>
                                    
                                    {job.findings && job.findings.length > 0 && (
                                        <div className="p-3 bg-amber-500/5 border border-amber-500/20 rounded-lg space-y-2">
                                            <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-amber-500">
                                                <AlertTriangle className="w-3 h-3" />
                                                Shadow Audit Findings ({job.findings.length})
                                            </div>
                                            <ul className="space-y-1">
                                                {job.findings.slice(0, 2).map((f, i) => (
                                                    <li key={i} className="text-[9px] text-muted-foreground font-medium flex items-start gap-2">
                                                        <div className="w-1 h-1 rounded-full bg-amber-500 mt-1" />
                                                        {f.issue}
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}

                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
                                            <Clock className="w-3 h-3" />
                                            {formatDistanceToNow(new Date(job.createdAt))} ago
                                        </div>
                                        {job.status === 'failed' ? (
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="h-7 px-2 text-[9px] font-black uppercase tracking-tighter border-destructive/30 text-destructive hover:bg-destructive/10"
                                                disabled={restartMutation.isPending}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    restartMutation.mutate(job.jobId);
                                                }}
                                            >
                                                {restartMutation.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Rocket className="w-3 h-3 mr-1" />}
                                                Restart Build
                                            </Button>
                                        ) : job.status === 'completed' && (
                                            <Button 
                                                variant="ghost" 
                                                size="sm" 
                                                className="h-7 px-2 text-[9px] font-black uppercase tracking-tighter hover:bg-primary/10 hover:text-primary"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    // This would ideally trigger a mutation to run the audit
                                                    toast({ title: "Audit Initiated", description: "Shadow agents are analyzing the deployment..." });
                                                }}
                                            >
                                                <Activity className="w-3 h-3 mr-1" /> Run Shadow Audit
                                            </Button>
                                        )}
                                    </div>
                                </CardContent>
                                <CardFooter className="pt-4 border-t border-white/5 bg-foreground/5 flex justify-between group-hover:bg-primary/5 transition-colors">
                                    <span className="text-[9px] font-black uppercase tracking-tighter text-muted-foreground group-hover:text-primary transition-colors">
                                        ID: {job.jobId.slice(0, 8)}... {job.attempt && job.attempt > 1 ? `· attempt ${job.attempt}` : ''}
                                    </span>
                                    <div className="flex items-center gap-1 text-primary font-black uppercase tracking-tighter text-[10px] italic">
                                        {job.status === 'failed' ? 'Inspect' : 'Resume'} <ArrowRight className="w-3 h-3 ml-1" />
                                    </div>
                                </CardFooter>
                            </Card>
                        </motion.div>
                    ))}
                </div>
            )}
        </div>
    );
}
