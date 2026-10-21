/** Public interaction controls live in the existing deployment JSON, not tenant defaults. */
export interface AgentInteractionConfig {
    allowChatInput?: boolean;
    buttons?: { id: string; label: string; message: string }[];
}

export function allowsAgentChat(config: AgentInteractionConfig | null | undefined): boolean {
    return config?.allowChatInput !== false;
}

/** Only return messages configured by the publisher; never trust a browser's button text. */
export function agentButton(config: AgentInteractionConfig | null | undefined, id: unknown) {
    return typeof id === "string" ? config?.buttons?.find(button => button.id === id) : undefined;
}
