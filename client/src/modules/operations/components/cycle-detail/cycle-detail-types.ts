import type { Blueprint } from "../../data/cycle-templates";
import type { Blueprint as ManagedBlueprint } from "../CycleManagementInterface/types";

export type { Blueprint, ManagedBlueprint };

export interface CycleRun {
  id: number;
  name: string;
  status: string;
  createdAt: string;
  updatedAt?: string;
  cycleId?: number;
  metadata?: { total_cost?: number; totalTokens?: number };
  dynamicTrace?: unknown[];
}

export interface CycleDetail {
  id: number;
  name: string;
  description?: string;
  objective: string;
  status: string;
  icon?: string;
  priority?: number;
  budgetLimitUsd?: string | number;
  tokenLimit?: number;
  requiresApproval?: number;
  recurrence?: string;
  timezone?: string;
  nextRunAt?: string | null;
  startDate?: string;
  endDate?: string;
  successCriteria?: { stop_on?: string; min_confidence?: number; action?: string } | null;
  metadata?: {
    blueprints?: Blueprint[];
    blueprint_history?: BlueprintHistoryEntry[];
    resource_answers?: Record<string, Record<string, string>>;
    forecast?: { totalEstimatedCost?: number; totalEstimatedTokens?: number };
    scheduling?: Record<string, any>;
  };
  outcomeMetrics?: {
    successRate?: number;
    totalSpend?: number;
    totalTokens?: number;
    alignmentScore?: number;
    lastAuditAt?: string;
    auditLog?: string | null;
    summaryReport?: string | null;
    postMortem?: string | null;
  };
  createdAt?: string;
  updatedAt?: string;
}

export interface BlueprintHistoryEntry {
  changedAt: string;
  changedBy: string | number;
  reason: string | null;
  cycleStatus: string;
  blueprints: Blueprint[];
}
