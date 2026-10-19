import { useState, useEffect, useMemo } from 'react';
import { useRoute, useSearch } from 'wouter';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { Skeleton } from '@domain-ui/core/ui/components/ui/skeleton';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@domain-ui/core/ui/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@domain-ui/core/ui/components/ui/dialog';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Textarea } from '@domain-ui/core/ui/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@domain-ui/core/ui/components/ui/tabs';
import { Separator } from '@domain-ui/core/ui/components/ui/separator';

import { PipelineHeader } from './PipelineHeader.js';
import { PipelineSettings } from './PipelineSettings.js';
import { PipelineVisualEditor } from './PipelineVisualEditor.js';
import { PipelineExecutionView } from './PipelineExecutionView.js';
import { PipelineInputParams } from './PipelineInputParams.js';
import { PipelineOutputParams } from './PipelineOutputParams.js';
import { VersionHistoryPanel } from '@domain-ui/core/ui/components/shared/VersionHistoryPanel';
import { PipelineLineageGraph } from './PipelineLineageGraph.js';
import TriggerBuilder from './triggers/TriggerBuilder.js';
import EventLogViewer from './triggers/EventLogViewer.js';
import DriftAnalytics from './triggers/DriftAnalytics.js';

import { usePipelineEditor } from '@domain-ui/pipeline/ui/modules/pipelines/hooks/use-pipeline-editor';
import type { Pipeline } from "@shared/schema/pipelines/pipeline-core";
import type { Job } from "@shared/schema/jobs/table";
import { ExecutionExplorer, type ExecutionGroup } from '@/components/execution/ExecutionExplorer';

