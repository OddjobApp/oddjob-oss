import { z } from 'zod';

export const SDLC_HANDOFF_COLLECTION = 'sdlc_stage_handoffs';
export const SDLC_DEPLOYMENT_LAUNCH_COLLECTION = 'sdlc_deployment_launches';
export const SDLC_SOURCE_COLLECTIONS = [
  'pm_workbench_signoffs', 'scrum_workbench_capacity_plans', 'qa_workbench_quality_gates', 'stakeholder_workbench_cab_approvals', 'stakeholder_workbench_uat_signoffs',
] as const;
export const SDLC_TRANSITIONS = {
  requirements_to_development: { source: 'pm_workbench_signoffs', target: 'scrum-master-workbench', label: 'Requirements → Development', mission: 'Requirements & Design Analysis' },
  planning_to_development: { source: 'scrum_workbench_capacity_plans', target: 'scrum-master-workbench', label: 'Planning → Development', mission: 'Sprint Kickoff & Planning' },
  qa_to_uat: { source: 'qa_workbench_quality_gates', target: 'stakeholder-workbench', label: 'QA → UAT', mission: null },
  uat_to_deployment: { source: 'stakeholder_workbench_cab_approvals', target: 'devops-workbench', label: 'UAT → Deployment', mission: null },
} as const;
export const stageHandoffInputSchema = z.object({
  version: z.literal(1),
  transition: z.enum(['requirements_to_development', 'planning_to_development', 'qa_to_uat', 'uat_to_deployment']),
  sourceRecordId: z.string().min(1).max(100),
  sourceUpdatedAt: z.string().datetime({ offset: true }),
  sourceRunId: z.number().int().positive().optional(),
  commitSha: z.string().regex(/^[a-f0-9]{40}$/i).optional(),
  ticketKeys: z.array(z.string().min(1).max(100)).max(100).default([]),
}).strict().superRefine((value, ctx) => {
  if (['requirements_to_development', 'planning_to_development'].includes(value.transition) && !value.sourceRunId)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'The source analysis/planning run is required', path: ['sourceRunId'] });
  if (['qa_to_uat', 'uat_to_deployment'].includes(value.transition) && !value.commitSha)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'A verified commit SHA is required', path: ['commitSha'] });
  if (SDLC_TRANSITIONS[value.transition].mission === null && value.sourceRunId)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Use the saved gate/decision as source evidence, not a destination run', path: ['sourceRunId'] });
});
export type StageHandoffInput = z.infer<typeof stageHandoffInputSchema>;
export interface SdlcSourceBinding { roomKey: string; cycleId: number; revision: string; repositoryUrl: string; branch: string }
export interface StageHandoffRecord {
  version: 1; id: string; fingerprint: string; sourceDigest: string; input: StageHandoffInput;
  binding: SdlcSourceBinding; target: string; label: string; createdAt: string;
  status: 'offered' | 'acknowledged';
  receipt?: { deploymentId: number; at: string; sourceUpdatedAt: string; runUpdatedAt?: string; reason?: string };
}

export function sameSdlcBinding(a: unknown, b: SdlcSourceBinding): boolean {
  if (!a || typeof a !== 'object') return false;
  const value = a as SdlcSourceBinding;
  return ['roomKey', 'cycleId', 'revision', 'repositoryUrl', 'branch'].every(key => value[key as keyof SdlcSourceBinding] === b[key as keyof SdlcSourceBinding]);
}

/** A software acknowledgement is not a human approval or a destination execution receipt. */
export function handoffSourceBlocker(input: StageHandoffInput, source: Record<string, any>, run?: { status: string; isSuccess: boolean | null } | null): string | null {
  const tickets = input.transition === 'requirements_to_development' ? [source.jiraKey] : source.ticketKeys ?? [];
  if (!Array.isArray(tickets) || tickets.some(key => typeof key !== 'string' || !key.trim()) ||
    JSON.stringify([...new Set(tickets)].sort()) !== JSON.stringify([...new Set(input.ticketKeys)].sort())) return 'Ticket references must match the reviewed source evidence.';
  if (input.transition === 'requirements_to_development' && (source.prdStatus !== 'Approved' || source.uxMockupStatus !== 'Approved')) return 'Requirements and UX sign-off must both be approved.';
  if (input.transition === 'planning_to_development' && !['engineerDays', 'targetVelocity'].every(key => Number.isFinite(Number(source[key])) && Number(source[key]) > 0)) return 'A positive saved sprint capacity is required.';
  if (input.commitSha && String(source.commitSha ?? '').toLowerCase() !== input.commitSha.toLowerCase()) return 'Source evidence is for a different commit.';
  if (input.transition === 'qa_to_uat' && (source.result !== 'pass' || source.evidenceKind !== 'runner')) return 'A passing runner-backed quality gate is required.';
  if (input.transition === 'uat_to_deployment' && source.decision !== 'approve') return 'A saved approving CAB decision is required.';
  if (input.sourceRunId && (!run || run.status !== 'completed' || run.isSuccess !== true)) return 'The source mission has not completed successfully.';
  return null;
}
