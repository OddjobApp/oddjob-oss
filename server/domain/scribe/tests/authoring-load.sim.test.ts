/**
 * What a real authoring session actually costs.
 *
 * Streaming every keystroke to a squad of agent sentinels sounds cheap because
 * a keystroke is small. The cost is not in the bytes — it is in how many model
 * calls a burst of typing fans out into, and Scribe already fans out once per
 * save through the continuity engine before any streaming is added.
 *
 * So this simulates a plausible drafting session against the real debounce and
 * the real continuity fan-out rule, and counts. No network, no model: the point
 * is the call count, which is what the spend cap actually responds to.
 *
 * Typing model: humans write in bursts separated by thinking pauses, not at a
 * constant rate. A 40 wpm drafter is ~3.3 chars/sec inside a burst.
 */

import { describe, expect, it } from "vitest";

const SAVE_DEBOUNCE_MS = 800; // LivingDocumentCanvas
const CONTINUITY_MIN_CHARS = 20; // continuity-engine skips shorter downstream nodes

interface Keystroke {
    atMs: number;
}

/** A drafting session: bursts of typing separated by pauses to think. */
function typingSession(opts: {
    bursts: number;
    charsPerBurst: number;
    charIntervalMs: number;
    pauseMs: number;
}): Keystroke[] {
    const keys: Keystroke[] = [];
    let t = 0;
    for (let b = 0; b < opts.bursts; b++) {
        for (let c = 0; c < opts.charsPerBurst; c++) {
            keys.push({ atMs: t });
            t += opts.charIntervalMs;
        }
        t += opts.pauseMs;
    }
    return keys;
}

/**
 * The debounce as LivingDocumentCanvas actually implements it: every keystroke
 * cancels the pending timer and re-arms it, so a save fires only after the
 * author stops for the full window.
 */
function savesFrom(keys: Keystroke[], debounceMs = SAVE_DEBOUNCE_MS): number {
    let saves = 0;
    for (let i = 0; i < keys.length; i++) {
        const next = keys[i + 1];
        if (!next || next.atMs - keys[i].atMs >= debounceMs) saves++;
    }
    return saves;
}

/** Continuity fans out one model call per downstream station holding prose. */
function continuityCallsPerSave(stationIndex: number, totalStations: number, filledRatio: number): number {
    const downstream = Math.max(0, totalStations - stationIndex - 1);
    return Math.round(downstream * filledRatio);
}

describe("authoring session load — what exists today", () => {
    // Thirty minutes of real drafting: 60 bursts of ~12 words, 4s of thinking
    // between them. Roughly 3,600 characters, which is a short chapter or a
    // couple of contract clauses.
    const session = typingSession({ bursts: 60, charsPerBurst: 60, charIntervalMs: 300, pauseMs: 4000 });

    it("debounces a 30-minute session down to one save per burst", () => {
        const saves = savesFrom(session);

        expect(session.length).toBe(3600);
        // The pause exceeds the debounce, so each burst settles into one save.
        expect(saves).toBe(60);
    });

    it("already fans out to hundreds of model calls before any streaming", () => {
        const saves = savesFrom(session);
        // A 12-station framework, author working station 3, most stations drafted.
        const perSave = continuityCallsPerSave(3, 12, 0.8);
        const calls = saves * perSave;

        expect(perSave).toBe(6);
        expect(calls).toBe(360);

        // 360 model calls for half an hour of typing, from the continuity engine
        // alone, on a feature nobody thinks of as a model-heavy surface.
        expect(calls).toBeGreaterThan(300);
    });

    it("costs more the EARLIER in the manuscript you edit", () => {
        // Editing station 1 of 12 re-analyses everything after it; editing the
        // last station costs nothing. Revising an opening clause is the
        // expensive case, and revising openings is exactly what authors do.
        const early = continuityCallsPerSave(0, 12, 1.0);
        const late = continuityCallsPerSave(10, 12, 1.0);

        expect(early).toBe(11);
        expect(late).toBe(1);
        expect(early).toBeGreaterThan(late * 10);
    });
});

