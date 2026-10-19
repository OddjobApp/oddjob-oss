/**
 * Artifact Registry Service
 *
 * Manages versioned phase artifacts for SDLC code generation pipeline sessions.
 * Provides persistence with auto-incrementing versions, phase queries, lineage
 * tracking, and upstream context assembly for downstream phases.
 */

import { db } from "@server/database_service.js";
import { artifactRegistry, generationSessions } from "@shared/schema/index.js";
import { eq, and, desc, max, inArray } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import type {
  PersistArtifactParams,
  ArtifactRecord,
  ArtifactLineage,
} from "./types.js";

const logger = createLogger("ArtifactRegistryService");

// ============================================================================
// PERSIST
// ============================================================================

/**
 * Persist a validated artifact with auto-incremented version.
 *
 * Version is determined by finding the current max version for the
 * (sessionId, phase, name) triple and incrementing by 1.
 */
export async function persist(params: PersistArtifactParams): Promise<ArtifactRecord> {
  const { sessionId, phase, name, content, mimeType, missionRunId } = params;

  // Determine next version for this session+phase+name
  const [latest] = await db
    .select({ maxVersion: max(artifactRegistry.version) })
    .from(artifactRegistry)
    .where(
      and(
        eq(artifactRegistry.sessionId, sessionId),
        eq(artifactRegistry.phase, phase),
        eq(artifactRegistry.name, name)
      )
    );

  const nextVersion = (latest?.maxVersion ?? 0) + 1;

  const [inserted] = await db
    .insert(artifactRegistry)
    .values({
      sessionId,
      phase,
      name,
      version: nextVersion,
      content,
      mimeType,
      missionRunId,
      validatedAt: new Date(),
    })
    .returning();

  logger.info(
    `Persisted artifact "${name}" v${nextVersion} for session=${sessionId} phase=${phase}`
  );

  return toArtifactRecord(inserted);
}

// ============================================================================
// QUERY
// ============================================================================

/**
 * Retrieve artifacts for a specific phase, optionally filtered by version.
 * If no version is provided, returns the latest version of each artifact.
 */
export async function getPhaseArtifacts(
  sessionId: string,
  phase: string,
  version?: number
): Promise<ArtifactRecord[]> {
  if (version !== undefined) {
    // Specific version requested
    const rows = await db
      .select()
      .from(artifactRegistry)
      .where(
        and(
          eq(artifactRegistry.sessionId, sessionId),
          eq(artifactRegistry.phase, phase),
          eq(artifactRegistry.version, version)
        )
      );

    return rows.map(toArtifactRecord);
  }

  // No version specified: return latest version of each artifact in the phase.
  // Strategy: get all artifacts for this session+phase, then group by name and pick max version.
  const rows = await db
    .select()
    .from(artifactRegistry)
    .where(
      and(
        eq(artifactRegistry.sessionId, sessionId),
        eq(artifactRegistry.phase, phase)
      )
    )
    .orderBy(desc(artifactRegistry.version));

  // Deduplicate by name, keeping only the latest version (first occurrence since ordered desc)
  const seen = new Set<string>();
  const latest: ArtifactRecord[] = [];
  for (const row of rows) {
    if (!seen.has(row.name)) {
      seen.add(row.name);
      latest.push(toArtifactRecord(row));
    }
  }

  return latest;
}

// ============================================================================
// LINEAGE
// ============================================================================

/**
 * Get full artifact lineage for a session — all artifacts grouped by phase in order.
 */
export async function getSessionLineage(sessionId: string): Promise<ArtifactLineage> {
  // Get the phase sequence from the session to determine ordering
  const [session] = await db
    .select({ phaseSequence: generationSessions.phaseSequence })
    .from(generationSessions)
    .where(eq(generationSessions.id, sessionId))
    .limit(1);

  const phaseOrder: string[] = (session?.phaseSequence as string[]) ?? [];

  // Fetch all artifacts for this session
  const rows = await db
    .select()
    .from(artifactRegistry)
    .where(eq(artifactRegistry.sessionId, sessionId))
    .orderBy(artifactRegistry.phase, artifactRegistry.version);

  // Group by phase
  const phaseMap = new Map<string, ArtifactRecord[]>();
  for (const row of rows) {
    const records = phaseMap.get(row.phase) ?? [];
    records.push(toArtifactRecord(row));
    phaseMap.set(row.phase, records);
  }

  // Order phases according to the session's phaseSequence.
  // Phases not in phaseSequence are appended at the end.
  const orderedPhases = [
    ...phaseOrder.filter((p) => phaseMap.has(p)),
    ...[...phaseMap.keys()].filter((p) => !phaseOrder.includes(p)),
  ];

  const phases = orderedPhases.map((phase) => ({
    phase,
    artifacts: phaseMap.get(phase) ?? [],
  }));

  const totalArtifacts = rows.length;

  return { sessionId, phases, totalArtifacts };
}

// ============================================================================
// PHASE CONTEXT ASSEMBLY
// ============================================================================

/**
 * Assemble upstream artifacts for a target phase.
 *
 * Looks up the session's phaseSequence, identifies all phases that come
 * before `targetPhase`, retrieves the latest version of each artifact
 * from those phases, and returns them keyed as `{phase}.{name}`.
 */
export async function buildPhaseContext(
  sessionId: string,
  targetPhase: string
): Promise<Record<string, unknown>> {
  // Get the phase sequence
  const [session] = await db
    .select({ phaseSequence: generationSessions.phaseSequence })
    .from(generationSessions)
    .where(eq(generationSessions.id, sessionId))
    .limit(1);

  if (!session) {
    logger.warn(`Session ${sessionId} not found when building phase context`);
    return {};
  }

  const phaseSequence: string[] = (session.phaseSequence as string[]) ?? [];
  const targetIndex = phaseSequence.indexOf(targetPhase);

  if (targetIndex <= 0) {
    // Either target phase is first or not found — no upstream context
    return {};
  }

  // Upstream phases are all phases before the target
  const upstreamPhases = phaseSequence.slice(0, targetIndex);

  // Get all artifacts from upstream phases
  const rows = await db
    .select()
    .from(artifactRegistry)
    .where(
      and(
        eq(artifactRegistry.sessionId, sessionId),
        inArray(artifactRegistry.phase, upstreamPhases)
      )
    )
    .orderBy(desc(artifactRegistry.version));

  // For each phase+name combo, keep only the latest version
  const seen = new Set<string>();
  const context: Record<string, unknown> = {};

  for (const row of rows) {
    const key = `${row.phase}.${row.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      context[key] = row.content;
    }
  }

  logger.info(
    `Built phase context for session=${sessionId} targetPhase=${targetPhase}: ${Object.keys(context).length} artifacts from ${upstreamPhases.length} upstream phases`
  );

  return context;
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Map a raw DB row to the domain ArtifactRecord type.
 */
function toArtifactRecord(row: typeof artifactRegistry.$inferSelect): ArtifactRecord {
  return {
    id: row.id,
    sessionId: row.sessionId,
    phase: row.phase,
    name: row.name,
    version: row.version,
    content: row.content,
    mimeType: row.mimeType,
    missionRunId: row.missionRunId!,
    validatedAt: row.validatedAt!,
    createdAt: row.createdAt,
  };
}

// ============================================================================
// EXPORTED SERVICE OBJECT
// ============================================================================

export const artifactRegistryService = {
  persist,
  getPhaseArtifacts,
  getSessionLineage,
  buildPhaseContext,
};
