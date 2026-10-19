/**
 * Crew Triage Service
 *
 * Decides whether a message deserves a full multi-agent round.
 *
 * Why this exists: "Hi" used to convene three agents plus a supervisor review —
 * four model calls — and produced durable-looking output about nothing ("A
 * simple greeting provides no verifiable data for threat modeling"). Once
 * discussion outcomes are written back into agent knowledge graphs, that stops
 * being merely wasteful and starts poisoning recall.
 *
 * The shape is borrowed from the signal engine, which flags event primitives
 * below 0.3 confidence as `low_confidence` and keeps them out of automatic
 * downstream processing rather than discarding them.
 *
 * Deliberately heuristic and model-free: a triage gate that costs a model call
 * defeats its own purpose.
 */

import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("CrewTriageService");

export type CrewMode = "discussion" | "conversational";

export interface TriageResult {
    mode: CrewMode;
    /** 0-1. Higher means more worth convening the crew over. */
    substance: number;
    reason: string;
}

/** Below this, one agent replies conversationally and no round is convened. */
const SUBSTANCE_THRESHOLD = 0.3;

/** Pure greetings/acknowledgements — nothing to discuss. */
const PLEASANTRIES = new Set([
    "hi", "hey", "hello", "yo", "sup", "hiya", "howdy",
    "thanks", "thank you", "ta", "cheers", "ok", "okay", "k", "kk",
    "cool", "nice", "great", "good", "got it", "sure", "yes", "no",
    "yep", "yeah", "nope", "morning", "good morning", "good afternoon",
    "good evening", "bye", "goodbye", "see you", "np", "no problem",
]);

/** High-stakes imperative verbs that always trigger a full crew discussion. */
const HIGH_STAKES_VERBS = new Set([
    "deploy", "ship", "release", "delete", "drop", "revert", "rollback",
    "merge", "publish", "execute", "run", "launch", "terminate", "shutdown", "destroy",
]);

/** Verbs and markers that signal actual work to be done. */
const SUBSTANCE_MARKERS =
    /\b(why|how|what|when|where|which|who|should|could|would|can|do|does|is|are|explain|compare|analyse|analyze|assess|review|evaluate|design|plan|build|fix|debug|improve|optimi[sz]e|decide|prioriti[sz]e|risk|impact|tradeoff|trade-off|recommend|propose|investigate|diagnose|migrate|refactor|scale|secure|test|discuss|discussion|brainstorm|talk(?:ing)?)\b/i;

/**
 * Short confirmations that, on their own, carry no substance — but when they
 * follow a `discussion` round they are continuing that discussion, not starting
 * a new chat about nothing. Matching these in isolation avoids the "Yes loop":
 * nine consecutive rounds of the agent describing an action without taking it
 * while the supervisor was suppressed because every confirmation was triage'd
 * as `conversational`.
 */
const CONFIRMATION_PATTERNS =
    /^(yes|yeah|yep|ok|okay|sure|proceed|go ahead|do it|please|continue|1|2|3|confirm|confirmed|agreed|go|next|yes please|yes proceed|please proceed|yes go ahead|please do|do that|that one)\.?$/i;

/**
 * Is this message nothing more than a short approval?
 *
 * The triage check needs the normalized form (trailing punctuation stripped),
 * which callers do not share — this wraps both so "Yes, please" and "Yes!"
 * read the same whether they reach `assess` or the requirement extractor.
 */
export function isConfirmationMessage(message: string): boolean {
    const normalized = message.trim().toLowerCase().replace(/[!.?,]+$/g, "").trim();
    return CONFIRMATION_PATTERNS.test(normalized);
}

export class CrewTriageService {
    /**
     * Scores how much substance a message carries.
     *
     * Signals, in rough order of weight:
     *  - a bare pleasantry is disqualifying regardless of anything else
     *  - length (a real question is rarely two words)
     *  - an explicit question or an imperative work verb
     *  - domain nouns rather than pure chat
     *  - an @mention, which is an explicit request for a specific agent
     *
     * `priorRoundWasDiscussion` lifts short confirmations to `discussion` mode
     * so the supervisor runs on every round in an active work session, not just
     * the ones where the user writes a full question.
     */
    assess(message: string, priorRoundWasDiscussion = false): TriageResult {
        const trimmed = message.trim();
        const normalized = trimmed.toLowerCase().replace(/[!.?,]+$/g, "").trim();
        const words = trimmed.split(/\s+/).filter(Boolean);

        // An explicit @mention is an unambiguous request to engage someone.
        if (trimmed.includes("@") && words.length > 2) {
            return { mode: "discussion", substance: 1, reason: "explicit @mention" };
        }

        // High-stakes imperative verbs always warrant full crew discussion.
        if (words.some((w) => HIGH_STAKES_VERBS.has(w.toLowerCase().replace(/[^a-z]/g, "")))) {
            return { mode: "discussion", substance: 1, reason: "high-stakes imperative verb" };
        }

        // A short confirmation in an ongoing discussion continues that discussion.
        // Without this, "Yes", "1", "ok proceed" all score ~0.1 and suppress the
        // supervisor — exactly the pattern that produced 30 rounds of silence in
        // production. The user is not chatting; they are advancing a work session.
        if (priorRoundWasDiscussion && CONFIRMATION_PATTERNS.test(normalized)) {
            return { mode: "discussion", substance: 0.5, reason: "confirmation continuing prior discussion" };
        }

        if (PLEASANTRIES.has(normalized)) {
            return {
                mode: "conversational",
                substance: 0,
                reason: "greeting or acknowledgement",
            };
        }

        if (words.length <= 2) {
            return {
                mode: "conversational",
                substance: 0.1,
                reason: "too short to discuss",
            };
        }

        let score = 0;

        // Length — saturating, so an essay is not automatically profound.
        score += Math.min(words.length / 25, 1) * 0.4;

        // A question mark or a work verb is the strongest single signal.
        if (trimmed.includes("?")) score += 0.25;
        if (SUBSTANCE_MARKERS.test(trimmed)) score += 0.3;

        // Some lexical variety, as opposed to repetition or filler.
        const distinct = new Set(words.map((w) => w.toLowerCase())).size;
        score += Math.min(distinct / 12, 1) * 0.15;

        const substance = Math.min(1, Number(score.toFixed(3)));
        const mode: CrewMode = substance >= SUBSTANCE_THRESHOLD ? "discussion" : "conversational";

        const reason =
            mode === "discussion"
                ? "substantive enough for the crew"
                : "not substantive enough to convene the crew";

        logger.debug(`Triage: mode=${mode} substance=${substance} — ${reason}`);
        return { mode, substance, reason };
    }
}

export const crewTriageService = new CrewTriageService();
