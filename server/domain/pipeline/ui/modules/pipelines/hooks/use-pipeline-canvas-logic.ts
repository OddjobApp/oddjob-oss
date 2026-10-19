import { UseFormReturn, UseFieldArrayReturn } from "react-hook-form";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import type { Job } from "@shared/schema/jobs/table";
import { PipelineFormValues } from "@/schemas/pipeline-schemas";

interface UsePipelineCanvasLogicProps {
    form: UseFormReturn<PipelineFormValues>;
    jobs: Job[];
    fields: Record<"id", string>[]; // approximates FieldArrayWithId
    append: UseFieldArrayReturn<PipelineFormValues, "steps", "id">["append"];
    setSelectedStepIndex: (index: number | null) => void;
}

export function usePipelineCanvasLogic({
    form,
    jobs,
    fields,
    append,
    setSelectedStepIndex
}: UsePipelineCanvasLogicProps) {
    const jobsList = Array.isArray(jobs) ? jobs : (jobs as any)?.items || [];
    const { toast } = useToast();
    const queryClient = useQueryClient();

    // Helper function to get previous step's output schema for transformer jobs
    const getPreviousStepSchema = (stepIndex: number): Record<string, unknown> | null => {
        if (stepIndex === 0) return null;
        const steps = form.getValues('steps') || [];
        const previousStep = steps[stepIndex - 1];

        // Handle undefined previous step
        if (!previousStep) return null;

        if (!previousStep.jobId) return null;
        const previousJob = jobsList.find((j: any) => j.id === previousStep.jobId);
        return (previousJob?.outputSchema as Record<string, unknown>) || null;
    };

    // Helper to get the schema of the job associated with the CURRENT step
    const getStepSchema = (stepIndex: number): Record<string, unknown> | null => {
        const steps = form.getValues('steps') || [];
        const step = steps[stepIndex];
        if (!step?.jobId) return null;
        const job = jobsList.find((j: any) => j.id === step.jobId);
        return (job?.outputSchema as Record<string, unknown>) || null;
    };

    // Helper function to check if we can add a transformation step
    const canAddTransformer = (): boolean => {
        const steps = form.getValues('steps') || [];
        if (steps.length === 0) return false; // No previous step
        const lastStep = steps[steps.length - 1];
        if (!lastStep?.jobId) return false;
        const lastJob = jobsList.find((j: any) => j.id === lastStep.jobId);
        return !!lastJob?.outputSchema;
    };

    // Handler for dropping steps from Toolbox
    const handleDropStep = async (type: string, position: { x: number, y: number }, data: { jobId?: number; label?: string }) => {
        let jobId = type === 'job' ? data.jobId : null;
        let moduleType: string | null = type === 'job' ? null : type;

        // If dropping an iterator, we need to create a backing Job for it immediately
        if (type === 'iterator') {
            try {
                const res = await apiRequest('POST', '/api/jobs', {
                    name: `Iterator ${new Date().toLocaleTimeString()}`,
                    type: 'iterator',
                    config: { mode: 'job', concurrency: 1, aggregateOutputs: true },
                    priority: 2,
                    tool: 'None',
                    isHidden: true
                });

                if (res.ok) {
                    const newJob = await res.json();
                    jobId = newJob.id;
                    moduleType = null; // It's a job now, not a generic module
                    queryClient.invalidateQueries({ queryKey: ['/api/jobs'] });
                    toast({
                        title: "Iterator Job Created",
                        description: "Created new iterator job for this step"
                    });
                }
            } catch (e) {
                console.error("Failed to create iterator job", e);
                toast({
                    title: "Error",
                    description: "Failed to create iterator job",
                    variant: "destructive"
                });
                return; // Abort if job creation fails
            }
        }

        const newStep: any = {
            jobId: jobId,
            order: fields.length,
            runOnCondition: 'on_success',
            onFailureAction: 'Stop Pipeline',
            moduleType: moduleType,
            // Visual properties for immediate rendering
            name: data.label || (jobId ? jobsList.find((j: any) => j.id === jobId)?.name : type),
            type: moduleType || (jobId ? jobsList.find((j: any) => j.id === jobId)?.type : 'generic'),
        };

        if (type === 'logic_gatekeeper') {
            newStep.decisionNodeConfig = {
                evaluationMode: "AND",
                conditions: [{ source: "", operator: "EQ", target: "" }],
                routes: { onMatch: { destinationStepId: undefined } },
            };
        }

        append(newStep);

        // Select the new step
        setTimeout(() => setSelectedStepIndex(fields.length), 100);

        toast({
            title: "Step Added",
            description: `Added ${data.label || type} to pipeline`,
        });
    };

    // Handler for manual connections
    const handleConnect = (connection: { source: string | null; target: string | null }) => {
        if (!connection.source || !connection.target) return;
        console.log("Connected", connection);

        // fields has .id which corresponds to the RHF internal ID, which we use as tempId usually
        const sourceIndex = fields.findIndex(f => f.id === connection.source);
        const targetIndex = fields.findIndex(f => f.id === connection.target);

        if (sourceIndex === -1 || targetIndex === -1) return;

        const sourceStep = fields[sourceIndex] as any; // Cast to access custom props if needed, though RHF fields might just be IDs and default values
        const targetStep = fields[targetIndex] as any;

        // Note: 'fields' in RHF only contains id and default values. 
        // To get the actual current values (like name), we might need form.getValues().
        // But for indexing, fields is sufficient.

        toast({
            title: "Connection Created",
            description: `Connected Step ${sourceIndex + 1} to Step ${targetIndex + 1}`,
        });

        // Update form value
        // Use targetStep.id (RHF GUID) as the tempId reference for new/unsaved steps
        form.setValue(`steps.${sourceIndex}.destinationTempId`, targetStep.id);

        // If target has a numeric ID (saved step), ideally we use that, but mix of temp/saved is complex.
        // relying on tempId is safer for the UI session.

        // Also ensure visuals update immediately
        form.trigger();
    };

    // Handler for adding transformation step
    const handleAddTransformationStep = async () => {
        try {
            const pipelineName = form.getValues('name') || 'Pipeline';

            // Create transformer job with empty config but ENABLED extraction
            const transformerJobResponse = await apiRequest('POST', '/api/jobs', {
                name: `Transformer for ${pipelineName}`,
                type: 'transformer',
                config: {
                    rules: [],
                    inputSource: 'previous_step',
                    entityExtraction: {
                        enabled: true, // Enable by default
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

            // Add step with transformer job
            const newStep = {
                jobId: transformerJob.id,
                runOnCondition: 'on_success' as const,
                waitDurationSeconds: 0,
                order: fields.length,
                onFailureAction: 'Stop Pipeline' as const,
                parallelGroup: undefined,
                conditionExpression: undefined,
                moduleType: 'transformer' as const,
                transformerConfig: transformerJob.config,
            };

            append(newStep, { shouldFocus: false });

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

    return {
        getPreviousStepSchema,
        getStepSchema,
        canAddTransformer,
        handleDropStep,
        handleConnect,
        handleAddTransformationStep
    };
}

