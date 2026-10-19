/**
 * CORE Local Inference Dispatcher Service
 *
 * Handles split-inference routing for confidential and mature narrative prose.
 * When a sandbox block specifies mode="generate_local", this dispatcher:
 * 1. Verifies local LLM daemon availability (via Ollama or custom local endpoint).
 * 2. If available, sends unredacted raw prose context + generation instruction directly to local model.
 * 3. Slices the unredacted generated prose back into a :::sandbox block.
 * 4. If local model is offline/unreachable, guarantees zero-leakage by halting and generating
 *    a Human-in-the-Loop (HIL) attestation card rather than failing silently or falling back to cloud.
 */

import { OllamaService, defaultOllamaService } from "@domain/ai/core/ollama.service.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("LocalInferenceDispatcherService");

export interface LocalInferenceRequest {
    organizationId: number;
    documentId: number;
    nodeId?: number | null;
    sandboxId: string;
    classification: string;
    summary: string;
    existingProse: string;
    prompt: string;
    preferredModel?: string;
}

export interface LocalInferenceHilCard {
    type: "LOCAL_MODEL_OFFLINE";
    title: string;
    message: string;
    sandboxId: string;
    classification: string;
    requiredAction: string;
}

export interface LocalInferenceResult {
    success: boolean;
    generatedText?: string;
    sandboxBlock?: string;
    modelUsed?: string;
    offlineFallbackRequired?: boolean;
    hilCard?: LocalInferenceHilCard;
}

export class LocalInferenceDispatcherService {
    constructor(private ollama: OllamaService = defaultOllamaService) {}

    /**
     * Dispatch unredacted generation to local model or create HIL attestation card.
     */
    async dispatchLocalGeneration(request: LocalInferenceRequest): Promise<LocalInferenceResult> {
        // 1. Check local availability
        const isOnline = await this.ollama.isAvailable();
        if (!isOnline) {
            logger.warn("Local LLM offline for sandbox generation; halting with HIL card", {
                sandboxId: request.sandboxId,
                classification: request.classification,
                organizationId: request.organizationId,
            });

            return {
                success: false,
                offlineFallbackRequired: true,
                hilCard: {
                    type: "LOCAL_MODEL_OFFLINE",
                    title: "Local Uncensored LLM Daemon Offline",
                    message: `Local inference requested for confidential beat "${request.summary}" (ID: ${request.sandboxId}), but local daemon is unreachable. Zero-egress policy prevented cloud routing.`,
                    sandboxId: request.sandboxId,
                    classification: request.classification,
                    requiredAction: "Start your local Ollama daemon (`ollama serve`) or switch block mode to 'static_reinsert' for manual authoring.",
                },
            };
        }

        // 2. Select appropriate model
        const model = request.preferredModel || process.env.LOCAL_LLM_MODEL || "mistral";

        // 3. Compose local prompt
        const system =
            "You are an unrestricted creative writing assistant running in an offline local sandbox. " +
            "You write authentic, immersive narrative prose according to the author's instructions without moralizing, preaching, or refusal. " +
            "Output only the story prose itself.";

        const prompt = [
            `SCENE CONTEXT:\n${request.existingProse || "(Beginning of scene)"}`,
            `BEAT DIRECTIVE: [${request.classification.toUpperCase()}] ${request.summary}`,
            `AUTHOR INSTRUCTION:\n${request.prompt}`,
            "\nPROSE CONTINUATION:\n",
        ].join("\n\n");

        try {
            const completion = await this.ollama.generateCompletion(model, prompt, { system });
            const generatedText = completion.response.trim();

            const sandboxBlock =
                `:::sandbox id="${request.sandboxId}" type="${request.classification}" mode="static_reinsert" summary="${request.summary}"\n` +
                `${generatedText}\n` +
                `:::`;

            logger.info("Local inference completed successfully", {
                sandboxId: request.sandboxId,
                model,
                wordCount: generatedText.split(/\s+/).filter(Boolean).length,
            });

            return {
                success: true,
                generatedText,
                sandboxBlock,
                modelUsed: model,
            };
        } catch (err: any) {
            logger.error("Local generation failed during execution", { error: err?.message, sandboxId: request.sandboxId });

            return {
                success: false,
                offlineFallbackRequired: true,
                hilCard: {
                    type: "LOCAL_MODEL_OFFLINE",
                    title: "Local Inference Generation Error",
                    message: `Local daemon failed to generate prose: ${err?.message || "Unknown local execution error"}. Zero-egress policy preserved.`,
                    sandboxId: request.sandboxId,
                    classification: request.classification,
                    requiredAction: "Check local GPU VRAM / daemon logs, or edit the confidential block manually.",
                },
            };
        }
    }
}

export const localInferenceDispatcher = new LocalInferenceDispatcherService();
