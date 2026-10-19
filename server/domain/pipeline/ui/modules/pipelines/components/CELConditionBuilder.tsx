/**
 * CEL Condition Builder - Form-Based Design
 * 
 * A cleaner, more structured form-based UI for building CEL conditions.
 */

import { useWatch, Control, useFormContext } from "react-hook-form";
import { Card, CardContent, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@domain-ui/core/ui/components/ui/select";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Separator } from "@domain-ui/core/ui/components/ui/separator";
import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage
} from "@domain-ui/core/ui/components/ui/form";
import { Trash2, HelpCircle, Code } from "lucide-react";
import { Alert, AlertDescription } from "@domain-ui/core/ui/components/ui/alert";
import SchemaPathInput from "@domain-ui/core/ui/components/shared/SchemaPathInput";
import { VariableSelector } from "@domain-ui/core/ui/components/shared/VariableSelector";
import type { JobOutputSchema } from "@shared/schema/jobs/types";

// Operator mappings by expression type
const OPERATORS = {
  scalar: [
    { value: "GT", label: "Greater Than (>)" },
    { value: "LT", label: "Less Than (<)" },
    { value: "GTE", label: "Greater Than or Equal (>=)" },
    { value: "LTE", label: "Less Than or Equal (<=)" },
    { value: "EQ", label: "Equals (==)" },
    { value: "NE", label: "Not Equals (!=)" },
  ],
  textual: [
    { value: "EQ", label: "Equals" },
    { value: "NE", label: "Not Equals" },
    { value: "CONTAINS", label: "Contains" },
    { value: "STARTS_WITH", label: "Starts With" },
    { value: "ENDS_WITH", label: "Ends With" },
    { value: "MATCHES", label: "Matches Regex" },
  ],
  set: [
    { value: "HAS", label: "Has (contains item)" },
    { value: "NOT_HAS", label: "Does Not Have" },
  ],
  temporal: [
    { value: "WITHIN_WINDOW", label: "Within Window" },
    { value: "BEFORE", label: "Before" },
    { value: "AFTER", label: "After" },
  ],
  integrity: [
    { value: "MATCHES", label: "Matches Regex" },
  ],
  boolean: [
    { value: "EQ", label: "Is" },
    { value: "NE", label: "Is Not" },
  ],
  semantic: [
    { value: "SEMANTIC_MATCH", label: "Semantic Match (AI)" },
  ],
  // Extended CEL functions
  diff: [
    { value: "DIFF_HAS_CHANGE", label: "Has Change (diff.hasChange)" },
    { value: "DIFF_HAS_CHANGES", label: "Has Any Changes (diff.hasChanges)" },
    { value: "DIFF_CHANGE_COUNT_GT", label: "Change Count > (diff.changeCount)" },
    { value: "DIFF_PERCENTAGE_GT", label: "Percentage Change > (diff.percentageChange)" },
  ],
  list_ops: [
    { value: "LIST_SIZE_GT", label: "List Size > (list.size)" },
    { value: "LIST_SIZE_EQ", label: "List Size == (list.size)" },
    { value: "LIST_CONTAINS", label: "List Contains (list.contains)" },
    { value: "LIST_ANY", label: "Any Item Matches (list.any)" },
    { value: "LIST_ALL", label: "All Items Match (list.all)" },
    { value: "LIST_SUM_GT", label: "Sum > (list.sum)" },
    { value: "LIST_AVG_GT", label: "Average > (list.avg)" },
  ],
};

/**
 * Detect expression type based on operator or schema field type
 */
function detectExpressionType(
  operator: string | undefined,
  sourcePath: string | undefined,
  contextSchema?: JobOutputSchema
): keyof typeof OPERATORS {
  // 1. Check for extended operators first (diff.*, list.*)
  if (operator?.startsWith("DIFF_")) {
    return "diff";
  }
  if (operator?.startsWith("LIST_")) {
    return "list_ops";
  }

  // 2. Try to detect type from schema if source path exists
  if (sourcePath && contextSchema?.schemaDef) {
    const fieldDef = contextSchema.schemaDef[sourcePath];
    if (fieldDef) {
      if (fieldDef.type.includes('array') || sourcePath.endsWith('[]')) {
        return 'set';
      }
      if (fieldDef.type === 'string') {
        return 'textual';
      }
      if (fieldDef.type === 'boolean') {
        return 'boolean';
      }
      if (fieldDef.type === 'number' || fieldDef.type === 'integer') {
        return 'scalar';
      }
    }

    // Fallback: simple path heuristics
    if (sourcePath.endsWith('[]') || sourcePath.includes('[*]')) return 'set';
  }

  // 3. Detect from source path patterns
  if (sourcePath?.startsWith('diff.') || sourcePath?.startsWith('event.diff')) {
    return 'diff';
  }
  if (sourcePath?.includes('.items') || sourcePath?.includes('.list') || sourcePath?.includes('.users')) {
    return 'list_ops';
  }

  // 4. Fallback to operator-based detection
  if (!operator) return 'scalar';

  if (operator === "WITHIN_WINDOW" || operator === "BEFORE" || operator === "AFTER") {
    return "temporal";
  }
  if (operator === "MATCHES" && !operator.includes("CONTAINS")) {
    return "integrity";
  }
  if (operator === "HAS" || operator === "NOT_HAS") {
    return "set";
  }
  if (operator === "CONTAINS" || operator === "STARTS_WITH" || operator === "ENDS_WITH") {
    return "textual";
  }
  if (operator === "SEMANTIC_MATCH") {
    return "semantic";
  }
  return "scalar";
}

