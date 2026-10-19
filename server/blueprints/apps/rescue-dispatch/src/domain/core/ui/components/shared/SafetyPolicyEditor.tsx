/**
 * Safety Policy Editor
 * 
 * Component for configuring Loopbane Protocols safety policies.
 */

import { useWatch, Control, useFormContext } from "react-hook-form";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@domain-ui/core/ui/components/ui/select";
import { FormField, FormItem, FormControl } from "@domain-ui/core/ui/components/ui/form";
import { Alert, AlertDescription } from "@domain-ui/core/ui/components/ui/alert";
import { AlertTriangle } from "lucide-react";

interface Step {
  id: number;
  name?: string;
  order: number;
}

interface SafetyPolicyEditorProps {
  control: Control<any>;
  availableSteps: Step[];
  showWarning?: boolean;
}

/**
 * Check if routing creates a backward loop
 */
function hasBackwardLoop(
  currentStepOrder: number,
  destinationStepId: number | null | undefined,
  availableSteps: Step[]
): boolean {
  if (!destinationStepId) return false;
  const destinationStep = availableSteps.find((s) => s.id === destinationStepId);
  if (!destinationStep) return false;
  return destinationStep.order < currentStepOrder;
}

export function SafetyPolicyEditor({
  control,
  availableSteps,
  showWarning = false,
}: SafetyPolicyEditorProps) {
  const { setValue } = useFormContext();
  const maxLoops = useWatch({ control, name: "safetyPolicy.maxLoops" });
  const loopAction = useWatch({ control, name: "safetyPolicy.onLoopLimitExceeded.action" });
  const loopDestination = useWatch({ control, name: "safetyPolicy.onLoopLimitExceeded.destination" });
  const loopReason = useWatch({ control, name: "safetyPolicy.onLoopLimitExceeded.logReason" });
  const stagnationAction = useWatch({ control, name: "safetyPolicy.onStagnationDetected.action" });
  const stagnationReason = useWatch({ control, name: "safetyPolicy.onStagnationDetected.logReason" });

  const getStepLabel = (stepId: number) => {
    const step = availableSteps.find((s) => s.id === stepId);
    if (!step) return `Step ${stepId}`;
    // Ensure name is a string, not an object
    const stepName = typeof step.name === 'string' ? step.name : `Job ${step.id}`;
    return `Step ${step.order + 1}: ${stepName}`;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Safety Policy (Loopbane Protocols)</CardTitle>
        <CardDescription>
          Configure safety mechanisms to prevent infinite loops and stagnant workflows
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {showWarning && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Loop detected: This decision node routes to a previous step. Safety settings are required.
            </AlertDescription>
          </Alert>
        )}

        {/* Protocol A: Cycle Breaker */}
        <div className="space-y-4">
          <FormField
            control={control}
            name="safetyPolicy.maxLoops"
            render={({ field }) => (
              <FormItem>
                <Label>Max Loops (Cycle Breaker)</Label>
                <FormControl>
                  <Input
                    type="number"
                    min="1"
                    placeholder="3"
                    {...field}
                    value={field.value ?? ""}
                    onChange={(e) => field.onChange(parseInt(e.target.value, 10) || 0)}
                  />
                </FormControl>
                <p className="text-xs text-muted-foreground mt-1">
                  Maximum number of times this step can be visited before triggering safety action
                </p>
              </FormItem>
            )}
          />

          <FormField
            control={control}
            name="safetyPolicy.onLoopLimitExceeded.action"
            render={({ field }) => (
              <FormItem>
                <Label>On Loop Limit Exceeded</Label>
                <Select
                  value={field.value || "route_to_fallback"}
                  onValueChange={field.onChange}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="route_to_fallback">Route to Fallback</SelectItem>
                    <SelectItem value="abort_workflow">Abort Workflow</SelectItem>
                  </SelectContent>
                </Select>
              </FormItem>
            )}
          />

          {loopAction === "route_to_fallback" && (
            <FormField
              control={control}
              name="safetyPolicy.onLoopLimitExceeded.destination"
              render={({ field }) => (
                <FormItem>
                  <Label>Fallback Destination</Label>
                  <Select
                    value={field.value ? String(field.value) : undefined}
                    onValueChange={(value) => field.onChange(parseInt(value, 10))}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select fallback step" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {availableSteps.length === 0 ? (
                        <div className="px-2 py-1.5 text-sm text-muted-foreground">No steps available</div>
                      ) : (
                        availableSteps
                          .filter((step) => {
                            // Only filter out null, undefined, or empty string values
                            // Allow 0 as a valid ID
                            if (step.id == null || step.id === undefined) return false;
                            const idStr = String(step.id);
                            return idStr !== ""; // Only exclude actual empty strings
                          })
                          .map((step) => {
                            const idStr = String(step.id);
                            // Double-check we never pass empty string
                            if (idStr === "") return null;
                            return (
                              <SelectItem key={step.id} value={idStr}>
                                {getStepLabel(step.id)}
                              </SelectItem>
                            );
                          })
                          .filter(Boolean) // Remove any null entries
                      )}
                    </SelectContent>
                  </Select>
                </FormItem>
              )}
            />
          )}

          <FormField
            control={control}
            name="safetyPolicy.onLoopLimitExceeded.logReason"
            render={({ field }) => (
              <FormItem>
                <Label>Log Reason</Label>
                <FormControl>
                  <Input
                    placeholder="target_stuck_in_qualification"
                    {...field}
                  />
                </FormControl>
              </FormItem>
            )}
          />
        </div>

        {/* Protocol B: Stagnation Lock */}
        <div className="space-y-4">
          <FormField
            control={control}
            name="safetyPolicy.onStagnationDetected.action"
            render={({ field }) => (
              <FormItem>
                <Label>On Stagnation Detected</Label>
                <Select
                  value={field.value || "abort_workflow"}
                  onValueChange={field.onChange}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="abort_workflow">Abort Workflow</SelectItem>
                  </SelectContent>
                </Select>
              </FormItem>
            )}
          />

          <FormField
            control={control}
            name="safetyPolicy.onStagnationDetected.logReason"
            render={({ field }) => (
              <FormItem>
                <Label>Log Reason</Label>
                <FormControl>
                  <Input
                    placeholder="enrichment_returned_no_new_data"
                    {...field}
                  />
                </FormControl>
              </FormItem>
            )}
          />
        </div>
      </CardContent>
    </Card>
  );
}

