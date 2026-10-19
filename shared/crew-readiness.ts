/** Tool availability is not proof of credentials, authorization or execution. */
export interface CrewReadinessReport {
  organizationId: number;
  sessionKey: string;
  projectId: number | null;
  checkedAt: string;
  agents: Array<{ id: number; name: string; tools: string[]; unavailableDeclaredTools: string[] }>;
  recipes: Array<{ id: string; label: string; agents: Array<{ id: number; missingTools: string[] }>; detail: string }>;
  projectBindings: Array<{ kind: string; key: string; name: string | null }>;
  integrations: Array<{ platform: string; scope: 'project' | 'organization'; status: string; lastSync: string | null; schemaCapturedAt: string | null }>;
  appliedSkills: Array<{ agentId: number; augmentationId: number; skillId: number | null; appliedAt: string | null; missingTools: string[] }>;
  checks: Array<{ label: string; state: 'passed' | 'blocked' | 'not_checked'; detail: string }>;
}

export const CREW_READINESS_RECIPES = [
  { id: 'email_calendar', label: 'Email → reviewed calendar event', tools: ['gmail_get_message', 'gcal_get_calendar', 'gcal_create_event'] },
  { id: 'books_snapshot', label: 'QuickBooks → forecast → snapshot review', tools: ['quickbooks_forecast_cashflow', 'propose_financial_snapshot'] },
] as const;

export function unavailableDeclaredTools(declared: string[], offered: string[]): string[] {
  const available = new Set(offered);
  return [...new Set(declared)].filter(name => !available.has(name)).sort();
}
