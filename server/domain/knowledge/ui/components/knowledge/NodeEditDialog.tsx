/**
 * Node Edit Dialog
 * 
 * Dialog for creating/editing knowledge graph nodes.
 */

import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@domain-ui/core/ui/components/ui/dialog";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@domain-ui/core/ui/components/ui/select";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

const nodeSchema = z.object({
  label: z.string().min(1, "Label is required"),
  name: z.string().min(1, "Name is required"),
  externalId: z.string().optional(),
  data: z.string().optional(), // JSON string
});

type NodeFormData = z.infer<typeof nodeSchema>;

interface KnowledgeNode {
  id: number;
  label: string;
  name: string;
  externalId?: string | null;
  data: Record<string, any>;
  knowledgeDocumentId?: number | null;
}

interface NodeEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  node?: KnowledgeNode | null;
  onSuccess?: () => void;
}

const NODE_LABELS = ["User", "Ticket", "Incident", "Infrastructure", "KnowledgeDocument"];

interface Job {
  id: number;
  name: string;
  outputSchema?: {
    sampleOutput: any;
    schemaDef?: Record<string, any>;
    suggestedLabel?: string;
  };
}

export default function NodeEditDialog({
  open,
  onOpenChange,
  node,
  onSuccess,
}: NodeEditDialogProps) {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch jobs to get schemas
  const { data: jobs } = useQuery<Job[]>({
    queryKey: ["/api/jobs"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/jobs");
      const data = await res.json();
      return Array.isArray(data) ? data : (data.items || []);
    },
  });

  // Fetch dynamic labels from existing data
  const { data: labelStats } = useQuery<Array<{ value: string, count: number }>>({
    queryKey: ["/api/knowledge-graph/values", "label"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/knowledge-graph/values?field=label");
      return res.json();
    }
  });

  const dynamicLabels = Array.isArray(labelStats) ? labelStats.map(s => String(s.value)) : [];
  // Merge, deduplicate, and sort labels
  const allLabels = Array.from(new Set([...NODE_LABELS, ...dynamicLabels])).sort();

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    setValue,
    watch,
  } = useForm<NodeFormData>({
    resolver: zodResolver(nodeSchema),
    defaultValues: {
      label: node?.label || "",
      name: node?.name || "",
      externalId: node?.externalId || "",
      data: node?.data ? JSON.stringify(node.data, null, 2) : "",
    },
  });

  useEffect(() => {
    if (node) {
      reset({
        label: node.label,
        name: node.name,
        externalId: node.externalId || "",
        data: node.data ? JSON.stringify(node.data, null, 2) : "",
      });
    } else {
      reset({
        label: "",
        name: "",
        externalId: "",
        data: "",
      });
    }
  }, [node, reset]);

  const handleTemplateChange = (jobId: string) => {
    const job = jobs?.find(j => j.id.toString() === jobId);
    if (job?.outputSchema?.sampleOutput) {
      // Try to determine the shape of a single item if schema is array-based
      // (Common pattern: job returns { issues: [...] }, we want one issue as a node)
      let sampleData = job.outputSchema.sampleOutput;

      // Heuristics to find the "single item" if the output is a list wrapper
      const keys = Object.keys(sampleData);
      // Look for an array property that might contain the items (e.g. 'issues', 'items', 'data')
      const arrayKey = keys.find(k => Array.isArray(sampleData[k]) && sampleData[k].length > 0);

      if (arrayKey) {
        sampleData = sampleData[arrayKey][0];
      }

      setValue("data", JSON.stringify(sampleData, null, 2));

      // Try to auto-populate Name and External ID from common fields
      if (sampleData) {
        // Name: try summary, name, title, display_name
        const nameCandidate =
          sampleData.fields?.summary ||
          sampleData.summary ||
          sampleData.name ||
          sampleData.title ||
          sampleData.displayName;

        if (nameCandidate && typeof nameCandidate === 'string') {
          setValue("name", nameCandidate);
        }

        // External ID: try key, id, external_id
        const idCandidate =
          sampleData.key ||
          sampleData.externalId ||
          sampleData.id;

        if (idCandidate && (typeof idCandidate === 'string' || typeof idCandidate === 'number')) {
          setValue("externalId", String(idCandidate));
        }
      }

      setValue("data", JSON.stringify(sampleData, null, 2));

      // Decision Priority:
      // 1. Explicit label from schema
      // 2. Heuristic guess from job name
      if (job.outputSchema.suggestedLabel) {
        setValue("label", job.outputSchema.suggestedLabel);
      } else {
        const jobNameLower = job.name.toLowerCase();
        const matchedLabel = NODE_LABELS.find(l => jobNameLower.includes(l.toLowerCase()));
        if (matchedLabel) {
          setValue("label", matchedLabel);
        }
      }

      toast({
        title: "Template Applied",
        description: `Loaded schema from job: ${job.name}`,
      });
    }
  };

  const onSubmit = async (data: NodeFormData) => {
    setIsSubmitting(true);
    try {
      let parsedData = {};
      if (data.data) {
        try {
          parsedData = JSON.parse(data.data);
        } catch (e) {
          toast({
            title: "Invalid JSON",
            description: "Data field must be valid JSON",
            variant: "destructive",
          });
          setIsSubmitting(false);
          return;
        }
      }

      const payload = {
        label: data.label,
        name: data.name,
        externalId: data.externalId || null,
        data: parsedData,
      };

      if (node) {
        // Update
        await apiRequest("PUT", `/api/knowledge-graph/nodes/${node.id}`, payload);
        toast({
          title: "Success",
          description: "Node updated successfully",
        });
      } else {
        // Create
        await apiRequest("POST", "/api/knowledge-graph/nodes", payload);
        toast({
          title: "Success",
          description: "Node created successfully",
        });
      }

      onOpenChange(false);
      onSuccess?.();
    } catch (error: any) {
      let errorMessage = error.message || "Failed to save node";

      // Handle validation errors from apiRequest (error.details.errors)
      const validationErrors = error.details?.errors || error.errors;
      if (validationErrors && Array.isArray(validationErrors)) {
        const errorMessages = validationErrors
          .map((e: any) => `${e.path?.join('.') || 'field'}: ${e.message}`)
          .join(', ');
        errorMessage = `Validation failed: ${errorMessages}`;
      }

      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filter jobs that have a valid outputSchema
  const availableTemplates = Array.isArray(jobs) ? jobs.filter(j => j?.outputSchema?.sampleOutput) : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{node ? "Edit Node" : "Add Data"}</DialogTitle>
          <DialogDescription>
            {node ? "Update node information" : "Add new data to the knowledge graph"}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">

          {/* Template Selector - Only show in Create mode */}
          {!node && availableTemplates.length > 0 && (
            <div className="p-3 bg-muted/50 rounded-lg border mb-4">
              <Label className="text-xs text-muted-foreground mb-2 block">Quick Start: Populate from Schema</Label>
              <Select onValueChange={handleTemplateChange}>
                <SelectTrigger className="h-8">
                  <SelectValue placeholder="Select a Job Schema Template..." />
                </SelectTrigger>
                <SelectContent>
                  {availableTemplates.map((job) => (
                    <SelectItem key={job.id} value={job.id.toString()}>
                      {job.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="label">Label *</Label>
            <Input
              id="label"
              list="node-labels"
              placeholder="e.g. Ticket, Incident (Type or Select)"
              {...register("label")}
            />
            <datalist id="node-labels">
              {allLabels.map((label) => (
                <option key={label} value={label} />
              ))}
            </datalist>
            {errors.label && (
              <p className="text-xs text-destructive">{errors.label.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="name">Name *</Label>
            <Input
              id="name"
              {...register("name")}
              placeholder="e.g., John Doe, Database Outage"
            />
            {errors.name && (
              <p className="text-sm text-red-500">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="externalId">External ID</Label>
            <Input
              id="externalId"
              {...register("externalId")}
              placeholder="e.g., JIRA-123, user_55"
            />
            {errors.externalId && (
              <p className="text-sm text-red-500">{errors.externalId.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="data">Data (JSON)</Label>
            <Textarea
              id="data"
              {...register("data")}
              placeholder='{"status": "open", "priority": "high"}'
              rows={6}
              className="font-mono text-sm"
            />
            {errors.data && (
              <p className="text-sm text-red-500">{errors.data.message}</p>
            )}
            <p className="text-xs text-muted-foreground">
              Define the node properties as a valid JSON object.
            </p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {node ? "Update" : "Add Node"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}


