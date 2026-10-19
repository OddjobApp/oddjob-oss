import { Plus, Zap, GitBranch, MoveUp, MoveDown, X, Info, ArrowDown, GripVertical } from 'lucide-react';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Card, CardContent } from '@domain-ui/core/ui/components/ui/card';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@domain-ui/core/ui/components/ui/select';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@domain-ui/core/ui/components/ui/accordion";
import { DecisionNodeBuilder } from './DecisionNodeBuilder.js';
import TransformationJobConfig from "@domain-ui/jobs/ui/modules/jobs/components/TransformationJobConfig";
import { MultiInputMapping } from './MultiInputMapping.js';
import { FormStep, Job } from './types.js';

interface PipelineStepsEditorProps {
    steps: FormStep[];
    jobs: Job[];
    jobsLoading: boolean;
    onAddStep: () => void;
    onAddTransformationStep: () => void;
    onRemoveStep: (stepId: string) => void;
    onUpdateStep: (stepId: string, updates: Partial<FormStep>) => void;
    onMoveStep: (index: number, direction: 'up' | 'down') => void;
    onStepClick?: (index: number) => void;
    selectedStepIndex?: number | null;
    canAddTransformer: boolean;
    validationError: string;
}

export default function PipelineStepsEditor({
    steps,
    jobs,
    jobsLoading,
    onAddStep,
    onAddTransformationStep,
    onRemoveStep,
    onUpdateStep,
    onMoveStep,
    onStepClick,
    selectedStepIndex,
    canAddTransformer,
    validationError,
}: PipelineStepsEditorProps) {

    // Helper function to get available variables for a step
    const getAvailableVariables = (stepIndex: number): string[] => {
        const variables: string[] = [];
        // Pipeline input is always available
        variables.push('{{pipeline.input}}');
        // Previous steps' outputs are available
        for (let i = 0; i < stepIndex; i++) {
            const step = steps[i];
            if (step.outputName) {
                variables.push(`{{step.${i}.${step.outputName}}}`);
            } else {
                variables.push(`{{step.${i}.output}}`);
            }
        }
        return variables;
    };

    // Helper function to get previous step's output schema for transformer jobs
    const getPreviousStepSchema = (stepIndex: number): any => {
        if (stepIndex === 0) return null;
        const previousStep = steps[stepIndex - 1];
        if (!previousStep.jobId) return null;
        const previousJob = jobs.find(j => j.id === previousStep.jobId);
        return previousJob?.outputSchema || null;
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">Pipeline Steps *</h3>
                <div className="flex gap-2">
                    <Button
                        type="button"
                        size="sm"
                        onClick={onAddStep}
                        disabled={jobsLoading}
                        data-testid="button-add-step"
                    >
                        <Plus className="w-4 h-4 mr-2" />
                        Add Step
                    </Button>
                    {canAddTransformer && (
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={onAddTransformationStep}
                            disabled={jobsLoading}
                            data-testid="button-add-transformation-step"
                        >
                            <Zap className="w-4 h-4 mr-2" />
                            Add Transformation Step
                        </Button>
                    )}
                </div>
            </div>

            {jobsLoading && (
                <div className="p-8 border-2 border-dashed rounded-lg text-center">
                    <p className="text-sm text-muted-foreground">Loading available jobs...</p>
                </div>
            )}

            {!jobsLoading && steps.length === 0 && (
                <div className="p-8 border-2 border-dashed rounded-lg text-center">
                    <GitBranch className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">No steps added yet</p>
                    <p className="text-xs text-muted-foreground mt-1">Click "Add Step" to build your pipeline</p>
                </div>
            )}

            <div className="space-y-3">
                {steps.map((step, index) => {
                    const selectedJob = jobs.find(j => j.id === step.jobId);
                    const availableVars = getAvailableVariables(index);
                    const isSelected = selectedStepIndex === index;

                    return (
                        <Card
                            key={step.tempId}
                            className={`cursor-pointer transition-all ${isSelected ? 'ring-2 ring-primary border-primary shadow-md' : 'hover:bg-accent/5'}`}
                            onClick={() => onStepClick?.(index)}
                            data-testid={`step-card-${index}`}
                        >
                            <CardContent className="p-4" onClick={(e) => e.stopPropagation()}>
                                <div className="space-y-4">
                                    {/* Step Header */}
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                                                <span className="text-sm font-medium text-primary">{index + 1}</span>
                                            </div>
                                            <span className="text-sm font-medium">Step {index + 1}</span>
                                            {selectedJob && <span className="text-xs text-muted-foreground">({selectedJob.name})</span>}
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => onMoveStep(index, 'up')}
                                                disabled={index === 0}
                                                data-testid={`button-move-up-${index}`}
                                            >
                                                <MoveUp className="w-4 h-4" />
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => onMoveStep(index, 'down')}
                                                disabled={index === steps.length - 1}
                                                data-testid={`button-move-down-${index}`}
                                            >
                                                <MoveDown className="w-4 h-4" />
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => onRemoveStep(step.tempId)}
                                                data-testid={`button-remove-step-${index}`}
                                            >
                                                <X className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    </div>

                                    {/* Expanded Configuration (only if selected) */}
                                    {isSelected && (
                                        <div className="space-y-4 mt-4 pt-4 border-t animate-in fade-in slide-in-from-top-2 duration-200">
                                            {/* Step Type */}
                                            <div className="space-y-2">
                                                <Label>Step Type</Label>
                                                <Select
                                                    value={step.moduleType || "regular"}
                                                    onValueChange={(value) => {
                                                        if (value === "logic_gatekeeper") {
                                                            onUpdateStep(step.tempId, {
                                                                moduleType: "logic_gatekeeper",
                                                                jobId: null, // Decision Nodes don't need jobs
                                                                decisionNodeConfig: step.decisionNodeConfig || {
                                                                    evaluationMode: "AND",
                                                                    conditions: [{ source: "", operator: "EQ", target: "" }],
                                                                    routes: { onMatch: { destinationStepId: undefined } },
                                                                },
                                                            });
                                                        } else if (value === "transformer") {
                                                            return;
                                                        } else {
                                                            onUpdateStep(step.tempId, {
                                                                moduleType: null,
                                                                decisionNodeConfig: null,
                                                                destinationStepId: null,
                                                            });
                                                        }
                                                    }}
                                                >
                                                    <SelectTrigger data-testid={`select-step-type-${index}`}>
                                                        <SelectValue placeholder="Select step type" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="regular">Regular Step</SelectItem>
                                                        <SelectItem value="logic_gatekeeper">Decision Node</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>

                                            {/* Decision Node Configuration */}
                                            {step.moduleType === "logic_gatekeeper" && (
                                                <div className="mt-4 p-4 border-2 border-primary/30 rounded-lg bg-primary/5">
                                                    <div className="mb-2 flex items-center gap-2">
                                                        <GitBranch className="h-4 w-4 text-primary" />
                                                        <span className="text-sm font-semibold text-primary">Decision Node Configuration</span>
                                                    </div>
                                                    <DecisionNodeBuilder
                                                        value={step.decisionNodeConfig}
                                                        onChange={(config) => onUpdateStep(step.tempId, { decisionNodeConfig: config })}
                                                        availableSteps={steps
                                                            .filter((s) => s.tempId !== step.tempId)
                                                            .map((s, idx) => ({
                                                                id: -idx - 1,
                                                                name: `Step ${idx + 1}`,
                                                                order: s.order
                                                            }))}
                                                        currentStepOrder={step.order}
                                                    />
                                                </div>
                                            )}

                                            {/* Job Selection */}
                                            {step.moduleType !== "logic_gatekeeper" && step.moduleType !== "transformer" && (
                                                <div className="space-y-4">
                                                    <div className="space-y-2">
                                                        <Label>Select Job *</Label>
                                                        {jobs.length === 0 ? (
                                                            <div className="p-3 border border-dashed rounded-md text-sm text-muted-foreground">
                                                                No jobs available.
                                                            </div>
                                                        ) : (
                                                            <Select
                                                                value={step.jobId ? step.jobId.toString() : undefined}
                                                                onValueChange={(value) => {
                                                                    const newJobId = parseInt(value, 10);
                                                                    const selected = jobs.find(j => j.id === newJobId);
                                                                    let transformerConfig = null;
                                                                    if (selected?.type === 'transformer' && selected.config) {
                                                                        transformerConfig = selected.config;
                                                                    }
                                                                    onUpdateStep(step.tempId, { jobId: newJobId, transformerConfig });
                                                                }}
                                                            >
                                                                <SelectTrigger data-testid={`select-job-${index}`}>
                                                                    <SelectValue placeholder="Choose a job to execute" />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    {jobs.map((job) => (
                                                                        <SelectItem key={job.id} value={String(job.id)}>
                                                                            {job.name} ({job.type})
                                                                        </SelectItem>
                                                                    ))}
                                                                </SelectContent>
                                                            </Select>
                                                        )}
                                                    </div>

                                                    {/* Multi-Input Mapping */}
                                                    <Accordion type="single" collapsible className="w-full">
                                                        <AccordionItem value="inputs">
                                                            <AccordionTrigger className="text-sm font-medium py-2">
                                                                Advanced Input Mapping
                                                            </AccordionTrigger>
                                                            <AccordionContent>
                                                                <div className="p-4 bg-muted/40 rounded-lg">
                                                                    <MultiInputMapping
                                                                        value={(step.inputMapping as any) || {}}
                                                                        onChange={(mapping) => onUpdateStep(step.tempId, { inputMapping: mapping })}
                                                                        availableVariables={availableVars}
                                                                        // Future: pass job parameters if we have access to job details/schema
                                                                        jobParameters={[]}
                                                                    />
                                                                </div>
                                                            </AccordionContent>
                                                        </AccordionItem>
                                                    </Accordion>
                                                </div>
                                            )}

                                            {/* Transformer Configuration */}
                                            {(step.moduleType === 'transformer' || selectedJob?.type === 'transformer') && (
                                                <div className="mt-4 p-4 border-2 border-indigo-300 rounded-lg bg-indigo-5">
                                                    <div className="mb-2 flex items-center gap-2">
                                                        <Zap className="h-4 w-4 text-indigo-600" />
                                                        <span className="text-sm font-semibold text-indigo-900">Transformer Configuration</span>
                                                    </div>
                                                    <TransformationJobConfig
                                                        config={step.transformerConfig || selectedJob?.config || { rules: [], inputSource: 'previous_step' }}
                                                        onChange={(config: any) => onUpdateStep(step.tempId, { transformerConfig: config })}
                                                        outputSchema={getPreviousStepSchema(index)}
                                                    />
                                                </div>
                                            )}

                                            {/* Output Name */}
                                            <div className="space-y-2">
                                                <Label htmlFor={`output-name-${index}`}>Output Name</Label>
                                                <Input
                                                    id={`output-name-${index}`}
                                                    placeholder="e.g., description, pricing, data"
                                                    value={step.outputName}
                                                    onChange={(e) => onUpdateStep(step.tempId, { outputName: e.target.value })}
                                                    data-testid={`input-output-name-${index}`}
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    );
                })}
            </div>

            {validationError && (
                <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                    <p className="text-sm text-destructive">{validationError}</p>
                </div>
            )}
        </div>
    );
}
