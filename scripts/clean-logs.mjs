import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const logsDir = path.join(rootDir, "logs");

if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

console.log("🧹 [LOG CLEANUP] Sweeping root directory for temporary logs and screenshots...");

const files = fs.readdirSync(rootDir);
let movedCount = 0;

for (const file of files) {
  const fullPath = path.join(rootDir, file);
  const stat = fs.statSync(fullPath);

  if (stat.isFile()) {
    const isTempLog = file.endsWith(".log") && file !== "package-lock.json";
    const isTempScreenshot = file.startsWith("tmp-") && file.endsWith(".png");

    if (isTempLog || isTempScreenshot) {
      const destPath = path.join(logsDir, file);
      try {
        fs.renameSync(fullPath, destPath);
        movedCount++;
      } catch (err) {
        // If locked by running process, skip
      }
    }
  }
}

console.log(`✨ [LOG CLEANUP] Successfully archived ${movedCount} temp file(s) into /logs directory.`);
