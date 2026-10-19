import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Guards the most repeated deployment failure in this repository: a migration
 * that exists on disk, is referenced by the Drizzle schema, and is never
 * applied — because its `_journal.json` entry is missing or out of order. The
 * subsystem then looks built everywhere while every writer fails into a
 * swallowing catch.
 *
 * The runtime migrator applies by journal `when` timestamp greater than the max
 * applied `created_at`, NOT by file hash. A backdated entry is therefore skipped
 * silently in any environment that already applied a later-stamped migration.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * KNOWN DRIFT
 *
 * Three violations predate this test. Each was verified as actually applied in
 * the development database, so they are latent hazards rather than live
 * outages, and they are NOT repaired here: rewriting a `when` would make the
 * migrator re-run a migration that environments have already applied, which is
 * a worse failure than the ordering being ugly. They are pinned instead, so the
 * invariant is enforced for everything new.
 */

/** Backdated `when` values. Verified applied: see the note on each. */
const KNOWN_WHEN_REGRESSIONS: ReadonlySet<string> = new Set([
    // Journalled after 0025 with an earlier timestamp. 0023/0024 were
    // hand-applied at the time. Verified applied: `kafka_outbox_events` and
    // `kafka_consumed_events` both exist.
    "0023_kafka_event_backbone",
    // Stamped before 0029_theory_of_mind. Verified applied: `theory_of_mind`
    // carries `access_consent`, `consent_decided_at` and `consent_request_id`.
    "0030_tom_access_consent",
]);

/**
 * Two distinct migrations were both numbered 0063 and both claim `idx: 63`.
 * Their `when` values are correctly ordered, so both apply; the collision is a
 * naming trap rather than a skip.
 */
const KNOWN_DUPLICATE_IDX: ReadonlySet<number> = new Set([63]);

const RUNTIME_DIR = path.resolve(process.cwd(), "migrations", "runtime");
const JOURNAL_PATH = path.join(RUNTIME_DIR, "meta", "_journal.json");

interface JournalEntry {
    idx: number;
    version: string;
    when: number;
    tag: string;
    breakpoints: boolean;
}

function journalEntries(): JournalEntry[] {
    return JSON.parse(fs.readFileSync(JOURNAL_PATH, "utf8")).entries;
}

function sqlTags(): string[] {
    return fs
        .readdirSync(RUNTIME_DIR)
        .filter((f) => f.endsWith(".sql"))
        .map((f) => f.replace(/\.sql$/, ""));
}

describe("runtime migration journal", () => {
    it("has a journal entry for every .sql file", () => {
        const journalled = new Set(journalEntries().map((e) => e.tag));
        const orphans = sqlTags().filter((tag) => !journalled.has(tag));
        expect(
            orphans,
            `Present on disk but absent from _journal.json, so the runtime migrator will never apply them: ${orphans.join(", ")}`,
        ).toEqual([]);
    });

    it("has a .sql file for every journal entry", () => {
        const onDisk = new Set(sqlTags());
        const missing = journalEntries()
            .map((e) => e.tag)
            .filter((tag) => !onDisk.has(tag));
        expect(missing, `Journal entries with no migration file: ${missing.join(", ")}`).toEqual([]);
    });

    it("keeps `when` strictly increasing for every migration added since this guard", () => {
        const entries = journalEntries();
        const regressions: string[] = [];
        for (let i = 1; i < entries.length; i++) {
            if (entries[i].when <= entries[i - 1].when && !KNOWN_WHEN_REGRESSIONS.has(entries[i].tag)) {
                regressions.push(
                    `${entries[i].tag} (when=${entries[i].when}) does not exceed ${entries[i - 1].tag} (when=${entries[i - 1].when})`,
                );
            }
        }
        expect(
            regressions,
            `A migration whose \`when\` does not exceed its predecessor is skipped by the runtime migrator: ${regressions.join("; ")}`,
        ).toEqual([]);
    });

    it("assigns each idx to exactly one migration", () => {
        const seen = new Map<number, string[]>();
        for (const entry of journalEntries()) {
            seen.set(entry.idx, [...(seen.get(entry.idx) ?? []), entry.tag]);
        }
        const collisions = [...seen.entries()]
            .filter(([idx, tags]) => tags.length > 1 && !KNOWN_DUPLICATE_IDX.has(idx))
            .map(([idx, tags]) => `idx ${idx}: ${tags.join(" + ")}`);
        expect(collisions, `Two migrations share an idx: ${collisions.join("; ")}`).toEqual([]);
    });

    it("has no gaps in the idx sequence", () => {
        const idxs = journalEntries().map((e) => e.idx);
        const missing: number[] = [];
        for (let i = Math.min(...idxs); i <= Math.max(...idxs); i++) {
            if (!idxs.includes(i)) missing.push(i);
        }
        expect(missing, `Missing idx values: ${missing.join(", ")}`).toEqual([]);
    });

    it("has no duplicate tags", () => {
        const tags = journalEntries().map((e) => e.tag);
        expect(tags.length).toBe(new Set(tags).size);
    });

    // If drift is repaired, shrink these sets. If one grows, the guard was
    // bypassed rather than satisfied.
    it("does not let the known-drift baseline grow", () => {
        expect(KNOWN_WHEN_REGRESSIONS.size).toBeLessThanOrEqual(2);
        expect(KNOWN_DUPLICATE_IDX.size).toBeLessThanOrEqual(1);
    });
});
