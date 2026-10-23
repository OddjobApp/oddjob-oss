import { orgModelService } from "./org-model.service.js";

/** Server-owned state only. Never include secrets, key hints or browser-supplied readiness. */
export async function buildOrgAiReadinessContext(organizationId: number | null | undefined): Promise<string> {
    const heading = "\n## Current organization AI connection (runtime state)\n";
    const unknown = heading + "Status: unknown. Connection status could not be checked. Do not claim keys are missing or ask the user to reconnect based on generic setup documentation. A specific execution error must be reported as returned.\n";
    if (!Number.isSafeInteger(organizationId) || !organizationId || organizationId <= 0) return unknown;
    try {
        const status = await orgModelService.status(organizationId);
        if (!status.configured) {
            return heading + "Status: not configured for this organization. If AI execution is requested, direct the user to Organization Settings to connect an AI provider. Never ask them to paste a key into chat.\n";
        }
        return heading + `Status: configured. Default provider: ${status.provider}. Default model: ${status.model}.
The organization already has an AI connection. Do not ask for API keys, repeat onboarding prerequisites, or claim missions are blocked by missing keys. This current runtime state overrides generic setup prerequisites in retrieved documentation or older conversation messages.
A configured connection does not prove current quota, model access, or every specialist provider is available. If a real tool call fails, explain its actual error and the specific affected capability; do not replace it with an unsupported missing-key diagnosis. Never ask the user to paste secrets into chat.\n`;
    } catch {
        return unknown;
    }
}