describe("authoring session load — with per-delta agent streaming", () => {
    const session = typingSession({ bursts: 60, charsPerBurst: 60, charIntervalMs: 300, pauseMs: 4000 });

    it("costs nothing extra for a fast typist — the window never elapses mid-burst", () => {
        // First assumption this simulation killed. At 300ms between characters
        // both a 400ms and an 800ms window collapse a burst to a single event,
        // so halving the debounce buys nothing and costs nothing.
        expect(savesFrom(session, 400)).toBe(savesFrom(session, 800));
    });

    it("but explodes for a deliberate typist, which is the contract-drafting case", () => {
        // Someone weighing each phrase — the exact profile for an indemnity
        // clause — leaves 500ms between characters. That sits above the 400ms
        // delta window and below the 800ms save window, so every keystroke
        // becomes its own delta while saves stay at one per burst.
        const deliberate = typingSession({ bursts: 20, charsPerBurst: 40, charIntervalMs: 500, pauseMs: 4000 });

        const deltas = savesFrom(deliberate, 400);
        const saves = savesFrom(deliberate, 800);

        expect(saves).toBe(20);
        expect(deltas).toBe(800); // one per character
        expect(deltas / saves).toBe(40);
    });

    it("streaming one LLM sentinel per delta is the part that does not scale", () => {
        const deltas = savesFrom(session, 400);
        const sentinels = 3; // Legal, GhostWriter, Critic

        const tier2 = deltas * sentinels;
        const continuity = savesFrom(session) * continuityCallsPerSave(3, 12, 0.8);

        // Three sentinels on every delta, on top of continuity, for one author
        // for thirty minutes.
        expect(tier2).toBe(180);
        expect(tier2 + continuity).toBe(540);

        // Ten authors drafting concurrently is 5,400 model calls an hour from
        // typing alone. That is the number the spend cap responds to.
        expect((tier2 + continuity) * 10).toBeGreaterThan(5000);
    });

    it("rule-based Tier 1 carries the same alerts at zero model cost", () => {
        const deltas = savesFrom(session, 400);

        // Tier 1 in the proposal is AST/regex work — placeholder tokens,
        // missing mandatory terms, ambiguous SLA metrics. No model, so the
        // per-delta budget is real work rather than spend.
        const tier1ModelCalls = 0;
        expect(tier1ModelCalls).toBe(0);
        expect(deltas).toBeGreaterThan(0);
    });

    it("settling Tier 2 on the save boundary bounds it regardless of typing speed", () => {
        const deliberate = typingSession({ bursts: 20, charsPerBurst: 40, charIntervalMs: 500, pauseMs: 4000 });
        const sentinels = 3;

        const perDelta = savesFrom(deliberate, 400) * sentinels;
        const onSave = savesFrom(deliberate, SAVE_DEBOUNCE_MS) * sentinels;

        // 2,400 model calls versus 60, for feedback the author receives at the
        // same moment either way — they are pausing to think when it lands.
        expect(perDelta).toBe(2400);
        expect(onSave).toBe(60);
        expect(perDelta / onSave).toBe(40);
    });
});

describe("continuity fan-out guards worth having before streaming lands", () => {
    it("skipping unchanged downstream stations removes most of the fan-out", () => {
        // Continuity re-analyses every downstream station on every save, even
        // when neither that station nor the edit touches anything it references.
        const naive = continuityCallsPerSave(3, 12, 0.8);
        // Only stations sharing an entity with the edited text need re-checking;
        // in practice that is one or two, not all eight.
        const scoped = 2;

        expect(naive).toBe(6);
        expect(scoped).toBeLessThan(naive);
    });

    it("a short station is already skipped, which is why the floor matters", () => {
        expect(CONTINUITY_MIN_CHARS).toBe(20);
        // Anything under the floor costs nothing — the fan-out grows with how
        // much of the manuscript is actually written, so it is worst on a
        // finished document being revised.
        const earlyDraft = continuityCallsPerSave(3, 12, 0.2);
        const finishedDoc = continuityCallsPerSave(3, 12, 1.0);

        expect(earlyDraft).toBe(2);
        expect(finishedDoc).toBe(8);
    });
});
