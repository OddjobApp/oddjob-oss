import yaml from "js-yaml";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("BlueprintYamlUtil");

function isObject(item: any): boolean {
    return item && typeof item === "object" && !Array.isArray(item);
}

/**
 * Deep merge two objects. `source` wins on scalar/array conflicts; nested
 * objects are merged recursively.
 */
export function deepMerge(target: any, source: any): any {
    const output = { ...target };

    if (isObject(target) && isObject(source)) {
        Object.keys(source).forEach(key => {
            if (isObject(source[key])) {
                if (!(key in target)) {
                    Object.assign(output, { [key]: source[key] });
                } else {
                    output[key] = deepMerge(target[key], source[key]);
                }
            } else {
                Object.assign(output, { [key]: source[key] });
            }
        });
    }

    return output;
}

/**
 * Apply environment-specific overrides to YAML content. Blueprints may carry an
 * `environment_overrides.<env>` block that is deep-merged into the base manifest
 * when installing for a non-default environment.
 */
export function applyEnvironmentOverrides(yamlContent: string, environment: string): string {
    if (environment === "default") {
        return yamlContent;
    }

    logger.info(`[OrgForge] Applying environment overrides for: ${environment}`);

    const manifest = yaml.load(yamlContent) as any;
    if (!manifest) return yamlContent;

    // Check for environment-specific overrides section
    if (manifest.environment_overrides && manifest.environment_overrides[environment]) {
        const overrides = manifest.environment_overrides[environment];

        // Deep merge overrides into base configuration
        const merged = deepMerge(manifest, overrides);

        // Remove the environment_overrides section from the merged result
        delete merged.environment_overrides;

        return yaml.dump(merged);
    }

    return yamlContent;
}

/**
 * Compose multiple blueprint files into a single manifest. Supports importing
 * sub-blueprints and merging configurations onto a base blueprint.
 */
export function composeBlueprints(baseYaml: string, additionalBlueprints: Array<{ name: string; yaml: string }>): string {
    logger.info(`[OrgForge] Composing ${additionalBlueprints.length} additional blueprints into base`);

    let composed = yaml.load(baseYaml) as any;
    if (!composed) {
        throw new Error("Invalid base blueprint");
    }

    for (const blueprint of additionalBlueprints) {
        logger.info(`[OrgForge] Merging blueprint: ${blueprint.name}`);

        const additional = yaml.load(blueprint.yaml) as any;
        if (!additional) {
            logger.warn(`[OrgForge] Skipping invalid blueprint: ${blueprint.name}`);
            continue;
        }

        // Deep merge additional blueprint into composed
        composed = deepMerge(composed, additional);
    }

    // Ensure composed blueprint has required fields
    if (!composed.name) {
        composed.name = "composed-blueprint";
    }
    if (!composed.version) {
        composed.version = "1.0.0";
    }

    return yaml.dump(composed);
}
