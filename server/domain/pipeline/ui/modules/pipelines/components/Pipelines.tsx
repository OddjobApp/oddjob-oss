import { useState, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Activity, Layers, Network, Plus, ShieldCheck, Sparkles } from 'lucide-react';
import { useOrgContext } from '@domain-ui/core/ui/hooks/use-org-context';
import { useAuth } from "@domain-ui/auth/ui/modules/auth";
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import PipelineList from './PipelineList.js';
import PipelineDialog from './PipelineDialog.js';
import { Pipeline, Job } from './types.js';
import { ExecutionExplorer, type ExecutionGroup } from '@/components/execution/ExecutionExplorer';

import { useLocation } from 'wouter';

function formatNumber(value: number) {
  return value.toLocaleString("en-US");
}

export default function Pipelines() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingPipelineId, setEditingPipelineId] = useState<number | null>(null);

  // Fetch full pipeline (with steps) when editing
  const { data: editingPipeline = null } = useQuery<Pipeline | null>({
    queryKey: ['/api/pipelines', editingPipelineId],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/pipelines/${editingPipelineId}`);
      return res.json();
    },
    enabled: editingPipelineId !== null,
    staleTime: 0,
  });

  // Org context for showing org labels
  const { selectedOrgId } = useOrgContext();
  const { adminRole } = useAuth();
  const isSuperAdmin = adminRole?.isSuperAdmin === true;
  const showOrgColumn = isSuperAdmin && selectedOrgId === null;

  // Fetch organizations for org labels
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
    (organizationsData?.organizations || []).forEach(org => {
      map[org.id] = org.name;
    });
    return map;
  }, [organizationsData]);

  // Fetch jobs and pipelines
  const { data: jobs = [], isLoading: jobsLoading } = useQuery<Job[]>({
    queryKey: ['/api/jobs'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/jobs');
      const data = await res.json();
      return data.items || [];
    }
  });

  const { data: pipelines = [], isLoading: pipelinesLoading } = useQuery<Pipeline[]>({
    queryKey: ['/api/pipelines'],
  });

  const stats = useMemo(() => {
    const active = pipelines.filter(pipeline => pipeline.isActive);
    const automated = pipelines.filter(pipeline => pipeline.isActive && pipeline.triggerType !== 'manual');
    const totalSteps = pipelines.reduce((total, pipeline) => total + (pipeline.steps?.length || 0), 0);
    const knowledgeEnabled = pipelines.filter(pipeline => pipeline.enableKnowledgeGraph || pipeline.knowledgeGraphConfig).length;
    const newest = pipelines.reduce((latest, pipeline) => {
      const created = pipeline.createdAt ? new Date(pipeline.createdAt) : null;
      if (!created || isNaN(created.getTime())) return latest;
      return !latest || created > latest ? created : latest;
    }, null as Date | null);

    return {
      activeCount: active.length,
      totalCount: pipelines.length,
      automatedCount: automated.length,
      totalSteps,
      knowledgeEnabled,
      newest,
    };
  }, [pipelines]);

  const summaryCards = [
    {
      label: "Live pipelines",
      value: String(stats.activeCount),
      helper: `${stats.totalCount} total pipelines tracked`,
      icon: Activity,
      tone: "border-blue-400/20 bg-blue-500/10 text-blue-700 dark:text-blue-300",
    },
    {
      label: "Automation signal",
      value: String(stats.automatedCount),
      helper: "scheduled, webhook, and event driven",
      icon: Network,
      tone: "border-emerald-400/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    },
    {
      label: "Execution graph",
      value: formatNumber(stats.totalSteps),
      helper: "configured steps across the fleet",
      icon: Layers,
      tone: "border-amber-400/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    },
    {
      label: "Knowledge links",
      value: String(stats.knowledgeEnabled),
      helper: stats.newest ? `newest created ${stats.newest.toLocaleDateString()}` : "no recent deployments",
      icon: ShieldCheck,
      tone: "border-violet-400/20 bg-violet-500/10 text-violet-700 dark:text-violet-300",
    },
  ];

  const pipelineExplorerGroups: ExecutionGroup[] = useMemo(() => {
    return pipelines.map((pipeline, index) => {
      const stepCount = pipeline.steps?.length || 0;
      const pipelineAny = pipeline as any;
      const status = pipeline.isActive ? 'running' : 'pending';
      const triggerLabel = pipeline.triggerType && pipeline.triggerType !== 'manual'
        ? `${pipeline.triggerType} trigger`
        : 'manual trigger';

      return {
        id: `pipeline-${pipeline.id || index}`,
        title: pipeline.name || `Workstream #${pipeline.id || index + 1}`,
        subtitle: pipeline.description || `${stepCount} configured steps • ${triggerLabel}`,
        category: pipeline.triggerType && pipeline.triggerType !== 'manual' ? 'automated workstream' : 'manual workstream',
        status,
        startedAt: pipelineAny.updatedAt || pipeline.createdAt,
        progress: pipeline.isActive ? 50 : 0,
        count: stepCount,
        childCount: stepCount || undefined,
        isCritical: pipeline.isActive,
        metadata: {
          pipelineId: pipeline.id,
          triggerType: pipeline.triggerType,
          isActive: pipeline.isActive,
          stepCount,
          enableKnowledgeGraph: pipeline.enableKnowledgeGraph,
          monthlyBudgetUsd: pipelineAny.monthlyBudgetUsd,
          labels: pipelineAny.labels,
        },
        events: [
          {
            id: `pipeline-${pipeline.id || index}-configured`,
            timestamp: pipelineAny.updatedAt || pipeline.createdAt,
            type: 'workstream.configured',
            title: `${pipeline.name || `Workstream #${pipeline.id || index + 1}`} configured`,
            description: `${stepCount} steps available for execution.`,
            status,
            metadata: pipeline as any,
          },
        ],
      } satisfies ExecutionGroup;
    }).sort((a, b) => new Date(b.startedAt || 0).getTime() - new Date(a.startedAt || 0).getTime());
  }, [pipelines]);

  // Delete pipeline mutation
  const deletePipelineMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest('DELETE', `/api/pipelines/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/pipelines'] });
      toast({ title: 'Success', description: 'Workstream deleted successfully' });
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to delete pipeline',
        variant: 'destructive'
      });
    },
  });

  // Run pipeline mutation
  const runPipelineMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest('POST', `/api/pipelines/${id}/execute`, {});
      return res.json();
    },
    onSuccess: () => {
      toast({ title: 'Success', description: 'Workstream execution started' });
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to run pipeline',
        variant: 'destructive'
      });
    },
  });

  const openEditDialog = (pipeline: Pipeline) => {
    setEditingPipelineId(pipeline.id);
    setIsDialogOpen(true);
  };

  const handleRunPipeline = (pipelineId: number) => {
    runPipelineMutation.mutate(pipelineId);
  };

  const handleDeletePipeline = (pipelineId: number) => {
    if (confirm('Are you sure you want to delete this workstream? This action cannot be undone.')) {
      deletePipelineMutation.mutate(pipelineId);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-background px-4 pb-20 pt-4 text-foreground md:px-6">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-gradient-to-b from-primary/15 via-emerald-500/5 to-transparent" />

      <div className="relative z-10 mx-auto flex w-full max-w-[2000px] flex-col gap-5">
        <div className="flex flex-col gap-4 border-b border-foreground/10 pb-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-primary shadow-[0_0_16px_rgba(var(--primary),0.65)]" />
              <span className="text-[10px] font-black uppercase text-primary">Pipeline Command</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">
                Pipelines
              </h1>
              <p className="mt-2 max-w-2xl text-sm font-medium text-muted-foreground">
                Portfolio command for reusable workstreams, triggers, execution graphs, and knowledge-producing automations.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              onClick={() => setLocation('/operations/templates')}
              className="h-11 rounded-xl border-foreground/10 bg-foreground/[0.03] px-5 text-[10px] font-black uppercase text-foreground hover:bg-foreground/[0.08]"
            >
              <Sparkles className="mr-2 h-4 w-4 text-amber-700 dark:text-amber-300" />
              Templates
            </Button>
            <Button
              onClick={() => setLocation('/operations/workstreams/new')}
              className="h-11 rounded-xl bg-foreground px-6 text-[10px] font-black uppercase text-background shadow-lg shadow-foreground/5 hover:bg-muted"
              data-testid="button-create-pipeline"
            >
              <Plus className="mr-2 h-4 w-4" />
              New Pipeline
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {summaryCards.map(card => (
            <div key={card.label} className="rounded-2xl border border-foreground/10 bg-foreground/[0.04] p-4 backdrop-blur-xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase text-muted-foreground">{card.label}</p>
                  <p className="mt-2 text-2xl font-black text-foreground">{card.value}</p>
                </div>
                <div className={`flex h-11 w-11 items-center justify-center rounded-2xl border ${card.tone}`}>
                  <card.icon className="h-5 w-5" />
                </div>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">{card.helper}</p>
            </div>
          ))}
        </div>

        <ExecutionExplorer
          title="Workstream Portfolio Explorer"
          description="Grouped pipeline readiness across live automations, manual workstreams, knowledge links, and configured steps."
          status={stats.activeCount > 0 ? 'running' : 'pending'}
          groups={pipelineExplorerGroups}
          relationships={[
            ...pipelines.filter(p => p.isActive).map(p => ({
              id: `active-pipeline-${p.id}`,
              label: 'Active workstream',
              value: p.name || `Workstream #${p.id}`,
              type: 'execution' as const,
              href: `/operations/workstreams/${p.id}`,
              status: 'running',
            })),
            ...pipelines.filter(p => p.enableKnowledgeGraph || p.knowledgeGraphConfig).map(p => ({
              id: `kg-pipeline-${p.id}`,
              label: 'Knowledge-producing workstream',
              value: p.name || `Workstream #${p.id}`,
              type: 'artifact' as const,
              href: `/operations/workstreams/${p.id}`,
              status: p.isActive ? 'running' : 'pending',
            })),
          ]}
          metadata={[
            { label: 'Total Workstreams', value: stats.totalCount },
            { label: 'Live Workstreams', value: stats.activeCount },
            { label: 'Automated', value: stats.automatedCount },
            { label: 'Configured Steps', value: stats.totalSteps },
            { label: 'Knowledge Links', value: stats.knowledgeEnabled },
            { label: 'Newest', value: stats.newest ? stats.newest.toLocaleString() : 'None' },
          ]}
          lastUpdatedAt={stats.newest}
          isLive={stats.activeCount > 0}
          defaultView="compact"
          className="border-foreground/10 bg-foreground/[0.04] text-foreground"
        />

        <PipelineList
          pipelines={pipelines}
          pipelinesLoading={pipelinesLoading}
          showOrgColumn={showOrgColumn}
          orgMap={orgMap}
          onRunPipeline={handleRunPipeline}
          onEditPipeline={openEditDialog}
          onDeletePipeline={handleDeletePipeline}
          onRefresh={() => queryClient.invalidateQueries({ queryKey: ['/api/pipelines'] })}
        />

        <PipelineDialog
          open={isDialogOpen}
          onOpenChange={(open) => {
            setIsDialogOpen(open);
            if (!open) setEditingPipelineId(null);
          }}
          editingPipeline={editingPipeline}
          jobs={jobs}
          jobsLoading={jobsLoading}
        />
      </div>
    </div>
  );
}

