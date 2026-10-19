/**
 * Agent contribution proposals.
 *
 * An agent can suggest a change to any live studio — Flow Studio (a new step),
 * Scribe (a new section or annotation), Form Studio (a new field), Signal Studio
 * (a new feed or filter), or any other surface — and offer the person a one-click
 * approval gate before anything is written.
 *
 * This module defines the shared data contract between:
 *  - the server tool `propose_studio_contribution` (tools/v1/capabilities/studio-contribution-tools.ts)
 *  - the client card `StudioContributionProposalCard.tsx`
 *  - the crew service that applies the contribution after approval
 *
 * Pattern mirrors `flow-studio-crew.ts`, `scribe-context.ts`, etc.: server and
 * client both read the same payload rather than duplicating field names.
 */

export const STUDIO_CONTRIBUTION_PROPOSAL = "studio_contribution_proposal";
export const STUDIO_CONTRIBUTION_APPLIED = "studio_contribution_applied";

/** Which studio the contribution targets. */
export type ContributionTargetStudio =
  | "flow"
  | "scribe"
  | "form"
  | "signal"
  | "prediction"
  | "media"
  | "project"
  | "computer"
  | "agent";

/** A single diff item the agent is proposing. */
export interface ContributionDiffItem {
  /** Human-readable label, e.g. "Add step", "New section", "Add field". */
  label: string;
  /** What will be added or changed — shown verbatim in the card. */
  description: string;
  /** Optional BEFORE snippet (for replacements/edits). */
  before?: string;
  /** Optional AFTER/NEW snippet. */
  after?: string;
  /** Whether this item is reversible once applied. */
  reversible?: boolean;
}

/** An agent's proposal to add or change something in a studio. */
export interface StudioContributionProposal {
  /** Unique proposal id — `contrib_<uuid>`. */
  proposalId: string;
  /** Studio being targeted. */
  targetStudio: ContributionTargetStudio;
  /** Human label for the target, e.g. "Loan Triage Flow", "Incident Report". */
  targetLabel: string;
  /** ID of the thing being changed (pipelineId, documentId, formId, …). May be absent for new items. */
  targetId?: string | number;
  /** The agent's own words explaining why it is suggesting this. */
  rationale: string;
  /** What the agent is proposing, as a diff list. */
  diff: ContributionDiffItem[];
  /** Things worth knowing before approving (non-blocking). */
  checks?: string[];
  /** Whether a human approval in the room is required before applying. Defaults to true. */
  requiresApproval?: boolean;
  /**
   * The tool call to run after approval, with its arguments.
   * The crew service calls this when the card's "Apply" button fires.
   * Example: { tool: "add_flow_step", args: { pipelineId: 42, job: "score_lead" } }
   */
  applyAction?: { tool: string; args: Record<string, unknown> };
}

/** The record written after a contribution is applied. */
export interface StudioContributionApplied {
  proposalId: string;
  appliedAt: string;
  appliedBy?: string;
}

/** The exact message the card sends back to the room to trigger apply. */
export function applyContributionMessage(proposalId: string): string {
  return `Apply contribution "${proposalId}".`;
}

const APPLY_PATTERN = /^Apply contribution "([A-Za-z0-9_-]{8,64})"\.?$/;

/** Parse an approval message from the room, or null if it is not one. */
export function parseContributionApply(message: string): { proposalId: string } | null {
  const m = message.trim().match(APPLY_PATTERN);
  return m ? { proposalId: m[1] } : null;
}

type RoomArtifact = { tool?: string; payload?: Record<string, unknown> | null };
type RoomTurn = { id?: number | string; artifacts?: RoomArtifact[] | null };

/**
 * Find a contribution proposal by id in the room history and whether it was applied.
 * Mirrors `findFlowCreateProposal` in flow-studio-crew.ts.
 */
export function findContributionProposal(
  turns: RoomTurn[],
  proposalId: string,
): { proposal: StudioContributionProposal; applied: boolean } | null {
  let proposal: StudioContributionProposal | null = null;
  let applied = false;
  for (const turn of turns) {
    for (const artifact of turn?.artifacts ?? []) {
      const p = artifact?.payload ?? {};
      if (p.proposalId !== proposalId) continue;
      if (p.type === STUDIO_CONTRIBUTION_PROPOSAL) proposal = p as unknown as StudioContributionProposal;
      if (p.type === STUDIO_CONTRIBUTION_APPLIED) applied = true;
    }
  }
  return proposal ? { proposal, applied } : null;
}
