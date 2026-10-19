/**
 * Assistant chat intent detection — the single source of truth for the fast-path
 * routing that used to live as inline regexes scattered through agent.service.ts.
 *
 * Hard-won rule: every pattern is anchored to the END of the message (allowing only
 * trailing whitespace/punctuation) so it matches ONLY when the trigger word is the
 * WHOLE message. A bare prefix/`\b` match routed real requests that merely START with
 * a trigger word — "help me create a mission", "test the pipeline", "good morning,
 * run the report" — to a canned/tool-less reply instead of the agent loop. These
 * pure predicates are unit-tested (see tests/agent-chat-intent.test.ts) so that
 * over-match regression can't happen again.
 */

// Trivial small-talk that gets a canned, hard-coded reply (no LLM call at all).
// IMPORTANT: do NOT add short or ambiguous words here (e.g. 'test', 'ping', 'run', 'go').
// If a word could plausibly start a real command — "test pipeline 3", "ping job 12" —
// it must NOT be in this list, or those commands will silently receive a canned greeting.
export const GREETING_RE =
    /^(hi|hello|hey|yo|gm|gn|thanks|thank you|ok|okay|got it|bye|goodbye|how are you|greet|morning|evening|afternoon)[\s.!?]*$/i;

// Chat/identity/help small-talk answerable in one LLM call without the tool loop.
export const CONVERSATIONAL_RE =
    /^(hi|hey|hello|yo|gm|good (morning|afternoon|evening)|thanks?|thank you|how are you|who are you|what('| i)?s your name|what can you do|what do you do|help)[\s.!?]*$/i;

/** A pure greeting / thanks / acknowledgement that warrants a canned reply. */
export function isGreetingMessage(message: string): boolean {
    const m = (message ?? "").trim();
    return m.length > 0 && m.length < 25 && GREETING_RE.test(m);
}

/**
 * Trivial chat answerable in a single LLM call (no multi-iteration tool loop).
 * Only applies OUTSIDE a job context — inside a job the agent may need its tools.
 */
export function isTrivialChatMessage(message: string, opts: { hasJob: boolean }): boolean {
    const m = (message ?? "").trim();
    return !opts.hasJob && m.length > 0 && m.length <= 120 && CONVERSATIONAL_RE.test(m);
}
