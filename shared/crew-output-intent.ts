/**
 * Output Intent declarations for Oddjob CREW Rooms.
 *
 * An Output Intent specifies the desired deliverable or engagement mode for a CREW round.
 * It is completely optional:
 * - When omitted or set to "auto", the CREW uses heuristic and contextual intent detection (backward-compatible).
 * - When explicitly set (via slash command like /present, /app, or UI selector), the orchestrator
 *   deterministically steers speaker turns toward the corresponding deliverable mode without fragile guessing.
 */

export const CREW_OUTPUT_INTENTS = [
    "auto",
    "deliberate",
    "present",
    "build_app",
    "map",
    "author_document",
    "diagram",
    "generate_image",
    "audit_governance",
] as const;

export type CrewOutputIntent = (typeof CREW_OUTPUT_INTENTS)[number];

export interface OutputIntentDescriptor {
    id: CrewOutputIntent;
    label: string;
    description: string;
    slashCommand?: string;
    aliases: string[];
}

export const OUTPUT_INTENT_DESCRIPTORS: Record<CrewOutputIntent, OutputIntentDescriptor> = {
    auto: {
        id: "auto",
        label: "Auto Detect",
        description: "Let the CREW dynamically determine whether to deliberate, build, or present based on context",
        aliases: [],
    },
    deliberate: {
        id: "deliberate",
        label: "Deliberation / Discussion",
        description: "Focus on multi-agent debate, strategic reasoning, and trade-off analysis without opening builder pods",
        slashCommand: "/deliberate",
        aliases: ["/deliberate", "/discuss"],
    },
    present: {
        id: "present",
        label: "Presentation Deck & Deliverable",
        description: "Generate an interactive multi-slide executive deck, AST briefing, or visual deliverable",
        slashCommand: "/present",
        aliases: ["/present", "/deck", "/slides"],
    },
    build_app: {
        id: "build_app",
        label: "Instant App / Live UI",
        description: "Build and render an on-the-fly interactive app, dynamic calculator, or UI widget directly in chat",
        slashCommand: "/app",
        aliases: ["/app", "/build"],
    },
    map: {
        id: "map",
        label: "Interactive Map",
        description: "Display an interactive geographic map with markers, coordinate discovery, and live GPS locating",
        slashCommand: "/map",
        aliases: ["/map", "/geo", "/pin"],
    },
    author_document: {
        id: "author_document",
        label: "Author Document / PRD",
        description: "Mount Scribe Studio in the side-rail to draft, outline, or revise a structured document or policy",
        slashCommand: "/doc",
        aliases: ["/doc", "/scribe", "/author"],
    },
    diagram: {
        id: "diagram",
        label: "Workflow Diagram / X-Ray",
        description: "Render an interactive Mermaid workflow diagram, dependency graph, or architectural X-Ray",
        slashCommand: "/diagram",
        aliases: ["/diagram", "/mermaid", "/xray"],
    },
    generate_image: {
        id: "generate_image",
        label: "AI Image",
        description: "Generate an AI image from a text prompt and render it inline in the chat as a visual artifact",
        slashCommand: "/image",
        aliases: ["/image", "/img", "/imagine", "/picture"],
    },
    audit_governance: {
        id: "audit_governance",
        label: "Governance & Attestation Audit",
        description: "Audit compliance status, review active HIL approval gates, and verify attestation requirements",
        slashCommand: "/audit",
        aliases: ["/audit", "/governance"],
    },
};

/**
 * Validates whether an arbitrary value matches a known CrewOutputIntent.
 */
export function isValidOutputIntent(value: unknown): value is CrewOutputIntent {
    return typeof value === "string" && (CREW_OUTPUT_INTENTS as readonly string[]).includes(value);
}

/**
 * Parses a user message to extract an explicit slash command output intent if present.
 * If found, returns the matched outputIntent and the message stripped of the leading command.
 */
export function extractOutputIntentFromMessage(rawMessage: string): {
    outputIntent?: CrewOutputIntent;
    cleanMessage: string;
} {
    if (!rawMessage || typeof rawMessage !== "string") {
        return { cleanMessage: "" };
    }

    const trimmed = rawMessage.trim();
    if (!trimmed.startsWith("/")) {
        return { cleanMessage: rawMessage };
    }

    // Match leading command word, e.g. /present or /app
    const commandMatch = trimmed.match(/^(\/[a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/);
    if (!commandMatch) {
        return { cleanMessage: rawMessage };
    }

    const command = commandMatch[1].toLowerCase();
    const remainingText = (commandMatch[2] ?? "").trim();

    for (const descriptor of Object.values(OUTPUT_INTENT_DESCRIPTORS)) {
        if (descriptor.aliases.includes(command)) {
            return {
                outputIntent: descriptor.id,
                cleanMessage: remainingText || (
                    descriptor.id === "present"
                        ? "Generate a presentation deck based on our discussion."
                        : descriptor.id === "build_app"
                        ? "Build and render an instant app surface on the fly."
                        : descriptor.id === "map"
                        ? "Display an interactive map with key locations and coordinates."
                        : descriptor.id === "diagram"
                        ? "Render the workflow diagram and system X-Ray."
                        : descriptor.id === "author_document"
                        ? "Launch Scribe Studio to author a structured document."
                        : descriptor.id === "generate_image"
                        ? "Generate an image based on our discussion."
                        : descriptor.id === "audit_governance"
                        ? "Review governance policies and active HIL gates."
                        : descriptor.id === "deliberate"
                        ? "Deliberate and evaluate options."
                        : remainingText
                ),
            };
        }
    }

    return { cleanMessage: rawMessage };
}
