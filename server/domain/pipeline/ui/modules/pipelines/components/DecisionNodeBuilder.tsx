/**
 * Decision Node Builder
 * 
 * Main component for building Decision Node configurations with CEL expressions.
 */

import { useEffect } from "react";
import { useForm, useFieldArray, Control, FormProvider } from "react-hook-form";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Plus } from "lucide-react";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { CELConditionBuilder } from './CELConditionBuilder.js';
import { CELExpressionPreview } from './CELExpressionPreview.js';
import { RouteConfiguration } from "@domain-ui/core/ui/components/shared/RouteConfiguration";
import { SafetyPolicyEditor } from "@domain-ui/core/ui/components/shared/SafetyPolicyEditor";
import type { JobOutputSchema } from "@shared/schema/jobs/types";

export interface DecisionNodeConfig {
  evaluationMode: "AND" | "OR";
  conditions: Array<{
    source: string;
    operator: string;
    target: any;
  }>;
  routes: {
    onMatch: {
      destinationStepId: number | null;
      action?: "next_step" | "stop_success" | "stop_failure";
      injectContext?: Record<string, any>;
    };
    onMismatch?: {
      destinationStepId: number | null;
      action?: "next_step" | "stop_success" | "stop_failure";
      injectContext?: Record<string, any>;
    };
  };
  safetyPolicy?: {
    maxLoops: number;
    onLoopLimitExceeded: {
      action: "route_to_fallback" | "abort_workflow";
      destination?: number;
      logReason: string;
    };
    onStagnationDetected: {
      action: "abort_workflow";
      logReason: string;
    };
  };
}

interface Step {
  id: number;
  name?: string;
  order: number;
}

interface DecisionNodeBuilderProps {
  value?: DecisionNodeConfig;
  onChange: (config: DecisionNodeConfig) => void;
  availableSteps: Step[];
  currentStepOrder?: number;
  onCancel?: () => void;
  contextSchema?: JobOutputSchema;
}

