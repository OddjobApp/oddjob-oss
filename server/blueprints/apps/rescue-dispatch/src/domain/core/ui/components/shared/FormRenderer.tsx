import React from "react";
import { useForm } from "react-hook-form";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@domain-ui/core/ui/components/ui/form";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@domain-ui/core/ui/components/ui/select";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Switch } from "@domain-ui/core/ui/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@domain-ui/core/ui/components/ui/radio-group";
import { Label } from "@domain-ui/core/ui/components/ui/label";

import { useQuery } from "@tanstack/react-query";
import { MarkdownEditor } from "@domain-ui/core/ui/components/shared/MarkdownEditor";
import { StarRating } from "@domain-ui/core/ui/components/shared/StarRating";
import { CheckCircle2 } from "lucide-react";
import "./FormRenderer.css";

export interface FormFieldDefinition {
  key: string;
  type: "text" | "textarea" | "markdown" | "select" | "radio" | "rating" | "boolean";
  label: string;
  description?: string;
  required?: boolean;
  options?: string[] | Array<{ label: string; value: string }>; // Enhanced for label/value pairs
  placeholder?: string;
  max?: number;
  defaultValue?: string;
  readOnly?: boolean;
  dataSourceType?: "static" | "dynamic_kg";
  kgEntityType?: string;
  source?: string; // e.g. "jira:priority" or "jira:customfield_10014"
}

export interface FormSchema {
  fields: FormFieldDefinition[];
}

interface FormRendererProps {
  schema: FormSchema;
  onSubmit: (data: Record<string, any>) => void | Promise<void>;
  submitLabel?: string;
  themeConfig?: {
    primaryColor?: string;
    companyName?: string;
    logoUrl?: string;
  };
  disabled?: boolean;
  context?: any;
}

// Simple mustache-like template resolver: {{ var.path }}
const resolveTemplate = (template: string, context: any): string => {
  if (!template || typeof template !== 'string') return template;
  if (!context) return template;

  return template.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
    const keys = path.trim().split('.');
    let value = context;
    for (const key of keys) {
      if (value === undefined || value === null) return '';
      value = value[key];
    }
    return value !== undefined && value !== null ? String(value) : '';
  });
};

