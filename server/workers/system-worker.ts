import { Job } from "bullmq";
import { QUEUE_NAMES } from "../domain/core/infrastructure/queue/queue-service.js";
import { BaseWorker } from "./base-worker.js";
import { pythonGateway } from "../domain/integrations/core/gateway/python.gateway.js";

export class SystemWorker extends BaseWorker<any, any> {
    constructor() {
        super(QUEUE_NAMES.SYSTEM, {
            concurrency: 5,
        });
    }

    protected async execute(job: Job<any>): Promise<any> {
        const { name } = job;
        const data = job.data;
        this.logger.info(`Executing system job: ${name}`);

        if (name === "execute-python-skill") {
            const { code, args } = data;
            const res = await pythonGateway.executeScript(code, args);
            return res;
        }

        if (name === "swarm-broadcast" || name === "swarm-directed") {
            this.logger.info(`Swarm job received: ${name}. Core message handled locally.`);
            return { success: true };
        }

        throw new Error(`Unsupported system job type: ${name}`);
    }
}

let workerInstance: SystemWorker | null = null;

export function startSystemWorker() {
    if (!workerInstance) {
        workerInstance = new SystemWorker();
    }
    return workerInstance;
}
