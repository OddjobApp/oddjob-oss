import path from "node:path";
import { createLogger } from "@server/utils/logger.js";
import { imageSynthesisService } from "@domain/ai/core/image-synthesis.service.js";

const logger = createLogger("ForgeAssetService");

/**
 * Forge Asset Service
 * 
 * Orchestrates the synthesis and placement of visual assets (icons, images)
 * into a Forge workspace during the application assembly pipeline.
 */
export const forgeAssetService = {
    /**
     * Fulfills asset synthesis requests from the AI Architect.
     * 
     * @param workspacePath Absolute path to the forge workspace
     * @param requests Map of relative file paths to image prompts (e.g., { "public/icon.png": "Minimalist logo..." })
     * @param orgId Organization ID for AI credentials
     * @param onProgress Optional callback to emit status logs back to the user
     */
    async fulfillAssetRequests(
        workspacePath: string,
        requests: Record<string, string>,
        orgId?: number,
        onProgress?: (msg: string) => Promise<void>
    ) {
        const fileEntries = Object.entries(requests);
        if (fileEntries.length === 0) {
            logger.info("No asset requests found in Architect output.");
            return;
        }

        logger.info(`[ForgeAsset] Fulfilling ${fileEntries.length} visual synthesis requests...`);
        if (onProgress) await onProgress(`Initiating synthesis for ${fileEntries.length} visual assets...`);

        for (const [relPath, prompt] of fileEntries) {
            try {
                if (typeof prompt !== 'string' || !prompt.trim()) {
                    logger.warn(`[ForgeAsset] Invalid prompt for ${relPath}, skipping.`);
                    continue;
                }

                if (onProgress) await onProgress(`Synthesizing asset: ${relPath}...`);
                
                const destPath = path.join(workspacePath, relPath);

                // Security check before rendering: an image costs the org money,
                // and one destined for a blocked path would be paid for and discarded.
                const absoluteWorkspacePath = path.resolve(workspacePath);
                const absoluteDestPath = path.resolve(destPath);

                if (absoluteDestPath !== absoluteWorkspacePath && !absoluteDestPath.startsWith(absoluteWorkspacePath + path.sep)) {
                    logger.warn(`[ForgeAsset] Security violation: Attempted to write asset outside workspace: ${relPath}`);
                    if (onProgress) await onProgress(`Warning: Asset path ${relPath} blocked for security.`);
                    continue;
                }

                await imageSynthesisService.synthesizeImageFile(prompt, orgId, absoluteDestPath);
                
                logger.info(`[ForgeAsset] Successfully fulfilled asset request: ${relPath}`);
            } catch (err: any) {
                logger.error(`[ForgeAsset] Call failed for ${relPath}: ${err.message}`);
                if (onProgress) await onProgress(`Warning: Failed to synthesize ${relPath} - ${err.message}`);
                // Non-fatal: continue with other assets
            }
        }
    }
};
