export interface SlackWorkspaceSettings {
    defaultChannel?: string | null;
    notifyOnMissionComplete?: boolean;
    notifyOnJobFailure?: boolean;
    notifyOnApproval?: boolean;
    notifyOnAppLaunched?: boolean;
}

const BOOLEAN_SETTINGS = [
    "notifyOnMissionComplete",
    "notifyOnJobFailure",
    "notifyOnApproval",
    "notifyOnAppLaunched",
] as const;

export function normalizeSlackWorkspaceSettings(value: unknown): SlackWorkspaceSettings {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError("Workspace settings must be an object");
    }

    const input = value as Record<string, unknown>;
    const settings: SlackWorkspaceSettings = {};

    if ("defaultChannel" in input) {
        if (input.defaultChannel !== null && typeof input.defaultChannel !== "string") {
            throw new TypeError("defaultChannel must be a string or null");
        }
        settings.defaultChannel = input.defaultChannel as string | null;
    }

    for (const key of BOOLEAN_SETTINGS) {
        if (!(key in input)) continue;
        if (typeof input[key] !== "boolean") {
            throw new TypeError(`${key} must be a boolean`);
        }
        settings[key] = input[key];
    }

    if (Object.keys(settings).length === 0) {
        throw new TypeError("No supported workspace settings were provided");
    }

    return settings;
}
