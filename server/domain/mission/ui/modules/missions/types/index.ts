import { z } from "zod";

export const formSchema = z.object({
  name: z.string().min(3, "Name must be at least 3 characters"),
  objective: z.string().min(10, "Objective must be descriptive"),
  budgetLimitUsd: z.coerce.number().min(0).optional(),
  executionStrategy: z.string().default("pre_planned"),
  dynamicCycleBudgetLimitUsd: z.coerce.number().min(0).default(5),
  hilStrictness: z.enum(["lenient", "moderate", "strict"]).default("moderate"),
  hilNotificationChannels: z.array(z.string()).default(["inbox"]),
  saveAsTemplate: z.boolean().default(false), // Rebranded as Blueprint
  targetMetric: z.object({
    type: z.string().optional(),
    target: z.string().optional(),
  }).optional(),
  isShadowMode: z.boolean().default(false),
  reasoningProtocol: z.string().default("json_manifest"),
});

export type MissionFormValues = z.infer<typeof formSchema>;

export interface MissionMember {
  role: string;
  entityType: "job" | "pipeline";
  entityId?: number;
  jobName?: string;
  jobType?: string;
  jobTool?: string;
  description?: string;
  suggestedConfig?: any;
}
