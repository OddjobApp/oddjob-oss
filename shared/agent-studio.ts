/**
 * Agent Studio: the agent a room has open, and the change it has drafted.
 *
 * Shared because both halves read the same room history — the server decides what a
 * message does, the client mounts the studio and sends back the exact approval the
 * server looks for.
 *
 * An agent differs from a form or a film in one way that shapes everything here: what
 * it is allowed to DO is part of its definition. A proposal therefore separates plain
 * edits from grants — a new tool is a permission, not a preference — and says what the
 * agent will cost to run, because a model binding is a price per run from then on
 * rather than a one-off render.
 */

export const AGENT_STUDIO_POD = "agent_studio_pod";
export const AGENT_CHANGE_PROPOSAL = "agent_change_proposal";

/** The tabs the studio opens on. `try` is where an agent is talked to before it exists. */
export const AGENT_STUDIO_VIEWS = ["identity", "brain", "reach", "knowledge", "governance", "try", "evidence"] as const;
export type AgentStudioView = (typeof AGENT_STUDIO_VIEWS)[number];

export interface MountedAgentStudio {
    /** Absent for an agent that has not been created yet: a draft has no id. */
    agentId?: number;
    agentName?: string;
    view?: AgentStudioView;
}

/** The editable definition of an agent, as the studio and a proposal both hold it. */
export interface AgentDefinition {
    name: string;
    description: string;
    personaType: string;
    /** First person: how this agent says it works. */
    legend?: string | null;
    soulArchetype?: string | null;
    modelBindingProviderId?: number | null;
    modelBindingModelId?: number | null;
    /** What it may call. A ceiling, not a plan: the room can still withhold a tool. */
    tools: string[];
    capabilities: string[];
    topicAffinities: string[];
    intentAffinities: string[];
    oceanTraits?: { o: number; c: number; e: number; a: number; n: number };
    enabled?: boolean;
}

/**
 * One line of a proposal's diff.
 *
 * `grant` and `revoke` are separated from `edit` on purpose. Renaming an agent and
 * giving it the ability to send email are not the same kind of change, and a card that
 * lists them together invites approving the second while reading the first.
 */
export interface AgentChangeLine {
    kind: "edit" | "grant" | "revoke";
    /** The part of the agent this touches: "Name", "Model", "Tools", "Knowledge"… */
    field: string;
    /** What it says now, where there is a before. */
    before?: string | null;
    after?: string | null;
    /** Set on a grant that lets the agent act outside the platform or spend money. */
    consequential?: boolean;
}

/** What running this agent is expected to cost, so approving is not a blind commitment. */
export interface AgentRunCost {
    /** The model it will run on, named as a person would recognise it. */
    model: string | null;
    /** Cents for one typical exchange, or null when the platform cannot say. */
    centsPerRun: number | null;
    /** Why the number is missing, when it is. */
    note?: string;
}

/** An agent drafted from a room request, shown as a card until someone applies it. */
export interface AgentChangeProposal {
    proposalId: string;
    /** Absent when the proposal creates an agent rather than changing one. */
    agentId?: number;
    agentName: string;
    instruction: string;
    changes: AgentChangeLine[];
    cost: AgentRunCost;
    /** Things worth knowing before applying: an unproven skill, a missing model binding. */
    cautions: string[];
    definition: AgentDefinition;
    /**
     * What this agent will still need, and what the platform makes of the work it is
     * pointed at. Carried on the proposal so the card can ask before the agent exists —
     * see agent-readiness.service.ts.
     */
    readiness?: {
        gaps: Array<{ kind: string; severity: "critical" | "warning" | "advisory"; message: string; remediation: string; suggests?: string[] }>;
        trajectory: { recommendedAction: "auto_execute" | "require_approval" | "halt_loop"; safeTransitionScore: number; blastRadius: number; reason: string };
    };
}

/** The grants in a proposal, which are what an approver is really deciding on. */
export function grantsOf(proposal: Pick<AgentChangeProposal, "changes">): AgentChangeLine[] {
    return proposal.changes.filter((line) => line.kind === "grant");
}

/** True when applying this would let the agent act outside the platform or spend money. */
export function needsCloseReading(proposal: Pick<AgentChangeProposal, "changes">): boolean {
    return proposal.changes.some((line) => line.kind === "grant" && line.consequential);
}

