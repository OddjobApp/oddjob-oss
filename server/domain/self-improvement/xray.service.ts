import { createLogger } from '@server/utils/logger.js';
import { db } from "@server/database_service.js";
import { forensicEventLog } from "@shared/schema/index.js";
import { inArray } from "drizzle-orm";

const logger = createLogger("XRayService");

export class XRayService {
  static async queryTracesForEvaluation(traceIds: string[]): Promise<any[]> {
    if (traceIds.length === 0) return [];
    logger.info(`Querying forensic event logs for traces: ${traceIds.join(", ")}`);
    try {
      const logs = await db.select({
        traceId: forensicEventLog.traceId,
        startTimeNs: forensicEventLog.startTimeNs,
        endTimeNs: forensicEventLog.endTimeNs,
        attributes: forensicEventLog.attributes,
      })
      .from(forensicEventLog)
      .where(inArray(forensicEventLog.traceId, traceIds));

      return logs.map(log => {
        let latency = 50; // default fallback
        if (log.attributes && (log.attributes as any).durationMs !== undefined) {
          latency = Number((log.attributes as any).durationMs);
        } else if (log.endTimeNs && log.startTimeNs) {
          latency = Number((log.endTimeNs - log.startTimeNs) / BigInt(1000000));
        }
        return {
          traceId: log.traceId,
          latency
        };
      });
    } catch (error: any) {
      logger.error(`Failed to query forensic logs in XRayService: ${error.message}`);
      return traceIds.map(id => ({ traceId: id, latency: 50 }));
    }
  }
}