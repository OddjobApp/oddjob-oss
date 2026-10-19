import { missionService } from "./mission.service.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("QMDWorker");

/**
 * QMD (Queued-Modify-Data) Worker
 * Processes blackboard updates asynchronously from a Redis stream.
 */
export async function startQMDWorker() {
    const { redis } = await import("@domain/core/infrastructure/redis/redis-client.js");
    if (!redis) {
        logger.error("[QMDWorker] Redis not available; QMD worker cannot start.");
        return;
    }

    const STREAM_KEY = 'mission:blackboard:updates';
    const GROUP_NAME = 'mission-service-group';
    const CONSUMER_NAME = `consumer-${process.pid}`;

    // 1. Create consumer group if not exists
    try {
        await redis.xgroup('CREATE', STREAM_KEY, GROUP_NAME, '$', 'MKSTREAM');
        logger.info(`[QMDWorker] Consumer group ${GROUP_NAME} created.`);
    } catch (err: any) {
        if (!err.message.includes('BUSYGROUP')) {
            logger.error(`[QMDWorker] Failed to create consumer group: ${err.message}`);
        }
    }

    logger.info(`[QMDWorker] Starting QMD background worker (PID: ${process.pid})...`);

    while (true) {
        try {
            // Read new messages from the stream
            const results = await redis.xreadgroup(
                'GROUP', GROUP_NAME, CONSUMER_NAME,
                'COUNT', '10',
                'BLOCK', '5000',
                'STREAMS', STREAM_KEY, '>'
            ) as any;

            if (!results) continue;

            for (const [stream, messages] of results) {
                for (const [id, fields] of messages) {
                    // Extract payload from fields (alternating keys and values)
                    let payloadStr: string | undefined;
                    for (let i = 0; i < fields.length; i += 2) {
                        if (fields[i] === 'payload') {
                            payloadStr = fields[i + 1];
                            break;
                        }
                    }

                    if (payloadStr) {
                        let parsed: any;
                        try {
                            parsed = JSON.parse(payloadStr);
                        } catch (parseErr: any) {
                            logger.error(`[QMDWorker] Malformed payload in message ${id}, skipping: ${parseErr.message}`);
                            await redis.xack(STREAM_KEY, GROUP_NAME, id).catch(() => {});
                            continue;
                        }

                        const { missionId, newContent, changedBy, reason } = parsed;
                        try {
                            logger.debug(`[QMDWorker] Processing update for mission ${missionId} (Reason: ${reason})`);
                            await missionService.updateBlackboard(missionId, newContent, changedBy, reason);
                            try {
                                const { blackboardKnowledgeExtractionService } = await import("./blackboard-knowledge-extraction.service.js");
                                await blackboardKnowledgeExtractionService.process({
                                    missionId,
                                    patch: newContent,
                                    changedBy,
                                    reason,
                                    streamId: id,
                                });
                            } catch (extractErr: any) {
                                logger.warn(`[QMDWorker] Knowledge extraction failed for ${id}: ${extractErr.message}`);
                            }

                            // Acknowledge the message
                            await redis.xack(STREAM_KEY, GROUP_NAME, id);
                            // Delete the message from stream to keep it clean
                            await redis.xdel(STREAM_KEY, id);
                        } catch (processErr: any) {
                            logger.error(`[QMDWorker] Failed to process blackboard update ${id} for mission ${missionId}: ${processErr.message}`);
                        }
                    }
                }
            }
        } catch (err: any) {
            logger.error(`[QMDWorker] Loop error: ${err.message}`);
            // Wait a bit before retrying on error
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
}