/**
 * Tools whose use reaches outside the platform, costs money, or cannot be taken back.
 * Matched on the name because a tool's own risk level is set by whoever wrote it, and
 * this list is what the person approving the agent is warned about.
 */
const CONSEQUENTIAL = [
    /^send_/, /email/, /^post_/, /publish/, /deploy/, /^delete_/, /^execute_/, /payment/, /invoice/,
    /computer_use/, /^trycua_(?!list_skills$|teach_task$|observe$|screenshot$|dom_extract$)/, /browser/, /slack/, /^create_mission/, /spend/,
];

export function isConsequentialTool(tool: string): boolean {
    const name = tool.toLowerCase();
    return CONSEQUENTIAL.some((pattern) => pattern.test(name));
}

/** The diff between what an agent is now and what a proposal would make it. */
export function diffAgent(before: AgentDefinition | null, after: AgentDefinition): AgentChangeLine[] {
    const lines: AgentChangeLine[] = [];
    const say = (value: unknown) => (value === null || value === undefined || value === "" ? null : String(value));

    const scalar: Array<[string, keyof AgentDefinition]> = [
        ["Name", "name"],
        ["Description", "description"],
        ["Persona", "personaType"],
        ["Operating philosophy", "legend"],
        ["Archetype", "soulArchetype"],
    ];
    for (const [field, key] of scalar) {
        const from = before ? say(before[key]) : null;
        const to = say(after[key]);
        if (from !== to) lines.push({ kind: "edit", field, before: from, after: to });
    }

    if ((before?.modelBindingModelId ?? null) !== (after.modelBindingModelId ?? null)) {
        lines.push({ kind: "edit", field: "Model", before: say(before?.modelBindingModelId), after: say(after.modelBindingModelId) });
    }
    if ((before?.modelBindingProviderId ?? null) !== (after.modelBindingProviderId ?? null)) {
        lines.push({ kind: "edit", field: "Provider", before: say(before?.modelBindingProviderId), after: say(after.modelBindingProviderId) });
    }

    // Everything apply() writes has to appear here: a field the card does not show is a
    // change nobody approved.
    const wasEnabled = before?.enabled ?? true;
    const willBeEnabled = after.enabled ?? true;
    if (wasEnabled !== willBeEnabled) {
        lines.push({
            kind: "edit",
            field: "State",
            before: before ? (wasEnabled ? "Active" : "Switched off") : null,
            after: willBeEnabled ? "Active" : "Switched off",
        });
    }

    const temperament = (traits: AgentDefinition["oceanTraits"]) =>
        traits ? `O ${traits.o} · C ${traits.c} · E ${traits.e} · A ${traits.a} · N ${traits.n}` : null;
    if (temperament(before?.oceanTraits) !== temperament(after.oceanTraits)) {
        lines.push({ kind: "edit", field: "Temperament", before: temperament(before?.oceanTraits), after: temperament(after.oceanTraits) });
    }

    // Lists are reported one entry at a time: "tools changed" tells an approver nothing
    // about whether the agent can now email their customers.
    const lists: Array<[string, keyof AgentDefinition]> = [
        ["Tools", "tools"],
        ["Capabilities", "capabilities"],
        ["Topics", "topicAffinities"],
        ["Intents", "intentAffinities"],
    ];
    for (const [field, key] of lists) {
        const from = new Set<string>((before?.[key] as string[] | undefined) ?? []);
        const to = new Set<string>((after[key] as string[] | undefined) ?? []);
        for (const added of [...to].filter((entry) => !from.has(entry))) {
            lines.push({
                kind: "grant",
                field,
                after: added,
                ...(field === "Tools" && isConsequentialTool(added) ? { consequential: true } : {}),
            });
        }
        for (const removed of [...from].filter((entry) => !to.has(entry))) {
            lines.push({ kind: "revoke", field, before: removed });
        }
    }

    return lines;
}

/**
 * The exact words the card sends back to apply a drafted agent, and the reader that
 * recognises them. One phrasing, written once: a card that says one thing and a server
 * that looks for another is a proposal nobody can accept.
 */
export function applyAgentMessage(proposalId: string): string {
    return `Apply agent draft "${proposalId}".`;
}

const APPROVAL = /^Apply agent draft "([A-Za-z0-9_-]{8,80})"\.?$/;

export function parseAgentApproval(message: string): { proposalId: string } | null {
    const match = message.trim().match(APPROVAL);
    return match ? { proposalId: match[1] } : null;
}

