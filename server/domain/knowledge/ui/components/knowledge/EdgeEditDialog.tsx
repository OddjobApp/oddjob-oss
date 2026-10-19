/**
 * Edge Edit Dialog
 * 
 * Dialog for creating/editing knowledge graph edges.
 */

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@domain-ui/core/ui/components/ui/select";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useQuery } from "@tanstack/react-query";

const edgeSchema = z.object({
  sourceId: z.number().int().positive(),
  targetId: z.number().int().positive(),
  relation: z.string().min(1, "Relation is required"),
  weight: z.number().int().min(1).max(10).default(1),
});

type EdgeFormData = z.infer<typeof edgeSchema>;

interface KnowledgeEdge {
  id: number;
  sourceId: number;
  targetId: number;
  relation: string;
  weight: number;
}

interface KnowledgeNode {
  id: number;
  name: string;
  label: string;
}

interface EdgeEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  edge?: KnowledgeEdge | null;
  onSuccess?: () => void;
}

const RELATION_TYPES = [
  "REPORTED",
  "BLOCKED_BY",
  "CAUSED",
  "RELATED_TO",
  "ASSIGNED_TO",
  "LINKS",
  "CONTAINS",
  "DEPENDS_ON",
];

export default function EdgeEditDialog({
  open,
  onOpenChange,
  edge,
  onSuccess,
}: EdgeEditDialogProps) {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch nodes for dropdowns
  const { data: nodesResponse } = useQuery<{ nodes: KnowledgeNode[]; total: number; page: number; limit: number }>({
    queryKey: ["/api/knowledge-graph/nodes"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/knowledge-graph/nodes");
      return res.json();
    },
  });

  const nodes = nodesResponse?.nodes ?? [];

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    setValue,
    watch,
  } = useForm<EdgeFormData>({
    resolver: zodResolver(edgeSchema),
    defaultValues: {
      sourceId: edge?.sourceId || 0,
      targetId: edge?.targetId || 0,
      relation: edge?.relation || "",
      weight: edge?.weight || 1,
    },
  });

  useEffect(() => {
    if (edge) {
      reset({
        sourceId: edge.sourceId,
        targetId: edge.targetId,
        relation: edge.relation,
        weight: edge.weight,
      });
    } else {
      reset({
        sourceId: 0,
        targetId: 0,
        relation: "",
        weight: 1,
      });
    }
  }, [edge, reset]);

  const onSubmit = async (data: EdgeFormData) => {
    if (data.sourceId === data.targetId) {
      toast({
        title: "Invalid Edge",
        description: "Source and target nodes must be different",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        sourceId: data.sourceId,
        targetId: data.targetId,
        relation: data.relation,
        weight: data.weight,
      };

      if (edge) {
        // Update
        await apiRequest("PUT", `/api/knowledge-graph/edges/${edge.id}`, payload);
        toast({
          title: "Success",
          description: "Edge updated successfully",
        });
      } else {
        // Create
        await apiRequest("POST", "/api/knowledge-graph/edges", payload);
        toast({
          title: "Success",
          description: "Edge created successfully",
        });
      }

      onOpenChange(false);
      onSuccess?.();
    } catch (error: any) {
      let errorMessage = error.message || "Failed to save edge";
      
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{edge ? "Edit Edge" : "Create Edge"}</DialogTitle>
          <DialogDescription>
            {edge ? "Update edge relationship" : "Create a new relationship between nodes"}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="sourceId">Source Node *</Label>
            <Select
              value={watch("sourceId")?.toString() || ""}
              onValueChange={(value) => setValue("sourceId", parseInt(value, 10))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select source node" />
              </SelectTrigger>
              <SelectContent>
                {nodes.map((node) => (
                  <SelectItem key={node.id} value={node.id.toString()}>
                    {node.name} ({node.label})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.sourceId && (
              <p className="text-sm text-red-500">{errors.sourceId.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="targetId">Target Node *</Label>
            <Select
              value={watch("targetId")?.toString() || ""}
              onValueChange={(value) => setValue("targetId", parseInt(value, 10))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select target node" />
              </SelectTrigger>
              <SelectContent>
                {nodes.map((node) => (
                  <SelectItem key={node.id} value={node.id.toString()}>
                    {node.name} ({node.label})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.targetId && (
              <p className="text-sm text-red-500">{errors.targetId.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="relation">Relation *</Label>
            <Select
              value={watch("relation")}
              onValueChange={(value) => setValue("relation", value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select relation type" />
              </SelectTrigger>
              <SelectContent>
                {RELATION_TYPES.map((rel) => (
                  <SelectItem key={rel} value={rel}>
                    {rel}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.relation && (
              <p className="text-sm text-red-500">{errors.relation.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="weight">Weight (1-10)</Label>
            <Input
              id="weight"
              type="number"
              min="1"
              max="10"
              {...register("weight", { valueAsNumber: true })}
            />
            {errors.weight && (
              <p className="text-sm text-red-500">{errors.weight.message}</p>
            )}
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
              {edge ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}


