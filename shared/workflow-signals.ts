/**
 * Signal → workflow subscriptions: the vocabulary a workflow signal
 * subscription filters with, and the dispositions a delivery row can record.
 *
 * Lives in shared/ so the API, the delivery service and the Project Space UI
 * all validate and render the same shape. Mirrors SubscriptionFilters from
 * cycle signal subscriptions on purpose — same signals, same filters,
 * different delivery target.
 */
import { z } from "zod";

export const WORKFLOW_SIGNAL_DISPOSITIONS = [
    "started",
    "skipped:no_active_deployment",
    "skipped:paused",
    "error",
] as const;
export type WorkflowSignalDisposition = (typeof WORKFLOW_SIGNAL_DISPOSITIONS)[number];

export const SIGNAL_SEVERITIES = ["Low", "Medium", "High", "Critical"] as const;

export const signalFiltersSchema = z.object({
    eventTypes: z.array(z.string().min(1).max(200)).max(50).optional(),
    sectors: z.array(z.string().min(1).max(200)).max(50).optional(),
    jurisdictions: z.array(z.string().min(1).max(200)).max(50).optional(),
    entityIds: z.array(z.string().min(1).max(200)).max(200).optional(),
    minimumConfidence: z.number().min(0).max(1).optional(),
    minimumSeverity: z.enum(SIGNAL_SEVERITIES).optional(),
}).strict();

export type SignalFilters = z.infer<typeof signalFiltersSchema>;