type RoomArtifact = { tool?: string; payload?: Record<string, unknown> | null };
type RoomTurn = { id?: number | string; artifacts?: RoomArtifact[] | null };

/**
 * A drafted agent by id, and whether the room has already applied it.
 *
 * `applied` matters because a card stays on screen after it is used: without it, a
 * second Apply would create a second agent from the same draft.
 */
export function findAgentProposal(turns: RoomTurn[], proposalId: string): { proposal: AgentChangeProposal; applied: boolean } | null {
    let proposal: AgentChangeProposal | null = null;
    let applied = false;
    for (const turn of turns) {
        for (const artifact of turn?.artifacts ?? []) {
            const payload = (artifact?.payload ?? {}) as Record<string, unknown>;
            if (payload.proposalId !== proposalId) continue;
            if (payload.type === AGENT_CHANGE_PROPOSAL) proposal = payload as unknown as AgentChangeProposal;
            if (payload.type === AGENT_STUDIO_POD) applied = true;
        }
    }
    return proposal ? { proposal, applied } : null;
}

/** The agent the room has open, from the last studio it mounted. */
export function mountedAgentStudio(turns: RoomTurn[]): MountedAgentStudio | null {
    for (let i = turns.length - 1; i >= 0; i--) {
        for (const artifact of turns[i]?.artifacts ?? []) {
            const payload = (artifact?.payload ?? {}) as Record<string, unknown>;
            if (payload.type !== AGENT_STUDIO_POD) continue;
            const props = (payload.props ?? {}) as Record<string, unknown>;
            return {
                agentId: typeof props.agentId === "number" ? props.agentId : undefined,
                agentName: typeof props.agentName === "string" ? props.agentName : undefined,
                view: props.view as MountedAgentStudio["view"],
            };
        }
    }
    return null;
}

/** What a message does to Agent Studio in this room. */
export type AgentStudioAction =
    | { kind: "none" }
    | { kind: "apply"; proposalId: string }
    | { kind: "mount" };

// Word boundaries matter: without them "management" and "agenda" both contain "agent",
// and the studio would open on half the messages in the room. The lookahead keeps
// "open the agent" from claiming the "agent" inside "open agent studio" — regex takes
// the earliest match, and that phrase is the studio request, not an agent called "open".
const MOUNT_REQUEST = /\b(agent|bot)\s*(studio|builder)\b|\bopen\s+(the\s+)?agent\b(?!\s*(studio|builder)\b)/i;

/** A mount request can name a tab: "open agent studio on the reach tab". */
const VIEW_REQUEST = /\b(identity|brain|reach|knowledge|governance|try|evidence)\s+(?:tab|view)\b/i;

export function agentStudioViewFromMessage(message: string): AgentStudioView | null {
    const match = message.match(VIEW_REQUEST);
    return match ? (match[1].toLowerCase() as AgentStudioView) : null;
}

/**
 * The agent a mount request names, with the request itself stripped out.
 *
 * The whole message used to go to name resolution, so "open the agent" could mount an
 * agent literally called "open" — its name sat inside the phrase. A bare gesture
 * ("agent studio", "open the agent", "open agent studio on the reach tab") leaves
 * nothing behind and returns null, which the caller reads as "reopen what is already
 * open, or a fresh draft".
 */
export function agentReferenceFromMessage(message: string): string | null {
    const rest = message
        .replace(MOUNT_REQUEST, " ")
        .replace(VIEW_REQUEST, " ")
        .replace(/\b(?:open|please|show|mount|launch|try)\b/gi, " ")
        .replace(/^\s*(?:the\s+)?(?:for|on|to)\s+/i, "")
        .replace(/[\s.!?]+$/g, "")
        .trim()
        .replace(/^(?:the|a|an|for|on|to|of)$/i, "");
    return rest || null;
}

/**
 * An approval first, because its string is emitted by a card and nothing else should
 * reinterpret it. Drafting is NOT decided here: it is a tool the room's speakers reach
 * for, so that asking for an agent reads as a request rather than a command.
 */
export function decideAgentStudioAction(message: string): AgentStudioAction {
    const approval = parseAgentApproval(message);
    if (approval) return { kind: "apply", proposalId: approval.proposalId };
    if (MOUNT_REQUEST.test(message)) return { kind: "mount" };
    return { kind: "none" };
}
