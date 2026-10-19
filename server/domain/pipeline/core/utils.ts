import { adminService } from "../../admin/admin.service.js";

/**
 * Safely parse JSON that might be double-stringified (common with LLM outputs)
 */
export function safeJsonParse(input: string): any {
    if (!input) return null;
    try {
        const parsed = JSON.parse(input);
        // If result is still a string and looks like a JSON object/array, try parsing again
        if (typeof parsed === 'string' && (parsed.trim().startsWith('{') || parsed.trim().startsWith('['))) {
            try {
                return JSON.parse(parsed);
            } catch (e) {
                return parsed;
            }
        }
        return parsed;
    } catch (e) {
        return null; // Silent fail on non-JSON
    }
}

/**
 * Check if a specific feature is enabled for an organization
 */
export async function checkOrgFeatureEnabled(
    organizationId: number | null,
    feature: 'knowledgeStore' | 'knowledgeGraph' | 'datasets'
): Promise<boolean> {
    if (!organizationId) return true; // Default enabled if no org

    try {
        const settings = await adminService.getOrgSettings(organizationId);
        if (!settings) return true; // Default enabled if no settings

        return feature === 'knowledgeStore'
            ? settings.knowledgeStoreEnabled
            : feature === 'knowledgeGraph'
                ? settings.knowledgeGraphEnabled
                : (settings as any).datasetsEnabled;
    } catch (error) {
        console.error(`[checkOrgFeatureEnabled] Error checking org feature ${feature}:`, error);
        return true; // Default to enabled on error
    }
}


