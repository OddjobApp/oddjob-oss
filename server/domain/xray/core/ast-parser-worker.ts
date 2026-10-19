import { parentPort, workerData } from "node:worker_threads";
import { codeParserService } from "./code-parser.service.js";

/**
 * AST Parser Worker Thread Script:
 * Offloads heavy TypeScript Compiler API AST structural parsing off the main process event loop.
 */
async function runWorkerParse() {
    if (!parentPort || !workerData?.workspacePath) return;

    try {
        const result = await codeParserService.parseWorkspaceStructural(workerData.workspacePath);
        parentPort.postMessage({ success: true, result });
    } catch (err: any) {
        parentPort.postMessage({ success: false, error: err.message });
    }
}

runWorkerParse();
