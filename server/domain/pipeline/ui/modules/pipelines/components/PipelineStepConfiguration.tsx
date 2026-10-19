import React from "react";
import { UseFormReturn, FieldArrayWithId } from "react-hook-form";
import { z } from "zod";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { FormField, FormItem, FormLabel, FormControl, FormDescription, FormMessage } from "@domain-ui/core/ui/components/ui/form";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@domain-ui/core/ui/components/ui/select";
import { GitBranch, Database } from "lucide-react";
import { MoveUp, MoveDown, Trash2 } from "lucide-react";
import { DecisionNodeBuilder } from './DecisionNodeBuilder.js';
import TransformationJobConfig from "@domain-ui/jobs/ui/modules/jobs/components/TransformationJobConfig";
import { StepKnowledgeGraphConfig } from "@domain-ui/knowledge/ui/components/knowledge/StepKnowledgeGraphConfig";
import type { Job } from "@shared/schema/jobs/table";

// Define schema locally for now
const PipelineCreateSchema = z.object({
    name: z.string().min(3, 'Name is required').max(100),
    description: z.string().optional(),
    triggerType: z.enum(['manual', 'schedule', 'webhook', 'event']).default('manual'),
    triggerCredentialId: z.number().int().positive().optional().nullable(),
    eventConfig: z.object({
        eventType: z.string().optional(),
        filterCondition: z.string().optional()
    }).optional(),
    webhookConfig: z.object({
        verificationMode: z.enum(['none', 'hmac', 'header_token']).default('none'),
        verificationConfig: z.string().optional(),
        mapPayload: z.boolean().default(false),
        payloadMapping: z.string().optional(),
    }).optional(),
    isActive: z.boolean().default(true),
    monthlyBudgetUsd: z.number().min(0).optional().nullable(),
    labels: z.array(z.string()).optional(),
    steps: z.array(z.any()).optional(),
});

type PipelineFormValues = z.infer<typeof PipelineCreateSchema>;

// Type for step field from react-hook-form field array
type StepField = FieldArrayWithId<PipelineFormValues, "steps", "id">;

interface PipelineStepConfigurationProps {
    form: UseFormReturn<PipelineFormValues>;
    jobs: Job[];
    selectedStepIndex: number | null;
    onSelectedStepChange: (index: number | null) => void;
    move: (from: number, to: number) => void;
    remove: (index: number) => void;
    fields: StepField[];
    getPreviousStepSchema: (stepIndex: number) => Record<string, unknown> | null;
    getStepSchema: (stepIndex: number) => Record<string, unknown> | null;
}

const CONDITION_TYPES = [
    { value: 'on_success', label: 'On Success' },
    { value: 'on_failure', label: 'On Failure' },
    { value: 'always', label: 'Always' },
];

const FAILURE_ACTION_TYPES = [
    { value: 'Stop Pipeline', label: 'Stop Pipeline' },
    { value: 'Continue to Next', label: 'Continue to Next Step' },
    { value: 'Execute Fallback Job', label: 'Execute Fallback Activity' },
];

