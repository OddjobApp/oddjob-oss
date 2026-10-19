/**
 * Form Studio in a CREW room: which form the room has open, the change it has
 * drafted, and whether a message asks to open the studio, change the form, or
 * apply a drafted change.
 *
 * Shared because both halves read the same room history. The server decides from
 * it what a message does; the client finds the form to mount and sends the exact
 * approval the server looks for.
 */

export const FORM_STUDIO_POD = "form_studio_pod";
export const FORM_CHANGE_PROPOSAL = "form_change_proposal";
export const FORM_CREATE_PROPOSAL = "form_create_proposal";

type RoomArtifact = { tool?: string; payload?: Record<string, unknown> | null };
type RoomTurn = { id?: number | string; artifacts?: RoomArtifact[] | null };

export interface MountedFormStudio {
  formId: number;
  formName?: string;
  revision?: number;
  view?: string;
}

/** A change drafted against one revision of a form, shown as a diff card until someone applies it. */
export interface FormChangeProposal {
  proposalId: string;
  formId: number;
  formName?: string;
  baseRevision: number;
  instruction: string;
  /** What changes, one line per kind of unit, e.g. "Changed field: Flight risk". */
  changes: string[];
  /** Checks the changed form fails. It can still be saved; publishing is what they block. */
  checks: string[];
  definition: unknown;
}

/** A new form drafted from a room request, shown as a card until someone creates it. */
export interface FormCreateProposal {
  proposalId: string;
  name: string;
  instruction: string;
  /** What the new form holds, one line per part, e.g. "Fields: Loan amount, Rate". */
  summary: string[];
  /** Checks the draft fails. It is still created; publishing is what they block. */
  checks: string[];
  definition: unknown;
}

// A later mount of another studio means "this form" no longer refers to anything.
const OTHER_STUDIOS = new Set(["app_studio_pod", "scribe_foundry_pod"]);

const text = (value: unknown) => (typeof value === "string" && value ? value : undefined);
const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

/** The form whose studio is open in this room: the latest studio mounted, when that is Form Studio. */
export function mountedFormStudio(turns: RoomTurn[]): MountedFormStudio | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    const artifacts = turns[i]?.artifacts ?? [];
    for (let j = artifacts.length - 1; j >= 0; j--) {
      const p = artifacts[j]?.payload ?? {};
      if ((p.type === FORM_STUDIO_POD || p.type === FORM_CHANGE_PROPOSAL) && typeof p.formId === "number") {
        return { formId: p.formId, formName: text(p.formName), revision: count(p.revision ?? p.baseRevision), view: text(p.view) };
      }
      if (OTHER_STUDIOS.has(String(p.type))) return null;
    }
  }
  return null;
}

/** A drafted change by id, and whether the room has already applied it. */
export function findFormChangeProposal(turns: RoomTurn[], proposalId: string): { proposal: FormChangeProposal; applied: boolean } | null {
  let proposal: FormChangeProposal | null = null;
  let applied = false;
  for (const turn of turns) {
    for (const artifact of turn?.artifacts ?? []) {
      const p = artifact?.payload ?? {};
      if (p.proposalId !== proposalId) continue;
      if (p.type === FORM_CHANGE_PROPOSAL) proposal = p as unknown as FormChangeProposal;
      if (p.type === FORM_STUDIO_POD) applied = true;
    }
  }
  return proposal ? { proposal, applied } : null;
}

/** A drafted new form by id, and whether the room has already created it. */
export function findFormCreateProposal(turns: RoomTurn[], proposalId: string): { proposal: FormCreateProposal; created: boolean } | null {
  let proposal: FormCreateProposal | null = null;
  let created = false;
  for (const turn of turns) {
    for (const artifact of turn?.artifacts ?? []) {
      const p = artifact?.payload ?? {};
      if (p.proposalId !== proposalId) continue;
      if (p.type === FORM_CREATE_PROPOSAL) proposal = p as unknown as FormCreateProposal;
      if (p.type === FORM_STUDIO_POD) created = true;
    }
  }
  return proposal ? { proposal, created } : null;
}

