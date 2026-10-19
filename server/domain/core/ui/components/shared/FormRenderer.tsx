import React, { lazy, Suspense } from "react";
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
import { CheckCircle2, RotateCw, Loader2, Navigation } from "lucide-react";
import { evalComputedFields } from "@domain-ui/core/ui/components/shared/formula";
import { cn } from "@/lib/utils";
import "./FormRenderer.css";

// mapbox-gl is ~1.5MB; only a form with a location field should pay for it.
const LocationPicker = lazy(() => import("./LocationPicker.js").then((m) => ({ default: m.LocationPicker })));

import { fractionDigitsFor } from "./fraction-digits.js";
export { fractionDigitsFor };

// Format a computed field's result for display. A blank result means the formula
// could not be evaluated (evalFormula returns "" on any parse error), so it
// renders as an em dash rather than an empty box that reads as a broken layout.
function formatComputed(v: number | string, format?: "number" | "currency" | "percent" | "text"): string {
  if (v === "" || v === null || v === undefined) return "—";
  if (typeof v === "number") {
    // Thousands separators: a mortgage payment read as "$13082.72" without them.
    if (format === "currency") return v.toLocaleString(undefined, { style: "currency", currency: "USD" });
    if (format === "percent") return `${(Number.isInteger(v) ? v : v.toFixed(1))}%`;
    if (format === "number") return v.toLocaleString(undefined, { maximumFractionDigits: fractionDigitsFor(v) });
    return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
  }
  return String(v ?? "");
}