export function DecisionNodeBuilder({
  value,
  onChange,
  availableSteps,
  currentStepOrder,
  onCancel,
  contextSchema,
}: DecisionNodeBuilderProps) {
  const { toast } = useToast();

  const defaultConfig: DecisionNodeConfig = {
    evaluationMode: "AND",
    conditions: [
      {
        source: "",
        operator: "EQ",
        target: "",
      }
    ],
    routes: {
      onMatch: { destinationStepId: null },
    },
  };

  const form = useForm<DecisionNodeConfig>({
    defaultValues: value && Object.keys(value).length > 0 ? value : defaultConfig,
  });

  // Sync form with value prop changes
  useEffect(() => {
    const defaultConfig = {
      evaluationMode: "AND" as const,
      conditions: [
        {
          source: "",
          operator: "EQ",
          target: "",
        }
      ],
      routes: {
        onMatch: { destinationStepId: null },
      },
    };

    if (value && Object.keys(value).length > 0) {
      form.reset(value);
    } else {
      form.reset(defaultConfig);
      // Also call onChange to ensure parent has the config
      onChange(defaultConfig);
    }
  }, [value, form, onChange]);

  const { fields, append, remove, replace } = useFieldArray({
    control: form.control,
    name: "conditions",
  });

  // Watch form values for preview
  const watchedConditions = form.watch("conditions");
  const watchedMode = form.watch("evaluationMode");
  const onMatchDestination = form.watch("routes.onMatch.destinationStepId");
  const onMismatchDestination = form.watch("routes.onMismatch.destinationStepId");

  // Ensure at least one condition is always present
  useEffect(() => {
    const currentConditions = form.getValues("conditions");
    if (!currentConditions || currentConditions.length === 0) {
      // If no conditions, add one default using replace to update useFieldArray
      replace([{
        source: "",
        operator: "EQ",
        target: "",
      }]);
    }
  }, [form, replace]);

  // Check for backward loops
  const hasBackwardLoop = () => {
    if (currentStepOrder === undefined) return false;

    // Check onMatch route
    if (onMatchDestination) {
      const destStep = availableSteps.find((s) => s.id === onMatchDestination);
      if (destStep && destStep.order < currentStepOrder) return true;
    }

    // Check onMismatch route
    if (onMismatchDestination) {
      const destStep = availableSteps.find((s) => s.id === onMismatchDestination);
      if (destStep && destStep.order < currentStepOrder) return true;
    }

    return false;
  };

  const handleAddCondition = () => {
    append({
      source: "",
      operator: "EQ",
      target: "",
    });
  };

  // Auto-save on form changes (debounced, for inline editing mode)
  useEffect(() => {
    if (!onCancel) {
      // Inline mode - auto-save on changes
      const subscription = form.watch((value) => {
        // Debounce auto-save
        const timeoutId = setTimeout(() => {
          if (value.routes?.onMatch?.destinationStepId) {
            onChange(value as DecisionNodeConfig);
          }
        }, 500);
        return () => clearTimeout(timeoutId);
      });
      return () => subscription.unsubscribe();
    }
  }, [form, onChange, onCancel]);

  const handleSave = () => {
    const config = form.getValues();

    // Validate
    if (config.conditions.length === 0) {
      toast({
        title: "Validation Error",
        description: "At least one condition is required",
        variant: "destructive",
      });
      return;
    }

    // Validate conditions have all required fields
    const invalidConditions = config.conditions.filter(
      (c) => !c.source || !c.operator || c.target === undefined || c.target === null || c.target === ""
    );
    if (invalidConditions.length > 0) {
      toast({
        title: "Validation Error",
        description: "All conditions must have source, operator, and target values",
        variant: "destructive",
      });
      return;
    }

    // Validate onMatch destination
    const onMatchAction = config.routes.onMatch.action || "next_step";
    if (onMatchAction === "next_step" && !config.routes.onMatch.destinationStepId) {
      toast({
        title: "Validation Error",
        description: "On Match destination step is required when action is Jump to Step",
        variant: "destructive",
      });
      return;
    }

    // Validate safety policy if backward loop detected
    if (hasBackwardLoop() && !config.safetyPolicy) {
      toast({
        title: "Validation Error",
        description: "Safety policy is required when routing to previous steps",
        variant: "destructive",
      });
      return;
    }

    // Validate safety policy completeness
    if (config.safetyPolicy) {
      if (!config.safetyPolicy.maxLoops || config.safetyPolicy.maxLoops < 1) {
        toast({
          title: "Validation Error",
          description: "Max loops must be at least 1",
          variant: "destructive",
        });
        return;
      }

      if (
        config.safetyPolicy.onLoopLimitExceeded.action === "route_to_fallback" &&
        !config.safetyPolicy.onLoopLimitExceeded.destination
      ) {
        toast({
          title: "Validation Error",
          description: "Fallback destination is required when action is 'route_to_fallback'",
          variant: "destructive",
        });
        return;
      }

      if (!config.safetyPolicy.onLoopLimitExceeded.logReason) {
        toast({
          title: "Validation Error",
          description: "Loop limit exceeded log reason is required",
          variant: "destructive",
        });
        return;
      }

      if (!config.safetyPolicy.onStagnationDetected.logReason) {
        toast({
          title: "Validation Error",
          description: "Stagnation detected log reason is required",
          variant: "destructive",
        });
        return;
      }
    }

    onChange(config);
  };

  return (
    <FormProvider {...form}>
      <div className="space-y-6">
        {/* Evaluation Mode */}
        <Card>
          <CardHeader>
            <CardTitle>Evaluation Mode</CardTitle>
            <CardDescription>
              How should multiple conditions be combined?
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4">
              <Button
                type="button"
                variant={watchedMode === "AND" ? "default" : "outline"}
                onClick={() => form.setValue("evaluationMode", "AND")}
              >
                AND (All conditions must be true)
              </Button>
              <Button
                type="button"
                variant={watchedMode === "OR" ? "default" : "outline"}
                onClick={() => form.setValue("evaluationMode", "OR")}
              >
                OR (Any condition can be true)
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Conditions */}
        <Card>
          <CardHeader>
            <CardTitle>Conditions</CardTitle>
            <CardDescription>
              Define the criteria for routing decisions
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {fields.map((field, index) => (
              <CELConditionBuilder
                key={field.id}
                index={index}
                control={form.control as Control<any>}
                onRemove={() => remove(index)}
                contextSchema={contextSchema}
              />
            ))}
            <Button
              type="button"
              variant="outline"
              onClick={handleAddCondition}
              className="w-full"
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Condition
            </Button>
          </CardContent>
        </Card>

        {/* Routing */}
        <RouteConfiguration
          control={form.control as Control<any>}
          availableSteps={availableSteps}
        />

        {/* Safety Policy */}
        <SafetyPolicyEditor
          control={form.control as Control<any>}
          availableSteps={availableSteps}
          showWarning={hasBackwardLoop()}
        />

        {/* Expression Preview */}
        <CELExpressionPreview
          conditions={watchedConditions}
          evaluationMode={watchedMode}
        />

        {/* Actions */}
        <div className="flex justify-end gap-2">
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button type="button" onClick={handleSave}>
            Save Decision Node
          </Button>
        </div>
      </div>
    </FormProvider>
  );
}