/** The message a new-form card sends to create its draft. Exact and anchored, like the change approval. */
export function createFormMessage(proposalId: string): string {
  return `Create form "${proposalId}".`;
}

const CREATE_APPROVAL = /^Create form "([A-Za-z0-9_-]{8,64})"\.?$/;

export function parseFormCreateApproval(message: string): { proposalId: string } | null {
  const match = message.trim().match(CREATE_APPROVAL);
  return match ? { proposalId: match[1] } : null;
}

/**
 * The message a diff card sends to apply its change.
 *
 * Exact and anchored, like the other confirmations a surface emits: this stands
 * between a sentence and a saved form, so agreeing in prose must not reach it.
 */
export function applyFormChangeMessage(proposalId: string): string {
  return `Apply form change "${proposalId}".`;
}

const APPROVAL = /^Apply form change "([A-Za-z0-9_-]{8,64})"\.?$/;

export function parseFormChangeApproval(message: string): { proposalId: string } | null {
  const match = message.trim().match(APPROVAL);
  return match ? { proposalId: match[1] } : null;
}

const FORM_NOUN = String.raw`(?:form|questionnaire|survey|assessment|scorecard|checklist)s?`;
const OPEN_FORM = new RegExp(String.raw`\b(?:open|show|mount|edit|change|update|modify|fix|review|reweight|restructure)\b[\s\S]{0,40}\b${FORM_NOUN}\b`, "i");

/**
 * Does this message ask to open a form for authoring?
 *
 * Filling one in, submitting it, or running the pipeline behind it is answering
 * a form, which other tools handle. Creating a form is left out too: calculator
 * and intake requests still go to their own directive.
 */
export function isFormStudioRequest(message: string): boolean {
  const trimmed = message.trim();
  if (/\bform\s*(?:studio|atudio|studo|builder)\b/i.test(trimmed)) return true;
  if (/\b(?:fill|filled|submit|submitted|complete|sign|answer|run|trigger|pipeline)\b/i.test(trimmed)) return false;
  return OPEN_FORM.test(trimmed);
}

// Nouns that are forms whatever else the message mentions. A bare "form" is only
// a form request when no application is being asked for.
const SPECIFIC_FORM_NOUN = String.raw`(?:calculator|intake\s+form|questionnaire|survey|assessment|scorecard|checklist|quiz|poll)s?`;
const CREATE_A = String.raw`\b(?:build|create|make|design|draft|set\s+up|put\s+together|generate)\s+(?:me\s+|us\s+)?(?:a|an|new|another|one)\b`;
const CREATES_SPECIFIC_FORM = new RegExp(String.raw`${CREATE_A}[\s\S]{0,60}\b${SPECIFIC_FORM_NOUN}\b`, "i");
const CREATES_FORM = new RegExp(String.raw`${CREATE_A}[\s\S]{0,60}\bforms?\b`, "i");
const APPLICATION_NOUN = /\b(?:app|application|dashboard|portal|website|console)\b/i;

/**
 * Does this message ask for a new form: a calculator, intake form, questionnaire,
 * survey, assessment, scorecard or checklist?
 *
 * It has to ask for "a" or "a new" one, so "make the phone field required" stays a
 * change to the open form. Calculators and intake forms are Form Studio's even
 * inside a request that also wants a dataset or pipeline; a plain "form" inside a
 * request for an app is App Studio's.
 */
export function isFormCreateRequest(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed || REVIEW_ONLY.test(trimmed)) return false;
  if (/\b(?:fill|filled|submit|submitted|answer|sign)\b/i.test(trimmed)) return false;
  if (CREATES_SPECIFIC_FORM.test(trimmed)) return true;
  return CREATES_FORM.test(trimmed) && !APPLICATION_NOUN.test(trimmed);
}