// Helper component for dynamic/static select
const SmartSelect = ({
  field,
  value,
  onChange,
  disabled
}: {
  field: FormFieldDefinition,
  value: string,
  onChange: (val: string) => void,
  disabled?: boolean
}) => {
  const isDynamicKg = !!(field.dataSourceType === "dynamic_kg" && field.kgEntityType);
  const isSaasDynamic = !!(field.source && field.source.includes(":"));
  const saasParts = isSaasDynamic ? field.source!.split(":") : [];
  const saasPlatform = saasParts[0];
  const saasFieldId = saasParts[1];

  const { data: dynamicOptionsKg, isLoading: isKgLoading } = useQuery({
    queryKey: [`/api/knowledge-graph/entities/options`, field.kgEntityType],
    queryFn: async () => {
      const res = await fetch(`/api/knowledge-graph/entities/options?type=${field.kgEntityType}`);
      if (!res.ok) throw new Error("Failed to fetch options");
      return res.json() as Promise<Array<{ label: string; value: string }>>;
    },
    enabled: !!isDynamicKg,
    staleTime: 5 * 60 * 1000 // Cache for 5 minutes
  });

  const { data: dynamicOptionsSaas, isLoading: isSaasLoading } = useQuery({
    queryKey: [`/api/saas/connectors/${saasPlatform}/schema-snapshots`],
    queryFn: async () => {
      const res = await fetch(`/api/saas/connectors/${saasPlatform}/schema-snapshots`);
      if (!res.ok) throw new Error("Failed to fetch saas snapshots");
      const snapshots = await res.json() as Array<{ fields: any[] }>;
      if (!snapshots || snapshots.length === 0) return [];
      
      const latestSnapshot = snapshots[0];
      const targetField = latestSnapshot.fields?.find(f => f.id === saasFieldId || f.key === saasFieldId || f.name?.toLowerCase() === saasFieldId?.toLowerCase());
      
      if (!targetField) return [];
      
      // JIRA custom field options are usually in allowedValues
      const allowedValues = targetField.allowedValues || [];
      return allowedValues.map((av: any) => ({
        label: av.value || av.name || av.label || String(av),
        value: av.id || av.value || av.name || String(av)
      }));
    },
    enabled: !!isSaasDynamic,
    staleTime: 5 * 60 * 1000 // Cache for 5 minutes
  });

  const isLoading = isKgLoading || isSaasLoading;
  
  const options = isDynamicKg 
    ? (dynamicOptionsKg || []).map(o => o.value)
    : isSaasDynamic
    ? (dynamicOptionsSaas || []).map((o: any) => o.value)
    : (field.options || []);

  const getLabel = (val: string) => {
    if (isDynamicKg && dynamicOptionsKg) {
      const found = dynamicOptionsKg.find(o => o.value === val);
      return found ? found.label : val;
    }
    if (isSaasDynamic && dynamicOptionsSaas) {
      const found = (dynamicOptionsSaas as any[]).find(o => o.value === val);
      return found ? found.label : val;
    }
    return val;
  };

  return (
    <Select
      onValueChange={onChange}
      value={value}
      disabled={disabled || isLoading}
    >
      <SelectTrigger>
        <SelectValue placeholder={field.placeholder || (isLoading ? "Loading..." : "Select...")} />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt: any) => {
          const optionValue = typeof opt === 'string' ? opt : opt.value;
          const optionLabel = typeof opt === 'string' ? opt : opt.label;
          return (
            <SelectItem key={optionValue} value={optionValue}>
              {(isDynamicKg || isSaasDynamic) ? getLabel(optionValue) : optionLabel}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
};

export default function FormRenderer({
  schema,
  onSubmit,
  submitLabel = "Submit",
  themeConfig,
  disabled = false,
  context = {},
}: FormRendererProps) {
  const form = useForm({
    defaultValues: schema.fields.reduce((acc, field) => {
      const resolvedDefault = field.defaultValue
        ? resolveTemplate(field.defaultValue, context)
        : undefined;

      if (field.type === "boolean") {
        acc[field.key] = resolvedDefault === 'true' || false;
      } else if (field.type === "rating") {
        acc[field.key] = resolvedDefault ? parseInt(resolvedDefault) : 0;
      } else {
        acc[field.key] = resolvedDefault || "";
      }
      return acc;
    }, {} as Record<string, any>),
  });

  const handleSubmit = form.handleSubmit(async (data) => {
    await onSubmit(data);
  });

  const primaryColor = themeConfig?.primaryColor || "#4F46E5";

  return (
    <Form {...form}>
      <style>{`.form-renderer-root { --primary-color: ${primaryColor}; }`}</style>
      <form 
        onSubmit={handleSubmit} 
        className="space-y-6 form-renderer-root"
      >
        {schema.fields.map((field) => {
          const label = resolveTemplate(field.label, context);
          const description = field.description ? resolveTemplate(field.description, context) : undefined;

          return (
            <FormField
              key={field.key}
              control={form.control}
              name={field.key}
              rules={{
                required: field.required
                  ? `${label} is required`
                  : undefined,
              }}
              render={({ field: formField }) => (
                <FormItem>
                  <FormLabel>
                    {label}
                    {field.required && (
                      <span className="text-red-500 ml-1">*</span>
                    )}
                  </FormLabel>
                  {description && (
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{description}</p>
                  )}
                  {field.type === "text" && (
                    <FormControl>
                      <Input
                        {...formField}
                        placeholder={field.placeholder}
                        disabled={disabled || field.readOnly}
                      />
                    </FormControl>
                  )}
                  {field.type === "textarea" && (
                    <FormControl>
                      <Textarea
                        {...formField}
                        placeholder={field.placeholder}
                        disabled={disabled || field.readOnly}
                        rows={4}
                      />
                    </FormControl>
                  )}
                  {field.type === "markdown" && (
                    <FormControl>
                      <MarkdownEditor
                        value={formField.value}
                        onChange={formField.onChange}
                        placeholder={field.placeholder}
                        disabled={disabled || field.readOnly}
                      />
                    </FormControl>
                  )}
                  {field.type === "select" && (
                    <FormControl>
                      <SmartSelect
                        field={field}
                        value={formField.value}
                        onChange={formField.onChange}
                        disabled={disabled || field.readOnly}
                      />
                    </FormControl>
                  )}
                  {field.type === "radio" && (
                    <FormControl>
                      <RadioGroup
                        onValueChange={formField.onChange}
                        value={formField.value}
                        className="grid grid-cols-1 sm:grid-cols-2 gap-3"
                        disabled={disabled || field.readOnly}
                      >
                        {(field.options || []).map((opt) => {
                          const optionValue = typeof opt === 'string' ? opt : opt.value;
                          const optionLabel = typeof opt === 'string' ? opt : opt.label;
                          const isSelected = formField.value === optionValue;
                          
                          return (
                            <button 
                              key={optionValue}
                              type="button"
                              className={`relative flex items-center justify-center p-4 rounded-xl border-2 cursor-pointer transition-all duration-200 text-sm font-bold uppercase tracking-wider form-renderer-radio-button
                                ${isSelected 
                                  ? 'bg-slate-800 selected text-white shadow-[0_0_15px_rgba(0,0,0,0.5)] transform scale-[1.02]' 
                                  : 'bg-slate-900/40 border-white/5 text-slate-500 hover:border-white/10 hover:bg-slate-900/60'
                                }`}
                              onClick={() => !disabled && !field.readOnly && formField.onChange(optionValue)}
                            >
                              <RadioGroupItem 
                                value={optionValue} 
                                id={`${field.key}-${optionValue}`}
                                className="sr-only" 
                              />
                              {isSelected && <CheckCircle2 className="w-4 h-4 mr-2 check-circle-icon" />}
                              {optionLabel}
                            </button>
                          );
                        })}
                      </RadioGroup>
                    </FormControl>
                  )}
                  {field.type === "rating" && (
                    <FormControl>
                      <StarRating
                        value={Number(formField.value)}
                        onChange={(val) => formField.onChange(val)}
                        max={field.max || 5}
                        disabled={disabled || field.readOnly}
                      />
                    </FormControl>
                  )}
                  {field.type === "boolean" && (
                    <div className="flex items-center space-x-2">
                      <Switch
                        checked={formField.value}
                        onCheckedChange={formField.onChange}
                        disabled={disabled || field.readOnly}
                      />
                      <Label className="text-sm text-muted-foreground">
                        {formField.value ? "Yes" : "No"}
                      </Label>
                    </div>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
          );
        })}

        <Button
          type="submit"
          disabled={disabled}
          className="w-full form-renderer-submit-button"
        >
          {submitLabel}
        </Button>
      </form>
    </Form>
  );
}

