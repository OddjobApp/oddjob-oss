/**
 * The model providers an organization can connect its own key for (BYOK).
 *
 * Shared by the server, which validates, stores and calls them, and the
 * settings page, which lists them. Every endpoint is fixed here: an org
 * supplies a key and a model ID, never a URL, so a stored connection cannot
 * point the server at an arbitrary host.
 */
export const ORG_AI_PROVIDER_IDS = ["google", "anthropic", "openai", "xai", "qwen", "muse", "bedrock"] as const;
export type OrgAiProviderId = (typeof ORG_AI_PROVIDER_IDS)[number];

export interface OrgAiProviderRegion {
    id: string;
    label: string;
    baseUrl: string;
}

export interface OrgAiProvider {
    id: OrgAiProviderId;
    label: string;
    /** `encrypted_credentials.credential_type`; Gemini keeps the type it was first stored under. */
    credentialType: string;
    defaultModel: string;
    modelPattern: RegExp;
    keyUrl: string;
    keyHelp: string;
    /** The shape of a key. Absent: letters, digits, `_` and `-`. */
    keyPattern?: RegExp;
    /**
     * The provider's endpoint per region: OpenAI-compatible chat for most, the
     * Bedrock runtime for Bedrock. Absent where the client fixes its own host.
     */
    regions?: readonly OrgAiProviderRegion[];
}

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;

export const ORG_AI_PROVIDERS: Record<OrgAiProviderId, OrgAiProvider> = {
    google: {
        id: "google", label: "Google Gemini", credentialType: "gemini",
        defaultModel: "gemini-2.5-flash", modelPattern: /^gemini-[a-zA-Z0-9._-]{1,113}$/,
        keyUrl: "https://aistudio.google.com/apikey", keyHelp: "Google AI Studio",
    },
    anthropic: {
        id: "anthropic", label: "Anthropic Claude", credentialType: "anthropic",
        defaultModel: "claude-sonnet-5-5", modelPattern: /^claude-[a-zA-Z0-9._-]{1,113}$/,
        keyUrl: "https://console.anthropic.com/settings/keys", keyHelp: "the Anthropic Console",
    },
    openai: {
        id: "openai", label: "OpenAI", credentialType: "openai",
        defaultModel: "gpt-5", modelPattern: MODEL_ID,
        keyUrl: "https://platform.openai.com/api-keys", keyHelp: "the OpenAI platform",
        regions: [{ id: "default", label: "Global", baseUrl: "https://api.openai.com/v1" }],
    },
    xai: {
        id: "xai", label: "xAI Grok", credentialType: "xai",
        defaultModel: "grok-4", modelPattern: MODEL_ID,
        keyUrl: "https://console.x.ai", keyHelp: "the xAI console",
        regions: [{ id: "default", label: "Global", baseUrl: "https://api.x.ai/v1" }],
    },
    qwen: {
        id: "qwen", label: "Alibaba Qwen", credentialType: "qwen",
        defaultModel: "qwen-plus", modelPattern: MODEL_ID,
        keyUrl: "https://modelstudio.console.alibabacloud.com", keyHelp: "Alibaba Cloud Model Studio",
        regions: [
            { id: "intl", label: "International (Singapore)", baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1" },
            { id: "cn", label: "China (Beijing)", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
        ],
    },
    muse: {
        id: "muse", label: "Meta Muse", credentialType: "muse",
        defaultModel: "muse-spark-1.3", modelPattern: MODEL_ID,
        keyUrl: "https://llama.developer.meta.com", keyHelp: "the Meta developer portal",
        regions: [{ id: "default", label: "Global", baseUrl: "https://api.meta.ai/v1" }],
    },
    // Any Bedrock text model through the organization's own AWS account, called
    // with the Converse API (Claude, Nova, Llama, Mistral...). The key is a long-term
    // Bedrock API key (ABSK…); short-term keys expire within hours and are refused.
    // Recent Claude models are offered only through an inference profile (us.…,
    // global.…), which may process a request in another Region of that geography.
    bedrock: {
        id: "bedrock", label: "Amazon Bedrock", credentialType: "bedrock",
        defaultModel: "us.anthropic.claude-sonnet-4-6",
        // [geography.]vendor.model[:version], e.g. us.anthropic.claude-sonnet-4-6, amazon.nova-lite-v1:0
        modelPattern: /^(?:(?:us|eu|apac|au|jp|ca|us-gov|global)\.)?[a-z0-9-]{2,20}\.[A-Za-z0-9][A-Za-z0-9._-]{0,90}(?::[0-9]{1,3})?$/,
        keyUrl: "https://console.aws.amazon.com/bedrock/home#/api-keys/long-term/create", keyHelp: "the Amazon Bedrock console",
        keyPattern: /^ABSK[A-Za-z0-9+/=]{20,1020}$/,
        regions: [
            { id: "us-east-2", label: "US East (Ohio)", baseUrl: "https://bedrock-runtime.us-east-2.amazonaws.com" },
            { id: "us-east-1", label: "US East (N. Virginia)", baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com" },
            { id: "us-west-2", label: "US West (Oregon)", baseUrl: "https://bedrock-runtime.us-west-2.amazonaws.com" },
        ],
    },
};

export function isOrgAiProviderId(value: unknown): value is OrgAiProviderId {
    return typeof value === "string" && (ORG_AI_PROVIDER_IDS as readonly string[]).includes(value);
}

/** The endpoint for an OpenAI-compatible provider; the first region when none is chosen. */
export function orgAiProviderBaseUrl(provider: OrgAiProviderId, region?: string): string | undefined {
    const regions = ORG_AI_PROVIDERS[provider].regions;
    if (!regions) return undefined;
    return (regions.find(r => r.id === region) ?? regions[0]).baseUrl;
}

/** Features that only run on Gemini, and so need a Gemini key whatever the default is. */
/** Knowledge search and embeddings run on Gemini or, without it, Amazon Bedrock (Titan). */
export const GEMINI_ONLY_FEATURES = "image generation and speech-to-text";