export default function PipelineDetail() {
  // --- Routing & IDs ---
  const [, legacyParams] = useRoute('/pipelines/:id');
  const [, operationsParams] = useRoute('/operations/workstreams/:id');
  const params = operationsParams?.id ? operationsParams : legacyParams;
  const pipelineId = params?.id && params.id !== 'new' ? parseInt(params.id) : 0;
  const search = useSearch();
  const { toast } = useToast();

  if (params?.id === 'new' || !pipelineId || isNaN(pipelineId)) {
    return null;
  }

  // --- Data Fetching ---
  const { data: pipeline, isLoading: pipelineLoading, error: pipelineError } = useQuery<Pipeline>({
    queryKey: ['/api/pipelines', pipelineId],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/pipelines/${pipelineId}`);
      return res.json();
    },
    enabled: !!pipelineId && pipelineId > 0,
  });

  const { data: jobs = [], isLoading: jobsLoading } = useQuery<Job[]>({
    queryKey: ['/api/jobs', { includeHidden: true }],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/jobs?includeHidden=true');
      const data = await res.json();
      return data.items || [];
    },
  });

  const { data: pipelineApps = [] } = useQuery<any[]>({
    queryKey: ['/api/apps/pipeline-runnable'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/apps/pipeline-runnable');
      return res.json();
    },
  });

  const { data: orgSettings } = useQuery<{ allowedJobTypes: string[] }>({
    queryKey: ['/api/org-settings'],
  });

  const { data: latestRun } = useQuery({
    queryKey: ['/api/pipelines', pipelineId, 'latest-run'],
    queryFn: async () => {
      if (!pipelineId) return null;
      const res = await apiRequest('GET', `/api/pipelines/${pipelineId}/latest-run`);
      if (res.status === 204 || res.status === 404) return null;
      return res.json();
    },
    enabled: !!pipelineId,
  });

  const { data: pipelineStats } = useQuery({
    queryKey: ['/api/pipelines', pipelineId, 'stats'],
    queryFn: async () => {
      if (!pipelineId) return {};
      const res = await apiRequest('GET', `/api/pipelines/${pipelineId}/stats`);
      return res.json();
    },
    enabled: !!pipelineId,
  });

  // --- Editor State & Logic (Hook) ---
  const { state, actions, mutations } = usePipelineEditor(pipelineId, pipeline, jobs);

  // --- Local State ---
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [executionResults, setExecutionResults] = useState<any>(null);

  const workstreamStepGroups: ExecutionGroup[] = useMemo(() => {
    const steps = state.editedSteps || [];
    return steps.map((step: any, index: number) => {
      const linkedJob = jobs.find((job: any) => job.id === step.jobId);
      const isConfigured = Boolean(step.jobId || step.jobName || linkedJob);
      const pipelineAny = pipeline as any;

      return {
        id: `workstream-step-${step.id || index}`,
        title: step.name || step.jobName || linkedJob?.name || `Step ${index + 1}`,
        subtitle: step.description || linkedJob?.description || step.jobType || "Configured workstream step",
        category: step.condition ? "conditional step" : "configured step",
        status: isConfigured ? "pending" : "warning",
        startedAt: pipelineAny?.updatedAt || pipeline?.createdAt,
        progress: isConfigured ? 0 : 100,
        count: 1,
        isCritical: !isConfigured || Boolean(step.onFailureAction && step.onFailureAction !== "continue"),
        metadata: {
          stepId: step.id,
          jobId: step.jobId,
          jobName: linkedJob?.name || step.jobName,
          jobType: linkedJob?.type || step.jobType,
          condition: step.condition,
          onFailureAction: step.onFailureAction,
          config: step.config,
        },
        events: [{
          id: `workstream-step-${step.id || index}-configured`,
          timestamp: pipelineAny?.updatedAt || pipeline?.createdAt,
          type: "workstream.step.configured",
          title: `${step.name || linkedJob?.name || `Step ${index + 1}`} configured`,
          description: linkedJob?.description || step.description,
          status: isConfigured ? "pending" : "warning",
          metadata: step,
        }],
      } satisfies ExecutionGroup;
    });
  }, [jobs, pipeline, state.editedSteps]);

  // --- Deep Linking for Steps ---
  useEffect(() => {
    const params = new URLSearchParams(search);
    const stepIdStr = params.get('stepId');
    if (stepIdStr && state.editedSteps.length > 0) {
      let index = state.editedSteps.findIndex(s => s.id && String(s.id) === stepIdStr);
      if (index !== -1) {
        state.setIsEditing(true);
        state.setSelectedStepIndex(index);
      }
    }
  }, [search, state.editedSteps, state.setIsEditing, state.setSelectedStepIndex]);

  // Update URL when step selected
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (state.selectedStepIndex !== null) {
      const step = state.editedSteps[state.selectedStepIndex];
      if (step && step.id) {
        if (params.get('stepId') !== String(step.id)) {
          params.set('stepId', String(step.id));
          const newUrl = `${window.location.pathname}?${params.toString()}`;
          window.history.replaceState(null, '', newUrl);
        }
      } else {
        if (params.has('stepId')) {
          params.delete('stepId');
          const newUrl = `${window.location.pathname}${params.toString() ? '?' + params.toString() : ''}`;
          window.history.replaceState(null, '', newUrl);
        }
      }
    } else {
      if (params.has('stepId')) {
        params.delete('stepId');
        const newUrl = `${window.location.pathname}${params.toString() ? '?' + params.toString() : ''}`;
        window.history.replaceState(null, '', newUrl);
      }
    }
  }, [state.selectedStepIndex, state.editedSteps]);


  // --- Pipeline Execution ---
  const executePipelineMutation = useMutation({
    mutationFn: async () => {
      try {
        const res = await apiRequest('POST', `/api/pipelines/${pipelineId}/execute`, {});
        return await res.json();
      } catch (error: any) {
        if (error?.message?.includes('Receiving end does not exist')) {
          const harmlessError = new Error('Browser extension error');
          (harmlessError as any).isExtensionError = true;
          throw harmlessError;
        }
        throw error;
      }
    },
    onSuccess: (data: any) => {
      setExecutionResults(data);
      if (data.success) {
        toast({ title: 'Success', description: 'Pipeline execution started successfully' });
      } else {
        toast({ title: 'Pipeline execution failed', description: data.error, variant: 'destructive' });
      }
    },
    onError: (error: any) => {
      if (error?.isExtensionError) {
        toast({ title: 'Info', description: 'Execution started (checking extensions)', duration: 3000 });
        return;
      }
      toast({ title: 'Error', description: error.message || 'Failed to run pipeline', variant: 'destructive' });
    }
  });


  if (pipelineLoading || jobsLoading) {
    return (
      <div className="p-8 space-y-4">
        <Skeleton className="h-12 w-1/3" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  if (pipelineError) {
    return (
      <div className="p-8 text-center text-red-500">
        Error fetching pipeline: {(pipelineError as Error).message}
      </div>
    );
  }

  if (!pipeline) return null;

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      <div className="space-y-8">
        <PipelineHeader
          pipeline={pipeline}
          isEditing={state.isEditing}
          editedName={state.editedName}
          setEditedName={state.setEditedName}
          editedDescription={state.editedDescription}
          setEditedDescription={state.setEditedDescription}
          onEdit={actions.handleEdit}
          onCancel={actions.handleCancel}
          onSave={actions.handleSave}
          onDelete={() => state.setDeleteDialogOpen(true)}
          onRun={() => executePipelineMutation.mutate()}
          onShowHistory={() => setIsHistoryOpen(true)}
          onSaveTemplate={() => state.setSaveTemplateOpen(true)}
          isSaving={mutations.updatePipelineMutation.isPending}
          isRunning={executePipelineMutation.isPending}
        />

        <PipelineExecutionView
          executionResults={executionResults}
          pipelineStats={pipelineStats}
          jobs={jobs}
          pipelineId={pipelineId}
        />

        <ExecutionExplorer
          title="Workstream Design Explorer"
          description="Grouped view of configured steps, trigger shape, latest run, relationships, and execution metadata."
          status={pipeline.isActive ? "running" : "pending"}
          groups={workstreamStepGroups}
          relationships={[
            ...(latestRun ? [{
              id: `latest-run-${latestRun.id || "latest"}`,
              label: "Latest execution",
              value: latestRun.id ? `Execution #${latestRun.id}` : "Latest run",
              type: "execution" as const,
              href: latestRun.id ? `/operations/workstream-executions/${latestRun.id}` : `/operations/workstreams/${pipelineId}/executions`,
              status: latestRun.status,
            }] : []),
            {
              id: `executions-${pipelineId}`,
              label: "Execution history",
              value: "All workstream runs",
              type: "child",
              href: `/operations/workstreams/${pipelineId}/executions`,
              status: pipeline.isActive ? "running" : "pending",
            },
          ]}
          metadata={[
            { label: "Workstream ID", value: pipelineId },
            { label: "Trigger", value: (pipeline as any).triggerType || "manual" },
            { label: "Active", value: pipeline.isActive ? "Yes" : "No" },
            { label: "Step Count", value: workstreamStepGroups.length },
            { label: "Knowledge Graph", value: (pipeline as any).enableKnowledgeGraph || (pipeline as any).knowledgeGraphConfig ? "Enabled" : "Disabled" },
            { label: "Latest Run", value: latestRun?.id ? `#${latestRun.id}` : "None" },
          ]}
          lastUpdatedAt={(pipeline as any).updatedAt || (pipeline as any).createdAt}
          isLive={Boolean(pipeline.isActive)}
          defaultView="compact"
        />

        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="bg-background/40 border border-cyan-500/20 p-1 h-auto gap-1 mb-8">
            <TabsTrigger value="overview" className="text-[10px] font-bold uppercase tracking-widest data-[state=active]:bg-cyan-500 data-[state=active]:text-black px-6 py-2">Overview</TabsTrigger>
            <TabsTrigger value="reactive" className="text-[10px] font-bold uppercase tracking-widest data-[state=active]:bg-cyan-500 data-[state=active]:text-black px-6 py-2">Reactive Intelligence</TabsTrigger>
            <TabsTrigger value="editor" className="text-[10px] font-bold uppercase tracking-widest data-[state=active]:bg-cyan-500 data-[state=active]:text-black px-6 py-2">Visual Editor</TabsTrigger>
            <TabsTrigger value="lineage" className="text-[10px] font-bold uppercase tracking-widest data-[state=active]:bg-cyan-500 data-[state=active]:text-black px-6 py-2">Data Lineage</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-8 mt-0">
            <PipelineInputParams
              pipelineId={pipelineId}
              isEditing={state.isEditing}
            />

            <PipelineOutputParams
              pipelineId={pipelineId}
              isEditing={state.isEditing}
            />

            <PipelineSettings
              pipeline={pipeline}
              jobs={jobs}
              isEditing={state.isEditing}
              editedTriggerType={state.editedTriggerType}
              setEditedTriggerType={state.setEditedTriggerType}
              editedIsActive={state.editedIsActive}
              setEditedIsActive={state.setEditedIsActive}
              editedEnableKnowledgeGraph={state.editedEnableKnowledgeGraph}
              setEditedEnableKnowledgeGraph={state.setEditedEnableKnowledgeGraph}
              editedKnowledgeGraphConfig={state.editedKnowledgeGraphConfig}
              setEditedKnowledgeGraphConfig={state.setEditedKnowledgeGraphConfig}
              editedMonthlyBudgetUsd={state.editedMonthlyBudgetUsd}
              setEditedMonthlyBudgetUsd={state.setEditedMonthlyBudgetUsd}
              editedLabels={state.editedLabels}
              setEditedLabels={state.setEditedLabels}
              editedSteps={state.editedSteps}
              latestRun={latestRun}
              editedSelfHealingEnabled={(state as any).editedSelfHealingEnabled}
              setEditedSelfHealingEnabled={(state as any).setEditedSelfHealingEnabled}
            />
          </TabsContent>

          <TabsContent value="reactive" className="space-y-12 mt-0">
            <DriftAnalytics pipelineId={pipelineId} />
            <Separator className="bg-cyan-500/10" />
            <TriggerBuilder pipelineId={pipelineId} />
            <Separator className="bg-cyan-500/10" />
            <EventLogViewer pipelineId={pipelineId} />
          </TabsContent>

          <TabsContent value="editor" className="mt-0">
            <div className="space-y-4">
              <h2 className="text-xl font-semibold">Visual Editor</h2>
              <PipelineVisualEditor
                jobs={jobs}
                pipelineApps={pipelineApps}
                orgSettings={orgSettings}
                editedSteps={state.editedSteps}
                isEditing={state.isEditing}
                selectedStepIndex={state.selectedStepIndex}
                setSelectedStepIndex={state.setSelectedStepIndex}
                pipelineId={pipelineId}
                onAddStep={actions.handleAddStep}
                onUpdateStep={actions.handleUpdateStep}
                onRemoveStep={actions.handleRemoveStep}
                onMoveStep={actions.handleMoveStep}
                onJobChange={actions.handleJobChange}
                onCreateSpecialJob={actions.handleCreateSpecialJob}
                onSave={actions.handleSave}
              />
            </div>
          </TabsContent>

          <TabsContent value="lineage" className="mt-0">
            <div className="space-y-4">
              <h2 className="text-xl font-semibold">Data Lineage</h2>
              <PipelineLineageGraph pipelineId={pipelineId} />
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Dialogs */}
      <AlertDialog open={state.deleteDialogOpen} onOpenChange={state.setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the pipeline
              and remove all associated data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => mutations.deletePipelineMutation.mutate()}
            >
              {mutations.deletePipelineMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={state.saveTemplateOpen} onOpenChange={state.setSaveTemplateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save as Template</DialogTitle>
            <DialogDescription>
              Create a reusable template from this pipeline configuration.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Template Name</Label>
              <Input
                value={state.templateName}
                onChange={(e) => state.setTemplateName(e.target.value)}
                placeholder="My Pipeline Template"
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={state.templateDescription}
                onChange={(e) => state.setTemplateDescription(e.target.value)}
                placeholder="Describe what this template does..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => state.setSaveTemplateOpen(false)}>Cancel</Button>
            <Button onClick={actions.handleSaveAsTemplate} disabled={mutations.saveTemplateMutation.isPending}>
              {mutations.saveTemplateMutation.isPending ? "Saving..." : "Save Template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <VersionHistoryPanel
        entityType="pipeline"
        entityId={pipelineId}
        open={isHistoryOpen}
        onOpenChange={setIsHistoryOpen}
      />
    </div>
  );
}


