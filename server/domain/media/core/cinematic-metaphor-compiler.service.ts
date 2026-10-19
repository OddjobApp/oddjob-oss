/**
 * Cinematic Metaphor Compiler Service
 *
 * Bridges Scribe Studio vaulted/sensitive narrative scenes to video rendering engines:
 *
 * 1. If videoEngine === "comfyui" (Local, Uncensored):
 *    - Keeps the unredacted cinematic prompt intact.
 *    - Formats payload for local ComfyUI execution (e.g. http://localhost:8188).
 *    - Zero modification or loss of visceral detail.
 *
 * 2. If videoEngine === "fal" (Seedance / Cloud API):
 *    - Automatically transforms explicit physical, romantic, or graphic forensic beats
 *      into evocative, high-art cinematic metaphors (lighting, shadows, angles, cutaways,
 *      sensory atmosphere) that pass cloud moderation gates while preserving narrative drama.
 */

import type { ScribeVaultClassification } from "@shared/schema/scribe.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("CinematicMetaphorCompilerService");

export interface MetaphorCompilerInput {
    rawPrompt: string;
    videoEngine: "fal" | "comfyui";
    classifications?: ScribeVaultClassification[];
    style?: string;
}

export interface MetaphorCompilerResult {
    effectivePrompt: string;
    targetEngine: "fal" | "comfyui";
    isMetaphorApplied: boolean;
    detectedClassifications: ScribeVaultClassification[];
    metaphorTransformations: Array<{
        category: ScribeVaultClassification;
        rule: string;
        appliedMetaphor: string;
    }>;
}

export class CinematicMetaphorCompilerService {
    /**
     * Patterns commonly flagged by cloud video moderation (Fal.ai / Seedance).
     */
    private static readonly SENSITIVE_PATTERNS: Record<ScribeVaultClassification, RegExp[]> = {
        adult: [
            /\b(naked|nude|nudity|sexual|erotic|intercourse|kiss(?:ing)?\s+passionately|strip(?:ping)?|breast|groin|cleavage|moan(?:ing)?)\b/gi,
        ],
        violence: [
            /\b(blood(?:y)?|gore|gory|slit\s+throat|stabbing|decapitat(?:e|ed|ion)|dismember(?:ed)?|mutilat(?:e|ed)|gruesome|brain\s+matter)\b/gi,
        ],
        forensic: [
            /\b(autopsy|corpse\s+dissection|morgue\s+incision|cadaver\s+slice|putrefaction|decaying\s+flesh)\b/gi,
        ],
        confidential: [
            /\b(classified|top\s+secret|confidential\s+token|proprietary\s+formula)\b/gi,
        ],
        pii: [
            /\b(ssn|social\s+security|credit\s+card|password|private\s+key)\b/gi,
        ],
        ip: [
            /\b(patent|trade\s+secret|proprietary\s+source\s+code|confidential\s+design)\b/gi,
        ],
    };

    /**
     * Cinematic visual metaphors for cloud-safe rendering.
     */
    private static readonly METAPHOR_LIBRARIES: Record<ScribeVaultClassification, string[]> = {
        adult: [
            "intimate candlelit low-key lighting, warm amber bokeh, soft focus silhouette of lovers, slow tracking shot past fluttering sheer curtains, poetic cinematic romance",
            "golden hour illumination dancing across clasped hands, shallow depth of field, gentle embrace in warm backlight, evocative atmospheric cinema",
            "dramatic chiaroscuro lighting, intertwined shadows on textured Venetian wall, slow graceful pan across silhouettes, sultry vintage cinema tone",
        ],
        violence: [
            "high-contrast noir shadows, sudden flash of lightning illuminating rain-slicked pavement, sharp canted Dutch angle, dramatic silhouette against stormy neon backdrop",
            "camera whips dynamically to a rain-streaked window pane as thunder cracks, deep crimson neon reflection bouncing on asphalt, intense cinematic tension",
            "extreme close-up on clenching fist in pouring rain, visceral cinematic sound design cue, dramatic low-angle shadow work",
        ],
        forensic: [
            "sterile high-key fluorescent examination lights reflecting off stainless steel trays, clinical precision camera movement, chilled mist rising from refrigeration unit",
            "shadowed silhouettes hovering over medical examination table, cold cyan palette, slow macro glide across chrome instruments",
        ],
        confidential: [
            "gloved hands sliding a wax-sealed leather portfolio across a dark mahogany executive desk, low pool of incandescent green banker-lamp light",
        ],
        pii: [
            "dramatic macro focus on an antique typewriter striking heavy archival paper, shadows concealing identity details",
        ],
        ip: [
            "dramatic silhouette of an inventor studying holographic schematics, glowing geometric lines reflecting in spectacles, cinematic atmosphere",
        ],
    };

