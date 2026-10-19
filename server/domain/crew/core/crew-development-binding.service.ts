import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@server/database_service.js';
import { crewSessions, operationalCycles, type CrewSessionRecord } from '@shared/schema/index.js';
import { crewDevelopmentBindingSchema } from '@shared/crew-development-binding.js';
import { ValidationError } from '@server/utils/errors.js';

export async function developmentBindingOptions(room: CrewSessionRecord) {
  const cycles = await db.select({ id: operationalCycles.id, name: operationalCycles.name, status: operationalCycles.status })
    .from(operationalCycles).where(and(eq(operationalCycles.organizationId, room.organizationId),
      room.projectId == null ? isNull(operationalCycles.projectId) : eq(operationalCycles.projectId, room.projectId)))
    .orderBy(desc(operationalCycles.updatedAt)).limit(100);
  return { cycles, projectId: room.projectId, current: { cycleId: room.cycleContext?.cycleId ?? null, ...room.cycleContext?.developmentBinding } };
}

export async function saveDevelopmentBinding(room: CrewSessionRecord, input: unknown, userId: string) {
  const parsed = crewDevelopmentBindingSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError('Select a cycle and provide a valid repository, branch and test environment.');
  const data = parsed.data;
  const [cycle] = await db.select({ id: operationalCycles.id, name: operationalCycles.name }).from(operationalCycles)
    .where(and(eq(operationalCycles.id, data.cycleId), eq(operationalCycles.organizationId, room.organizationId),
      room.projectId == null ? isNull(operationalCycles.projectId) : eq(operationalCycles.projectId, room.projectId))).limit(1);
  if (!cycle) throw new ValidationError('The selected cycle is unavailable in this room’s Project Space.');
  const patch = { cycleId: cycle.id, cycleName: cycle.name, developmentBinding: {
    repositoryUrl: data.repositoryUrl, branch: data.branch, testEnvironment: data.testEnvironment,
    configuredBy: userId, configuredAt: new Date().toISOString(),
  } };
  await db.update(crewSessions).set({
    // A newly configured target must not inherit another cycle's stage or app roster.
    cycleSlug: null,
    cycleStageId: null,
    cycleContext: sql`(coalesce(${crewSessions.cycleContext}, '{}'::jsonb) - ARRAY['cycleSlug','stageId','stageName','appSlugs','requiredDecisions','isStandingRoom']) || ${JSON.stringify(patch)}::jsonb`,
  })
    .where(and(eq(crewSessions.id, room.id), eq(crewSessions.organizationId, room.organizationId)));
  return patch;
}
