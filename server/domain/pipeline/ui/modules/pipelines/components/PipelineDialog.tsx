import { useState, useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@domain-ui/core/ui/components/ui/dialog';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@domain-ui/core/ui/components/ui/tabs';
import { ScrollArea } from '@domain-ui/core/ui/components/ui/scroll-area';
import { Separator } from '@domain-ui/core/ui/components/ui/separator';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Card, CardContent } from '@domain-ui/core/ui/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@domain-ui/core/ui/components/ui/select';
import { Mouse, Calendar, Webhook as WebhookIcon, GitBranch, ArrowDown } from 'lucide-react';
import PipelineTriggerConfig from './PipelineTriggerConfig.js';
import PipelineKGConfig from './PipelineKGConfig.js';
import PipelineStepsEditor from './PipelineStepsEditor.js';
import { Pipeline, Job, FormStep } from './types.js';

interface PipelineDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    editingPipeline: Pipeline | null;
    jobs: Job[];
    jobsLoading: boolean;
}

export default function PipelineDialog({
    open,
    onOpenChange,
    editingPipeline,
    jobs,
    jobsLoading,
}: PipelineDialogProps) {
    const { toast } = useToast();

    // Form state
    const [pipelineName, setPipelineName] = useState('');
    const [pipelineDescription, setPipelineDescription] = useState('');
    const [triggerType, setTriggerType] = useState<'schedule' | 'manual' | 'webhook' | 'event'>('manual');
    const [steps, setSteps] = useState<FormStep[]>([]);
    const [validationError, setValidationError] = useState('');
    const [enableKnowledgeGraph, setEnableKnowledgeGraph] = useState(false);
    const [knowledgeGraphConfig, setKnowledgeGraphConfig] = useState<any>(null);
    const [governorSettings, setGovernorSettings] = useState<{ enabled: boolean, mode: 'ADVISORY' | 'AUTONOMOUS' }>({
        enabled: false,
        mode: 'ADVISORY'
    });

    // Load schemas for KG config
    const { data: schemas } = useQuery<any[]>({
        queryKey: ['/api/knowledge/schemas'],
        queryFn: async () => {
            const res = await apiRequest("GET", "/api/knowledge/schema");
            return res.json();
        }
    });

    // Populate form when opening or editing
    useEffect(() => {
        if (open) {
            if (editingPipeline) {
                setPipelineName(editingPipeline.name);
                setPipelineDescription(editingPipeline.description || '');
                setTriggerType(editingPipeline.triggerType.toLowerCase() as any);
                setEnableKnowledgeGraph(editingPipeline.enableKnowledgeGraph || !!editingPipeline.knowledgeGraphConfig);
                setKnowledgeGraphConfig(editingPipeline.knowledgeGraphConfig || null);
                setGovernorSettings((editingPipeline as any).governorSettings || { enabled: false, mode: 'ADVISORY' });

                // Convert backend steps to form steps
                const formSteps: FormStep[] = editingPipeline.steps.map(step => {
                    const stepJob = jobs.find(j => j.id === step.jobId);
                    return {
                        tempId: `step-${step.id}`,
                        jobId: step.jobId,
                        order: step.order,
                        outputName: step.outputName || '',
                        moduleType: (step as any).moduleType || null,
                        destinationStepId: (step as any).destinationStepId || null,
                        decisionNodeConfig: (step as any).decisionNodeConfig || null,
                        transformerConfig: stepJob?.type === 'transformer' ? stepJob?.config : null,
                    };
                });
                setSteps(formSteps);
            } else {
                // Reset form
                setPipelineName('');
                setPipelineDescription('');
                setTriggerType('manual');
                setSteps([]);
                setValidationError('');
                setEnableKnowledgeGraph(false);
                setKnowledgeGraphConfig(null);
                setGovernorSettings({ enabled: false, mode: 'ADVISORY' });
            }
        }
    }, [open, editingPipeline, jobs]);

    // Create pipeline mutation
    const createPipelineMutation = useMutation({
        mutationFn: async (data: any) => {
            const res = await apiRequest('POST', '/api/pipelines', data);
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['/api/pipelines'] });
            toast({ title: 'Success', description: 'Workstream created successfully' });
            onOpenChange(false);
        },
        onError: (error: any) => {
            toast({
                title: 'Error',
                description: error.message || 'Failed to create pipeline',
                variant: 'destructive'
            });
        },
    });

    // Update pipeline mutation
    const updatePipelineMutation = useMutation({
        mutationFn: async ({ id, data }: { id: number; data: any }) => {
            const res = await apiRequest('PATCH', `/api/pipelines/${id}`, data);
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['/api/pipelines'] });
            toast({ title: 'Success', description: 'Workstream updated successfully' });
            onOpenChange(false);
        },
        onError: (error: any) => {
            toast({
                title: 'Error',
                description: error.message || 'Failed to update pipeline',
                variant: 'destructive'
            });
        },
    });

    const handleAddStep = () => {
        const newStep: FormStep = {
            tempId: `step-${Date.now()}`,
            jobId: null,
            order: steps.length,
            outputName: '',
            moduleType: null,
            destinationStepId: null,
            decisionNodeConfig: null,
            transformerConfig: null,
        };
        setSteps([...steps, newStep]);
    };

    const handleRemoveStep = (stepId: string) => {
        const newSteps = steps.filter(s => s.tempId !== stepId);
        newSteps.forEach((step, index) => {
            step.order = index;
        });
        setSteps(newSteps);
    };

    const handleUpdateStep = (stepId: string, updates: Partial<FormStep>) => {
        setSteps(steps.map(s => s.tempId === stepId ? { ...s, ...updates } : s));
    };

    const handleMoveStep = (index: number, direction: 'up' | 'down') => {
        if (direction === 'up' && index > 0) {
            const newSteps = [...steps];
            [newSteps[index - 1], newSteps[index]] = [newSteps[index], newSteps[index - 1]];
            newSteps.forEach((step, i) => step.order = i);
            setSteps(newSteps);
        } else if (direction === 'down' && index < steps.length - 1) {
            const newSteps = [...steps];
            [newSteps[index], newSteps[index + 1]] = [newSteps[index + 1], newSteps[index]];
            newSteps.forEach((step, i) => step.order = i);
            setSteps(newSteps);
        }
    };

    const canAddTransformer = (): boolean => {
        if (steps.length === 0) return false;
        const lastStep = steps[steps.length - 1];
        if (!lastStep.jobId) return false;
        const lastJob = jobs.find(j => j.id === lastStep.jobId);
        return !!lastJob?.outputSchema;
    };

    const handleAddTransformationStep = async () => {
        try {
            const transformerJobResponse = await apiRequest('POST', '/api/jobs', {
                name: `Transformer for ${pipelineName || 'Workstream'}`,
                type: 'transformer',
                config: {
                    rules: [],
                    inputSource: 'previous_step',
                    entityExtraction: {
                        enabled: false,
                        autoCreate: true,
                    },
                },
                priority: 2,
                tool: 'None',
            });

            if (!transformerJobResponse.ok) {
                const error = await transformerJobResponse.json();
                throw new Error(error.message || 'Failed to create transformer job');
            }

            const transformerJob = await transformerJobResponse.json();

            const newStep: FormStep = {
                tempId: `step-${Date.now()}`,
                jobId: transformerJob.id,
                order: steps.length,
                outputName: '',
                moduleType: 'transformer',
                destinationStepId: null,
                decisionNodeConfig: null,
                transformerConfig: transformerJob.config,
            };

            setSteps([...steps, newStep]);
            await queryClient.invalidateQueries({ queryKey: ['/api/jobs'] });

            toast({
                title: 'Success',
                description: 'Transformation step added',
            });
        } catch (error) {
            console.error('Error adding transformation step:', error);
            toast({
                title: 'Error',
                description: error instanceof Error ? error.message : 'Failed to add transformation step',
                variant: 'destructive'
            });
        }
    };

    const handleSavePipeline = () => {
        // Validation
        if (!pipelineName.trim()) {
            setValidationError('Workstream name is required');
            return;
        }
        if (steps.length === 0) {
            setValidationError('At least one step is required');
            return;
        }
        if (steps.some(s => s.moduleType !== "logic_gatekeeper" && s.moduleType !== "transformer" && s.jobId === null)) {
            setValidationError('All regular steps must have a job selected');
            return;
        }

        // Logic Gatekeeper Validation
        for (const step of steps) {
            if (step.moduleType === "logic_gatekeeper") {
                if (!step.decisionNodeConfig) {
                    setValidationError(`Decision Node step ${steps.indexOf(step) + 1} must have a configuration`);
                    return;
                }
                if (!step.decisionNodeConfig.routes?.onMatch?.destinationStepId) {
                    setValidationError(`Decision Node step ${steps.indexOf(step) + 1} must have an onMatch destination`);
                    return;
                }
            }
        }

        // Transformer Validation
        for (const step of steps) {
            const stepJob = jobs.find(j => j.id === step.jobId);
            if (step.moduleType === 'transformer' || stepJob?.type === 'transformer') {
                const transformerConfig = step.transformerConfig || stepJob?.config;
                if (!transformerConfig || !transformerConfig.rules || transformerConfig.rules.length === 0) {
                    setValidationError(`Transformer job step ${steps.indexOf(step) + 1} must have at least one transformation rule`);
                    return;
                }
                for (const rule of transformerConfig.rules) {
                    if (!rule.sourcePath || !rule.targetPath) {
                        setValidationError(`Transformer job step ${steps.indexOf(step) + 1}: All rules must have source and target paths`);
                        return;
                    }
                    if (rule.type === 'wrap_object' && !rule.config?.wrapperKey) {
                        setValidationError(`Transformer job step ${steps.indexOf(step) + 1}: Wrap Object rules require a wrapper key`);
                        return;
                    }
                    if (rule.type === 'map_value' && (!rule.config?.mapping || Object.keys(rule.config.mapping).length === 0)) {
                        setValidationError(`Transformer job step ${steps.indexOf(step) + 1}: Map Value rules require a mapping`);
                        return;
                    }
                    if (rule.type === 'extract_field' && !rule.config?.extractPath) {
                        setValidationError(`Transformer job step ${steps.indexOf(step) + 1}: Extract Field rules require an extract path`);
                        return;
                    }
                }
            }
        }

        // Update job configs when step config overrides (transformer, decision)
        const jobUpdatePromises: Promise<any>[] = [];
        for (const step of steps) {
            const stepJob = jobs.find(j => j.id === step.jobId);
            if (stepJob?.type === 'transformer') {
                const originalConfig = stepJob?.config;
                const newConfig = step.transformerConfig;
                if (JSON.stringify(originalConfig) !== JSON.stringify(newConfig)) {
                    jobUpdatePromises.push(
                        apiRequest('PATCH', `/api/jobs/${step.jobId}`, {
                            config: newConfig,
                        }).then(res => res.json())
                    );
                }
            }
            if (stepJob?.type === 'decision' && step.decisionConfig) {
                // Persist condition to job; routing (trueStepId, falseStepId) stays in step.decisionNodeConfig
                const newConfig = { condition: step.decisionConfig.condition };
                const originalConfig = { condition: stepJob?.config?.condition };
                if (JSON.stringify(originalConfig) !== JSON.stringify(newConfig)) {
                    jobUpdatePromises.push(
                        apiRequest('PATCH', `/api/jobs/${step.jobId}`, {
                            config: { ...stepJob?.config, ...newConfig },
                        }).then(res => res.json())
                    );
                }
            }
        }

        const savePipeline = () => {
            const stepsData = steps.map(step => ({
                jobId: step.moduleType === "logic_gatekeeper" ? null : step.jobId!,
                order: step.order,
                outputName: step.outputName.trim() || null,
                moduleType: step.moduleType || null,
                destinationStepId: step.destinationStepId || null,
                decisionNodeConfig: step.decisionNodeConfig || null,
            }));

            const pipelineData = {
                name: pipelineName.trim(),
                description: pipelineDescription.trim() || undefined,
                triggerType,
                enableKnowledgeGraph,
                knowledgeGraphConfig: enableKnowledgeGraph ? knowledgeGraphConfig : null,
                governorSettings,
                steps: stepsData,
            };

            if (editingPipeline) {
                updatePipelineMutation.mutate({ id: editingPipeline.id, data: pipelineData });
            } else {
                createPipelineMutation.mutate(pipelineData);
            }
        };

        if (jobUpdatePromises.length > 0) {
            Promise.all(jobUpdatePromises)
                .then(() => savePipeline())
                .catch((error) => {
                    toast({
                        title: 'Error',
                        description: `Failed to update transformer job configs: ${error.message}`,
                        variant: 'destructive',
                    });
                });
        } else {
            savePipeline();
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl max-h-[90vh]">
                <DialogHeader>
                    <DialogTitle>{editingPipeline ? 'Edit Workstream' : 'Create Workstream'}</DialogTitle>
                    <DialogDescription>
                        {editingPipeline ? 'Modify your multi-step workflow' : 'Build a multi-step workflow with sequential job execution'}
                    </DialogDescription>
                </DialogHeader>

                <Tabs defaultValue="config" className="w-full">
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="config" data-testid="tab-config">Configuration</TabsTrigger>
                        <TabsTrigger value="preview" data-testid="tab-preview">Flow Preview</TabsTrigger>
                    </TabsList>

                    <TabsContent value="config" className="space-y-4">
                        <ScrollArea className="h-[500px] pr-4">
                            <div className="space-y-6">
                                {/* Basic Info */}
                                <div className="space-y-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="pipeline-name">Workstream Name *</Label>
                                        <Input
                                            id="pipeline-name"
                                            placeholder="e.g., Data Processing Workflow"
                                            value={pipelineName}
                                            onChange={(e) => setPipelineName(e.target.value)}
                                            data-testid="input-pipeline-name"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="pipeline-description">Description</Label>
                                        <Input
                                            id="pipeline-description"
                                            placeholder="Brief description of this workstream"
                                            value={pipelineDescription}
                                            onChange={(e) => setPipelineDescription(e.target.value)}
                                            data-testid="input-pipeline-description"
                                        />
                                    </div>
                                </div>

                                <Separator />

                                <PipelineTriggerConfig
                                    triggerType={triggerType}
                                    onChange={setTriggerType}
                                    form={{} as any}
                                />

                                <Separator />

                                <PipelineKGConfig
                                    enabled={enableKnowledgeGraph}
                                    setEnabled={setEnableKnowledgeGraph}
                                    config={knowledgeGraphConfig}
                                    setConfig={setKnowledgeGraphConfig}
                                    steps={steps}
                                    schemas={schemas || []}
                                />

                                <Separator />

                                <div className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <div className="space-y-0.5">
                                            <Label className="text-sm font-medium">Pentagonal OODA Governor</Label>
                                            <p className="text-xs text-muted-foreground">Enable multi-node AI verification for high-risk workstreams.</p>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <Button
                                                type="button"
                                                variant={governorSettings.enabled ? "default" : "outline"}
                                                size="sm"
                                                onClick={() => setGovernorSettings(prev => ({ ...prev, enabled: !prev.enabled }))}
                                            >
                                                {governorSettings.enabled ? "Opted-In" : "Opt-In"}
                                            </Button>
                                        </div>
                                    </div>

                                    {governorSettings.enabled && (
                                        <div className="grid grid-cols-2 gap-4 pl-4 border-l-2 border-border py-2">
                                            <div className="space-y-2">
                                                <Label className="text-xs">Operation Mode</Label>
                                                <Select
                                                    value={governorSettings.mode}
                                                    onValueChange={(val: any) => setGovernorSettings(prev => ({ ...prev, mode: val }))}
                                                >
                                                    <SelectTrigger className="h-8">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="ADVISORY">Advisory (Human Approval)</SelectItem>
                                                        <SelectItem value="AUTONOMOUS">Autonomous (Consensus-led)</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div className="text-xs text-muted-foreground pt-5">
                                                {governorSettings.mode === 'ADVISORY'
                                                    ? "Workstream will pause and request confirmation on high-risk steps."
                                                    : "Steps will proceed automatically if AI consensus is reached."}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <Separator />

                                <PipelineStepsEditor
                                    steps={steps}
                                    jobs={jobs}
                                    jobsLoading={jobsLoading}
                                    onAddStep={handleAddStep}
                                    onAddTransformationStep={handleAddTransformationStep}
                                    onRemoveStep={handleRemoveStep}
                                    onUpdateStep={handleUpdateStep}
                                    onMoveStep={handleMoveStep}
                                    canAddTransformer={canAddTransformer()}
                                    validationError={validationError}
                                />
                            </div>
                        </ScrollArea>
                    </TabsContent>

                    <TabsContent value="preview" className="space-y-4">
                        <ScrollArea className="h-[500px] pr-4">
                            <div className="space-y-6 p-4">
                                <div>
                                    <h3 className="text-sm font-medium mb-2">Pipeline: {pipelineName || 'Untitled Pipeline'}</h3>
                                    {pipelineDescription && (
                                        <p className="text-xs text-muted-foreground mb-4">{pipelineDescription}</p>
                                    )}
                                    <div className="flex items-center gap-2 text-sm">
                                        <span className="text-muted-foreground">Trigger:</span>
                                        <Badge variant="secondary">
                                            {triggerType === 'manual' && <><Mouse className="w-3 h-3 mr-1" />Manual</>}
                                            {triggerType === 'schedule' && <><Calendar className="w-3 h-3 mr-1" />Schedule</>}
                                            {triggerType === 'webhook' && <><WebhookIcon className="w-3 h-3 mr-1" />Webhook</>}
                                        </Badge>
                                    </div>
                                </div>

                                <Separator />

                                {steps.length === 0 ? (
                                    <div className="p-12 border-2 border-dashed rounded-lg text-center">
                                        <GitBranch className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                                        <p className="text-sm text-muted-foreground">No steps to preview</p>
                                        <p className="text-xs text-muted-foreground mt-1">Add steps in the Configuration tab</p>
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        {steps.map((step, index) => {
                                            const selectedJob = jobs.find(j => j.id === step.jobId);
                                            return (
                                                <div key={step.tempId} className="space-y-4">
                                                    <div className="flex items-start gap-4">
                                                        <div className="flex flex-col items-center">
                                                            <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-medium">
                                                                {index + 1}
                                                            </div>
                                                            {index < steps.length - 1 && (
                                                                <ArrowDown className="w-4 h-4 text-muted-foreground my-2" />
                                                            )}
                                                        </div>
                                                        <div className="flex-1">
                                                            <Card>
                                                                <CardContent className="p-4">
                                                                    <div className="space-y-3">
                                                                        <div>
                                                                            <h4 className="font-medium">{selectedJob?.name || 'No job selected'}</h4>
                                                                            <p className="text-xs text-muted-foreground mt-1">
                                                                                Type: {selectedJob?.type || 'N/A'}
                                                                            </p>
                                                                            {step.outputName && (
                                                                                <p className="text-xs text-muted-foreground mt-1">
                                                                                    Output: <code className="bg-muted px-1 py-0.5 rounded">{step.outputName}</code>
                                                                                </p>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                </CardContent>
                                                            </Card>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </ScrollArea>
                    </TabsContent>
                </Tabs>

                <DialogFooter>
                    <Button
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        disabled={createPipelineMutation.isPending || updatePipelineMutation.isPending}
                        data-testid="button-cancel-pipeline"
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={handleSavePipeline}
                        disabled={createPipelineMutation.isPending || updatePipelineMutation.isPending || jobsLoading}
                        data-testid="button-submit-pipeline"
                    >
                        {(createPipelineMutation.isPending || updatePipelineMutation.isPending) && (
                            <span className="mr-2">...</span>
                        )}
                        {editingPipeline ? 'Update Pipeline' : 'Create Pipeline'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

