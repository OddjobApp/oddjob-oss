/**
 * A refusal the person can do something about: what was refused, what would
 * allow it, and the steps that remain, in the order they have to happen.
 *
 * CREW renders it as a card in place of the agent narrating the refusal, which
 * used to end in "ask the project owner" even for a project with no owner.
 */
export interface PermissionStep {
  id: 'connect' | 'join' | 'grant';
  label: string;
  done: boolean;
}

export interface PermissionRequiredPayload {
  type: 'permission_required';
  /** Identifies the refusal, so two refused calls for the same access show one card. */
  key: string;
  title: string;
  /** What was attempted, e.g. "read QuickBooks Invoice records". */
  action: string;
  /** The refusal as the server stated it. */
  reason: string;
  /** Roles that would allow the action, as people name them. */
  allowedRoles: string[];
  project: { id: number; key: string; name: string } | null;
  organizationId: number;
  steps: PermissionStep[];
  /** Who can complete the steps the caller cannot, e.g. "an org admin". */
  grantedBy: string;
  /** The caller can complete every remaining step themselves. */
  callerCanGrant: boolean;
  /** Where the steps are done. */
  manageHref: string | null;
}

export function isPermissionRequiredPayload(value: unknown): value is PermissionRequiredPayload {
  const p = value as Partial<PermissionRequiredPayload> | null;
  return !!p && p.type === 'permission_required' && typeof p.key === 'string' && Array.isArray(p.steps);
}