export interface FormFieldDefinition {
  key: string;
  type: "text" | "number" | "textarea" | "markdown" | "select" | "radio" | "rating" | "boolean" | "computed" | "query" | "location" | "geo" | "date" | "datetime" | "time";
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
  /**
   * For type: "computed" — a formula referencing other field keys, evaluated
   * live as inputs change (field chaining). Supports math (+ - * / %), string
   * concat, and functions (round/min/max/abs/upper/lower/concat/if/…). The result
   * renders read-only and is included in the submitted values.
   * e.g. { key: "tip", type: "computed", label: "Tip", formula: "round(bill * tipPercent / 100, 2)", format: "currency" }
   */
  formula?: string;
  /** Display format for a computed or queried field's result. */
  format?: "number" | "currency" | "percent" | "text";
  /** External API URL for live query fields (fetched via Oddjob governed HTTP connector). */
  url?: string;
  /** Query params for external API. Supports template references like { lat: "{{latitude}}" }. */
  params?: Record<string, any>;
  /** Dotted path into response JSON to extract. */
  jsonPath?: string;
  /** Unit label to display after the queried value (e.g. "°C", "°F", "USD"). */
  unit?: string;
  /** Credential ID to inject from credentials service. */
  credentialId?: number;
  /** Response cache TTL in seconds (default 60). */
  cacheTtlSeconds?: number;
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

// Component for dynamic external HTTP queries (weather, currency, REST APIs)
const QueryFieldRenderer = ({
  field,
  formValues,
  onValueChange,
  context,
}: {
  field: FormFieldDefinition;
  formValues: Record<string, any>;
  onValueChange: (val: any) => void;
  context?: any;
}) => {
  const label = resolveTemplate(field.label, context);
  const description = field.description ? resolveTemplate(field.description, context) : undefined;

  const resolvedParams = React.useMemo(() => {
    const out: Record<string, any> = {};
    if (field.params && typeof field.params === "object") {
      for (const [k, v] of Object.entries(field.params)) {
        if (typeof v === "string") {
          out[k] = resolveTemplate(v, { ...context, ...formValues });
        } else {
          out[k] = v;
        }
      }
    }
    return out;
  }, [field.params, formValues, context]);

  const hasUnresolvedPlaceholders = React.useMemo(() => {
    return Object.values(resolvedParams).some(
      (v) => typeof v === "string" && /\{\{[^}]+\}\}/.test(v)
    );
  }, [resolvedParams]);

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: [
      "/api/integrations/http-connector/query",
      field.url,
      resolvedParams,
      field.jsonPath,
      field.credentialId,
    ],
    queryFn: async () => {
      const res = await fetch("/api/integrations/http-connector/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: field.url,
          params: resolvedParams,
          jsonPath: field.jsonPath,
          credentialId: field.credentialId,
          cacheTtlSeconds: field.cacheTtlSeconds ?? 60,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      return res.json() as Promise<{ success: boolean; data: any; cached?: boolean }>;
    },
    enabled: Boolean(field.url && !hasUnresolvedPlaceholders),
    staleTime: (field.cacheTtlSeconds ?? 60) * 1000,
  });

  const resolvedValue = data?.data;

  React.useEffect(() => {
    if (resolvedValue !== undefined) {
      onValueChange(resolvedValue);
    }
  }, [resolvedValue, onValueChange]);

  const formatDisplay = (val: any) => {
    if (val === undefined || val === null) return "—";
    if (typeof val === "object") {
      return (
        <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
          {Object.entries(val)
            .slice(0, 6)
            .map(([k, v]) => (
              <div key={k} className="rounded bg-muted/60 p-2 border border-border/40">
                <span className="block text-[10px] uppercase font-semibold text-muted-foreground truncate">
                  {k}
                </span>
                <span className="block font-medium text-foreground truncate mt-0.5">
                  {String(v)}
                </span>
              </div>
            ))}
        </div>
      );
    }
    return (
      <span className="text-2xl font-bold tabular-nums text-foreground">
        {formatComputed(val, field.format)}
        {field.unit ? ` ${field.unit}` : ""}
      </span>
    );
  };

  return (
    <div className="rounded-lg border border-border bg-card/60 px-4 py-3 shadow-soft backdrop-blur-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-500 border border-emerald-500/20">
            LIVE API
          </span>
          {data?.cached && (
            <span className="text-[10px] text-muted-foreground">(cached)</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isLoading || isFetching}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors p-1 rounded hover:bg-muted"
          title="Refresh query"
        >
          <RotateCw
            className={cn("h-3.5 w-3.5", (isLoading || isFetching) && "animate-spin text-primary")}
          />
        </button>
      </div>

      {description && (
        <p className="mt-0.5 text-xs text-muted-foreground/80 whitespace-pre-wrap">{description}</p>
      )}

      <div className="mt-2 min-h-[2rem] flex items-center">
        {hasUnresolvedPlaceholders ? (
          <span className="text-xs text-muted-foreground italic">
            Waiting for required input values...
          </span>
        ) : isLoading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span>Fetching live data...</span>
          </div>
        ) : error ? (
          <span className="text-xs text-destructive">{(error as Error).message}</span>
        ) : (
          formatDisplay(resolvedValue)
        )}
      </div>
    </div>
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
  const fieldsList = schema?.fields || [];
  const form = useForm({
    defaultValues: fieldsList.reduce((acc, field, idx) => {
      const fieldKey = (field.key || (field as any).id || (field as any).name || `field_${idx}`) as string;
      const resolvedDefault = field.defaultValue
        ? resolveTemplate(field.defaultValue, context)
        : undefined;

      if (field.type === "boolean") {
        acc[fieldKey] = resolvedDefault === 'true' || false;
      } else if (field.type === "rating") {
        acc[fieldKey] = resolvedDefault ? parseInt(resolvedDefault) : 0;
      } else {
        acc[fieldKey] = resolvedDefault || "";
      }
      return acc;
    }, {} as Record<string, any>),
  });

  // Subscribe to live values so computed (chained) fields re-evaluate as the
  // user types. `values` drives the read-only computed outputs below.
  const values = form.watch();

  // Computed results for the current values, shared by the live display below
  // and the submitted payload, so what the user reads is what gets sent.
  const computed = evalComputedFields(fieldsList, values);

  const handleSubmit = form.handleSubmit(async (data) => {
    // Include computed fields (derived, not editable) in the submitted payload.
    await onSubmit(evalComputedFields(fieldsList, data));
  });

  const primaryColor = themeConfig?.primaryColor || "#4F46E5";

  return (
    <Form {...form}>
      <style>{`.form-renderer-root { --primary-color: ${primaryColor}; }`}</style>
      <form 
        onSubmit={handleSubmit} 
        className="space-y-6 form-renderer-root"
      >
        {fieldsList.map((field, idx) => {
          const fieldKey = (field.key || (field as any).id || (field as any).name || `field_${idx}`) as string;
          const label = resolveTemplate(field.label, context);
          const description = field.description ? resolveTemplate(field.description, context) : undefined;

          // Computed / chained field: read-only, recomputed live from other fields.
          if (field.type === "computed") {
            const result = computed[fieldKey];
            return (
              <div key={fieldKey} className="rounded-lg border border-border bg-muted/40 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
                {description && <p className="mt-0.5 text-xs text-muted-foreground/80 whitespace-pre-wrap">{description}</p>}
                <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{formatComputed(result, field.format)}</p>
              </div>
            );
          }

          // Dynamic query field: fetches external data live through governed HTTP connector
          if (field.type === "query") {
            return (
              <QueryFieldRenderer
                key={fieldKey}
                field={field}
                formValues={values}
                onValueChange={(val) => {
                  form.setValue(fieldKey, val, { shouldValidate: false, shouldDirty: true });
                }}
                context={context}
              />
            );
          }

          return (
            <FormField
              key={fieldKey}
              control={form.control}
              name={fieldKey}
              rules={{
                validate: (val) => {
                  if (!field.required) return true;
                  if (val === undefined || val === null || val === "") return `${label} is required`;
                  if (typeof val === "object") {
                    if (field.type === "location" || field.type === "geo") {
                      if (!val.address && val.lat === undefined) return `${label} is required`;
                    }
                  }
                  return true;
                },
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
                  {field.type === "number" && (
                    <FormControl>
                      <Input
                        type="number"
                        inputMode="decimal"
                        {...formField}
                        placeholder={field.placeholder}
                        disabled={disabled || field.readOnly}
                      />
                    </FormControl>
                  )}
                  {/*
                    Dates were the one obvious field an intake form could not
                    express: agents asked for `type: "date"` (a transaction date
                    on a tip calculator), the schema enum rejected it, and the
                    whole call failed validation with no usable reason. Rendering
                    a native date input is the honest fix — widening the enum
                    without this would have produced a silently blank field.
                  */}
                  {(field.type === "date" || field.type === "datetime" || field.type === "time") && (
                    <FormControl>
                      <Input
                        type={field.type === "datetime" ? "datetime-local" : field.type}
                        {...formField}
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
                                  ? 'bg-muted selected text-foreground shadow-[0_0_15px_rgba(0,0,0,0.5)] transform scale-[1.02]' 
                                  : 'bg-card/40 border-foreground/5 text-muted-foreground hover:border-foreground/10 hover:bg-card/60'
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
                  {(field.type === "location" || field.type === "geo") && (
                    <div className="space-y-2">
                      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading map…</p>}>
                      <FormControl>
                        <LocationPicker
                          value={formField.value}
                          onChange={(loc) => {
                            formField.onChange(loc);
                            if (typeof loc === "object" && loc && "lat" in loc && "lng" in loc) {
                              form.setValue("latitude", loc.lat, { shouldValidate: false, shouldDirty: true });
                              form.setValue("longitude", loc.lng, { shouldValidate: false, shouldDirty: true });
                              if (loc.address) {
                                form.setValue("address", loc.address, { shouldValidate: false, shouldDirty: true });
                              }
                            }
                          }}
                          placeholder={field.placeholder || "Search address, landmark, city, or click on map..."}
                          disabled={disabled || field.readOnly}
                        />
                      </FormControl>
                      </Suspense>
                      {typeof navigator !== "undefined" && "geolocation" in navigator && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
                          onClick={() => {
                            navigator.geolocation.getCurrentPosition(
                              (pos) => {
                                const lat = Number(pos.coords.latitude.toFixed(4));
                                const lng = Number(pos.coords.longitude.toFixed(4));
                                formField.onChange({ lat, lng, address: `${lat}, ${lng}` });
                                form.setValue("latitude", lat, { shouldValidate: false, shouldDirty: true });
                                form.setValue("longitude", lng, { shouldValidate: false, shouldDirty: true });
                              },
                              () => {}
                            );
                          }}
                        >
                          <Navigation className="h-3 w-3 text-primary" />
                          Use My Current Location
                        </Button>
                      )}
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

