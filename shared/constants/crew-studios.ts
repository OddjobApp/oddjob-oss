/**
 * Crew studio scoping.
 *
 * A room can be opened in the context of a studio (e.g. ?studio=forge). When it is,
 * the initial roster should include the agents most relevant to that studio, in
 * addition to the platform Copilot that is seeded into every new room.
 *
 * This module is dependency-free so it can be imported from both server and client.
 */

export const CREW_STUDIO_SLUGS = [
    "forge",
    "builder",
    "media",
    "form",
    "scribe",
    "agent",
    "project",
    "computer",
    "flow",
    "signal",
    "prediction",
] as const;

export type CrewStudioSlug = (typeof CREW_STUDIO_SLUGS)[number];

/**
 * Maps a studio to the persona types of agents that should be seeded into a new
 * crew room opened in that studio. The platform Copilot is always added first,
 * separately, so it is not repeated here.
 *
 * Persona types correspond to the values used by the seed-provisioning service
 * and the agent_cards.persona_type column.
 */
export const CREW_STUDIO_SQUADS: Record<CrewStudioSlug, string[]> = {
    forge: ["knowledge-architect", "backend-architect", "coder", "security"],
    builder: ["coder", "backend-architect"],
    media: ["media-creator"],
    form: ["analyst", "knowledge-architect"],
    scribe: ["ghostwriter", "analyst"],
    agent: [],
    project: ["analyst", "knowledge-architect"],
    computer: ["coder", "security"],
    flow: ["coder", "backend-architect"],
    signal: ["analyst", "knowledge-architect"],
    prediction: ["analyst"],
};

/**
 * Whether the value is a recognized crew studio slug.
 */
export function isCrewStudioSlug(value: string): value is CrewStudioSlug {
    return (CREW_STUDIO_SLUGS as readonly string[]).includes(value);
}
