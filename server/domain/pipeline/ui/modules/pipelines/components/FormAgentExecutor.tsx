import React, { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Card, CardContent } from "@domain-ui/core/ui/components/ui/card";
import { Progress } from "@domain-ui/core/ui/components/ui/progress";
import { Clock, AlertTriangle, X } from "lucide-react";
import { StudioForm } from "@/modules/forms/StudioForm";
import { FormSchema } from "@/types/form-types";
import { safeAsync } from "@shared/utils/errorHandling";

export interface FormAgentExecutorProps {
  jobId: number;
  pipelineExecutionId: string;
  formSchema: FormSchema;
  timeoutMinutes: number;
  onComplete: (formData: Record<string, any>) => void;
  onTimeout: () => void;
  onCancel: () => void;
}

export default function FormAgentExecutor({
  jobId,
  pipelineExecutionId,
  formSchema,
  timeoutMinutes,
  onComplete,
  onTimeout,
  onCancel
}: FormAgentExecutorProps) {
  const { toast } = useToast();
  const [timeRemaining, setTimeRemaining] = useState(timeoutMinutes * 60); // seconds
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Timer countdown
  useEffect(() => {
    if (timeRemaining <= 0) {
      onTimeout();
      return;
    }

    const timer = setInterval(() => {
      setTimeRemaining(prev => prev - 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [timeRemaining, onTimeout]);

  // Submit form mutation
  const submitMutation = useMutation({
    mutationFn: async (formData: Record<string, any>) => {
      const result = await safeAsync(async () => {
        const res = await apiRequest('POST', `/api/form-agents/${jobId}/submit`, {
          pipelineExecutionId,
          formData,
          submittedAt: new Date().toISOString()
        });
        return res.json();
      });

      if (!result.success) {
        throw result.error;
      }
      return result.data;
    },
    onSuccess: (response) => {
      toast({
        title: "Form Submitted",
        description: "Your responses have been recorded and the pipeline will continue.",
      });
      onComplete(response);
    },
    onError: (error: any) => {
      toast({
        title: "Submission Failed",
        description: error.message || "Failed to submit form",
        variant: "destructive",
      });
      setIsSubmitting(false);
    },
    onSettled: () => {
      setIsSubmitting(false);
    }
  });

  const handleSubmit = async (data: Record<string, any>) => {
    setIsSubmitting(true);
    await submitMutation.mutateAsync(data);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getTimeColor = () => {
    if (timeRemaining < 300) return "text-destructive"; // Last 5 minutes
    if (timeRemaining < 600) return "text-amber-600 dark:text-amber-400"; // Last 10 minutes
    return "text-muted-foreground";
  };

  const totalSeconds = timeoutMinutes * 60;
  const progressPercentage = Math.max(0, Math.min(100, (timeRemaining / (totalSeconds || 1)) * 100));

  return (
    <div className="max-w-2xl mx-auto space-y-6" data-testid="form-agent-executor">
      {/* Global Timer Card */}
      <Card className="border-l-4 border-l-primary">
        <CardContent className="pt-4 pb-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-2 bg-primary/10 rounded-full">
              <Clock className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Time Remaining</p>
              <div className="flex items-center gap-2">
                <span className={`text-xl font-bold ${getTimeColor()}`}>
                  {formatTime(timeRemaining)}
                </span>
                {timeRemaining < 300 && (
                  <span className="text-xs text-destructive font-medium flex items-center animate-pulse">
                    <AlertTriangle className="w-3 h-3 mr-1" />
                    Timeout warning
                  </span>
                )}
              </div>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={isSubmitting || submitMutation.isPending}>
            <X className="w-4 h-4 mr-2" />
            Cancel Execution
          </Button>
        </CardContent>
        <Progress value={progressPercentage} className="h-1 rounded-none" />
      </Card>

      {/* Main Unified Form Area */}
      <Card className="p-6">
        <StudioForm
          schema={formSchema}
          onSubmit={handleSubmit}
          submitLabel={isSubmitting || submitMutation.isPending ? "Submitting..." : "Submit Form"}
          disabled={isSubmitting || submitMutation.isPending}
        />
      </Card>
    </div>
  );
}
