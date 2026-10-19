import { z } from 'zod';
export const INCIDENT_COLLECTION = 'incident_response_cases';
export const incidentCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('declare'), requestId: z.string().uuid(), title: z.string().trim().min(1).max(200), description: z.string().trim().min(1).max(4000), severity: z.enum(['SEV-1','SEV-2','SEV-3','SEV-4']) }).strict(),
  z.object({ action: z.literal('transition'), requestId: z.string().uuid(), incidentId: z.string().uuid(), expectedVersion: z.number().int().positive(), status: z.enum(['investigating','mitigated','resolved','open']), note: z.string().trim().min(1).max(4000), evidenceUrl: z.string().url().max(2000).refine(url => url.startsWith('https://'), 'Evidence must use HTTPS').optional(), commander: z.string().trim().min(1).max(200).optional() }).strict(),
]);
export type IncidentCommand = z.infer<typeof incidentCommandSchema>;
export interface IncidentCase {
  id: string; roomKey: string; title: string; description: string; severity: string;
  status: 'open'|'investigating'|'mitigated'|'resolved'; version: number;
  commander?: string; createdAt: string; updatedAt: string;
  events: Array<{ requestId: string; fingerprint: string; action: string; at: string; deploymentId: number; note: string; evidenceUrl?: string }>;
}
export function incidentTransitionBlocker(current: IncidentCase, command: Extract<IncidentCommand,{ action:'transition' }>) {
  if (current.version !== command.expectedVersion) return 'Incident changed. Refresh before submitting another transition.';
  const next: Record<IncidentCase['status'],string[]> = { open:['investigating'], investigating:['mitigated'], mitigated:['resolved','investigating'], resolved:['open'] };
  if (!next[current.status].includes(command.status)) return 'Invalid incident transition.';
  if (command.status === 'investigating' && !command.commander && !current.commander) return 'Assign an incident commander before investigation.';
  if (['mitigated','resolved'].includes(command.status) && !command.evidenceUrl) return 'A recovery evidence URL is required. A narrative alone does not establish recovery.';
  return null;
}