    /**
     * Detect classifications from raw text if not explicitly provided.
     */
    detectClassifications(text: string): ScribeVaultClassification[] {
        const detected: ScribeVaultClassification[] = [];
        for (const [classification, patterns] of Object.entries(CinematicMetaphorCompilerService.SENSITIVE_PATTERNS)) {
            for (const pattern of patterns) {
                if (pattern.test(text)) {
                    detected.push(classification as ScribeVaultClassification);
                    break;
                }
            }
        }
        return detected;
    }

    /**
     * Compile prompt according to the target video engine.
     */
    compilePrompt(input: MetaphorCompilerInput): MetaphorCompilerResult {
        const detected = input.classifications && input.classifications.length > 0
            ? input.classifications
            : this.detectClassifications(input.rawPrompt);

        // 1. Local ComfyUI: Deliver raw unredacted prompt
        if (input.videoEngine === "comfyui") {
            logger.info("Local ComfyUI selected: dispatching unredacted raw prompt", {
                detectedCount: detected.length,
            });

            return {
                effectivePrompt: input.rawPrompt,
                targetEngine: "comfyui",
                isMetaphorApplied: false,
                detectedClassifications: detected,
                metaphorTransformations: [],
            };
        }

        // 2. Cloud Fal.ai (Seedance): If sensitive, compile into cinematic metaphors
        if (detected.length === 0) {
            return {
                effectivePrompt: input.rawPrompt,
                targetEngine: "fal",
                isMetaphorApplied: false,
                detectedClassifications: [],
                metaphorTransformations: [],
            };
        }

        let compiled = input.rawPrompt;
        const transformations: MetaphorCompilerResult["metaphorTransformations"] = [];

        for (const category of detected) {
            const patterns = CinematicMetaphorCompilerService.SENSITIVE_PATTERNS[category] || [];
            const metaphors = CinematicMetaphorCompilerService.METAPHOR_LIBRARIES[category] || [];
            const chosenMetaphor = metaphors[0] || "cinematic atmospheric lighting and dramatic shadows";

            for (const pattern of patterns) {
                if (pattern.test(compiled)) {
                    compiled = compiled.replace(pattern, (match) => {
                        transformations.push({
                            category,
                            rule: `Replaced explicit '${match}' with cinematic metaphor`,
                            appliedMetaphor: chosenMetaphor,
                        });
                        return "";
                    });
                }
            }

            // Append the high-art metaphor framing
            compiled = `${compiled.trim()}. ${chosenMetaphor}`;
        }

        // Clean up double punctuation or awkward whitespace
        compiled = compiled.replace(/\s{2,}/g, " ").replace(/\.{2,}/g, ".").trim();

        logger.info("Fal.ai cloud selected: compiled prompt with cinematic metaphors", {
            transformationsCount: transformations.length,
            categories: detected,
        });

        return {
            effectivePrompt: compiled,
            targetEngine: "fal",
            isMetaphorApplied: true,
            detectedClassifications: detected,
            metaphorTransformations: transformations,
        };
    }
}

export const cinematicMetaphorCompiler = new CinematicMetaphorCompilerService();
