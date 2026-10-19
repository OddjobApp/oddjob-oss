/**
 * Route Configuration
 * 
 * Component for configuring routing destinations and context injection.
 */

import { useWatch, Control, useFormContext } from "react-hook-form";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@domain-ui/core/ui/components/ui/select";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { FormField, FormItem, FormControl } from "@domain-ui/core/ui/components/ui/form";
import { Plus, Trash2 } from "lucide-react";
import { useState, useEffect } from "react";

interface Step {
  id: number;
  name?: string;
  order: number;
}

interface RouteConfigurationProps {
  control: Control<any>;
  availableSteps: Step[];
}

export function RouteConfiguration({ control, availableSteps }: RouteConfigurationProps) {
  const { setValue } = useFormContext();
  const onMatchAction = useWatch({ control, name: "routes.onMatch.action" });
  const onMismatchAction = useWatch({ control, name: "routes.onMismatch.action" });
  const onMatchDestination = useWatch({ control, name: "routes.onMatch.destinationStepId" });
  const onMismatchDestination = useWatch({ control, name: "routes.onMismatch.destinationStepId" });
  const onMatchContext = useWatch({ control, name: "routes.onMatch.injectContext" }) || {};
  const onMismatchContext = useWatch({ control, name: "routes.onMismatch.injectContext" }) || {};

  const [onMatchContextKeys, setOnMatchContextKeys] = useState<string[]>([]);
  const [onMismatchContextKeys, setOnMismatchContextKeys] = useState<string[]>([]);

  // Initialize context keys from watched values
  useEffect(() => {
    if (onMatchContext && Object.keys(onMatchContext).length > 0) {
      setOnMatchContextKeys(Object.keys(onMatchContext));
    }
  }, []);

  useEffect(() => {
    if (onMismatchContext && Object.keys(onMismatchContext).length > 0) {
      setOnMismatchContextKeys(Object.keys(onMismatchContext));
    }
  }, []);

  const getStepLabel = (stepId: number) => {
    const step = availableSteps.find((s) => s.id === stepId);
    if (!step) return `Step ${stepId}`;
    // Ensure name is a string, not an object
    const stepName = typeof step.name === 'string' ? step.name : `Job ${step.id}`;
    return `Step ${step.order + 1}: ${stepName}`;
  };

  const updateContext = (route: "onMatch" | "onMismatch", key: string, value: string) => {
    const contextPath = `routes.${route}.injectContext` as const;
    const currentContext = route === "onMatch" ? onMatchContext : onMismatchContext;
    const newContext = { ...currentContext, [key]: value };
    setValue(contextPath, newContext);
  };

  const removeContextKey = (route: "onMatch" | "onMismatch", key: string) => {
    const contextPath = `routes.${route}.injectContext` as const;
    const currentContext = route === "onMatch" ? onMatchContext : onMismatchContext;
    const newContext = { ...currentContext };
    delete newContext[key];
    setValue(contextPath, newContext);

    if (route === "onMatch") {
      setOnMatchContextKeys(onMatchContextKeys.filter((k) => k !== key));
    } else {
      setOnMismatchContextKeys(onMismatchContextKeys.filter((k) => k !== key));
    }
  };

  const addContextKey = (route: "onMatch" | "onMismatch") => {
    const newKey = `key${Date.now()}`;
    if (route === "onMatch") {
      setOnMatchContextKeys([...onMatchContextKeys, newKey]);
    } else {
      setOnMismatchContextKeys([...onMismatchContextKeys, newKey]);
    }
    updateContext(route, newKey, "");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Routing</CardTitle>
        <CardDescription>
          Configure where the workflow should route based on condition results
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* On Match Route */}
        <div className="space-y-4">
          <FormField
            control={control}
            name="routes.onMatch.destinationStepId"
            render={({ field }) => (
              <FormItem>
                <Label>On Match (All conditions true)</Label>
                <div className="space-y-2">
                  <Select
                    value={onMatchAction || "next_step"}
                    onValueChange={(val) => {
                      setValue("routes.onMatch.action", val);
                      if (val !== "next_step") {
                        setValue("routes.onMatch.destinationStepId", null);
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select Action" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="next_step">Jump to Step</SelectItem>
                      <SelectItem value="stop_success">Stop Pipeline (Success)</SelectItem>
                      <SelectItem value="stop_failure">Stop Pipeline (Failure)</SelectItem>
                    </SelectContent>
                  </Select>

                  {(onMatchAction === "next_step" || !onMatchAction) && (
                    <Select
                      value={field.value ? String(field.value) : undefined}
                      onValueChange={(value) => field.onChange(parseInt(value, 10))}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select destination step" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {availableSteps.length === 0 ? (
                          <div className="px-2 py-1.5 text-sm text-muted-foreground">No steps available</div>
                        ) : (
                          availableSteps
                            .filter((step) => {
                              if (step.id == null || step.id === undefined) return false;
                              const idStr = String(step.id);
                              return idStr !== "";
                            })
                            .map((step) => {
                              const idStr = String(step.id);
                              if (idStr === "") return null;
                              return (
                                <SelectItem key={step.id} value={idStr}>
                                  {getStepLabel(step.id)}
                                </SelectItem>
                              );
                            })
                            .filter(Boolean)
                        )}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </FormItem>
            )}
          />

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Inject Context (Optional)</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => addContextKey("onMatch")}
              >
                <Plus className="h-3 w-3 mr-1" />
                Add
              </Button>
            </div>
            <div className="space-y-2">
              {onMatchContextKeys.map((key) => (
                <div key={key} className="flex gap-2">
                  <Input
                    placeholder="key"
                    value={key}
                    onChange={(e) => {
                      const newKey = e.target.value;
                      const newKeys = onMatchContextKeys.map((k) => (k === key ? newKey : k));
                      setOnMatchContextKeys(newKeys);
                      const oldValue = onMatchContext[key];
                      if (oldValue !== undefined) {
                        const newContext = { ...onMatchContext };
                        delete newContext[key];
                        newContext[newKey] = oldValue;
                        setValue("routes.onMatch.injectContext", newContext);
                      }
                    }}
                  />
                  <Input
                    placeholder="value"
                    value={onMatchContext[key] || ""}
                    onChange={(e) => updateContext("onMatch", key, e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeContextKey("onMatch", key)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* On Mismatch Route */}
        <div className="space-y-4">
          <FormField
            control={control}
            name="routes.onMismatch.destinationStepId"
            render={({ field }) => (
              <FormItem>
                <Label>On Mismatch (Any condition false) - Optional</Label>
                <div className="space-y-2">
                  <Select
                    value={onMismatchAction || "next_step"}
                    onValueChange={(val) => {
                      setValue("routes.onMismatch.action", val);
                      if (val !== "next_step") {
                        setValue("routes.onMismatch.destinationStepId", null);
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select Action" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="next_step">Jump to Step</SelectItem>
                      <SelectItem value="stop_success">Stop Pipeline (Success)</SelectItem>
                      <SelectItem value="stop_failure">Stop Pipeline (Failure)</SelectItem>
                    </SelectContent>
                  </Select>

                  {(onMismatchAction === "next_step" || !onMismatchAction) && (
                    <Select
                      value={field.value ? String(field.value) : "none"}
                      onValueChange={(value) => field.onChange(value === "none" ? undefined : parseInt(value, 10))}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select destination step (optional)" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">None (use onMatch route)</SelectItem>
                        {availableSteps.length === 0 ? (
                          <div className="px-2 py-1.5 text-sm text-muted-foreground">No steps available</div>
                        ) : (
                          availableSteps
                            .filter((step) => {
                              if (step.id == null || step.id === undefined) return false;
                              const idStr = String(step.id);
                              return idStr !== "";
                            })
                            .map((step) => {
                              const idStr = String(step.id);
                              if (idStr === "") return null;
                              return (
                                <SelectItem key={step.id} value={idStr}>
                                  {getStepLabel(step.id)}
                                </SelectItem>
                              );
                            })
                            .filter(Boolean)
                        )}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </FormItem>
            )}
          />

          {onMismatchDestination && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>Inject Context (Optional)</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => addContextKey("onMismatch")}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add
                </Button>
              </div>
              <div className="space-y-2">
                {onMismatchContextKeys.map((key) => (
                  <div key={key} className="flex gap-2">
                    <Input
                      placeholder="key"
                      value={key}
                      onChange={(e) => {
                        const newKey = e.target.value;
                        const newKeys = onMismatchContextKeys.map((k) => (k === key ? newKey : k));
                        setOnMismatchContextKeys(newKeys);
                        const oldValue = onMismatchContext[key];
                        if (oldValue !== undefined) {
                          const newContext = { ...onMismatchContext };
                          delete newContext[key];
                          newContext[newKey] = oldValue;
                          setValue("routes.onMismatch.injectContext", newContext);
                        }
                      }}
                    />
                    <Input
                      placeholder="value"
                      value={onMismatchContext[key] || ""}
                      onChange={(e) => updateContext("onMismatch", key, e.target.value)}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeContextKey("onMismatch", key)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

