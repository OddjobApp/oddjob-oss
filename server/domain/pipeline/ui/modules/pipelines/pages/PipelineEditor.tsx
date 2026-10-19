import { useState, useMemo, useEffect } from "react";
import { useForm, useFieldArray, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ReactFlowProvider } from 'reactflow';
import { z } from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useLocation, useRoute } from "wouter";
import { ExportButton } from "@domain-ui/core/ui/components/shared/ExportButton";
import { formatDateForExport, formatBooleanForExport } from "@/lib/export-utils";
import type { Pipeline } from "@shared/schema/pipelines/pipeline-core";
import type { PipelineStep } from "@shared/schema/pipelines/pipeline-steps";
import type { Job } from "@shared/schema/jobs/table";
import type { Credential } from "@shared/schema/system";
import { estimatePipelinePerformance, validatePipeline, type PipelineValidationResult } from "@/utils/pipeline-utils";
import { PipelinePerformanceBadge } from '../components/PipelinePerformanceBadge.js';
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription
} from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { DataTable, Column } from "@domain-ui/core/ui/components/ui/data-table";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@domain-ui/core/ui/components/ui/dropdown-menu";
import { useAuth } from "@domain-ui/auth/ui/modules/auth";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { MoreHorizontal, Plus, ArrowLeft, GripVertical, Trash2, History, Zap } from "lucide-react";
import { Separator } from "@domain-ui/core/ui/components/ui/separator";
import PipelineDetail from '../components/PipelineDetail.js';
import PipelineFormHeader from '../components/PipelineFormHeader.js';
import PipelineTriggerConfig from '../components/PipelineTriggerConfig.js';
import PipelineStepConfiguration from '../components/PipelineStepConfiguration.js';
import { usePipelineCanvasLogic } from "@domain-ui/pipeline/ui/modules/pipelines/hooks/use-pipeline-canvas-logic";
import { PipelineInputParams } from '../components/PipelineInputParams.js';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@domain-ui/core/ui/components/ui/sheet";
import { Form } from "@domain-ui/core/ui/components/ui/form";
import EnhancedPipelineCanvas from '../components/EnhancedPipelineCanvas.js';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@domain-ui/core/ui/components/ui/resizable";
import { PipelineToolbox } from '../components/PipelineToolbox.js';
import { SaveAsTemplateDialog } from '../components/SaveAsTemplateDialog.js';

import {
    PipelineCreateSchema,
    PipelineFormValues,
    TRIGGER_TYPES,
    CONDITION_TYPES,
    FAILURE_ACTION_TYPES,
    PipelineStepFormSchema,
    PipelineStepSchema
} from "@/schemas/pipeline-schemas";

import { PipelineFormActions } from '../components/PipelineFormActions.js';
import { getErrorMessages } from "@/lib/form-utils";

// --- Components ---

