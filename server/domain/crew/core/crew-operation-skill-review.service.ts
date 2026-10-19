import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@server/database_service.js';
import { crewTurns, skills, skillReviews, approvalRequests, type CrewSessionRecord } from '@shared/schema/index.js';
import type { CrewOperationSkillDraft } from '@shared/crew-operation-skill.js';
import { crewRepository } from './crew-repository.js';
import { crewToolsService } from './crew-tools.service.js';
import { getCrewReadiness } from './crew-readiness.service.js';
import { SkillGovernanceService } from '@domain/agents/core/skill-governance.service.js';
import { ValidationError } from '@server/utils/errors.js';
import { calendarOperationSkillDraft } from './crew-operation-skill.service.js';
import { calendarArgsHash } from '@domain/tools/v1/capabilities/google-calendar.js';

export const operationSkillEditsSchema = z.object({
  name: z.string().trim().min(3).max(100),
  inputs: z.object({ messageIds: z.string().trim().min(3).max(500), calendarId: z.string().trim().min(3).max(500), eventRequirements: z.string().trim().min(3).max(500), timezone: z.string().trim().min(3).max(500) }).strict(),
  targetAgentId: z.number().int().positive(),
}).strict();
type Edits = z.infer<typeof operationSkillEditsSchema>;
const fingerprint = (draft: CrewOperationSkillDraft, targetAgentId: number) => createHash('sha256').update(JSON.stringify({ ...draft, registration: undefined, targetAgentId })).digest('hex');

