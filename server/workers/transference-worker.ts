import { Job } from "bullmq";
import { QUEUE_NAMES } from "@domain/core/infrastructure/queue/queue-service.js";
import { TransferenceRouter } from "@domain/agents/core/transference-router.js";
import { trainClassifierForPromptHash } from "@domain/agents/core/train-classifier.js";
import { BaseWorker } from "./base-worker.js";

/**
 * TransferenceWorker
 *
 * Processes background Transference Engine operations:
 *   - "mine"         : Scan execution logs for new candidates (daily schedule)
 *   - "retrainCheck" : Re-evaluate shadow accuracy on a candidate to see if it is ready for promotion
 */
export class TransferenceWorker extends BaseWorker {
    constructor() {
        super(QUEUE_NAMES.TRANSFERENCE, {
            concurrency: 2,
        });
    }

    protected async execute(job: Job): Promise<any> {
        const { type, data } = job.data as { type: string; data: any };

        switch (type) {
            case "mine": {
                this.logger.info("[TransferenceWorker] Running candidate mining...");
                await TransferenceRouter.mineTransferenceCandidates();
                this.logger.info("[TransferenceWorker] Candidate mining complete.");
                return { ok: true };
            }

            case "retrainCheck": {
                const { promptHash, llmOutput, inputVariables } = data as {
                    promptHash: string;
                    llmOutput: string;
                    inputVariables: Record<string, any>;
                };
                this.logger.info(`[TransferenceWorker] Shadow accuracy check for ${promptHash}`);
                await TransferenceRouter.trackShadowAccuracyForHash(promptHash, llmOutput, inputVariables);
                return { ok: true };
            }

            case "train": {
                const { promptHash } = data as { promptHash: string };
                this.logger.info(`[TransferenceWorker] Training model for prompt hash ${promptHash}...`);
                const result = await trainClassifierForPromptHash(promptHash);
                return result;
            }

            case "distill_slm_adapter": {
                const { promptHash } = data as { promptHash: string };
                this.logger.info(`[TransferenceWorker] Distilling SLM adapter for prompt hash ${promptHash}...`);
                const { slmAdapterDistillerService } = await import("@domain/agents/core/slm-adapter-distiller.service.js");
                const res = await slmAdapterDistillerService.distillAdapterForPromptHash(promptHash);
                return res;
            }

            default:
                this.logger.warn(`[TransferenceWorker] Unknown job type: ${type}`);
                return { ok: false };
        }
    }
}

let workerInstance: TransferenceWorker | null = null;

export function startTransferenceWorker() {
    if (!workerInstance) {
        workerInstance = new TransferenceWorker();
    }
    return workerInstance;
}
