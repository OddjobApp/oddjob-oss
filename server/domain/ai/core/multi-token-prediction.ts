export interface MultiTokenPredictionConfig {
    enabled?: boolean;
    preferred?: boolean;
    required?: boolean;
    backend?: "vllm" | "sglang" | "custom" | string;
    numSpeculativeTokens?: number;
    requestPassthrough?: boolean;
    extraRequestBody?: Record<string, unknown>;
}

interface MultiTokenPredictionSource {
    multiTokenPrediction?: MultiTokenPredictionConfig | null;
}

export function isMultiTokenPredictionCapability(capability: string): boolean {
    const normalized = capability.toLowerCase().replace(/[_\s]+/g, "-");
    return normalized === "mtp" || normalized === "multi-token-prediction";
}

export function resolveMultiTokenPrediction(
    requestSource?: MultiTokenPredictionSource | null,
    metadataSource?: MultiTokenPredictionSource | null
): MultiTokenPredictionConfig | undefined {
    const requestConfig = requestSource?.multiTokenPrediction ?? undefined;
    const metadataConfig = metadataSource?.multiTokenPrediction ?? undefined;

    if (!requestConfig && !metadataConfig) {
        return undefined;
    }

    return {
        ...metadataConfig,
        ...requestConfig,
    };
}

export function applyMultiTokenPredictionRequestBody(
    requestBody: Record<string, unknown>,
    config?: MultiTokenPredictionConfig
): void {
    if (!config?.enabled || config.requestPassthrough !== true || !config.extraRequestBody) {
        return;
    }

    Object.assign(requestBody, config.extraRequestBody);
}

export function constrainMultiTokenPredictionPassthrough(
    config: MultiTokenPredictionConfig | undefined,
    allowPassthrough: boolean
): MultiTokenPredictionConfig | undefined {
    if (!config || allowPassthrough) {
        return config;
    }

    return {
        ...config,
        requestPassthrough: false,
        extraRequestBody: undefined,
    };
}

export function buildMultiTokenPredictionMetadata(config?: MultiTokenPredictionConfig) {
    if (!config?.enabled) {
        return undefined;
    }

    return {
        multiTokenPrediction: {
            enabled: true,
            backend: config.backend,
            numSpeculativeTokens: config.numSpeculativeTokens,
            requestPassthrough: config.requestPassthrough === true,
        },
    };
}

export function modelSupportsMultiTokenPrediction(model: any): boolean {
    const capabilities = Array.isArray(model?.capabilities)
        ? model.capabilities.map((capability: unknown) => String(capability))
        : [];

    if (capabilities.some(isMultiTokenPredictionCapability)) {
        return true;
    }

    const metadata = model?.metadata as any;
    return metadata?.multiTokenPrediction?.enabled === true
        || metadata?.mtp === true
        || metadata?.speculativeDecoding?.method === "mtp";
}

export function requestRequiresMultiTokenPrediction(request: {
    capabilities?: string[];
    multiTokenPrediction?: MultiTokenPredictionConfig;
}): boolean {
    return request.multiTokenPrediction?.required === true
        || request.capabilities?.some(isMultiTokenPredictionCapability) === true;
}

export function requestPrefersMultiTokenPrediction(request: {
    capabilities?: string[];
    maxTokens?: number;
    multiTokenPrediction?: MultiTokenPredictionConfig;
    routingStrategy?: string;
}): boolean {
    if (requestRequiresMultiTokenPrediction(request)) {
        return true;
    }

    if (request.multiTokenPrediction?.preferred === false) {
        return false;
    }

    if (request.multiTokenPrediction?.preferred === true) {
        return true;
    }

    return request.routingStrategy === "speed" && (request.maxTokens ?? 0) >= 1024;
}
