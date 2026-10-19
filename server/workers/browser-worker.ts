import { Job } from "bullmq";
import { QUEUE_NAMES } from "@domain/core/infrastructure/queue/queue-service.js";
import { SeleniumRunner, type SeleniumExecutionResult } from "../domain/mission/selenium/runner.js";
import { BaseWorker } from "./base-worker.js";

interface BrowserJobData {
    config: any;
    context: any;
    region?: string;
}

export class BrowserWorker extends BaseWorker<BrowserJobData, SeleniumExecutionResult> {
    private runner: SeleniumRunner;

    constructor() {
        super(QUEUE_NAMES.BROWSER, {
            concurrency: parseInt(process.env.BROWSER_CONCURRENCY || "2"),
            lockDuration: 600000, // 10 minutes
        });
        this.runner = new SeleniumRunner();
    }

    protected async execute(job: Job<BrowserJobData>): Promise<SeleniumExecutionResult> {
        const { config, context, region } = job.data;
        // Inject region into config if provided
        const executionConfig = { ...config, region: region || config.region };
        return await this.runner.execute(executionConfig, context);
    }
}

let workerInstance: BrowserWorker | null = null;

export function startBrowserWorker() {
    if (!workerInstance) {
        workerInstance = new BrowserWorker();
    }
    return workerInstance;
}


