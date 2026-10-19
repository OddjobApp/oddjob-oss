/**
 * KB Question Engine Extensions — Shared Types
 *
 * Type definitions used across the five KB extension services:
 * - Rescue Strategy Tracker
 * - HIL Pattern Detector
 * - Cross-Repo Propagation
 * - Pre-Mission Briefing
 * - Sprint Planning Tech Debt
 */

/** Event recorded each time a rescue strategy is applied. */
export interface RescueEvent {
  strategy: string;       // retry | relax | skip | replan
  jobType: string;        // from job config
  missionRunId: number;
  timestamp: number;      // Unix ms
}

/** Describes the shape of an HIL approval pattern (tool + param keys). */
export interface ApprovalPattern {
  tool: string;
  parameterKeys: string[];  // sorted keys from params (values excluded)
  repositoryId: string;
}

/** A single item returned in the pre-mission briefing advisory. */
export interface BriefingItem {
  questionId: number;
  questionText: string;
  triggerSource: string;
  ageInDays: number;
  filePaths: string[];
}

/** A pending KB question formatted as a tech debt card for sprint planning. */
export interface TechDebtCard {
  questionId: number;
  questionText: string;
  triggerSource: string;
  createdAt: Date;
  ageInDays: number;
  filePaths: string[];
  priorityScore: number;   // Higher = more urgent
  repositoryId: string;
}

/** Query parameters for fetching tech debt cards. */
export interface TechDebtQuery {
  organizationId: number;
  repositoryId?: string;    // optional filter
  limit?: number;           // default 50, max 50
  sortBy?: 'priority';      // only priority desc supported
}
