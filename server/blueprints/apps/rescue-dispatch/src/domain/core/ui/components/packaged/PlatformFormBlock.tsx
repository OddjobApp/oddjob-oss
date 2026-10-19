import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card.js';
import { Button } from '../ui/button.js';
import { Input } from '../ui/input.js';
import { Label } from '../ui/label.js';
import { Textarea } from '../ui/textarea.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select.js';
import { Checkbox } from '../ui/checkbox.js';
import { Switch } from '../ui/switch.js';
import { Badge } from '../ui/badge.js';
import { Skeleton } from '../ui/skeleton.js';
import { CheckCircle, Loader2, Send, RotateCcw } from "lucide-react";

interface FormField {
  id: string;
  type: "text" | "textarea" | "number" | "email" | "select" | "checkbox" | "switch" | "date" | "url";
  label: string;
  placeholder?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
    message?: string;
  };
}

interface FormSchema {
  id: number;
  name: string;
  fields: FormField[];
  submitLabel?: string;
}

interface PlatformFormBlockProps {
  formId: number;
  prefillCollection?: string;
  prefillRecordId?: string;
  successMessage?: string;
  title?: string;
  onSubmit?: (data: Record<string, any>) => void;
  onSuccess?: (response: any) => void;
}

export default function PlatformFormBlock({
  formId,
  prefillCollection,
  prefillRecordId,
  successMessage = "Form submitted successfully!",
  title,
  onSubmit,
  onSuccess,
}: PlatformFormBlockProps) {
  const [formSchema, setFormSchema] = useState<FormSchema | null>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchFormSchema();
  }, [formId]);

  useEffect(() => {
    if (prefillCollection && prefillRecordId) {
      fetchPrefillData();
    }
  }, [prefillCollection, prefillRecordId]);

  const fetchFormSchema = async () => {
    try {
      const res = await fetch(`/api/oddjob/forms/${formId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setFormSchema(data.form ?? data);
      
      // Initialize form data with defaults
      const initialData: Record<string, any> = {};
      (data.form?.fields ?? data.fields ?? []).forEach((field: FormField) => {
        if (field.type === "checkbox" || field.type === "switch") {
          initialData[field.id] = false;
        } else {
          initialData[field.id] = "";
        }
      });
      setFormData(initialData);
    } catch (e: any) {
      setError(e.message || "Failed to load form");
    } finally {
      setLoading(false);
    }
  };

  const fetchPrefillData = async () => {
    try {
      const res = await fetch(`/api/oddjob/datasets/${prefillCollection}/records/${prefillRecordId}`);
      if (res.ok) {
        const record = await res.json();
        setFormData(prev => ({ ...prev, ...record }));
      }
    } catch (e) {
      console.error("Failed to load prefill data:", e);
    }
  };

  const validateField = (field: FormField, value: any): string | null => {
    if (field.required && (value === "" || value === null || value === undefined)) {
      return `${field.label} is required`;
    }
    if (field.validation) {
      if (field.type === "number" && typeof value === "number") {
        if (field.validation.min !== undefined && value < field.validation.min) {
          return `Minimum value is ${field.validation.min}`;
        }
        if (field.validation.max !== undefined && value > field.validation.max) {
          return `Maximum value is ${field.validation.max}`;
        }
      }
      if (field.validation.pattern && typeof value === "string" && value) {
        const regex = new RegExp(field.validation.pattern);
        if (!regex.test(value)) {
          return field.validation.message || "Invalid format";
        }
      }
    }
    return null;
  };

  const validateForm = (): boolean => {
    if (!formSchema) return false;
    const newErrors: Record<string, string> = {};
    let valid = true;

    formSchema.fields.forEach(field => {
      const error = validateField(field, formData[field.id]);
      if (error) {
        newErrors[field.id] = error;
        valid = false;
      }
    });

    setErrors(newErrors);
    return valid;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;

    setSubmitting(true);
    setError(null);

    try {
      onSubmit?.(formData);

      const res = await fetch(`/api/oddjob/forms/${formId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: formData,
          prefillCollection,
          prefillRecordId,
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      
      const response = await res.json();
      setSubmitted(true);
      onSuccess?.(response);
    } catch (e: any) {
      setError(e.message || "Submission failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleFieldChange = (fieldId: string, value: any) => {
    setFormData(prev => ({ ...prev, [fieldId]: value }));
    if (errors[fieldId]) {
      setErrors(prev => {
        const next = { ...prev };
        delete next[fieldId];
        return next;
      });
    }
  };

  const reset = () => {
    setSubmitted(false);
    setFormData({});
    setErrors({});
    setError(null);
    fetchFormSchema();
  };

  const renderField = (field: FormField) => {
    const value = formData[field.id];
    const error = errors[field.id];

    const baseInputClass = `bg-white/5 border-white/10 text-white placeholder:text-white/30 ${
      error ? "border-rose-500/50 focus:border-rose-500" : "focus:border-white/30"
    }`;

    switch (field.type) {
      case "textarea":
        return (
          <Textarea
            value={value || ""}
            onChange={e => handleFieldChange(field.id, e.target.value)}
            placeholder={field.placeholder}
            className={baseInputClass}
            rows={4}
          />
        );
      case "select":
        return (
          <Select value={value || ""} onValueChange={v => handleFieldChange(field.id, v)}>
            <SelectTrigger className={baseInputClass}>
              <SelectValue placeholder={field.placeholder || "Select..."} />
            </SelectTrigger>
            <SelectContent className="bg-zinc-900 border-white/10">
              {field.options?.map(opt => (
                <SelectItem key={opt.value} value={opt.value} className="text-white">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      case "checkbox":
        return (
          <div className="flex items-center space-x-2">
            <Checkbox
              id={field.id}
              checked={value || false}
              onCheckedChange={(checked: boolean | "indeterminate") => handleFieldChange(field.id, checked === true)}
              className="border-white/30 data-[state=checked]:bg-indigo-500"
            />
            <Label htmlFor={field.id} className="text-white/70 text-sm cursor-pointer">
              {field.placeholder || "Yes"}
            </Label>
          </div>
        );
      case "switch":
        return (
          <div className="flex items-center space-x-3">
            <Switch
              checked={value || false}
              onCheckedChange={(checked: boolean) => handleFieldChange(field.id, checked)}
              className="data-[state=checked]:bg-indigo-500"
            />
            <span className="text-white/70 text-sm">{field.placeholder || "Enabled"}</span>
          </div>
        );
      case "number":
        return (
          <Input
            type="number"
            value={value || ""}
            onChange={e => handleFieldChange(field.id, e.target.value === "" ? "" : parseFloat(e.target.value))}
            placeholder={field.placeholder}
            className={baseInputClass}
          />
        );
      case "date":
        return (
          <Input
            type="date"
            value={value || ""}
            onChange={e => handleFieldChange(field.id, e.target.value)}
            className={baseInputClass}
          />
        );
      default:
        return (
          <Input
            type={field.type === "email" ? "email" : field.type === "url" ? "url" : "text"}
            value={value || ""}
            onChange={e => handleFieldChange(field.id, e.target.value)}
            placeholder={field.placeholder}
            className={baseInputClass}
          />
        );
    }
  };

  if (loading) {
    return (
      <Card className="bg-black/40 border-white/10 backdrop-blur-xl">
        <CardContent className="p-6 space-y-4">
          <Skeleton className="h-8 w-48 bg-white/5" />
          <Skeleton className="h-12 w-full bg-white/5" />
          <Skeleton className="h-12 w-full bg-white/5" />
          <Skeleton className="h-24 w-full bg-white/5" />
        </CardContent>
      </Card>
    );
  }

  if (submitted) {
    return (
      <Card className="bg-black/40 border-white/10 backdrop-blur-xl">
        <CardContent className="p-8 text-center">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-500/20 mb-4"
          >
            <CheckCircle className="w-8 h-8 text-emerald-400" />
          </motion.div>
          <h3 className="text-xl font-bold text-white mb-2">{successMessage}</h3>
          <p className="text-white/50 mb-6">Your submission has been received.</p>
          <Button onClick={reset} variant="outline" className="border-white/10 text-white hover:bg-white/5">
            <RotateCcw className="w-4 h-4 mr-2" /> Submit Another
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-black/40 border-white/10 backdrop-blur-xl">
      <CardHeader>
        <CardTitle className="text-xl font-bold text-white">
          {title || formSchema?.name || "Form"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm">
            {error}
          </div>
        )}

        <div className="space-y-5">
          {formSchema?.fields.map((field, index) => (
            <motion.div
              key={field.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className="space-y-2"
            >
              <Label htmlFor={field.id} className="text-white/80 text-sm flex items-center gap-2">
                {field.label}
                {field.required && (
                  <Badge variant="outline" className="text-rose-400 border-rose-400/30 text-[10px] px-1">Required</Badge>
                )}
              </Label>
              {renderField(field)}
              {errors[field.id] && (
                <p className="text-rose-400 text-xs">{errors[field.id]}</p>
              )}
            </motion.div>
          ))}
        </div>

        <div className="mt-6 flex justify-end">
          <Button
            onClick={handleSubmit}
            disabled={submitting}
            className="bg-indigo-500 hover:bg-indigo-400 text-white"
          >
            {submitting ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Submitting...</>
            ) : (
              <><Send className="w-4 h-4 mr-2" /> {formSchema?.submitLabel || "Submit"}</>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
