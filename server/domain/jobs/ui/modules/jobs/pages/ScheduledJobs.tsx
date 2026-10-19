import React, { useState, useMemo } from 'react';
import { ErrorBoundary } from '@domain-ui/core/ui/components/shared/ErrorBoundary';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useParams } from 'wouter';
import {
    Plus, Link as LinkIcon, Play, Pencil, Trash2, MoreVertical, History,
    Clock, RotateCcw, GitBranch, CheckCircle, XCircle, Loader2, Building2, Search, Zap
} from 'lucide-react';
import { useOrgContext } from '@domain-ui/core/ui/hooks/use-org-context';
import { useAuth } from '@domain-ui/auth/ui/modules/auth/hooks/use-auth';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@domain-ui/core/ui/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@domain-ui/core/ui/components/ui/dialog';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@domain-ui/core/ui/components/ui/select';
import { Switch } from '@domain-ui/core/ui/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@domain-ui/core/ui/components/ui/tabs';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@domain-ui/core/ui/components/ui/dropdown-menu';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';

interface ExecutionHistoryItem {
    id: number;
    scheduledJobId: number;
    status: 'running' | 'completed' | 'failed' | 'retrying' | 'cancelled';
    executionType: 'job' | 'pipeline' | 'mission';
    scheduledFor: string;
    startedAt: string;
    completedAt?: string;
    durationMs?: number;
    retryCount: number;
    error?: string;
}

