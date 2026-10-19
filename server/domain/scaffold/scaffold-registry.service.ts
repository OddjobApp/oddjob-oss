import fs from "node:fs/promises";
import path from "node:path";
import { PackManifestSchema, type PackManifest } from "@shared/schema/scaffold.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("ScaffoldRegistryService");

export class ScaffoldRegistryService {
  private registryDir: string;
  private packCache: Map<string, PackManifest> = new Map();

  constructor(customRegistryDir?: string) {
    this.registryDir = customRegistryDir || path.resolve(process.cwd(), "packages/scaffold-registry");
  }

  public async loadAllPacks(forceReload: boolean = false): Promise<PackManifest[]> {
    if (!forceReload && this.packCache.size > 0) {
      return Array.from(this.packCache.values());
    }
    this.packCache.clear();
    await this.scanDirectory(this.registryDir);
    return Array.from(this.packCache.values());
  }

  public async getPack(packId: string): Promise<PackManifest | undefined> {
    if (this.packCache.size === 0) {
      await this.loadAllPacks();
    }
    return this.packCache.get(packId);
  }

  private async scanDirectory(dirPath: string): Promise<void> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          await this.scanDirectory(fullPath);
        } else if (entry.isFile() && entry.name === "pack.json") {
          try {
            const raw = await fs.readFile(fullPath, "utf-8");
            const parsed = JSON.parse(raw);
            const validated = PackManifestSchema.parse(parsed);
            (validated as any).packDir = path.dirname(fullPath);
            this.packCache.set(validated.id, validated);
            logger.info(`[ScaffoldRegistry] Loaded pack '${validated.id}' (${validated.name})`);
          } catch (err: any) {
            logger.warn(`[ScaffoldRegistry] Failed to parse pack manifest at ${fullPath}: ${err.message}`);
          }
        }
      }
    } catch {
      // Directory doesn't exist or unreadable
    }
  }
}

export const scaffoldRegistryService = new ScaffoldRegistryService();
