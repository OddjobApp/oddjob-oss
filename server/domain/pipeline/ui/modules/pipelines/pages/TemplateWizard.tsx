
import { useState, useEffect } from 'react';
import { useRoute, useLocation } from 'wouter';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Loader2, ArrowRight, CheckCircle2, Circle, ArrowLeft } from 'lucide-react';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@domain-ui/core/ui/components/ui/card';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import FormRenderer from '@domain-ui/core/ui/components/shared/FormRenderer';
// Import config components
import AIAgentJobConfig from '@domain-ui/jobs/ui/modules/jobs/components/AIAgentJobConfig';
import FolderImportJobConfig from '@domain-ui/jobs/ui/modules/jobs/components/FolderImportJobConfig';
import FileWriterJobConfig from '@domain-ui/jobs/ui/modules/jobs/components/FileWriterJobConfig';
import TransformationJobConfig from '@domain-ui/jobs/ui/modules/jobs/components/TransformationJobConfig';
// Add others as needed...

interface WizardStep {
    id: string; // 'job-INDEX'
    type: 'job';
    title: string;
    description?: string;
    jobData: any; // Template job definition
    status: 'pending' | 'current' | 'completed';
    draftJobId?: number;
}

export default function TemplateWizard() {
    const [, legacyParams] = useRoute('/templates/:id/wizard');
    const [, operationsParams] = useRoute('/operations/templates/:id/wizard');
    const params = operationsParams?.id ? operationsParams : legacyParams;
    const [, setLocation] = useLocation();
    const { toast } = useToast();
    const templateId = params?.id ? parseInt(params.id) : 0;

    const [session, setSession] = useState<{ sessionId: number; pipelineId: number; templateConfig: any } | null>(null);
    const [steps, setSteps] = useState<WizardStep[]>([]);
    const [currentStepIndex, setCurrentStepIndex] = useState(0);
    const [formData, setFormData] = useState<any>({});

    // Initialize Session
    const initSessionMutation = useMutation({
        mutationFn: async () => {
            const res = await apiRequest('POST', `/api/templates/${templateId}/wizard-session`);
            return res.json();
        },
        onSuccess: (data) => {
            setSession(data);

            // Normalize jobs from 'jobs' array or 'steps' array
            let sourceJobs = data.templateConfig.jobs;
            if (!sourceJobs && data.templateConfig.steps) {
                // Extract jobs from steps if they are embedded
                sourceJobs = data.templateConfig.steps
                    .filter((s: any) => s.moduleType === 'job' && s.jobConfig)
                    .map((s: any) => s.jobConfig);
            }

            const jobSteps: WizardStep[] = (sourceJobs || []).map((job: any, idx: number) => ({
                id: `job-${idx}`,
                type: 'job',
                title: job.name || `Job ${idx + 1}`,
                description: `Configure ${job.type} job`,
                jobData: job,
                status: idx === 0 ? 'current' : 'pending'
            }));
            setSteps(jobSteps);
            // Initialize form data with defaults from template
            if (jobSteps.length > 0) {
                setFormData(jobSteps[0].jobData.config || {});
            }
        },
        onError: (err: any) => {
            toast({ title: "Error", description: err.message, variant: "destructive" });
            setLocation('/operations/templates');
        }
    });

    // Create Draft Job
    const createDraftJobMutation = useMutation({
        mutationFn: async (data: any) => {
            const res = await apiRequest('POST', '/api/jobs', {
                ...data,
                lifecycleStatus: 'draft'
            });
            return res.json();
        },
        onSuccess: (job) => {
            // Update step with draft ID
            const newSteps = [...steps];
            newSteps[currentStepIndex].draftJobId = job.id;
            newSteps[currentStepIndex].status = 'completed';

            if (currentStepIndex < steps.length - 1) {
                newSteps[currentStepIndex + 1].status = 'current';
                setCurrentStepIndex(currentStepIndex + 1);
                // Load next form data
                setFormData(newSteps[currentStepIndex + 1].jobData.config || {});
            }
            setSteps(newSteps);
            queryClient.invalidateQueries({ queryKey: ['/api/jobs'] }); // Should filter out anyway but good practice to clear cache
        },
        onError: (err: any) => {
            toast({ title: "Validation Error", description: err.message, variant: "destructive" });
        }
    });

    // Promote Pipeline
    const promoteMutation = useMutation({
        mutationFn: async () => {
            if (!session) return;
            // First we need to link the jobs to the pipeline steps
            // Ideally the backend wizard session creation would have handled the structure, 
            // but for this MVP we might need to manually link them or the backend session already created a shell pipeline.
            // Wait, the backend session created a draft pipeline. 
            // But we created Jobs independently. We need to link them!
            // The template config has 'steps' which reference 'jobs' by ID/Index.
            // We need to construct the pipeline steps linkage.

            // Actually, we should simpler approach:
            // The Wizard creates Jobs.
            // We need to ADD these jobs to the pipeline as steps.

            // Let's iterate and add steps to the pipeline
            const stepLinkPromises = steps.map((step, idx) => {
                const templateStep = session.templateConfig.steps.find((s: any) => s.jobId === step.jobData.id); // Map via template internal ID
                // Fallback if strict mapping missing: assume sequential

                return apiRequest('POST', '/api/pipeline-steps', {
                    pipelineId: session.pipelineId,
                    jobId: step.draftJobId,
                    order: idx, // Simple sequential for now
                    outputName: templateStep?.outputName || `step_${idx + 1}_output`
                });
            });

            await Promise.all(stepLinkPromises);

            // Now promote
            const res = await apiRequest('POST', `/api/pipelines/${session.pipelineId}/promote`);
            return res.json();
        },
        onSuccess: () => {
            toast({ title: "Success", description: "Pipeline created successfully!" });
            setLocation(`/operations/workstreams/${session?.pipelineId}`);
        },
        onError: (err: any) => {
            toast({ title: "Promotion Error", description: err.message, variant: "destructive" });
        }
    });

    useEffect(() => {
        if (templateId && !session) {
            initSessionMutation.mutate();
        }
    }, [templateId]);

    const handleNext = () => {
        const currentStep = steps[currentStepIndex];

        // Prepare Job Data
        const jobData = {
            name: `${currentStep.jobData.name || currentStep.title}`,
            type: currentStep.jobData.type,
            config: formData,
            organizationId: session?.templateConfig.organizationId, // From context really
            // ... other fields
        };

        createDraftJobMutation.mutate(jobData);
    };

    const handleFinish = () => {
        // Create last job then promote
        const currentStep = steps[currentStepIndex];
        const jobData = {
            name: `${currentStep.jobData.name || currentStep.title}`,
            type: currentStep.jobData.type,
            config: formData,
        };

        // We wrap this in a promise chain or just rely on CreateJob success to trigger check
        // Ideally we refactor handleNext to return a promise

        // HACK: for MVP, duplicate logic slightly or make createJobMutation handle "if last step, promote"
        createDraftJobMutation.mutate(jobData, {
            onSuccess: () => {
                promoteMutation.mutate();
            }
        });
    };

    if (initSessionMutation.isPending || !session) {
        return <div className="flex justify-center p-12"><Loader2 className="animate-spin" /></div>;
    }

    const currentStep = steps[currentStepIndex];
    const isLastStep = currentStepIndex === steps.length - 1;

    return (
        <div className="p-6 md:p-12 space-y-8 w-full max-w-full animate-in fade-in duration-500">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold">Build Pipeline: {session.templateConfig.name || "Wizard"}</h1>
                <Button variant="ghost" onClick={() => setLocation('/operations/templates')}>Exit</Button>
            </div>

            {/* Progress Bar */}
            <div className="flex items-center space-x-4 overflow-x-auto pb-4">
                {steps.map((step, idx) => (
                    <div key={idx} className={`flex items-center shrink-0 ${idx === currentStepIndex ? 'text-primary font-bold' : 'text-muted-foreground'}`}>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center border mr-2 
                            ${step.status === 'completed' ? 'bg-primary text-primary-foreground border-primary' :
                                step.status === 'current' ? 'border-primary' : 'border-border'}`}>
                            {step.status === 'completed' ? <CheckCircle2 className="w-5 h-5" /> : idx + 1}
                        </div>
                        <span>{step.title}</span>
                        {idx < steps.length - 1 && <div className="h-[1px] w-8 bg-muted mx-4" />}
                    </div>
                ))}
            </div>

            <Card className="min-h-[500px] flex flex-col">
                <CardHeader>
                    <CardTitle>{currentStep.title}</CardTitle>
                    <CardDescription>{currentStep.description}</CardDescription>
                </CardHeader>
                <CardContent className="flex-1">
                    {/* Dynamic Form Rendering */}
                    {/* In a real app, use the specific config components. For now we can use a generic JSON editor or switch */}
                    {currentStep.jobData.type === 'file_writer' && (
                        <FileWriterJobConfig config={formData} onChange={setFormData} />
                    )}
                    {currentStep.jobData.type === 'folder_import' && (
                        <FolderImportJobConfig config={formData} onChange={setFormData} />
                    )}
                    {/* Fallback for others */}
                    {!['file_writer', 'folder_import'].includes(currentStep.jobData.type) && (
                        <div className="p-4 bg-muted rounded">
                            <pre>{JSON.stringify(formData, null, 2)}</pre>
                            <p className="text-sm text-yellow-600 mt-2">Generic Config Editor (Placeholder)</p>
                            {/* Ideally integration FormRenderer or specific configs */}
                        </div>
                    )}
                </CardContent>
                <CardFooter className="flex justify-between border-t p-6">
                    <Button variant="outline" onClick={() => {
                        if (currentStepIndex > 0) {
                            setCurrentStepIndex(currentStepIndex - 1);
                            setFormData(steps[currentStepIndex - 1].jobData.config);
                        }
                    }} disabled={currentStepIndex === 0}>
                        <ArrowLeft className="mr-2 h-4 w-4" /> Back
                    </Button>

                    {isLastStep ? (
                        <Button onClick={handleFinish} disabled={createDraftJobMutation.isPending || promoteMutation.isPending}>
                            {(createDraftJobMutation.isPending || promoteMutation.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Create Pipeline
                        </Button>
                    ) : (
                        <Button onClick={handleNext} disabled={createDraftJobMutation.isPending}>
                            {createDraftJobMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Next Step <ArrowRight className="ml-2 h-4 w-4" />
                        </Button>
                    )}
                </CardFooter>
            </Card>
        </div>
    );
}

