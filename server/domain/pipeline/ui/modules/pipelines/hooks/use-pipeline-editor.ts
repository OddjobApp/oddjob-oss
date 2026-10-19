import { useState, useEffect, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import type { Job } from "@shared/schema/jobs/table";
import type { Pipeline } from "@shared/schema/pipelines/pipeline-core";
import type { PipelineStep } from "@shared/schema/pipelines/pipeline-steps";
import type { FormStep } from "@domain-ui/pipeline/ui/modules/pipelines/types";
import { generateTransformerOutputSchema } from '@/utils/pipeline-utils';
export type { FormStep };

// Extended definitions or UI references if they differ slightly from schema
interface UIJob extends Omit<Job, 'config' | 'outputSchema' | 'inputSchema'> {
    config?: any;
    outputSchema?: any;
    inputSchema?: any;
}

export function usePipelineEditor(pipelineId: number, pipeline: Pipeline | undefined, jobs: UIJob[]) {
    const jobsList = Array.isArray(jobs) ? jobs : (jobs as any)?.items || [];
    const { toast } = useToast();
    const [, setLocation] = useLocation();
    const queryClient = useQueryClient();

    // Mode
    const [isEditing, setIsEditing] = useState(false);

    // Form State
    const [editedName, setEditedName] = useState('');
    const [editedDescription, setEditedDescription] = useState('');
    const [editedTriggerType, setEditedTriggerType] = useState<'schedule' | 'manual' | 'webhook'>('manual');
    const [editedIsActive, setEditedIsActive] = useState(true);
    const [editedSteps, setEditedSteps] = useState<FormStep[]>([]);
    const [editedEnableKnowledgeGraph, setEditedEnableKnowledgeGraph] = useState(false);
    const [editedKnowledgeGraphConfig, setEditedKnowledgeGraphConfig] = useState<any>(null);
    const [editedMonthlyBudgetUsd, setEditedMonthlyBudgetUsd] = useState<number | null>(null);
    const [editedLabels, setEditedLabels] = useState<string[]>([]);
    const [editedSelfHealingEnabled, setEditedSelfHealingEnabled] = useState(false);

    // UI State
    const [selectedStepIndex, setSelectedStepIndex] = useState<number | null>(null);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
    const [templateName, setTemplateName] = useState('');
    const [templateDescription, setTemplateDescription] = useState('');

    const [hasLoaded, setHasLoaded] = useState(false);

    // Initialize form when pipeline loads
    useEffect(() => {
        if (pipeline && (!hasLoaded || pipeline.id !== pipelineId)) {
            setEditedName(pipeline.name);
            setEditedDescription(pipeline.description || '');
            setEditedTriggerType((pipeline.triggerType?.toLowerCase() as any) || 'manual');
            setEditedIsActive(pipeline.isActive ?? true);
            setEditedEnableKnowledgeGraph((pipeline as any).enableKnowledgeGraph || false);
            setEditedKnowledgeGraphConfig((pipeline as any).knowledgeGraphConfig || null);
            setEditedMonthlyBudgetUsd(Number(pipeline.monthlyBudgetUsd) || null);
            setEditedLabels((pipeline.labels as any) || []);
            setEditedSelfHealingEnabled(pipeline.selfHealingEnabled || false);

            // Convert backend steps to form steps
            const pipelineSteps = (pipeline as any).steps || [];
            const formSteps: FormStep[] = pipelineSteps.map((step: any) => {
                const stepJob = jobsList.find((j: any) => j.id === step.jobId);
                return {
                    tempId: `step-${step.id}`,
                    id: step.id,
                    jobId: step.jobId,
                    order: step.order,
                    outputName: step.outputName || '',
                    moduleType: step.moduleType || null,
                    destinationStepId: step.destinationStepId || null,
                    decisionNodeConfig: step.decisionNodeConfig || null,
                    transformerConfig: stepJob?.type === 'transformer' ? stepJob?.config : null,
                    iteratorConfig: stepJob?.type === 'iterator' ? stepJob?.config : null,
                    decisionConfig: stepJob?.type === 'decision'
                        ? { ...stepJob?.config, ...(step.decisionNodeConfig as any) }
                        : null,
                    retryConfig: step.retryConfig || null,
                    knowledgeGraphConfig: step.knowledgeGraphConfig || null,
                    runOnCondition: step.runOnCondition || 'on_success',
                    onFailureAction: step.onFailureAction || 'Stop Pipeline',
                    fallbackJobId: step.fallbackJobId ?? null,
                    inputMapping: step.inputMapping || {},
                };
            });
            setEditedSteps(formSteps);
            setHasLoaded(true);
        }
    }, [pipeline, jobs, pipelineId, hasLoaded]);

    // Mutations
    const updatePipelineMutation = useMutation({
        mutationFn: async (data: any) => {
            const res = await apiRequest('PATCH', `/api/pipelines/${pipelineId}`, data);
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['/api/pipelines', pipelineId] });
            queryClient.invalidateQueries({ queryKey: ['/api/pipelines'] });
            toast({ title: 'Success', description: 'Pipeline updated successfully' });
            setIsEditing(false);
        },
        onError: (error: any) => {
            toast({
                title: 'Error',
                description: error.message || 'Failed to update pipeline',
                variant: 'destructive'
            });
        },
    });

    const deletePipelineMutation = useMutation({
        mutationFn: async () => {
            await apiRequest('DELETE', `/api/pipelines/${pipelineId}`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['/api/pipelines'] });
            toast({ title: 'Success', description: 'Pipeline deleted successfully' });
            setLocation('/operations/workstreams');
        },
        onError: (error: any) => {
            toast({
                title: 'Error',
                description: error.message || 'Failed to delete pipeline',
                variant: 'destructive'
            });
        },
    });

    const saveTemplateMutation = useMutation({
        mutationFn: async (data: { pipelineId: number, name: string, description: string }) => {
            const res = await apiRequest('POST', '/api/templates/from-pipeline', data);
            return res.json();
        },
        onSuccess: () => {
            toast({ title: 'Success', description: 'Template created successfully' });
            setSaveTemplateOpen(false);
            queryClient.invalidateQueries({ queryKey: ['/api/templates'] });
        },
        onError: (error: any) => {
            toast({
                title: 'Error',
                description: error.message || 'Failed to create template',
                variant: 'destructive',
            });
        },
    });

    // Handlers
    const handleEdit = useCallback(() => setIsEditing(true), []);

    const handleCancel = useCallback(() => {
        if (pipeline) {
            // Revert to original state
            setEditedName(pipeline.name);
            setEditedDescription(pipeline.description || '');
            setEditedTriggerType((pipeline.triggerType?.toLowerCase() as any) || 'manual');
            setEditedIsActive(pipeline.isActive ?? true);
            setEditedEnableKnowledgeGraph((pipeline as any).enableKnowledgeGraph || false);
            setEditedKnowledgeGraphConfig((pipeline as any).knowledgeGraphConfig || null);
            setEditedMonthlyBudgetUsd(Number(pipeline.monthlyBudgetUsd) || null);
            setEditedLabels((pipeline.labels as any) || []);
            setEditedSelfHealingEnabled(pipeline.selfHealingEnabled || false);

            const pipelineSteps = (pipeline as any).steps || [];
            const formSteps: FormStep[] = pipelineSteps.map((step: any) => {
                const stepJob = jobsList.find((j: any) => j.id === step.jobId);
                return {
                    tempId: `step-${step.id}`,
                    id: step.id,
                    jobId: step.jobId,
                    order: step.order,
                    outputName: step.outputName || '',
                    moduleType: step.moduleType || null,
                    destinationStepId: step.destinationStepId || null,
                    decisionNodeConfig: step.decisionNodeConfig || null,
                    transformerConfig: stepJob?.type === 'transformer' ? stepJob.config : null,
                    iteratorConfig: stepJob?.type === 'iterator' ? stepJob.config : null,
                    decisionConfig: stepJob?.type === 'decision' ? stepJob.config : null,
                    retryConfig: step.retryConfig || null,
                    knowledgeGraphConfig: step.knowledgeGraphConfig || null,
                    runOnCondition: step.runOnCondition || 'on_success',
                    onFailureAction: step.onFailureAction || 'Stop Pipeline',
                    fallbackJobId: step.fallbackJobId ?? null,
                    inputMapping: step.inputMapping || {},
                };
            });
            setEditedSteps(formSteps);
        }
        setIsEditing(false);
    }, [pipeline, jobs]);

    const handleUpdateStep = useCallback((stepTempId: string, updates: Partial<FormStep>) => {
        setIsEditing(true);
        setEditedSteps(prev => prev.map(s => s.tempId === stepTempId ? { ...s, ...updates } : s));
    }, []);

    const handleAddStep = useCallback(async (stepLike?: Partial<FormStep>) => {
        if (!pipeline) return;

        setIsEditing(true);
        const maxOrder = editedSteps.reduce((max, s) => Math.max(max, s.order), -1);
        let jobId: number | null = stepLike?.jobId || null;
        let moduleType: string | null = stepLike?.moduleType || null;
        let initialConfig: any = null;
        let jobName = stepLike?.name || '';

        if ((stepLike as any)?.appDeploymentId) {
            try {
                const res = await apiRequest('POST', `/api/apps/deployments/${(stepLike as any).appDeploymentId}/pipeline-job`, {});
                const appJob = await res.json();
                jobId = appJob.job.id;
                jobName = appJob.job.name || jobName || appJob.app?.name || '';

                queryClient.setQueryData(['/api/jobs', { includeHidden: true }], (old: any) => {
                    if (!Array.isArray(old) || old.some((j: any) => j.id === appJob.job.id)) return old;
                    return [appJob.job, ...old];
                });
                queryClient.invalidateQueries({ queryKey: ['/api/jobs'] });
                toast({ title: 'App Step Ready', description: `Added ${appJob.app?.name || appJob.job.name} to this draft` });
            } catch (error: any) {
                toast({
                    title: 'Error',
                    description: error.message || 'Failed to prepare app step',
                    variant: 'destructive'
                });
                return;
            }
        }

        // Handle Templates requiring Job Creation
        if (['iterator_template', 'decision_template', 'repeater_template', 'transformer_template'].includes(stepLike?.moduleType as string)) {
            try {
                let type: string;
                let config: any;

                if (stepLike?.moduleType === 'transformer_template') {
                    type = 'transformer';
                    config = { rules: [], inputSource: 'previous_step', entityExtraction: { enabled: false, autoCreate: true } };
                } else if (stepLike?.moduleType === 'decision_template') {
                    type = 'decision';
                    config = { condition: '' };
                } else {
                    type = 'iterator';
                    config = { mode: 'job', concurrency: 1, aggregateOutputs: true };
                }

                initialConfig = config;

                // Auto-naming for special jobs
                if (!jobName) {
                    const typeLabels: Record<string, string> = {
                        'transformer_template': 'Transformer',
                        'iterator_template': 'Iterator',
                        'decision_template': 'Decision',
                        'logic_gatekeeper': 'Gatekeeper'
                    };
                    const baseLabel = (moduleType && typeLabels[moduleType]) || 'Step';

                    let counter = 1;
                    let candidateName = `${baseLabel} Step ${counter}`;

                    // Check against both existing jobs in the organization AND current edited steps
                    const isNameTaken = (name: string) => {
                        return jobsList.some((j: any) => j.name === name) ||
                            editedSteps.some(s => s.name === name);
                    };

                    while (isNameTaken(candidateName)) {
                        counter++;
                        candidateName = `${baseLabel} Step ${counter}`;
                    }

                    jobName = candidateName;
                }

                const jobInput = {
                    name: jobName,
                    type: type, // Use 'type' determined above (transformer, iterator, decision)
                    config: initialConfig,
                    priority: 2, // Default priority
                    tool: 'None', // Default tool
                    isHidden: true,
                    // organizationId: state.metadata.organizationId // Assuming 'state' and 'metadata' are available in scope, otherwise remove or define
                };

                const res = await apiRequest('POST', '/api/jobs', jobInput);

                if (!res.ok) {
                    const errorData = await res.json();
                    throw new Error(errorData.message || `Failed to create ${type} Job`);
                }
                const newJob = await res.json();

                jobId = newJob.id;
                moduleType = null;
                toast({ title: `${type.charAt(0).toUpperCase() + type.slice(1)} Created`, description: `Created job "${newJob.name}"` });

                queryClient.invalidateQueries({ queryKey: ['/api/jobs'] });
            } catch (error: any) {
                const errorMessage = error.response?.data?.message || error.message || "Unknown error";
                toast({
                    title: "Error",
                    description: `Failed to create job template: ${errorMessage}`,
                    variant: "destructive"
                });
                return;
            }
        }

        const newStep: FormStep = {
            tempId: `step-${Date.now()}`,
            jobId: jobId,
            order: maxOrder + 1,
            outputName: stepLike?.outputName || '',
            name: jobName || stepLike?.name || '',
            moduleType: moduleType,
            destinationStepId: null,
            decisionNodeConfig: stepLike?.decisionNodeConfig || null,
            retryConfig: null,
            transformerConfig: stepLike?.moduleType === 'transformer_template' ? initialConfig : (stepLike?.transformerConfig || null),
            iteratorConfig: (stepLike?.moduleType === 'iterator_template' || stepLike?.moduleType === 'repeater_template') ? initialConfig : (stepLike?.iteratorConfig || null),
            decisionConfig: stepLike?.moduleType === 'decision_template' ? initialConfig : (stepLike?.decisionConfig || null),
            knowledgeGraphConfig: null,
            runOnCondition: 'on_success',
            inputMapping: {},
            ...stepLike // Merge any other properties
        };


        setEditedSteps(prev => {
            const updated = [...prev, newStep];
            // Use setTimeout to ensure the selection happens after the state update
            setTimeout(() => {
                setSelectedStepIndex(updated.length - 1);
            }, 0);
            return updated;
        });
    }, [editedSteps, queryClient, toast, jobsList, pipeline]);

    const handleRemoveStep = useCallback((stepTempId: string) => {
        setIsEditing(true);
        setEditedSteps(prev => {
            const newSteps = prev.filter(s => s.tempId !== stepTempId);
            // Reorder
            return newSteps.map((s, i) => ({ ...s, order: i }));
        });
        setSelectedStepIndex(null);
    }, []);

    const handleMoveStep = useCallback((index: number, direction: 'up' | 'down') => {
        setIsEditing(true);
        setEditedSteps(prev => {
            const newSteps = [...prev];
            if (direction === 'up' && index > 0) {
                [newSteps[index - 1], newSteps[index]] = [newSteps[index], newSteps[index - 1]];
            } else if (direction === 'down' && index < newSteps.length - 1) {
                [newSteps[index], newSteps[index + 1]] = [newSteps[index + 1], newSteps[index]];
            }
            return newSteps.map((s, i) => ({ ...s, order: i }));
        });
    }, []);

    const handleJobChange = useCallback((stepTempId: string, jobId: string) => {
        if (jobId === 'create-iterator-job' || jobId === 'create-decision-job') {
            // Special handling normally done in UI via handleCreateSpecialJob
            // But if passed here, we need to handle it or expect caller to handle it
            return;
        }

        const newJobId = parseInt(jobId);
        const selectedJob = jobsList.find((j: any) => j.id === newJobId);

        let transformerConfig = null;
        let iteratorConfig = null;
        let decisionConfig = null;

        if (selectedJob?.config) {
            if (selectedJob.type === 'transformer') transformerConfig = selectedJob.config;
            if (selectedJob.type === 'iterator') iteratorConfig = selectedJob.config;
            if (selectedJob.type === 'decision') decisionConfig = selectedJob.config;
        }

        handleUpdateStep(stepTempId, {
            jobId: newJobId,
            transformerConfig,
            iteratorConfig,
            decisionConfig,
        });
    }, [jobs, handleUpdateStep]);

    const handleSave = async () => {
        // Validation
        if (!editedName.trim()) {
            toast({ title: 'Validation Error', description: 'Pipeline name is required', variant: 'destructive' });
            return;
        }
        if (editedSteps.length === 0) {
            toast({ title: 'Validation Error', description: 'At least one step is required', variant: 'destructive' });
            return;
        }
        if (editedSteps.some(s => s.jobId === null && s.moduleType !== "logic_gatekeeper" && s.moduleType !== "transformer")) {
            // Transformer steps might not have a jobId initially if treated specially, but usually they do. 
            // Logic gatekeepers don't need jobId.
            toast({ title: 'Validation Error', description: 'All steps must have a job selected (except specific logic nodes)', variant: 'destructive' });
            return;
        }

        // Transformer Validation
        for (const step of editedSteps) {
            const stepJob = jobsList.find((j: any) => j.id === step.jobId);
            if (step.moduleType === 'transformer' || stepJob?.type === 'transformer') {
                const transformerConfig = step.transformerConfig || stepJob?.config;
                if (!transformerConfig || !transformerConfig.rules || transformerConfig.rules.length === 0) {
                    toast({ title: 'Validation Error', description: `Transformer step ${editedSteps.indexOf(step) + 1} must have rules`, variant: 'destructive' });
                    return;
                }
                // ... more detailed validation could go here
            }
        }

        // Update job configs if modified
        const jobUpdatePromises: Promise<any>[] = [];
        for (const step of editedSteps) {
            const stepJob = jobsList.find((j: any) => j.id === step.jobId);

            // Helper to check and update config
            const checkAndUpdate = (type: string, newConfig: any) => {
                if (stepJob?.type === type && newConfig) {
                    const originalConfig = stepJob.config;
                    if (JSON.stringify(originalConfig) !== JSON.stringify(newConfig)) {
                        jobUpdatePromises.push(
                            apiRequest('PATCH', `/api/jobs/${step.jobId}`, { config: newConfig }).then(res => res.json())
                        );
                    }
                }
            };

            checkAndUpdate('transformer', step.transformerConfig);

            // Persist generated schema for Transformers
            if (stepJob?.type === 'transformer' && step.transformerConfig?.rules) {
                const newSchema = generateTransformerOutputSchema(step.transformerConfig.rules);
                const currentSchema = stepJob.outputSchema;
                if (JSON.stringify(currentSchema) !== JSON.stringify(newSchema)) {
                    jobUpdatePromises.push(
                        apiRequest('PATCH', `/api/jobs/${step.jobId}`, { outputSchema: newSchema }).then(res => res.json())
                    );
                }
            }

            checkAndUpdate('iterator', step.iteratorConfig);
            // Decision: only persist condition to job; routing (trueStepId, falseStepId) stays in step.decisionNodeConfig
            if (stepJob?.type === 'decision' && step.decisionConfig?.condition) {
                const newConfig = { ...stepJob.config, condition: step.decisionConfig.condition };
                if (JSON.stringify(stepJob.config) !== JSON.stringify(newConfig)) {
                    jobUpdatePromises.push(
                        apiRequest('PATCH', `/api/jobs/${step.jobId}`, { config: newConfig }).then(res => res.json())
                    );
                }
            }
        }

        try {
            await Promise.all(jobUpdatePromises);

            const stepsData = editedSteps.map(step => ({
                jobId: step.moduleType === "logic_gatekeeper" ? null : step.jobId!,
                order: step.order,
                outputName: step.outputName?.trim() || null,
                moduleType: step.moduleType || null,
                destinationStepId: step.destinationStepId || null,
                decisionNodeConfig: step.decisionNodeConfig || null,
                retryConfig: step.retryConfig || null,
                knowledgeGraphConfig: step.knowledgeGraphConfig || null,
                runOnCondition: step.runOnCondition || 'on_success',
                onFailureAction: step.onFailureAction || 'Stop Pipeline',
                fallbackJobId: step.onFailureAction === 'Execute Fallback Job' ? (step.fallbackJobId ?? null) : null,
                inputMapping: step.inputMapping || null,
            }));


            const pipelineData = {
                name: editedName.trim(),
                description: editedDescription.trim() || undefined,
                triggerType: editedTriggerType,
                isActive: editedIsActive,
                enableKnowledgeGraph: editedEnableKnowledgeGraph,
                knowledgeGraphConfig: editedEnableKnowledgeGraph ? editedKnowledgeGraphConfig : null,
                monthlyBudgetUsd: editedMonthlyBudgetUsd,
                labels: editedLabels,
                selfHealingEnabled: editedSelfHealingEnabled,
                steps: stepsData,
            };

            updatePipelineMutation.mutate(pipelineData);

        } catch (error: any) {
            toast({ title: 'Error', description: `Failed to update job configs: ${error.message}`, variant: 'destructive' });
        }
    };

    const handleSaveAsTemplate = () => {
        if (!templateName) {
            toast({ title: 'Validation Error', description: 'Template name is required', variant: 'destructive' });
            return;
        }
        saveTemplateMutation.mutate({
            pipelineId,
            name: templateName,
            description: templateDescription,
        });
    };

    const handleCreateSpecialJob = async (type: 'iterator' | 'decision', stepTempId: string) => {
        try {
            const baseLabel = type === 'iterator' ? 'Iterator' : 'Decision';

            let counter = 1;
            let candidateName = `${baseLabel} Step ${counter}`;

            const isNameTaken = (name: string) => {
                return jobsList.some((j: any) => j.name === name) ||
                    editedSteps.some(s => s.name === name);
            };

            while (isNameTaken(candidateName)) {
                counter++;
                candidateName = `${baseLabel} Step ${counter}`;
            }

            const name = candidateName;
            const config = type === 'iterator' ? { mode: 'job', concurrency: 1, aggregateOutputs: true } : { condition: '' };

            const jobRes = await apiRequest('POST', '/api/jobs', {
                name, type, config, priority: 2, tool: 'None', isHidden: true,
            });
            const newJob = await jobRes.json();

            handleJobChange(stepTempId, String(newJob.id));
            queryClient.invalidateQueries({ queryKey: ['/api/jobs'] });
            toast({ title: 'Success', description: `Created ${type} job` });
        } catch (e: any) {
            toast({ title: 'Error', description: e.message, variant: 'destructive' });
        }
    };


    return {
        state: {
            isEditing, setIsEditing,
            editedName, setEditedName,
            editedDescription, setEditedDescription,
            editedTriggerType, setEditedTriggerType,
            editedIsActive, setEditedIsActive,
            editedSteps, setEditedSteps,
            editedEnableKnowledgeGraph, setEditedEnableKnowledgeGraph,
            editedKnowledgeGraphConfig, setEditedKnowledgeGraphConfig,
            editedMonthlyBudgetUsd, setEditedMonthlyBudgetUsd,
            editedLabels, setEditedLabels,
            editedSelfHealingEnabled, setEditedSelfHealingEnabled,
            selectedStepIndex, setSelectedStepIndex,
            deleteDialogOpen, setDeleteDialogOpen,
            saveTemplateOpen, setSaveTemplateOpen,
            templateName, setTemplateName,
            templateDescription, setTemplateDescription,
        },
        actions: {
            handleEdit,
            handleCancel,
            handleSave,
            handleAddStep,
            handleRemoveStep,
            handleUpdateStep,
            handleMoveStep,
            handleJobChange,
            handleCreateSpecialJob,
            handleSaveAsTemplate,
        },
        mutations: {
            updatePipelineMutation,
            deletePipelineMutation,
            saveTemplateMutation,
        }
    };
}

