import { db } from "@server/database_service.js";
import { operationalCycles } from "@shared/schema/operational-cycles.js";
import { eq, and, sql } from "drizzle-orm";

export class HarnessRegistryService {
  /**
   * Retrieves a specific version of a harness (operational cycle).
   * @param harnessId The ID of the harness (e.g., 'incident-response').
   * @param version The version of the harness (e.g., 'v1.0.0').
   * @returns The harness definition or null if not found.
   */
  async getHarness(harnessId: string, version: string): Promise<any | null> {
    const [found] = await db.select().from(operationalCycles)
      .where(and(
        sql`${operationalCycles.metadata}->>'harnessId' = ${harnessId}`,
        sql`${operationalCycles.metadata}->>'version' = ${version}`,
      ))
      .limit(1);
    if (!found) return null;
    const meta = (found.metadata as any) || {};
    return { id: meta.harnessId, version: meta.version, definition: meta.definition };
  }

  /**
   * Activates a specific version of a harness.
   * This might involve updating a 'current' pointer or deploying the new version.
   * For now, we'll assume the 'version' in the operationalCycles table implies activation.
   * A more complex system might have an 'activeVersion' field in a separate table.
   * @param harnessId The ID of the harness.
   * @param version The version to activate.
   * @returns True if activation was successful, false otherwise.
   */
  async activateHarness(harnessId: string, version: string): Promise<boolean> {
    const harness = await this.getHarness(harnessId, version);
    return harness !== null;
  }

  /**
   * Lists all available versions for a given harness.
   * @param harnessId The ID of the harness.
   * @returns A list of available versions.
   */
  async listHarnessVersions(harnessId: string): Promise<string[]> {
    const rows = await db.select({ metadata: operationalCycles.metadata }).from(operationalCycles)
      .where(sql`${operationalCycles.metadata}->>'harnessId' = ${harnessId}`);
    return rows
      .map(r => ((r.metadata as any) || {}).version)
      .filter((v): v is string => typeof v === 'string');
  }

  /**
   * Saves a new version of a harness.
   * @param harnessId The ID of the harness.
   * @param version The new version to save.
   * @param definition The harness definition (YAML content).
   * @returns The saved harness.
   */
  async saveHarnessVersion(harnessId: string, version: string, definition: any): Promise<any> {
    const [savedHarness] = await db.insert(operationalCycles).values({
      name: harnessId,
      objective: `Harness version ${version} for ${harnessId}`,
      status: 'active',
      createdBy: 'System',
      metadata: {
        harnessId,
        version,
        definition
      }
    }).returning();
    
    return {
      id: (savedHarness.metadata as any).harnessId,
      version: (savedHarness.metadata as any).version,
      definition: (savedHarness.metadata as any).definition
    };
  }

  /**
   * Deletes a specific version of a harness.
   * @param harnessId The ID of the harness.
   * @param version The version to delete.
   * @returns True if deletion was successful, false otherwise.
   */
  async deleteHarnessVersion(harnessId: string, version: string): Promise<boolean> {
    const [found] = await db.select({ id: operationalCycles.id }).from(operationalCycles)
      .where(and(
        sql`${operationalCycles.metadata}->>'harnessId' = ${harnessId}`,
        sql`${operationalCycles.metadata}->>'version' = ${version}`,
      ))
      .limit(1);
    if (!found) return false;
    await db.delete(operationalCycles).where(eq(operationalCycles.id, found.id));
    return true;
  }
}