const QUESTION = /^(?:what|why|how|which|who|when|where|does|do|is|are|was|were|should|would it|explain|tell me|summari[sz]e|describe)\b/i;
const REVIEW_ONLY = /\b(?:only|just)\s+(?:review|discuss|suggest|explain)\b|\b(?:do not|don't|dont)\s+(?:edit|change|apply|touch|save)\b/i;
const CHANGE_VERB = String.raw`(?:add|remove|delete|drop|rename|change|update|edit|set|make|weight|reweight|require|mark|move|reorder|split|merge|combine|hide|include|replace|increase|decrease|lower|raise|cap|limit|allow|group|label|default|swap|turn|convert|ask)`;
const LEADS_WITH_CHANGE = new RegExp(String.raw`^(?:(?:ok(?:ay)?|now|then|also|and|please|can you|could you|would you|let'?s)[,\s]+)*${CHANGE_VERB}\b`, "i");

/**
 * With a form open, does this message ask to change it?
 *
 * Once the studio is on screen nobody names the form, so "Weight flight risk at
 * 20%" is enough. Questions and review-only requests belong to the room; a
 * change still has to lead with what to do.
 */
export function isFormChangeRequest(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed || REVIEW_ONLY.test(trimmed) || QUESTION.test(trimmed)) return false;
  return LEADS_WITH_CHANGE.test(trimmed);
}

const SCOPE_OPEN = "[Form Studio selection: ";

/**
 * A message the composer scoped to a unit selected in the studio, split into the
 * selection and what the author wrote. The prefix is JSON, so it is read by
 * balancing braces rather than with a pattern a label could break.
 */
export function splitFormStudioScope(message: string): {
  selection: { formId?: number; kind?: string; key?: string; label?: string } | null;
  text: string;
} {
  const trimmed = message.trim();
  if (!trimmed.startsWith(SCOPE_OPEN)) return { selection: null, text: trimmed };
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = SCOPE_OPEN.length; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      if (trimmed[i + 1] !== "]") break;
      try {
        return { selection: JSON.parse(trimmed.slice(SCOPE_OPEN.length, i + 1)), text: trimmed.slice(i + 2).trim() };
      } catch {
        break;
      }
    }
  }
  return { selection: null, text: trimmed };
}

export type FormStudioAction =
  | { kind: "none" }
  | { kind: "apply"; proposalId: string }
  | { kind: "create"; proposalId: string }
  | { kind: "propose"; form: MountedFormStudio; instruction: string }
  | { kind: "draft"; instruction: string }
  | { kind: "mount" };

/**
 * What a message does to Form Studio in this room.
 *
 * An approval first, because its string is emitted by a card and nothing else
 * should reinterpret it. A change before a mount, because with a form open
 * "update the review page" means that form. Anything else is the room's.
 */
export function decideFormStudioAction(message: string, turns: RoomTurn[]): FormStudioAction {
  const approval = parseFormChangeApproval(message);
  if (approval) return { kind: "apply", proposalId: approval.proposalId };
  const creation = parseFormCreateApproval(message);
  if (creation) return { kind: "create", proposalId: creation.proposalId };
  // A unit selected in the studio travels as a prefix; the request is what follows it.
  const { selection, text } = splitFormStudioScope(message);
  // "Make a survey" asks for a new form even with one open; "make the field required" does not.
  if (!selection && isFormCreateRequest(text)) return { kind: "draft", instruction: text };
  const mounted = mountedFormStudio(turns);
  if (mounted && isFormChangeRequest(text)) {
    const about = selection?.label ? ` (about the ${selection.kind ?? "unit"} "${selection.label}")` : "";
    return { kind: "propose", form: mounted, instruction: `${text}${about}` };
  }
  if (isFormStudioRequest(text)) return { kind: "mount" };
  return { kind: "none" };
}