interface CELConditionBuilderProps {
  index: number;
  control: Control<any>;
  onRemove: () => void;
  contextSchema?: JobOutputSchema;
}

export function CELConditionBuilder({ index, control, onRemove, contextSchema }: CELConditionBuilderProps) {
  const operator = useWatch({ control, name: `conditions.${index}.operator` });
  const source = useWatch({ control, name: `conditions.${index}.source` });
  const target = useWatch({ control, name: `conditions.${index}.target` });

  // Re-calculate expression type when source or operator changes
  const expressionType = detectExpressionType(operator, source, contextSchema);
  const operators = OPERATORS[expressionType] || OPERATORS.scalar;

  const getPlaceholder = () => {
    switch (expressionType) {
      case "temporal":
        return "7d, 24h, 30m";
      case "integrity":
        return "^[a-z]+@example\\.com$";
      case "set":
        return "premium"; // Single item to check for in list
      case "textual":
        return "some text";
      case "boolean":
        return "true";
      case "semantic":
        return "Is the customer angry?";
      case "diff":
        return "price";
      case "list_ops":
        return "5";
      default:
        return "80, 100";
    }
  };

  const getDescription = () => {
    switch (expressionType) {
      case "temporal":
        return "Time window format: number followed by unit (d=days, h=hours, m=minutes, s=seconds)";
      case "integrity":
        return "Regular expression pattern. Use standard regex syntax.";
      case "set":
        return "Value to check if it matches an item in the list";
      case "textual":
        return "String value for text comparison";
      case "boolean":
        return "Boolean value (true/false)";
      case "semantic":
        return "Describe the condition in natural language (e.g., 'Is the sentiment positive?')";
      case "diff":
        return "Field path to check for changes (e.g., 'price', 'status')";
      case "list_ops":
        return "Numeric value for list comparison, or item to check for";
      default:
        return "Numeric value for comparison";
    }
  };

  return (
    <Card className="border-l-4 border-l-primary">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-medium">
            Condition {index + 1}
          </CardTitle>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRemove}
            className="h-8 w-8 p-0"
            aria-label={`Remove condition ${index + 1}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Source Path Field */}
        <FormField
          control={control}
          name={`conditions.${index}.source`}
          rules={{
            required: "Source path is required",
            pattern: {
              value: /^[a-zA-Z_][a-zA-Z0-9_.]*$/,
              message: "Invalid CEL path format. Use dot notation (e.g., profile.interest_score)"
            }
          }}
          render={({ field, fieldState }) => (
            <FormItem>
              <FormLabel>
                Source Path
                <span className="text-destructive ml-1">*</span>
              </FormLabel>
              <FormControl>
                <div className="relative">
                  <Code className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <SchemaPathInput
                    value={field.value}
                    onChange={field.onChange}
                    placeholder="step.0.output.user.id"
                    schema={contextSchema}
                    className={`pl-9 ${fieldState.error ? "border-destructive" : ""}`}
                  />
                </div>
              </FormControl>
              <FormDescription>
                CEL expression path to the data field. Use dot notation for nested properties.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <Separator />

        {/* Operator Selection */}
        <FormField
          control={control}
          name={`conditions.${index}.operator`}
          rules={{ required: "Operator is required" }}
          render={({ field, fieldState }) => (
            <FormItem>
              <FormLabel>
                Operator
                <span className="text-destructive ml-1">*</span>
              </FormLabel>
              <Select
                value={field.value && field.value !== "" ? field.value : "EQ"}
                onValueChange={field.onChange}
              >
                <FormControl>
                  <SelectTrigger className={fieldState.error ? "border-destructive" : ""}>
                    <SelectValue placeholder="Select operator" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent className="max-h-80">
                  {/* Standard operators */}
                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Comparison</div>
                  {OPERATORS.scalar.map((op) => (
                    <SelectItem key={op.value} value={op.value}>
                      {op.label}
                    </SelectItem>
                  ))}

                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground border-t mt-1 pt-2">Text</div>
                  {OPERATORS.textual.filter(op => !['EQ', 'NE'].includes(op.value)).map((op) => (
                    <SelectItem key={op.value} value={op.value}>
                      {op.label}
                    </SelectItem>
                  ))}

                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground border-t mt-1 pt-2">List/Set</div>
                  {OPERATORS.set.map((op) => (
                    <SelectItem key={op.value} value={op.value}>
                      {op.label}
                    </SelectItem>
                  ))}

                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground border-t mt-1 pt-2">🔄 Change Detection (Diff)</div>
                  {OPERATORS.diff.map((op) => (
                    <SelectItem key={op.value} value={op.value} className="text-blue-600">
                      {op.label}
                    </SelectItem>
                  ))}

                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground border-t mt-1 pt-2">📊 List Operations</div>
                  {OPERATORS.list_ops.map((op) => (
                    <SelectItem key={op.value} value={op.value} className="text-green-600">
                      {op.label}
                    </SelectItem>
                  ))}

                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground border-t mt-1 pt-2">🧠 AI-Powered</div>
                  {OPERATORS.semantic.map((op) => (
                    <SelectItem key={op.value} value={op.value} className="text-purple-600">
                      {op.label}
                    </SelectItem>
                  ))}

                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground border-t mt-1 pt-2">Time</div>
                  {OPERATORS.temporal.map((op) => (
                    <SelectItem key={op.value} value={op.value}>
                      {op.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2 mt-1">
                <Badge
                  variant="outline"
                  className={`text-xs ${expressionType === 'diff' ? 'bg-blue-50 border-blue-200 text-blue-700' :
                      expressionType === 'list_ops' ? 'bg-green-50 border-green-200 text-green-700' :
                        expressionType === 'semantic' ? 'bg-purple-50 border-purple-200 text-purple-700' :
                          ''
                    }`}
                >
                  {expressionType === 'list_ops' ? 'list' : expressionType}
                </Badge>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <HelpCircle className="h-3 w-3" />
                  <span>Type detected from operator</span>
                </div>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />


        <Separator />

        {/* Target Value Field */}
        <FormField
          control={control}
          name={`conditions.${index}.target`}
          rules={{
            required: "Target value is required",
            validate: (value) => {
              if (expressionType === "temporal") {
                const temporalPattern = /^\d+[dhms]$/;
                if (!temporalPattern.test(String(value))) {
                  return "Invalid time window format. Use format like: 7d, 24h, 30m";
                }
              }
              return true;
            }
          }}
          render={({ field, fieldState }) => (
            <FormItem>
              <FormLabel>
                Target Value
                <span className="text-destructive ml-1">*</span>
              </FormLabel>
              <FormControl>
                <div className="flex gap-2">
                  <Input
                    {...field}
                    placeholder={getPlaceholder()}
                    value={field.value ?? ""}
                    onChange={(e) => {
                      const value = e.target.value;
                      // Try to parse as number if it looks numeric (for scalar types)
                      const numValue = expressionType === "scalar" && /^-?\d+\.?\d*$/.test(value)
                        ? parseFloat(value)
                        : value;
                      field.onChange(numValue);
                    }}
                    className={`flex-1 ${fieldState.error ? "border-destructive" : ""}`}
                    aria-invalid={fieldState.error ? "true" : "false"}
                  />
                  <VariableSelector 
                    schema={contextSchema} 
                    onSelect={(variable) => field.onChange(variable)} 
                  />
                </div>
              </FormControl>
              <FormDescription>
                {getDescription()}
              </FormDescription>
              {expressionType === "temporal" && (
                <Alert className="mt-2">
                  <HelpCircle className="h-4 w-4" />
                  <AlertDescription className="text-xs">
                    Examples: <code className="bg-muted px-1 rounded">7d</code> (7 days),
                    <code className="bg-muted px-1 rounded">24h</code> (24 hours),
                    <code className="bg-muted px-1 rounded">30m</code> (30 minutes)
                  </AlertDescription>
                </Alert>
              )}
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Expression Preview (Inline) */}
        <div className="pt-2 border-t">
          <div className="flex items-center gap-2 mb-2">
            <Code className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium text-muted-foreground">Preview</span>
          </div>
          <div className="rounded-md bg-muted p-3 font-mono text-xs">
            {source || "source"} {" "}
            {operator || "EQ"} {" "}
            {target !== undefined && target !== null && target !== "" ? String(target) : "target"}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