const PipelineForm: React.FC<{ pipeline?: any, onSave: () => void, onCancel: () => void }> = ({ pipeline, onSave, onCancel }) => {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const { user, adminRole } = useAuth();
    const isEdit = !!pipeline;
    const [selectedStepIndex, setSelectedStepIndex] = useState<number | null>(null);
    const [isSaveTemplateOpen, setIsSaveTemplateOpen] = useState(false);

    const { data: jobs = [], isLoading: isLoadingJobs } = useQuery<Job[]>({
        queryKey: ['/api/jobs'],
        queryFn: async () => {
            const res = await apiRequest('GET', '/api/jobs?includeHidden=true');
            const data = await res.json();
            if (data && typeof data === 'object' && Array.isArray(data.items)) {
                return data.items;
            }
            if (Array.isArray(data)) return data;
            return [];
        },
        staleTime: 300000,
    });

    const { data: credentials = [] } = useQuery<Credential[]>({
        queryKey: ['/api/credentials'],
        queryFn: async () => {
            const res = await apiRequest('GET', '/api/credentials');
            return res.json();
        },
    });

    const { data: existingTriggers } = useQuery({
        queryKey: ['/api/pipelines', pipeline?.id, 'triggers'],
        queryFn: async () => {
            if (!pipeline?.id) return null;
            const res = await apiRequest('GET', `/api/pipelines/${pipeline.id}/triggers`);
            return res.json();
        },
        enabled: !!pipeline?.id && pipeline?.triggerType === 'event'
    });

    const form = useForm<PipelineFormValues>({
        resolver: zodResolver(PipelineCreateSchema) as any,
        defaultValues: {
            name: pipeline?.name || '',
            description: pipeline?.description || '',
            triggerType: pipeline?.triggerType || 'manual',
            triggerCredentialId: pipeline?.triggerCredentialId || null,
            eventConfig: {
                eventType: pipeline?.eventConfig?.eventType || '',
                filterCondition: pipeline?.eventConfig?.filterCondition || ''
            },
            webhookConfig: {
                verificationMode: pipeline?.webhookConfig?.verificationMode || 'none',
                verificationConfig: JSON.stringify(pipeline?.webhookConfig?.verificationConfig || {}, null, 2),
                mapPayload: pipeline?.webhookConfig?.mapPayload || false,
                payloadMapping: JSON.stringify(pipeline?.webhookConfig?.payloadMapping || {}, null, 2),
            },
            isActive: pipeline?.isActive ?? true,
            monthlyBudgetUsd: pipeline?.monthlyBudgetUsd ? Number(pipeline.monthlyBudgetUsd) : null,
            labels: (pipeline?.labels as string[]) || [],
            steps: pipeline?.steps?.map((step: any) => ({
                ...step,
                onFailureAction: step.onFailureAction || 'Stop Pipeline',
                parallelGroup: step.parallelGroup || undefined,
                conditionExpression: step.conditionExpression || undefined,
                retryConfig: step.retryConfig || null,
            })) || []
        },
        mode: 'onChange',
    });

    useEffect(() => {
        if (existingTriggers && existingTriggers.length > 0) {
            const trigger = existingTriggers[0];
            form.setValue('eventConfig', {
                eventType: trigger.eventType,
                filterCondition: trigger.filterCondition || ''
            });
        }
    }, [existingTriggers, form]);

    const currentSteps = useWatch({ control: form.control, name: 'steps' });
    const { fields, append, remove, move } = useFieldArray({ control: form.control, name: "steps" });

    const performanceEstimates = useMemo(() => {
        return estimatePipelinePerformance({ steps: currentSteps }, jobs);
    }, [currentSteps, jobs]);

    const {
        getPreviousStepSchema,
        getStepSchema,
        handleDropStep,
        handleConnect
    } = usePipelineCanvasLogic({
        form,
        jobs,
        fields,
        append,
        setSelectedStepIndex
    });

    const mutation = useMutation({
        mutationFn: async (data: PipelineFormValues) => {
            const validSteps = (data.steps || [])
                .filter((step) => {
                    if (step.moduleType === "logic_gatekeeper") {
                        const config = step.decisionNodeConfig as any;
                        return config && config.routes?.onMatch?.destinationStepId;
                    }
                    return step.jobId && step.jobId > 0;
                })
                .map((step, index) => ({
                    ...step,
                    order: index,
                    jobId: step.moduleType === "logic_gatekeeper" ? null : step.jobId,
                }));

            if (validSteps.length === 0) throw new Error('At least one step is required');

            const payload: any = {
                name: data.name.trim(),
                description: data.description?.trim() || null,
                triggerType: data.triggerType,
                isActive: data.isActive ?? true,
                monthlyBudgetUsd: data.monthlyBudgetUsd,
                labels: data.labels,
                steps: validSteps,
            };

            if (data.triggerType === 'event' && data.eventConfig) payload.eventConfig = data.eventConfig;
            if (data.triggerCredentialId) payload.triggerCredentialId = data.triggerCredentialId;
            if (data.triggerType === 'webhook' && data.webhookConfig) {
                payload.webhookConfig = {
                    ...data.webhookConfig,
                    verificationConfig: data.webhookConfig.verificationConfig ? JSON.parse(data.webhookConfig.verificationConfig) : {},
                    payloadMapping: data.webhookConfig.payloadMapping ? JSON.parse(data.webhookConfig.payloadMapping) : {},
                };
            }

            if (!isEdit) payload.createdBy = user?.username || user?.email || 'system';

            const url = isEdit ? `/api/pipelines/${pipeline.id}` : '/api/pipelines';
            const method = isEdit ? 'PUT' : 'POST';
            const res = await apiRequest(method, url, payload);
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['/api/pipelines'] });
            toast({ title: `Workstream ${isEdit ? 'updated' : 'created'} successfully` });
            setTimeout(onSave, 500);
        },
        onError: (e: Error) => {
            toast({ title: 'Error Saving Workstream', description: e.message, variant: 'destructive' });
        }
    });

    const saveTemplateMutation = useMutation({
        mutationFn: async (data: any) => {
            const res = await apiRequest('POST', '/api/templates', { ...data, config: form.getValues() });
            return res.json();
        },
        onSuccess: () => toast({ title: "Template Created" }),
        onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" })
    });

    const canvasSteps = useMemo(() => fields.map((field, idx) => {
        const reactiveStep = (currentSteps?.[idx] || {}) as any;
        return {
            ...field,
            ...reactiveStep,
            tempId: field.id,
            label: jobs?.find(j => j.id === (reactiveStep.jobId || (field as any).jobId))?.name || `Step ${idx + 1}`,
        };
    }), [fields, currentSteps, jobs]);

    if (isLoadingJobs && jobs.length === 0) {
        return <Card><CardHeader><CardTitle>Loading...</CardTitle></CardHeader></Card>;
    }

    const toolboxJobs = jobs.filter(j => !j.isHidden);

    return (
        <Form {...form}>
            <div className="space-y-6">
                <PipelineFormHeader form={form} isEdit={isEdit} pipeline={pipeline} />
                <PipelineTriggerConfig
                    triggerType={form.watch("triggerType")}
                    onChange={(type) => form.setValue("triggerType", type)}
                    form={form}
                />

                <div className="h-[800px] border rounded-lg overflow-hidden bg-background">
                    <ResizablePanelGroup direction="vertical">
                        <ResizablePanel defaultSize={65}>
                            <ReactFlowProvider>
                                <EnhancedPipelineCanvas
                                    steps={canvasSteps}
                                    jobs={jobs as any}
                                    onUpdateStep={(tempId, updates) => {
                                        const index = fields.findIndex(f => f.id === tempId);
                                        if (index !== -1) form.setValue(`steps.${index}`, { ...fields[index], ...updates } as any);
                                    }}
                                    onNodeClick={(tempId) => {
                                        const index = fields.findIndex(f => f.id === tempId);
                                        if (index !== -1) setSelectedStepIndex(index);
                                    }}
                                    onDropStep={handleDropStep}
                                    onConnect={handleConnect}
                                />
                            </ReactFlowProvider>
                        </ResizablePanel>
                        <ResizableHandle />
                        <ResizablePanel defaultSize={35} minSize={20}>
                            <PipelineToolbox jobs={toolboxJobs as any} />
                        </ResizablePanel>
                    </ResizablePanelGroup>
                </div>

                {isEdit && pipeline?.id && (
                    <PipelineInputParams
                        pipelineId={pipeline.id}
                        isEditing={true}
                        importableJob={currentSteps?.[0] ? jobs.find(j => j.id === currentSteps[0].jobId) : undefined}
                    />
                )}

                <form onSubmit={(e) => {
                    e.preventDefault();
                    form.handleSubmit(data => mutation.mutate(data), errors => {
                        toast({
                            title: 'Validation Error',
                            description: getErrorMessages(errors).join('\n'),
                            variant: 'destructive',
                            className: "whitespace-pre-wrap"
                        });
                    })();
                }} className="space-y-6">
                    <Sheet open={selectedStepIndex !== null} onOpenChange={open => !open && setSelectedStepIndex(null)}>
                        <SheetContent className="w-[90%] sm:max-w-[800px] overflow-y-auto">
                            <SheetHeader>
                                <SheetTitle>Configure Step {(selectedStepIndex ?? 0) + 1}</SheetTitle>
                            </SheetHeader>
                            <div className="py-6">
                                <PipelineStepConfiguration
                                    form={form} jobs={jobs} selectedStepIndex={selectedStepIndex}
                                    onSelectedStepChange={setSelectedStepIndex} move={move} remove={remove}
                                    fields={fields} getPreviousStepSchema={getPreviousStepSchema} getStepSchema={getStepSchema}
                                />
                            </div>
                        </SheetContent>
                    </Sheet>

                    <PipelineFormActions
                        isPending={mutation.isPending}
                        isSuperAdmin={!!adminRole?.isSuperAdmin}
                        onCancel={onCancel}
                        onSaveAsTemplate={() => setIsSaveTemplateOpen(true)}
                        performanceEstimates={performanceEstimates}
                    />
                </form>
            </div>

            <SaveAsTemplateDialog
                open={isSaveTemplateOpen}
                onOpenChange={setIsSaveTemplateOpen}
                onSave={data => saveTemplateMutation.mutateAsync(data)}
                defaultName={form.getValues('name')}
            />
        </Form>
    );
};

export default PipelineForm;


