/**
 * Snapshot history that survives a reload.
 *
 * The panel offered Restore against component state: it emptied on reload or
 * unmount, silently, with nothing saying it was ever temporary. A restore point
 * that quietly stops existing is worse than none, because it is only missed at
 * the moment it is needed.
 *
 * What is tested hardest is the failure path. localStorage throws outright in a
 * private window, with site data blocked, or over quota — and losing the
 * ability to type because history could not be written would be far worse than
 * losing the history.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
    loadHistory,
    saveHistory,
    appendSnapshot,
    pruneToFit,
    clearHistory,
    MAX_SNAPSHOTS_PER_NODE,
    MAX_DOCUMENT_BYTES,
    type SnapshotsByNode,
} from "./station-history";

const snap = (content: string, label = "Autosave") => ({
    timestamp: "10:30",
    label,
    content,
    wordCount: content.split(/\s+/).filter(Boolean).length,
});

describe("round trip", () => {
    beforeEach(() => window.localStorage.clear());

    it("returns what was saved", () => {
        const history: SnapshotsByNode = { 7: [snap("first draft")] };

        expect(saveHistory(5, history)).toBe(true);
        expect(loadHistory(5)).toEqual(history);
    });

    it("keeps documents apart", () => {
        saveHistory(5, { 7: [snap("doc five")] });
        saveHistory(6, { 7: [snap("doc six")] });

        expect(loadHistory(5)[7][0].content).toBe("doc five");
        expect(loadHistory(6)[7][0].content).toBe("doc six");
    });

    it("returns empty for a document with no history", () => {
        expect(loadHistory(999)).toEqual({});
    });

    it("forgets a document on request", () => {
        saveHistory(5, { 7: [snap("draft")] });
        clearHistory(5);
        expect(loadHistory(5)).toEqual({});
    });
});

describe("corrupt or foreign data never breaks the editor", () => {
    beforeEach(() => window.localStorage.clear());

    it("ignores unparseable JSON", () => {
        window.localStorage.setItem("scribe:history:v1:5", "{not json");
        expect(loadHistory(5)).toEqual({});
    });

    it("ignores a stored array where an object was expected", () => {
        window.localStorage.setItem("scribe:history:v1:5", "[1,2,3]");
        expect(loadHistory(5)).toEqual({});
    });

    it("drops malformed snapshots but keeps the sound ones", () => {
        window.localStorage.setItem(
            "scribe:history:v1:5",
            JSON.stringify({ 7: [{ content: "good", label: "L", timestamp: "T" }, { nonsense: true }] }),
        );

        const out = loadHistory(5);
        expect(out[7]).toHaveLength(1);
        expect(out[7][0].content).toBe("good");
    });

    it("drops a station whose snapshots are all malformed", () => {
        window.localStorage.setItem("scribe:history:v1:5", JSON.stringify({ 7: [{ x: 1 }] }));
        expect(loadHistory(5)).toEqual({});
    });
});

describe("storage that refuses to work", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("reports failure rather than throwing when the write is refused", () => {
        vi.stubGlobal("localStorage", {
            getItem: () => null,
            setItem: () => { throw new Error("QuotaExceededError"); },
            removeItem: () => {},
        });

        // The caller uses this to tell the author their history is
        // session-only, instead of letting them assume otherwise.
        expect(saveHistory(5, { 7: [snap("draft")] })).toBe(false);
    });

    it("reads as empty rather than throwing when storage is blocked", () => {
        vi.stubGlobal("localStorage", {
            getItem: () => { throw new Error("SecurityError"); },
            setItem: () => {},
            removeItem: () => {},
        });

        expect(loadHistory(5)).toEqual({});
    });

    it("swallows a failure to clear", () => {
        vi.stubGlobal("localStorage", {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => { throw new Error("SecurityError"); },
        });

        expect(() => clearHistory(5)).not.toThrow();
    });
});

describe("appendSnapshot", () => {
    it("adds a snapshot to a station", () => {
        const out = appendSnapshot({}, 7, snap("first"));
        expect(out[7]).toHaveLength(1);
    });

    it("does not record a save that changed nothing", () => {
        // An unchanged save is not a restore point, and recording it would push
        // the useful ones out of a ten-deep history.
        const first = appendSnapshot({}, 7, snap("same text"));
        const second = appendSnapshot(first, 7, snap("same text"));

        expect(second).toBe(first);
        expect(second[7]).toHaveLength(1);
    });

    it("keeps the newest and drops the oldest past the cap", () => {
        let history: SnapshotsByNode = {};
        for (let i = 0; i < MAX_SNAPSHOTS_PER_NODE + 5; i++) {
            history = appendSnapshot(history, 7, snap(`draft ${i}`));
        }

        expect(history[7]).toHaveLength(MAX_SNAPSHOTS_PER_NODE);
        expect(history[7][history[7].length - 1].content).toBe(`draft ${MAX_SNAPSHOTS_PER_NODE + 4}`);
        expect(history[7][0].content).not.toBe("draft 0");
    });

    it("keeps stations independent", () => {
        let history = appendSnapshot({}, 7, snap("station seven"));
        history = appendSnapshot(history, 8, snap("station eight"));

        expect(history[7]).toHaveLength(1);
        expect(history[8]).toHaveLength(1);
    });
});

describe("pruneToFit", () => {
    const bulky = (n: number) => Array.from({ length: 6 }, (_, i) => snap("x".repeat(12_000) + `${n}-${i}`));

    it("leaves a small history alone", () => {
        const history = { 7: [snap("short")] };
        expect(pruneToFit(history, 7)).toEqual(history);
    });

    it("drops other stations before the one being edited", () => {
        const history: SnapshotsByNode = { 1: bulky(1), 2: bulky(2), 3: bulky(3), 7: bulky(7) };

        const pruned = pruneToFit(history, 7);

        // Losing a station's history entirely keeps the rest restorable;
        // trimming everywhere would leave every station one-deep and useless.
        expect(pruned[7]).toBeDefined();
        expect(JSON.stringify(pruned).length).toBeLessThanOrEqual(MAX_DOCUMENT_BYTES);
    });

    it("trims the active station rather than storing nothing", () => {
        // One station on its own has to exceed the ceiling for this path to be
        // reached at all: 10 x 30KB against a 256KB cap.
        const huge = Array.from({ length: 10 }, (_, i) => snap("y".repeat(30_000) + i));
        const history: SnapshotsByNode = { 7: huge };

        const pruned = pruneToFit(history, 7);

        expect(pruned[7].length).toBeGreaterThan(0);
        expect(pruned[7].length).toBeLessThan(history[7].length);
        // The newest survives — that is the one an author reaches for.
        expect(pruned[7][pruned[7].length - 1]).toEqual(history[7][history[7].length - 1]);
    });

    it("keeps a saved payload under the ceiling", () => {
        const history: SnapshotsByNode = { 1: bulky(1), 2: bulky(2), 7: bulky(7) };
        window.localStorage.clear();

        expect(saveHistory(5, history, 7)).toBe(true);
        expect(JSON.stringify(loadHistory(5)).length).toBeLessThanOrEqual(MAX_DOCUMENT_BYTES);
    });
});