export default function PipelineStepConfiguration({
    form,
    jobs,
    selectedStepIndex,
    onSelectedStepChange,
    move,
    remove,
    fields,
    getPreviousStepSchema,
    getStepSchema
}: PipelineStepConfigurationProps) {
    if (selectedStepIndex === null || !fields[selectedStepIndex]) {
        return null;
    }

    const index = selectedStepIndex;
    const field = fields[index];
    const moduleType = form.watch(`steps.${index}.moduleType` as any);

    return (
        <div className="space-y-6">
            {/* Move/Remove Controls */}
            <div className="flex justify-between items-center bg-muted/40 p-2 rounded-md">
                <div className="flex gap-2">
                    <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => move(index, index - 1)}
                        disabled={index === 0}
                    >
                        <MoveUp className="h-4 w-4" />
                    </Button>
                    <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => move(index, index + 1)}
                        disabled={index === fields.length - 1}
                    >
                        <MoveDown className="h-4 w-4" />
                    </Button>
                </div>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-red-500 hover:text-red-600 hover:bg-red-50"
                    onClick={() => {
                        remove(index);
                        onSelectedStepChange(null);
                    }}
                >
                    <Trash2 className="h-4 w-4 mr-2" /> Remove Step
                </Button>
            </div>

            {/* Step Type Selector */}
            <FormField
                control={form.control}
                name={`steps.${index}.moduleType` as any}
                render={({ field }) => (
                    <FormItem>
                        <FormLabel>Step Type</FormLabel>
                        <Select
                            value={field.value || "regular"}
                            onValueChange={(value) => {
                                if (value === "logic_gatekeeper") {
                                    field.onChange("logic_gatekeeper");
                                    form.setValue(`steps.${index}.jobId` as any, null);
                                    form.setValue(`steps.${index}.decisionNodeConfig` as any, {
                                        evaluationMode: "AND",
                                        conditions: [{ source: "", operator: "EQ", target: "" }],
                                        routes: { onMatch: { destinationStepId: undefined } },
                                    });
                                } else if (value === "transformer") {
                                    // Manual selection not main way, but supported if they want
                                    return;
                                } else {
                                    field.onChange(null);
                                    form.setValue(`steps.${index}.decisionNodeConfig` as any, null);
                                    form.setValue(`steps.${index}.destinationStepId` as any, null);
                                }
                            }}
                        >
                            <FormControl>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select step type" />
                                </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                                <SelectItem value="regular">Regular Step</SelectItem>
                                <SelectItem value="logic_gatekeeper">Decision Node</SelectItem>
                            </SelectContent>
                        </Select>
                    </FormItem>
                )}
            />

            {/* Regular Step Configuration */}
            {(!moduleType || moduleType === "regular") && (
                <>
                    {/* Job Selection */}
                    <FormField
                        control={form.control}
                        name={`steps.${index}.jobId` as any}
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Activity</FormLabel>
                                <Select
                                    value={field.value?.toString() || ""}
                                    onValueChange={(value) => field.onChange(value === "" ? null : parseInt(value))}
                                >
                                    <FormControl>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select an activity" />
                                        </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                        {jobs.map((job) => (
                                            <SelectItem key={job.id} value={job.id.toString()}>
                                                {job.name} ({job.type})
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <FormMessage />
                            </FormItem>
                        )}
                    />

                    {/* Step Configuration Fields */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <FormField
                            control={form.control}
                            name={`steps.${index}.runOnCondition` as any}
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Run On Condition</FormLabel>
                                    <Select value={field.value} onValueChange={field.onChange}>
                                        <FormControl>
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            {CONDITION_TYPES.map(t => (
                                                <SelectItem key={t.value} value={t.value}>
                                                    {t.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name={`steps.${index}.waitDurationSeconds` as any}
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Wait Duration (seconds)</FormLabel>
                                    <FormControl>
                                        <Input
                                            type="number"
                                            {...field}
                                            value={field.value || ''}
                                            onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name={`steps.${index}.outputName` as any}
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Output Name (Optional)</FormLabel>
                                    <FormControl>
                                        <Input {...field} placeholder="Custom name for this step's output" />
                                    </FormControl>
                                    <FormDescription>
                                        Custom name for referencing this step's output in later steps
                                    </FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name={`steps.${index}.onFailureAction` as any}
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>On Failure Action</FormLabel>
                                    <Select value={field.value} onValueChange={field.onChange}>
                                        <FormControl>
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            {FAILURE_ACTION_TYPES.map(t => (
                                                <SelectItem key={t.value} value={t.value}>
                                                    {t.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        {/* Fallback Activity — only relevant when On Failure Action is "Execute Fallback Job" */}
                        {form.watch(`steps.${index}.onFailureAction` as any) === 'Execute Fallback Job' && (
                            <FormField
                                control={form.control}
                                name={`steps.${index}.fallbackJobId` as any}
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Fallback Activity</FormLabel>
                                        <Select
                                            value={field.value?.toString() || ""}
                                            onValueChange={(value) => field.onChange(value === "" ? null : parseInt(value))}
                                        >
                                            <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Select a fallback activity" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                {jobs.map((job) => (
                                                    <SelectItem key={job.id} value={job.id.toString()}>
                                                        {job.name} ({job.type})
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <FormDescription>
                                            Runs if this step fails. On success the failure is recovered and the pipeline continues; on failure the pipeline stops.
                                        </FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        )}
                    </div>

                    {/* Advanced Options */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <FormField
                            control={form.control}
                            name={`steps.${index}.parallelGroup` as any}
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Parallel Group (Optional)</FormLabel>
                                    <FormControl>
                                        <Input {...field} placeholder="Group name for parallel execution" />
                                    </FormControl>
                                    <FormDescription>
                                        Steps with the same group name will run in parallel
                                    </FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name={`steps.${index}.conditionExpression` as any}
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Condition Expression (Optional)</FormLabel>
                                    <FormControl>
                                        <Input {...field} placeholder="{{step.0.output}} == 'success'" />
                                    </FormControl>
                                    <FormDescription>
                                        Custom condition expression for advanced logic
                                    </FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </div>

                    {getStepSchema(index) && (
                        <div className="border rounded-lg p-4">
                            <StepKnowledgeGraphConfig
                                stepIndex={index}
                                outputSchema={getStepSchema(index)}
                            />
                        </div>
                    )}
                </>
            )}

            {/* Decision Node Configuration */}
            {moduleType === "logic_gatekeeper" && (
                <div className="p-4 border border-primary/20 rounded-lg bg-primary/5">
                    <div className="mb-2 flex items-center gap-2">
                        <GitBranch className="h-4 w-4 text-primary" />
                        <span className="text-sm font-semibold text-primary">Decision Node Configuration</span>
                    </div>
                    <DecisionNodeBuilder
                        value={form.watch(`steps.${index}.decisionNodeConfig` as any)}
                        onChange={(config) => {
                            form.setValue(`steps.${index}.decisionNodeConfig` as any, config);
                        }}
                        availableSteps={fields.filter((_, idx) => idx !== index)}
                    />
                </div>
            )}

            {/* Transformer Configuration */}
            {moduleType === "transformer" && (
                <div className="border rounded-lg p-4">
                    <TransformationJobConfig
                        config={form.watch(`steps.${index}.transformerConfig` as any) || { rules: [], inputSource: "previous_step" }}
                        onChange={(config) => form.setValue(`steps.${index}.transformerConfig` as any, config)}
                        outputSchema={getStepSchema(index)}
                    />
                </div>
            )}
        </div>
    );
}
