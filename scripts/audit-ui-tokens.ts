import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const scanDirectories = [
  path.join(rootDir, "client", "src"),
  path.join(rootDir, "server", "domain"),
];

interface FileReport {
  filePath: string;
  hardcodedHexCount: number;
  designSystemImports: boolean;
}

function scanFile(filePath: string): FileReport {
  const content = fs.readFileSync(filePath, "utf-8");
  const hexMatches = content.match(/#[0-9a-fA-F]{3,6}\b/g) || [];
  const hasDsImport = content.includes("@oddjob/design-system");

  return {
    filePath: path.relative(rootDir, filePath),
    hardcodedHexCount: hexMatches.length,
    designSystemImports: hasDsImport,
  };
}

function scanDirectory(dirPath: string): string[] {
  let results: string[] = [];
  if (!fs.existsSync(dirPath)) return results;

  const list = fs.readdirSync(dirPath);
  for (const file of list) {
    const fullPath = path.join(dirPath, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      if (file !== "node_modules" && file !== "dist" && file !== ".git") {
        results = results.concat(scanDirectory(fullPath));
      }
    } else if (file.endsWith(".tsx") || file.endsWith(".ts")) {
      results.push(fullPath);
    }
  }
  return results;
}

export function runUiTokenAudit() {
  console.log("=========================================");
  console.log("🎨 Oddjob UI Tokenization Audit Scanner");
  console.log("=========================================");

  const allFiles = scanDirectories.flatMap(scanDirectory);
  const reports = allFiles.map(scanFile);

  const totalFiles = reports.length;
  const filesWithDsImport = reports.filter((r) => r.designSystemImports).length;
  const totalHexCount = reports.reduce((acc, r) => acc + r.hardcodedHexCount, 0);
  const fullyCleanFiles = reports.filter((r) => r.hardcodedHexCount === 0).length;

  const cleanPercentage = Math.round((fullyCleanFiles / totalFiles) * 100);

  console.log(`Total Component Files Scanned: ${totalFiles}`);
  console.log(`Files with @oddjob/design-system Imports: ${filesWithDsImport}`);
  console.log(`Files Completely Free of Hardcoded Hex: ${fullyCleanFiles} (${cleanPercentage}%)`);
  console.log(`Total Hardcoded Hex Occurrences: ${totalHexCount}`);
  console.log("=========================================\n");

  if (totalHexCount > 0) {
    console.log("Top Files Needing Tokenization:");
    const topHexFiles = reports
      .filter((r) => r.hardcodedHexCount > 0)
      .sort((a, b) => b.hardcodedHexCount - a.hardcodedHexCount)
      .slice(0, 10);

    topHexFiles.forEach((r) => {
      console.log(` - ${r.filePath}: ${r.hardcodedHexCount} hardcoded hex colors`);
    });
  }

  return {
    totalFiles,
    filesWithDsImport,
    fullyCleanFiles,
    cleanPercentage,
    totalHexCount,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runUiTokenAudit();
}
