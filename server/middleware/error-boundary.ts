/**
 * Global Error Boundary
 * 
 * catches process-level exceptions (uncaughtException, unhandledRejection)
 * and logs them before ensuring a graceful shutdown if necessary.
 */

import { createLogger } from "../utils/logger.js";
import { errorDiagnosisEngine } from "@domain/diagnostics/index.js";

const logger = createLogger("ErrorBoundary");

export function setupErrorBoundary() {
    process.on("uncaughtException", async (error: Error) => {
        logger.error("UNCAUGHT EXCEPTION - Process state compromised", error);

        try {
            // Attempt to diagnose even in critical state (fire and forget)
            await errorDiagnosisEngine.diagnose({
                error,
                errorCode: "CRITICAL_PROCESS_FAILURE",
                httpStatus: 500,
                requestUrl: "process:uncaughtException"
            }, { includeAI: false }); // No AI in critical path
        } catch (e) {
            // Ignore diagnosis failure
        }

        // In production, we should exit.
        // In development, we might keep running but it's risky.
        if (process.env.NODE_ENV === "production") {
            process.exit(1);
        }
    });

    process.on("unhandledRejection", (reason: any, promise: Promise<any>) => {
        logger.error("UNHANDLED REJECTION", { reason });

        // Unhandled rejections are deprecated and will terminate the process in future Node versions.
        // For now, we log it.
        if (reason instanceof Error) {
            errorDiagnosisEngine.diagnose({
                error: reason,
                errorCode: "UNHANDLED_REJECTION",
                httpStatus: 500,
                requestUrl: "process:unhandledRejection"
            }, { includeAI: false }).catch(() => { });
        }
    });

    logger.info("Global Error Boundary installed (Uncaught Exception & Unhandled Rejection listeners)");
}