export default function ScheduledJobsPage() {
    const { toast } = useToast();
    const [, setLocation] = useLocation();
    const queryClient = useQueryClient();
    const [searchQuery, setSearchQuery] = useState('');
    const params = useParams<{ id?: string }>();
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
    const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
    const [editingJobId, setEditingJobId] = useState<number | null>(null);
    const [executionType, setExecutionType] = useState<'job' | 'pipeline' | 'mission'>('job');
    const [newScheduledJob, setNewScheduledJob] = useState({
        name: '',
        jobId: '',
        pipelineId: '',
        missionId: '',
        scheduleId: '',
        priority: 2,
        alertOnFailure: true,
        maxRetries: 0,
        retryDelaySeconds: 60,
    });

    // Org / auth context
    const { selectedOrgId } = useOrgContext();
    const { adminRole } = useAuth();
    const isSuperAdmin = adminRole?.isSuperAdmin === true;
    const showOrgColumn = isSuperAdmin && selectedOrgId === null;

    // Super-admin org lookup
    const { data: organizationsData } = useQuery<{ organizations: Array<{ id: number; name: string }> }>({
        queryKey: ['/api/admin/organizations'],
        queryFn: async () => {
            const res = await fetch('/api/admin/organizations', { credentials: 'include' });
            if (!res.ok) return { organizations: [] };
            return res.json();
        },
        enabled: showOrgColumn,
        staleTime: 5 * 60 * 1000,
    });
    const orgMap = useMemo(() => {
        const map: Record<number, string> = {};
        (organizationsData?.organizations || []).forEach(org => { map[org.id] = org.name; });
        return map;
    }, [organizationsData]);

    // Fetch scheduled jobs
    const { data: scheduledJobsData = [], isLoading } = useQuery<any[]>({
        queryKey: ['/api/scheduled-jobs', selectedOrgId],
    });

    const normalizeList = (data: any) => Array.isArray(data) ? data : (data?.items || []);

    // Fetch dropdowns
    const { data: jobs = [] } = useQuery<any>({ queryKey: ['/api/jobs'], select: normalizeList });
    const { data: pipelines = [] } = useQuery<any>({ queryKey: ['/api/pipelines'], select: normalizeList });
    const { data: missions = [] } = useQuery<any>({ queryKey: ['/api/missions'], select: normalizeList });
    const { data: schedules = [] } = useQuery<any>({ queryKey: ['/api/schedules'], select: normalizeList });

    // Fetch execution history for the selected job
    const { data: historyData, isLoading: historyLoading } = useQuery<{ data: ExecutionHistoryItem[]; pagination: any }>({
        queryKey: ['/api/scheduled-jobs', selectedJobId, 'history'],
        queryFn: async () => {
            const res = await fetch(`/api/scheduled-jobs/${selectedJobId}/history?limit=20`, { credentials: 'include' });
            if (!res.ok) throw new Error('Failed to fetch execution history');
            return res.json();
        },
        enabled: !!selectedJobId && historyDialogOpen,
    });

    // Normalise raw API rows into display view-model
    const scheduledJobs = (scheduledJobsData || []).map((sj: any) => ({
        id: sj.scheduledJobId || sj.id,
        name: sj.name || `Scheduled Job #${sj.scheduledJobId || sj.id}`,
        jobId: sj.jobId,
        pipelineId: sj.pipelineId,
        missionId: sj.missionId,
        job: sj.jobName || jobs.find((j: any) => j.id === sj.jobId)?.name || (sj.jobId ? `Job #${sj.jobId}` : null),
        pipeline: sj.pipelineName || pipelines.find((p: any) => p.id === sj.pipelineId)?.name || (sj.pipelineId ? `Pipeline #${sj.pipelineId}` : null),
        mission: sj.missionName || missions.find((m: any) => m.id === sj.missionId)?.name || (sj.missionId ? `Activity #${sj.missionId}` : null),
        scheduleId: sj.scheduleId,
        schedule: sj.scheduleName || schedules.find((s: any) => s.id === sj.scheduleId)?.name || (sj.scheduleId ? `Schedule #${sj.scheduleId}` : 'No schedule'),
        priority: sj.priority || 2,
        isActive: sj.isActive ?? true,
        alertOnFailure: sj.alertOnFailure ?? true,
        maxRetries: sj.maxRetries || 0,
        retryDelaySeconds: sj.retryDelaySeconds || 60,
        executionType: sj.missionId ? 'mission' : (sj.pipelineId ? 'pipeline' : 'job'),
        organizationId: sj.organizationId,
    }));

    const filteredScheduledJobs = scheduledJobs.filter(sj =>
        sj.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (sj.job && sj.job.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (sj.pipeline && sj.pipeline.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (sj.mission && sj.mission.toLowerCase().includes(searchQuery.toLowerCase()))
    );

    // Sync dialog with URL param
    React.useEffect(() => {
        if (params.id && scheduledJobs.length > 0) {
            const id = parseInt(params.id);
            if (editingJobId === id) return;
            
            const sj = scheduledJobs.find(x => x.id === id);
            if (sj) {
                setEditingJobId(id);
                setExecutionType(sj.executionType as any);
                setNewScheduledJob({
                    name: sj.name,
                    jobId: sj.jobId ? String(sj.jobId) : '',
                    pipelineId: sj.pipelineId ? String(sj.pipelineId) : '',
                    missionId: sj.missionId ? String(sj.missionId) : '',
                    scheduleId: String(sj.scheduleId),
                    priority: sj.priority,
                    alertOnFailure: sj.alertOnFailure,
                    maxRetries: sj.maxRetries,
                    retryDelaySeconds: sj.retryDelaySeconds,
                });
                setIsDialogOpen(true);
            }
        }
    }, [params.id, scheduledJobs, editingJobId]);

    // ── Mutations ────────────────────────────────────────────────────────────

    const saveMutation = useMutation({
        mutationFn: async () => {
            const body = {
                name: newScheduledJob.name,
                jobId: executionType === 'job' ? parseInt(newScheduledJob.jobId) : null,
                pipelineId: executionType === 'pipeline' ? parseInt(newScheduledJob.pipelineId) : null,
                missionId: executionType === 'mission' ? parseInt(newScheduledJob.missionId) : null,
                scheduleId: parseInt(newScheduledJob.scheduleId),
                priority: newScheduledJob.priority,
                alertOnFailure: newScheduledJob.alertOnFailure,
                maxRetries: newScheduledJob.maxRetries,
                retryDelaySeconds: newScheduledJob.retryDelaySeconds,
            };
            const method = editingJobId ? 'PUT' : 'POST';
            const url = editingJobId ? `/api/scheduled-jobs/${editingJobId}` : '/api/scheduled-jobs';
            
            const res = await apiRequest(method, url, body);
            if (!res.ok) { const e = await res.text(); throw new Error(e || 'Failed to save'); }
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['/api/scheduled-jobs'] });
            toast({ title: `Scheduled job ${editingJobId ? 'updated' : 'created'}`, description: 'The scheduled job has been saved successfully.' });
            handleCloseDialog();
        },
        onError: (err: Error) => toast({ title: 'Save failed', description: err.message, variant: 'destructive' }),
    });

    const deleteMutation = useMutation({
        mutationFn: async (id: number) => {
            const res = await apiRequest('DELETE', `/api/scheduled-jobs/${id}`);
            if (!res.ok) throw new Error('Failed to delete');
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['/api/scheduled-jobs'] });
            toast({ title: 'Deleted', description: 'Scheduled job removed.' });
        },
        onError: (err: Error) => toast({ title: 'Delete failed', description: err.message, variant: 'destructive' }),
    });

    const runNowMutation = useMutation({
        mutationFn: async (id: number) => {
            const res = await apiRequest('POST', `/api/scheduled-jobs/${id}/run`, {});
            if (!res.ok) throw new Error('Trigger failed');
            return res.json();
        },
        onSuccess: (data: any) => {
            queryClient.invalidateQueries({ queryKey: ['/api/scheduled-jobs'] });
            toast({ title: data?.success ? 'Execution started' : 'Execution failed', description: data?.message || 'Triggered manually.' });
        },
        onError: (err: Error) => toast({ title: 'Run now failed', description: err.message, variant: 'destructive' }),
    });

    // ── Helpers ──────────────────────────────────────────────────────────────

    const handleOpenCreate = () => {
        setEditingJobId(null);
        setNewScheduledJob({ name: '', jobId: '', pipelineId: '', missionId: '', scheduleId: '', priority: 2, alertOnFailure: true, maxRetries: 0, retryDelaySeconds: 60 });
        setExecutionType('job');
        setIsDialogOpen(true);
    };

    const handleCloseDialog = () => {
        setIsDialogOpen(false);
        if (params.id) setLocation('/operations/schedules/automations');
    };

    const handleSave = () => {
        if (!newScheduledJob.name || !newScheduledJob.scheduleId) {
            toast({ title: 'Validation error', description: 'Name and schedule are required.', variant: 'destructive' });
            return;
        }
        if (executionType === 'job' && !newScheduledJob.jobId) {
            toast({ title: 'Validation error', description: 'Please select a job.', variant: 'destructive' });
            return;
        }
        if (executionType === 'pipeline' && !newScheduledJob.pipelineId) {
            toast({ title: 'Validation error', description: 'Please select a pipeline.', variant: 'destructive' });
            return;
        }
        if (executionType === 'mission' && !newScheduledJob.missionId) {
            toast({ title: 'Validation error', description: 'Please select an activity.', variant: 'destructive' });
            return;
        }
        saveMutation.mutate();
    };

    const handleViewHistory = (id: number) => {
        setSelectedJobId(id);
        setHistoryDialogOpen(true);
    };

    const formatDuration = (ms?: number) => {
        if (!ms) return '—';
        if (ms < 1000) return `${ms}ms`;
        if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
        return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
    };

    const getPriorityBadge = (priority: number) => {
        if (priority === 1) return <Badge variant="destructive" className="bg-red-500/10 text-red-400 border-red-500/20 text-[9px] font-black uppercase tracking-[0.2em] italic px-2 h-5">Priority Alpha</Badge>;
        if (priority === 2) return <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20 text-[9px] font-black uppercase tracking-[0.2em] italic px-2 h-5">Priority Beta</Badge>;
        return <Badge variant="secondary" className="bg-foreground/5 text-foreground/30 border-foreground/10 text-[9px] font-black uppercase tracking-[0.2em] italic px-2 h-5">Priority Gamma</Badge>;
    };

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'completed': return <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[9px] font-black uppercase tracking-[0.2em] italic px-3 h-6"><CheckCircle className="w-3 h-3 mr-1.5" />Success</Badge>;
            case 'failed':    return <Badge className="bg-red-500/10 text-red-400 border-red-500/20 text-[9px] font-black uppercase tracking-[0.2em] italic px-3 h-6"><XCircle className="w-3 h-3 mr-1.5" />Critical Failure</Badge>;
            case 'running':   return <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/20 text-[9px] font-black uppercase tracking-[0.2em] italic px-3 h-6"><Loader2 className="w-3 h-3 mr-1.5 animate-spin" />Active Pulse</Badge>;
            case 'retrying':  return <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20 text-[9px] font-black uppercase tracking-[0.2em] italic px-3 h-6"><RotateCcw className="w-3 h-3 mr-1.5 animate-reverse-spin" />Re-Initialization</Badge>;
            default:          return <Badge variant="secondary" className="bg-foreground/5 text-foreground/30 border-foreground/10 text-[9px] font-black uppercase tracking-[0.2em] italic px-3 h-6">{status.toUpperCase()}</Badge>;
        }
    };

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <ErrorBoundary name="Scheduled Jobs">
        <div className="min-h-screen w-full bg-background relative overflow-hidden font-sans selection:bg-primary/30 p-3 sm:p-6 space-y-5 sm:space-y-8">
            {/* Cinematic Background */}
            <div className="fixed inset-0 pointer-events-none">
                <div className="absolute inset-0 cinematic-grid opacity-10" />
                <div className="absolute inset-0 scanlines opacity-[0.03]" />
                <div className="absolute inset-0 bg-gradient-to-b from-black via-transparent to-black" />
            </div>

            {/* Header */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between relative z-10">
                <div className="min-w-0 space-y-1">
                    <h1 className="break-words text-3xl font-black tracking-normal text-foreground uppercase italic leading-none drop-shadow-[0_0_20px_rgba(255,255,255,0.2)] sm:text-5xl">
                        Automation Linkages
                    </h1>
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-primary italic glow-text-small sm:text-[11px] sm:tracking-[0.5em]">
                        Schedule triggers and automation rules
                    </p>
                </div>
                <Button 
                    onClick={handleOpenCreate} 
                    data-testid="button-create-scheduled-job"
                    className="w-full bg-primary hover:bg-foreground text-primary-foreground hover:text-background text-[11px] font-black uppercase tracking-widest rounded-2xl px-5 h-12 shadow-[0_0_30px_hsl(var(--primary)/0.3)] transition-all active:scale-95 italic group border border-primary/20 sm:w-auto sm:px-8 sm:h-14"
                >
                    <Plus className="w-5 h-5 mr-3 group-hover:rotate-90 transition-transform" />
                    Forge New Linkage
                </Button>
            </div>

            {/* Table */}
            <Card className="glass-panel-heavy border-foreground/5 rounded-2xl overflow-hidden shadow-2xl relative z-10 before:absolute before:inset-0 before:bg-gradient-to-br before:from-primary/5 before:to-transparent before:pointer-events-none sm:rounded-[2.5rem]">
                <CardHeader className="border-b border-foreground/5 p-4 sm:pb-8 sm:pt-10 sm:px-10">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div className="min-w-0">
                            <CardTitle className="text-xl font-black text-foreground uppercase italic tracking-tighter flex items-center gap-3">
                                <div className="w-1.5 h-6 bg-primary rounded-full animate-pulse" />
                                Active Links
                            </CardTitle>
                            <CardDescription className="text-[10px] font-black text-foreground/40 uppercase tracking-[0.16em] mt-2 italic sm:text-[11px] sm:tracking-[0.3em]">
                                Orchestrated chronological linkages for cross-system autonomous execution
                            </CardDescription>
                        </div>
                        <div className="relative group w-full sm:w-auto">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground/20 group-focus-within:text-primary transition-colors" />
                            <Input
                                placeholder="SEARCH_LINKAGES..."
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                className="pl-9 h-11 w-full bg-foreground/[0.03] border-foreground/10 rounded-xl text-[10px] font-black tracking-widest text-foreground placeholder:text-foreground/10 focus:ring-primary/40 focus:border-primary/20 transition-all italic uppercase sm:w-72"
                                data-testid="input-search-scheduled-jobs"
                            />
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-4 sm:p-6">
                    {isLoading ? (
                        <div className="text-center py-8 text-muted-foreground">Loading scheduled jobs…</div>
                    ) : filteredScheduledJobs.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground">
                            <Clock className="w-10 h-10 mx-auto mb-3 opacity-30" />
                            <p className="text-sm">No scheduled jobs found.</p>
                        </div>
                    ) : (
                        <>
                        <div className="grid gap-3 md:hidden">
                            {filteredScheduledJobs.map(sj => (
                                <div key={sj.id} data-testid={`card-scheduled-job-${sj.id}`} className="rounded-2xl border border-foreground/10 bg-foreground/[0.03] p-4">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0 space-y-2">
                                            <div className="flex items-center gap-2">
                                                <div className="rounded-xl border border-primary/10 bg-primary/5 p-2">
                                                    <LinkIcon className="h-4 w-4 text-primary" />
                                                </div>
                                                <h3 className="truncate text-sm font-black italic tracking-tight text-foreground">{sj.name}</h3>
                                            </div>
                                            <Badge variant="outline" className={`w-fit text-[10px] font-black uppercase tracking-widest italic border-none ${sj.executionType === 'mission' ? 'text-emerald-400 bg-emerald-500/10' : sj.executionType === 'pipeline' ? 'text-purple-400 bg-purple-500/10' : 'text-blue-400 bg-blue-500/10'}`}>
                                                {sj.executionType === 'mission' ? 'Activity' : sj.executionType === 'pipeline' ? 'Pipeline' : 'Job'}
                                            </Badge>
                                        </div>
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" size="icon" data-testid={`button-actions-mobile-${sj.id}`}>
                                                    <MoreVertical className="w-4 h-4" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                <DropdownMenuItem onClick={() => runNowMutation.mutate(sj.id)}>
                                                    <Play className="w-4 h-4 mr-2" />Run Now
                                                </DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => handleViewHistory(sj.id)}>
                                                    <History className="w-4 h-4 mr-2" />View History
                                                </DropdownMenuItem>
                                                <DropdownMenuSeparator />
                                                <DropdownMenuItem onClick={() => setLocation(`/operations/schedules/automations/${sj.id}`)}>
                                                    <Pencil className="w-4 h-4 mr-2" />Edit
                                                </DropdownMenuItem>
                                                <DropdownMenuItem
                                                    onClick={() => { if (confirm('Delete this scheduled job?')) deleteMutation.mutate(sj.id); }}
                                                    className="text-destructive"
                                                >
                                                    <Trash2 className="w-4 h-4 mr-2" />Delete
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </div>
                                    <div className="mt-4 grid gap-3 text-xs">
                                        <div className="flex items-center justify-between gap-3">
                                            <span className="font-black uppercase tracking-widest text-foreground/30">Target</span>
                                            <span className="min-w-0 truncate text-right font-black italic text-foreground/70">
                                                {sj.executionType === 'mission' ? sj.mission : sj.executionType === 'pipeline' ? sj.pipeline : sj.job || 'Not deployed'}
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between gap-3">
                                            <span className="font-black uppercase tracking-widest text-foreground/30">Pattern</span>
                                            <span className="min-w-0 truncate text-right font-black uppercase tracking-widest text-foreground/45">{sj.schedule}</span>
                                        </div>
                                        <div className="flex items-center justify-between gap-3">
                                            <span className="font-black uppercase tracking-widest text-foreground/30">Priority</span>
                                            {getPriorityBadge(sj.priority)}
                                        </div>
                                        <div className="flex items-center justify-between gap-3">
                                            <span className="font-black uppercase tracking-widest text-foreground/30">Retries</span>
                                            {sj.maxRetries > 0
                                                ? <Badge variant="outline" className="bg-foreground/5 border-foreground/10 text-foreground/40 text-[9px] font-black uppercase italic tracking-widest"><RotateCcw className="w-2.5 h-2.5 mr-1" />{sj.maxRetries}x</Badge>
                                                : <span className="text-foreground/20 font-black">None</span>}
                                        </div>
                                        <div className="flex items-center justify-between gap-3">
                                            <span className="font-black uppercase tracking-widest text-foreground/30">Status</span>
                                            {sj.isActive
                                                ? <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[10px] font-black uppercase tracking-widest italic">Active</Badge>
                                                : <Badge variant="secondary" className="bg-foreground/5 text-foreground/30 border-foreground/10 text-[10px] font-black uppercase tracking-widest italic">Inactive</Badge>}
                                        </div>
                                        {showOrgColumn && (
                                            <div className="flex items-center justify-between gap-3">
                                                <span className="font-black uppercase tracking-widest text-foreground/30">Org</span>
                                                <span className="truncate text-right text-foreground/50">
                                                    {sj.organizationId ? orgMap[sj.organizationId] || `Org #${sj.organizationId}` : 'Global'}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="hidden overflow-x-auto md:block">
                        <Table>
                            <TableHeader>
                                <TableRow className="border-foreground/5 hover:bg-transparent bg-foreground/[0.01]">
                                    <TableHead className="text-[11px] font-black uppercase tracking-[0.2em] text-foreground/30 italic py-6 pl-10">Link Identity</TableHead>
                                    <TableHead className="text-[11px] font-black uppercase tracking-[0.2em] text-foreground/30 italic py-6">Target Class</TableHead>
                                    <TableHead className="text-[11px] font-black uppercase tracking-[0.2em] text-foreground/30 italic py-6">Designation</TableHead>
                                    <TableHead className="text-[11px] font-black uppercase tracking-[0.2em] text-foreground/30 italic py-6">Pattern Ref</TableHead>
                                    <TableHead className="text-[11px] font-black uppercase tracking-[0.2em] text-foreground/30 italic py-6">Buffer</TableHead>
                                    <TableHead className="text-[11px] font-black uppercase tracking-[0.2em] text-foreground/30 italic py-6">Priority</TableHead>
                                    <TableHead className="text-[11px] font-black uppercase tracking-[0.2em] text-foreground/30 italic py-6">Status</TableHead>
                                    {showOrgColumn && <TableHead className="text-[11px] font-black uppercase tracking-[0.2em] text-foreground/30 italic py-6">Org</TableHead>}
                                    <TableHead className="text-right text-[11px] font-black uppercase tracking-[0.2em] text-foreground/30 italic py-6 pr-10">Ops</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredScheduledJobs.map(sj => (
                                    <TableRow key={sj.id} data-testid={`row-scheduled-job-${sj.id}`} className="border-foreground/5 hover:bg-foreground/[0.02] transition-colors group/row">
                                        <TableCell className="py-6 pl-10 border-foreground/[0.02]">
                                            <div className="flex items-center gap-3">
                                                <div className="p-2 rounded-xl bg-primary/5 border border-primary/10 group-hover/row:border-primary/30 transition-all">
                                                    <LinkIcon className="w-4 h-4 text-primary" />
                                                </div>
                                                <span className="text-[15px] font-black text-foreground italic tracking-tight group-hover/row:text-primary transition-colors">{sj.name}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="py-6 border-foreground/[0.02]">
                                            <Badge variant="outline" className={`text-[10px] font-black uppercase tracking-[0.2em] italic px-3 h-7 border-none bg-opacity-10 shadow-sm ${sj.executionType === 'mission' ? 'text-emerald-400 bg-emerald-500/10' : sj.executionType === 'pipeline' ? 'text-purple-400 bg-purple-500/10' : 'text-blue-400 bg-blue-500/10'}`}>
                                                {sj.executionType === 'mission' ? 'Activity' : sj.executionType === 'pipeline' ? 'Pipeline' : 'Job'}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="py-6 border-foreground/[0.02]">
                                            {sj.executionType === 'mission' && sj.missionId ? (
                                                <Link href={`/operations/runs`}>
                                                    <span className="text-[13px] font-black text-emerald-400/80 hover:text-emerald-400 cursor-pointer transition-colors italic underline underline-offset-4 decoration-emerald-500/20">{sj.mission}</span>
                                                </Link>
                                            ) : sj.executionType === 'pipeline' && sj.pipelineId ? (
                                                <Link href={`/operations/workstreams/${sj.pipelineId}`}>
                                                    <span className="text-[13px] font-black text-purple-400/80 hover:text-purple-400 cursor-pointer transition-colors italic underline underline-offset-4 decoration-purple-500/20">{sj.pipeline}</span>
                                                </Link>
                                            ) : sj.jobId ? (
                                                <Link href={`/operations/agents/${sj.jobId}`}>
                                                    <span className="text-[13px] font-black text-blue-400/80 hover:text-blue-400 cursor-pointer transition-colors italic underline underline-offset-4 decoration-blue-500/20">{sj.job}</span>
                                                </Link>
                                            ) : (
                                                <span className="text-foreground/20 text-[10px] font-black uppercase italic tracking-widest">Not Deployed</span>
                                            )}
                                        </TableCell>
                                        <TableCell className="py-4">
                                            <span className="text-[10px] font-black text-foreground/30 uppercase tracking-[0.2em] italic">{sj.schedule}</span>
                                        </TableCell>
                                        <TableCell className="py-4">
                                            {sj.maxRetries > 0
                                                ? <Badge variant="outline" className="bg-foreground/5 border-foreground/10 text-foreground/40 text-[9px] font-black uppercase italic tracking-widest px-2 h-5"><RotateCcw className="w-2.5 h-2.5 mr-1" />{sj.maxRetries}x</Badge>
                                                : <span className="text-foreground/10 text-[9px] font-black uppercase italic tracking-widest">—</span>}
                                        </TableCell>
                                        <TableCell className="py-4">
                                            <div className="scale-90 origin-left">
                                                {getPriorityBadge(sj.priority)}
                                            </div>
                                        </TableCell>
                                        <TableCell className="py-4">
                                            {sj.isActive
                                                ? <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[9px] font-black uppercase tracking-[0.2em] italic px-3 h-6">Active</Badge>
                                                : <Badge variant="secondary" className="bg-foreground/5 text-foreground/30 border-foreground/10 text-[9px] font-black uppercase tracking-[0.2em] italic px-3 h-6">Inactive</Badge>}
                                        </TableCell>
                                        {showOrgColumn && (
                                            <TableCell>
                                                {sj.organizationId ? (
                                                    <Badge variant="outline" className="text-xs font-normal">
                                                        <Building2 className="w-3 h-3 mr-1" />
                                                        {orgMap[sj.organizationId] || `Org #${sj.organizationId}`}
                                                    </Badge>
                                                ) : (
                                                    <span className="text-xs text-muted-foreground">Global</span>
                                                )}
                                            </TableCell>
                                        )}
                                        <TableCell className="text-right">
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" size="icon" data-testid={`button-actions-${sj.id}`}>
                                                        <MoreVertical className="w-4 h-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuItem onClick={() => runNowMutation.mutate(sj.id)}>
                                                        <Play className="w-4 h-4 mr-2" />Run Now
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem onClick={() => handleViewHistory(sj.id)}>
                                                        <History className="w-4 h-4 mr-2" />View History
                                                    </DropdownMenuItem>
                                                    <DropdownMenuSeparator />
                                                    <DropdownMenuItem onClick={() => setLocation(`/operations/schedules/automations/${sj.id}`)}>
                                                        <Pencil className="w-4 h-4 mr-2" />Edit
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem
                                                        onClick={() => { if (confirm('Delete this scheduled job?')) deleteMutation.mutate(sj.id); }}
                                                        className="text-destructive"
                                                    >
                                                        <Trash2 className="w-4 h-4 mr-2" />Delete
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                        </div>
                        </>
                    )}
                </CardContent>
            </Card>

            {/* ── Create Dialog ── */}
            <Dialog open={isDialogOpen} onOpenChange={handleCloseDialog}>
                <DialogContent className="max-w-xl glass-panel-deep border-foreground/10 rounded-[2.5rem] shadow-2xl p-0 overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
                    
                    <DialogHeader className="p-8 pb-0">
                        <div className="flex items-center gap-4 mb-2">
                            <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                                <Zap className="w-5 h-5 text-primary" />
                            </div>
                            <div>
                                <DialogTitle className="text-2xl font-black text-foreground uppercase italic tracking-tighter">
                                    {editingJobId ? 'Reconfigure_Automation_Link' : 'Forge_Automation_Link'}
                                </DialogTitle>
                                <DialogDescription className="text-[10px] font-bold text-foreground/30 uppercase tracking-widest">
                                    {editingJobId ? 'Modify existing technical module parameters' : 'Connect technical modules with temporal triggers'}
                                </DialogDescription>
                            </div>
                        </div>
                    </DialogHeader>

                    <div className="p-8 space-y-6">
                        <div className="space-y-2">
                            <Label htmlFor="sj-name" className="text-[10px] font-black uppercase tracking-widest text-foreground/40 italic ml-1">Link Identity *</Label>
                            <Input
                                id="sj-name"
                                placeholder="E.G., DAILY_NEURAL_BACKUP"
                                value={newScheduledJob.name}
                                onChange={e => setNewScheduledJob({ ...newScheduledJob, name: e.target.value })}
                                className="h-12 bg-foreground/[0.03] border-foreground/10 rounded-xl px-4 text-[11px] font-black tracking-widest text-foreground placeholder:text-foreground/10 focus:ring-primary/40 focus:border-primary/20 transition-all italic uppercase"
                                data-testid="input-scheduled-job-name"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>Type</Label>
                            <Tabs value={executionType} onValueChange={v => setExecutionType(v as 'job' | 'pipeline' | 'mission')}>
                                <TabsList className="grid w-full grid-cols-3">
                                    <TabsTrigger value="job"><Clock className="w-4 h-4 mr-2" />Job</TabsTrigger>
                                    <TabsTrigger value="pipeline"><GitBranch className="w-4 h-4 mr-2" />Pipeline</TabsTrigger>
                                    <TabsTrigger value="mission"><Zap className="w-4 h-4 mr-2" />Activity</TabsTrigger>
                                </TabsList>
                                <TabsContent value="job" className="mt-2">
                                    <Select value={newScheduledJob.jobId} onValueChange={v => setNewScheduledJob({ ...newScheduledJob, jobId: v })}>
                                        <SelectTrigger data-testid="select-scheduled-job-job">
                                            <SelectValue placeholder="Select a job" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {jobs.map((j: any) => (
                                                <SelectItem key={j.id} value={String(j.id)}>{j.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </TabsContent>
                                <TabsContent value="pipeline" className="mt-2">
                                    <Select value={newScheduledJob.pipelineId} onValueChange={v => setNewScheduledJob({ ...newScheduledJob, pipelineId: v })}>
                                        <SelectTrigger data-testid="select-scheduled-job-pipeline">
                                            <SelectValue placeholder="Select a pipeline" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {pipelines.map((p: any) => (
                                                <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </TabsContent>
                                <TabsContent value="mission" className="mt-2">
                                    <Select value={newScheduledJob.missionId} onValueChange={v => setNewScheduledJob({ ...newScheduledJob, missionId: v })}>
                                        <SelectTrigger data-testid="select-scheduled-job-mission">
                                            <SelectValue placeholder="Select an activity" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {missions.map((m: any) => (
                                                <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </TabsContent>
                            </Tabs>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="sj-schedule" className="text-[10px] font-black uppercase tracking-widest text-foreground/40 italic ml-1">Pattern Reference *</Label>
                            <Select value={newScheduledJob.scheduleId} onValueChange={v => setNewScheduledJob({ ...newScheduledJob, scheduleId: v })}>
                                <SelectTrigger id="sj-schedule" className="h-12 bg-foreground/[0.03] border-foreground/10 rounded-xl px-4 text-[11px] font-black tracking-widest text-foreground focus:ring-primary/40 transition-all italic" data-testid="select-scheduled-job-schedule">
                                    <SelectValue placeholder="Select a pattern" />
                                </SelectTrigger>
                                <SelectContent className="bg-background border-foreground/10">
                                    {schedules.map((s: any) => (
                                        <SelectItem key={s.id} value={String(s.id)} className="text-[11px] font-bold text-foreground uppercase tracking-widest italic focus:bg-primary/20 transition-colors">{s.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Priority</Label>
                                <Select value={String(newScheduledJob.priority)} onValueChange={v => setNewScheduledJob({ ...newScheduledJob, priority: parseInt(v) })}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="1">High</SelectItem>
                                        <SelectItem value="2">Medium</SelectItem>
                                        <SelectItem value="3">Low</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Max Retries</Label>
                                <Select value={String(newScheduledJob.maxRetries)} onValueChange={v => setNewScheduledJob({ ...newScheduledJob, maxRetries: parseInt(v) })}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="0">None</SelectItem>
                                        <SelectItem value="1">1 retry</SelectItem>
                                        <SelectItem value="2">2 retries</SelectItem>
                                        <SelectItem value="3">3 retries</SelectItem>
                                        <SelectItem value="5">5 retries</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        {newScheduledJob.maxRetries > 0 && (
                            <div className="space-y-2">
                                <Label>Retry Delay (seconds)</Label>
                                <Input
                                    type="number"
                                    min={10}
                                    max={3600}
                                    value={newScheduledJob.retryDelaySeconds}
                                    onChange={e => setNewScheduledJob({ ...newScheduledJob, retryDelaySeconds: parseInt(e.target.value) || 60 })}
                                />
                            </div>
                        )}

                        <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                                <Label>Alert on Failure</Label>
                                <p className="text-xs text-muted-foreground">Send notifications when execution fails</p>
                            </div>
                            <Switch
                                checked={newScheduledJob.alertOnFailure}
                                onCheckedChange={v => setNewScheduledJob({ ...newScheduledJob, alertOnFailure: v })}
                            />
                        </div>
                    </div>
                    <DialogFooter className="p-8 pt-4 bg-foreground/[0.02] border-t border-foreground/5">
                        <Button 
                            variant="outline" 
                            onClick={handleCloseDialog}
                            className="h-12 bg-transparent border-foreground/10 text-foreground/40 text-[10px] font-black uppercase tracking-widest hover:bg-foreground/5 hover:text-foreground rounded-xl px-6 italic transition-all"
                        >
                            Abort Linkage
                        </Button>
                        <Button 
                            onClick={handleSave} 
                            disabled={saveMutation.isPending} 
                            data-testid="button-submit-scheduled-job"
                            className="h-12 bg-primary hover:bg-primary/90 text-primary-foreground text-[10px] font-black uppercase tracking-widest rounded-xl px-8 shadow-lg shadow-primary/20 transition-all active:scale-95 italic"
                        >
                            {saveMutation.isPending ? 'FORGING...' : (editingJobId ? 'Reconfigure_Link' : 'Establish_Automation_Link')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ── Execution History Dialog ── */}
            <Dialog open={historyDialogOpen} onOpenChange={setHistoryDialogOpen}>
                <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden glass-panel-deep border-foreground/10 rounded-[2.5rem] shadow-2xl p-0">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500/40 to-transparent" />
                    
                    <DialogHeader className="p-8 pb-0">
                        <div className="flex items-center gap-4 mb-2">
                            <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                                <History className="w-5 h-5 text-blue-400" />
                            </div>
                            <div>
                                <DialogTitle className="text-2xl font-black text-foreground uppercase italic tracking-tighter">Execution Registry</DialogTitle>
                                <DialogDescription className="text-[10px] font-bold text-foreground/30 uppercase tracking-widest italic">Historical telemetry for this automation link</DialogDescription>
                            </div>
                        </div>
                    </DialogHeader>

                    <div className="p-8 overflow-y-auto max-h-[50vh]">
                        {historyLoading ? (
                            <div className="flex items-center justify-center py-12">
                                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                            </div>
                        ) : historyData?.data && historyData.data.length > 0 ? (
                            <Table>
                                <TableHeader>
                                    <TableRow className="border-foreground/5 hover:bg-transparent">
                                        <TableHead className="text-[9px] font-black uppercase tracking-widest text-foreground/40 italic">Result</TableHead>
                                        <TableHead className="text-[9px] font-black uppercase tracking-widest text-foreground/40 italic">Class</TableHead>
                                        <TableHead className="text-[9px] font-black uppercase tracking-widest text-foreground/40 italic">Timestamp</TableHead>
                                        <TableHead className="text-[9px] font-black uppercase tracking-widest text-foreground/40 italic">Duration</TableHead>
                                        <TableHead className="text-[9px] font-black uppercase tracking-widest text-foreground/40 italic">Retries</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {historyData.data.map(exec => (
                                        <TableRow key={exec.id} className="border-foreground/5 hover:bg-foreground/[0.02]">
                                            <TableCell className="py-3">{getStatusBadge(exec.status)}</TableCell>
                                            <TableCell className="py-3">
                                                <Badge variant="outline" className="bg-foreground/5 border-foreground/10 text-foreground/40 text-[8px] font-black uppercase italic tracking-widest px-2 h-5">
                                                    {exec.executionType}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-[10px] font-bold text-foreground/60 py-3">{new Date(exec.startedAt).toLocaleString()}</TableCell>
                                            <TableCell className="text-[10px] font-bold text-foreground/30 py-3">{formatDuration(exec.durationMs)}</TableCell>
                                            <TableCell className="py-3">
                                                {exec.retryCount > 0
                                                    ? <Badge variant="outline" className="bg-amber-500/5 border-amber-500/10 text-amber-500/60 text-[8px] font-black px-2 h-5">{exec.retryCount}</Badge>
                                                    : <span className="text-foreground/10 text-[9px] font-black">—</span>}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        ) : (
                            <div className="text-center py-12 text-foreground/20">
                                <History className="w-12 h-12 mx-auto mb-4 opacity-10" />
                                <p className="text-[10px] font-black uppercase tracking-[0.2em] italic">No telemetry recorded</p>
                            </div>
                        )}
                    </div>

                    <DialogFooter className="p-8 pt-4 bg-foreground/[0.02] border-t border-foreground/5">
                        <Button 
                            variant="outline" 
                            onClick={() => setHistoryDialogOpen(false)}
                            className="w-full h-12 bg-transparent border-foreground/10 text-foreground/40 text-[10px] font-black uppercase tracking-widest hover:bg-foreground/5 hover:text-foreground rounded-xl italic transition-all"
                        >
                            Close Registry
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
        </ErrorBoundary>
    );
}
