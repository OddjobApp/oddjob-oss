import { Job } from "@shared/schema/index.js";
import path from "path";

export async function saveJobOutput(
    job: Job,
    config: { saveOutputToFile?: boolean; screenshotDirectory?: string },
    output: any,
    defaultSubDir: string = "extractions"
) {
    if (!config.saveOutputToFile) return;

    try {
        const { fileStorageSuccess } = await import("../../../knowledge/core/file-storage.js");
        const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 12); // YYYYMMDDHHMM
        const jobNameSafe = job.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const folderName = `${jobNameSafe}_${timestamp}`;

        const baseDir = config.screenshotDirectory || defaultSubDir;
        const orgId = job.organizationId || null;

        const fileName = `output.json`;
        const filePath = path.join(baseDir, folderName, fileName);
        const content = typeof output === 'string' ? output : JSON.stringify(output, null, 2);

        await fileStorageSuccess.saveFile(orgId, filePath, content);

        console.log(`[JobExecutor] Saved output to ${path.join(baseDir, folderName)}`);
    } catch (err: any) {
        console.error(`[JobExecutor] Failed to save output to file: ${err.message}`);
    }
}