async function source(room: CrewSessionRecord, evidenceHash: string) {
  if (!/^[a-f0-9]{64}$/.test(evidenceHash)) throw new ValidationError('Invalid evidence fingerprint.', { field: 'evidenceHash' });
  const [turn] = await db.select().from(crewTurns).where(and(eq(crewTurns.organizationId, room.organizationId), eq(crewTurns.sessionId, room.id),
    sql`${crewTurns.artifacts} @> ${JSON.stringify([{ payload: { type: 'crew_operation_skill_draft', evidenceHash } }])}::jsonb`)).limit(1);
  const draft = turn?.artifacts.find(artifact => artifact.payload.type === 'crew_operation_skill_draft' && artifact.payload.evidenceHash === evidenceHash)?.payload as unknown as CrewOperationSkillDraft | undefined;
  if (!turn || !draft || draft.version !== 1 || draft.recipe !== 'email_to_calendar' || draft.status !== 'draft') throw new ValidationError('Skill draft unavailable in this room.', { field: 'evidenceHash' });
  let verified = false;
  if (turn.toolsUsed.some(call => call.name === 'gcal_create_event' && call.ok)) {
    for (const artifact of turn.artifacts.filter(artifact => artifact.payload.kind === 'calendar_action' && artifact.payload.type === 'approval_request')) {
      const proposalId = artifact.payload.proposalId;
      if (typeof proposalId !== 'number' || !Number.isInteger(proposalId) || proposalId < 1) continue;
      const [approval] = await db.select().from(approvalRequests).where(and(eq(approvalRequests.id, proposalId), eq(approvalRequests.organizationId, room.organizationId))).limit(1);
      if (!approval) continue;
      try {
        const canonical = calendarOperationSkillDraft({ room, status: approval.status, meta: approval.toolArgs, stored: approval.modifiedOutput });
        const protectedFields = (value: CrewOperationSkillDraft) => ({ steps: value.steps, scopes: value.scopes, successCriteria: value.successCriteria, recovery: value.recovery, regressionScenarios: value.regressionScenarios, limitations: value.limitations });
        if (canonical.evidenceHash === evidenceHash && calendarArgsHash(protectedFields(canonical)) === calendarArgsHash(protectedFields(draft))) { verified = true; break; }
      } catch { /* Unconfirmed or changed source proposals do not authorize a skill. */ }
    }
  }
  if (!verified) throw new ValidationError('The draft no longer matches a verified operation and protected recipe.', { field: 'draft' });
  return { turn, draft };
}
async function target(room: CrewSessionRecord, agentId: number) {
  const card = (await crewRepository.getMembers(room.id)).find(card => card.id === agentId && card.organizationId === room.organizationId && card.enabled);
  if (!card) throw new ValidationError('Select an enabled agent in this room.', { field: 'targetAgentId' });
  return card;
}
export async function getOperationSkillReview(room: CrewSessionRecord, hash: string) {
  const { draft } = await source(room, hash);
  const agents = (await crewRepository.getMembers(room.id)).filter(card => card.organizationId === room.organizationId && card.enabled).map(card => ({ id: card.id, name: card.name }));
  const review = draft.registration ? (await SkillGovernanceService.listReviews(room.organizationId)).find(review => review.id === draft.registration!.reviewId) : null;
  return { draft, agents, reviewStatus: review?.status ?? null };
}
export async function validateOperationSkillReview(room: CrewSessionRecord, hash: string, input: unknown, userId: string) {
  const edits = operationSkillEditsSchema.parse(input);
  const { draft: original } = await source(room, hash);
  const draft: CrewOperationSkillDraft = { ...original, name: edits.name, inputs: edits.inputs };
  const card = await target(room, edits.targetAgentId);
  const tools = await crewToolsService.resolveForCard(card);
  const names = tools.map(tool => tool.definition.name);
  const missingTools = draft.steps.map(step => step.tool).filter(name => !names.includes(name));
  const fixtures: Record<string, unknown> = {
    get_crew_readiness: {}, gmail_get_message: { message_id: 'mock-message' }, gcal_get_calendar: { calendar_id: 'mock-calendar' },
    gcal_create_event: { calendar_id: 'mock-calendar', event: { summary: 'Mock event', start: { date: '2026-10-10' }, end: { date: '2026-10-11' } } },
  };
  const checks = draft.steps.map(step => ({ label: `${step.tool} mock input schema`, passed: !!tools.find(tool => tool.definition.name === step.tool)?.definition.parameters.safeParse(fixtures[step.tool]).success }));
  const create = tools.find(tool => tool.definition.name === 'gcal_create_event');
  checks.push({ label: 'Invalid all-day date range rejected', passed: !!create && !create.definition.parameters.safeParse({ event: { summary: 'Mock', start: { date: '2026-10-11' }, end: { date: '2026-10-10' } } }).success });
  const readiness = await getCrewReadiness(room, null, userId, { id: card.id, tools: names });
  const required = ['Gmail reading', 'Calendar reading', 'Calendar editing'];
  const accessChecks = required.map(label => readiness.checks.find(check => check.label === label) ?? { label, state: 'blocked' as const, detail: 'Required access could not be checked.' });
  const contractHash = fingerprint(draft, card.id);
  return { draft, targetAgentId: card.id, contractHash, missingTools, checks, accessChecks,
    readyForReview: missingTools.length === 0 && checks.every(check => check.passed) && accessChecks.every(check => check.state === 'passed'),
    limitations: ['Mock inputs were schema-validated without executing provider writes.', 'Duplicate, unknown-outcome and injection regression scenarios remain required before broad rollout.'] };
}
export async function submitOperationSkillReview(room: CrewSessionRecord, hash: string, edits: unknown, userId: string) {
  const validation = await validateOperationSkillReview(room, hash, edits, userId);
  if (!validation.readyForReview) throw new ValidationError('Resolve tool, schema and access blockers before submitting.', { field: 'draft' });
  const found = await source(room, hash);
  return db.transaction(async tx => {
    const [locked] = await tx.select().from(crewTurns).where(and(eq(crewTurns.id, found.turn.id), eq(crewTurns.organizationId, room.organizationId), eq(crewTurns.sessionId, room.id))).for('update');
    if (!locked) throw new ValidationError('Source draft unavailable.', { field: 'draft' });
    const current = locked.artifacts.find(artifact => artifact.payload.type === 'crew_operation_skill_draft' && artifact.payload.evidenceHash === hash)?.payload as unknown as CrewOperationSkillDraft;
    if (current.registration) {
      if (current.registration.contractHash !== validation.contractHash) throw new ValidationError('Submitted versions are immutable. Export a new draft for changes.', { field: 'draft' });
      return current.registration;
    }
    const [skill] = await tx.insert(skills).values({ name: `crew-${room.organizationId}-${validation.contractHash}`, description: validation.draft.name,
      organizationId: room.organizationId, isPublic: false, isInstalled: false, language: 'workflow_contract', code: '', metadata: { version: 1, contract: validation.draft, contractHash: validation.contractHash, validation: { checks: validation.checks, limitations: validation.limitations } } }).returning();
    const [review] = await tx.insert(skillReviews).values({ organizationId: room.organizationId, skillId: skill.id, skillName: validation.draft.name,
      skillDescription: 'Read selected Gmail messages, verify destination calendar metadata, validate event inputs and prepare a human-approved calendar event. Reconcile unknown outcomes before creating again.',
      sourcePlatform: 'crew_operation', extractedCapabilities: ['email to calendar'], extractedTools: validation.draft.steps.map(step => step.tool), status: 'pending',
      targetAgentCardId: validation.targetAgentId, submittedBy: userId, riskLevel: 'medium', securityReport: { contractHash: validation.contractHash, validationKind: 'schema_and_scoped_access', limitations: validation.limitations } }).returning();
    const registration = { skillId: skill.id, reviewId: review.id, targetAgentId: validation.targetAgentId, contractHash: validation.contractHash };
    await tx.update(crewTurns).set({ artifacts: locked.artifacts.map(artifact => artifact.payload.type === 'crew_operation_skill_draft' && artifact.payload.evidenceHash === hash
      ? { tool: artifact.tool, payload: { ...validation.draft, registration } } : artifact) }).where(and(eq(crewTurns.id, locked.id), eq(crewTurns.organizationId, room.organizationId)));
    return registration;
  });
}
export async function approveOperationSkillReview(room: CrewSessionRecord, hash: string, userId: string) {
  const { draft } = await source(room, hash);
  if (!draft.registration) throw new ValidationError('Submit this draft for review first.', { field: 'draft' });
  const registration = draft.registration;
  const validation = await validateOperationSkillReview(room, hash, { name: draft.name, inputs: draft.inputs, targetAgentId: registration.targetAgentId }, userId);
  if (!validation.readyForReview || validation.contractHash !== registration.contractHash) throw new ValidationError('The reviewed version or current access is invalid.', { field: 'draft' });
  return db.transaction(async tx => {
    // Serialize decisions from this lifecycle, including retry-after-response-loss.
    await tx.execute(sql`select pg_advisory_xact_lock(${room.organizationId}, ${registration.reviewId})`);
    const review = (await SkillGovernanceService.listReviews(room.organizationId)).find(review => review.id === registration.reviewId && review.skillId === registration.skillId && review.targetAgentCardId === registration.targetAgentId);
    if (!review) throw new ValidationError('Review unavailable.', { field: 'draft' });
    if (!['approved', 'augmented'].includes(review.status)) await SkillGovernanceService.processDecision({ organizationId: room.organizationId, reviewId: review.id, reviewerId: userId, action: 'approve', targetAgentCardId: registration.targetAgentId,
      reviewNotes: 'Approved versioned CREW contract after schema and scoped-access preflight. Mocked checks are not a live provider replay.' });
    await tx.update(skills).set({ isInstalled: true }).where(and(eq(skills.id, registration.skillId), eq(skills.organizationId, room.organizationId)));
    return { ...registration, status: 'approved' as const };
  });
}
