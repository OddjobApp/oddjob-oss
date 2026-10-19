import { resolveAiOrganization } from "./ai-org-context.js";
import { orgModelService } from "./org-model.service.js";

/** What to tell a person whose organization has no Gemini key of its own. */
export const ORG_GEMINI_KEY_MISSING =
    "This feature runs on Gemini. Connect your organization's Gemini API key in Organization Settings";

/**
 * The organization's Gemini API key, or null — whatever its default provider.
 *
 * For the features only Gemini runs (embeddings and knowledge search, image
 * generation, speech-to-text): an org whose default is another provider still
 * needs a Gemini key for these, and without one they stay off. Chat and agent
 * work go through the org-aware client, which uses the default. Outside
 * production the platform's GEMINI_API_KEY/GOOGLE_API_KEY stands in, so local
 * development works without connecting one; in production there is no platform
 * fallback -- the same rule OrganizationAIClient and organizationEmbeddings apply.
 *
 * Callers that hand the result to a client whose own default is the platform
 * env key (createGeminiImageGenerator) must pass `?? ""`, not undefined, or the
 * client falls back to the platform key itself.
 */
export async function resolveOrgGeminiKey(organizationId: number | null | undefined): Promise<string | null> {
    const orgId = await resolveAiOrganization(organizationId ?? null);
    const connection = orgId === null ? null : await orgModelService.resolve(orgId, "google");
    if (connection?.apiKey) return connection.apiKey;
    if (process.env.NODE_ENV === "production") return null;
    return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null;
}

export type PlatformKeyProvider = "google" | "openai" | "anthropic" | "fal";

/**
 * The platform's key for `provider` outside production, and "" in production.
 *
 * Only for the `apiKey` argument of the org-aware client (`AIClientFactory` /
 * `aiClient`). That client ignores the argument whenever the organization has
 * its own key, and refuses the call in production when it does not — so this
 * value is what local development runs on, and never what production bills.
 * Anything that builds its own provider client must use resolveOrgGeminiKey.
 */
export function developmentProviderKey(provider: PlatformKeyProvider = "google"): string {
    if (process.env.NODE_ENV === "production") return "";
    if (provider === "openai") return process.env.OPENAI_API_KEY || process.env.OPEN_AI_API_KEY || "";
    if (provider === "anthropic") return process.env.ANTHROPIC_API_KEY || "";
    if (provider === "fal") return process.env.FAL_KEY || "";
    return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_AI_API_KEY || "";
}

/**
 * The fal.ai key to render this organization's video with, or null.
 *
 * The organization's own key (Organization Settings). Outside production the
 * platform's FAL_KEY stands in; production refuses to boot with one.
 */
export async function resolveOrgFalKey(organizationId: number | null | undefined): Promise<string | null> {
    const orgId = await resolveAiOrganization(organizationId ?? null);
    if (orgId !== null) {
        const { orgFalKeyService } = await import("./org-fal-key.service.js");
        const key = await orgFalKeyService.resolve(orgId);
        if (key) return key;
    }
    return developmentProviderKey("fal") || null;
}
