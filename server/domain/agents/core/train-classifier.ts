import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { db } from "@server/database_service.js";
import { aiExecutionLogs, transferenceRules } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";

const execAsync = promisify(exec);
const logger = createLogger("TrainClassifier");

export async function trainClassifierForPromptHash(promptHash: string): Promise<{ success: boolean; modelPath?: string; error?: string }> {
    try {
        logger.info(`[TrainClassifier] Starting model training for hash ${promptHash}...`);
        
        // 1. Fetch historical execution logs
        const logs = await db.select()
            .from(aiExecutionLogs)
            .where(eq(aiExecutionLogs.promptHash, promptHash))
            .limit(1000);

        if (logs.length < 10) {
            logger.warn(`[TrainClassifier] Insufficient logs for training (${logs.length} found, minimum 10 required)`);
            return { success: false, error: "Insufficient training data" };
        }

        // 2. Prepare temp directories
        const dir = path.join(process.cwd(), "server", "config", "transference", "models", promptHash);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        const csvPath = path.join(dir, "training_data.csv");
        const modelPath = path.join(dir, "model.joblib");
        const handlerPath = path.join(dir, "handler.py");

        // Escape CSV content
        const rows = ["input_text,target_output"];
        for (const log of logs) {
            const inputClean = JSON.stringify(log.inputVariables || {}).replace(/"/g, '""');
            const outputClean = String(log.rawOutput || "").replace(/"/g, '""');
            rows.push(`"${inputClean}","${outputClean}"`);
        }
        fs.writeFileSync(csvPath, rows.join("\n"), "utf-8");

        // 3. Shell out to Python script
        const pythonScript = path.join(process.cwd(), "server", "config", "transference", "train_classifier.py");
        const { stdout } = await execAsync(`python "${pythonScript}" "${csvPath}" "${modelPath}"`);
        
        const result = JSON.parse(stdout.trim());
        if (!result.success) {
            logger.error(`[TrainClassifier] Python training failed: ${result.error}`);
            return { success: false, error: result.error };
        }

        // 4. Write local handler wrapper
        const templatePath = path.join(process.cwd(), "server", "config", "transference", "handler_template.py");
        let templateContent = fs.readFileSync(templatePath, "utf-8");
        // Embed modelPath directly into handler if env variable is unset
        templateContent = `import os\nos.environ['TRANSFERENCE_MODEL_PATH'] = r"${modelPath.replace(/\\/g, "\\\\")}"\n` + templateContent;
        fs.writeFileSync(handlerPath, templateContent, "utf-8");

        // 5. Update database rule record
        await db.update(transferenceRules)
            .set({
                handlerPath: handlerPath,
                updatedAt: new Date(),
            })
            .where(eq(transferenceRules.promptHash, promptHash));

        logger.info(`[TrainClassifier] Model training completed successfully for ${promptHash}. Model saved to ${modelPath}`);
        return { success: true, modelPath };
    } catch (err: any) {
        logger.error(`[TrainClassifier] Exception during training for ${promptHash}: ${err.message}`);
        return { success: false, error: err.message };
    }
}
