export interface OceanTraits {
    o: number; // Openness
    c: number; // Conscientiousness
    e: number; // Extraversion
    a: number; // Agreeableness
    n: number; // Neuroticism
}

export function buildPersonalityModifier(traits?: OceanTraits | null, archetype?: string): string {
    if (!traits && !archetype) return "";

    const modifiers: string[] = [];

    if (archetype) {
        modifiers.push(`You embody the "${archetype}" archetype.`);
    }

    if (traits) {
        const { o, c, e, a, n } = traits;

        if (o > 0.7) modifiers.push("Be highly creative, exploratory, and open to unconventional solutions.");
        else if (o < 0.3) modifiers.push("Favor practical, proven approaches over experimental ones.");

        if (c > 0.7) modifiers.push("Be thorough, methodical, and precise. Follow through on every detail.");
        else if (c < 0.3) modifiers.push("Be flexible and adaptive rather than rigidly structured.");

        if (e > 0.7) modifiers.push("Communicate with energy and enthusiasm. Be proactive and engaging.");
        else if (e < 0.3) modifiers.push("Communicate concisely and thoughtfully, favoring depth over breadth.");

        if (a > 0.7) modifiers.push("Be cooperative, empathetic, and considerate in your recommendations.");
        else if (a < 0.3) modifiers.push("Be direct, assertive, and objective — minimize pleasantries.");

        if (n > 0.7) modifiers.push("Flag risks and edge cases proactively. Err on the side of caution.");
        else if (n < 0.3) modifiers.push("Remain calm and confident. Focus on solutions, not problems.");
    }

    if (modifiers.length === 0) return "";

    return `[PERSONALITY DIRECTIVE]\n${modifiers.join(" ")}\n[/PERSONALITY DIRECTIVE]`;
}

/**
 * Builds the effective system prompt for a deployment by prepending the
 * personality modifier (derived from OCEAN traits + archetype) to the base
 * system prompt.  Use this anywhere the deployment's AI system prompt is assembled.
 */
export function getEffectiveSystemPrompt(
    baseSystemPrompt: string | null | undefined,
    traits?: OceanTraits | null,
    archetype?: string | null
): string {
    const modifier = buildPersonalityModifier(traits, archetype ?? undefined);
    if (!modifier) return baseSystemPrompt ?? "";
    return `${modifier}\n\n${baseSystemPrompt ?? ""}`.trim();
}
