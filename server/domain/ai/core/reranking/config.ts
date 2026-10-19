/**
 * Reranking Configuration — Load & Persist
 *
 * Manages RerankBackendConfig storage in the system_settings table.
 * Key: "reranking.config"
 *
 * On first run (no row present), falls back to a hardcoded default config.
 * Supports runtime config updates via saveRerankingConfig().
 *
 * Requirements: 2.3, 2.5
 */

import { db } from "@server/database_service.js";
import { systemSettings } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import type { RerankBackendConfig } from "./types.js";

const logger = createLogger("RerankingConfig");

/** The system_settings key used for reranking configuration. */
const CONFIG_KEY = "reranking.config";

/**
 * Default reranking configuration used when no persisted config exists.
 * LLM is the default backend since it requires no external services beyond
 * the platform's existing LLM Router.
 */
export const DEFAULT_RERANKING_CONFIG: RerankBackendConfig = {
  defaultBackend: "llm",
  priorityOrder: ["cohere", "local", "llm"],
  cohere: {
    model: "rerank-v3.5",
    apiKeyEnvVar: "COHERE_API_KEY",
  },
  local: {
    endpoint: "http://localhost:11434",
    model: "cross-encoder/ms-marco-MiniLM-L-6-v2",
    batchSize: 32,
    timeoutMs: 10000,
  },
  llm: {
    maxDocsPerPrompt: 20,
    temperature: 0,
  },
};

/**
 * Load reranking configuration from the system settings store.
 * Falls back to DEFAULT_RERANKING_CONFIG if no row is found or on error.
 */
export async function loadRerankingConfig(): Promise<RerankBackendConfig> {
  try {
    const [row] = await db
      .select()
      .from(systemSettings)
      .where(eq(systemSettings.key, CONFIG_KEY))
      .limit(1);

    if (!row || !row.settingsData) {
      logger.info("No persisted reranking config found, using defaults");
      return { ...DEFAULT_RERANKING_CONFIG };
    }

    const data = row.settingsData as Record<string, any>;

    // Validate minimum shape — must have defaultBackend and priorityOrder
    if (!data.defaultBackend || !Array.isArray(data.priorityOrder)) {
      logger.warn("Persisted reranking config is malformed, using defaults");
      return { ...DEFAULT_RERANKING_CONFIG };
    }

    logger.info("Loaded reranking config from system settings", {
      defaultBackend: data.defaultBackend,
      priorityOrder: data.priorityOrder,
    });

    return data as RerankBackendConfig;
  } catch (error) {
    logger.error("Failed to load reranking config, using defaults", error);
    return { ...DEFAULT_RERANKING_CONFIG };
  }
}

/**
 * Persist reranking configuration to the system settings store (upsert).
 * Called by RerankingService.updateConfig() to support runtime config changes.
 */
export async function saveRerankingConfig(config: RerankBackendConfig): Promise<void> {
  try {
    await db
      .insert(systemSettings)
      .values({
        key: CONFIG_KEY,
        settingsData: config as any,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: {
          settingsData: config as any,
          updatedAt: new Date(),
        },
      });

    logger.info("Saved reranking config to system settings", {
      defaultBackend: config.defaultBackend,
      priorityOrder: config.priorityOrder,
    });
  } catch (error) {
    logger.error("Failed to save reranking config", error);
    throw error;
  }
}
