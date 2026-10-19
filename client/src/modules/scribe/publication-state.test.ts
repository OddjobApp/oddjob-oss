/**
 * What survives a publish once the modal has closed.
 *
 * Publishing showed a tick for 1600ms and then left nothing behind, so an
 * author who looked away could not tell whether it had happened. The data was
 * never missing — settings.publications has recorded the version, time, word
 * count and attachment id since the feature shipped, written through an `as
 * any` cast and read by nothing.
 *
 * The claim that has to be right is staleness. Telling an author their
 * published asset is out of date when it is not sends them to republish for
 * nothing; the reverse lets them hand out a stale document. So every
 * unreadable timestamp resolves to "not an edit".
 */

import { describe, expect, it } from "vitest";
import { latestPublication, relativeTime } from "./publication-state";

const PUBLISHED_AT = "2026-08-29T10:00:00.000Z";

const publication = (over: Record<string, unknown> = {}) => ({
    versionTag: "v1.0",
    publishedAt: PUBLISHED_AT,
    releaseNotes: "First issue for review",
    wordCount: 306,
    attachmentId: 88,
    theme: "corporate_legal",
    ...over,
});

const node = (updatedAt: string | Date | null) => ({ updatedAt });

describe("a document that has never been published", () => {
    it("has no state to show", () => {
        expect(latestPublication(undefined)).toBeNull();
        expect(latestPublication([])).toBeNull();
        expect(latestPublication(null)).toBeNull();
    });

    it("ignores a settings value of the wrong shape", () => {
        // jsonb: whatever is in the column is what arrives.
        expect(latestPublication("not an array")).toBeNull();
        expect(latestPublication({ versionTag: "v1.0" })).toBeNull();
    });

    it("ignores entries missing the fields the state is built on", () => {
        expect(latestPublication([{ releaseNotes: "orphaned" }])).toBeNull();
        expect(latestPublication([{ versionTag: "v1.0" }])).toBeNull();
        expect(latestPublication([{ versionTag: "v1.0", publishedAt: "not a date" }])).toBeNull();
    });

    it("keeps the sound entries when one is malformed", () => {
        const out = latestPublication([{ versionTag: "v2.0" }, publication()]);
        expect(out?.versionTag).toBe("v1.0");
    });
});

describe("the most recent publish", () => {
    it("carries what the author needs to identify it", () => {
        expect(latestPublication([publication()])).toMatchObject({
            versionTag: "v1.0",
            publishedAt: PUBLISHED_AT,
            wordCount: 306,
            releaseNotes: "First issue for review",
        });
    });

    it("links to the asset it produced", () => {
        expect(latestPublication([publication()])?.downloadUrl).toBe("/api/attachments/88/download");
    });

    it("offers no link when the publish predates attachment tracking", () => {
        expect(latestPublication([publication({ attachmentId: undefined })])?.downloadUrl).toBeNull();
    });

    it("picks the newest by time, not by position", () => {
        // publishDocument stores newest first, but that is its convention
        // rather than a guarantee, and a hand-edited jsonb column is not bound
        // by it.
        const out = latestPublication([
            publication({ versionTag: "v1.0", publishedAt: "2026-08-01T10:00:00.000Z" }),
            publication({ versionTag: "v3.0", publishedAt: "2026-08-29T10:00:00.000Z" }),
            publication({ versionTag: "v2.0", publishedAt: "2026-08-15T10:00:00.000Z" }),
        ]);

        expect(out?.versionTag).toBe("v3.0");
    });
});

describe("whether the asset still matches the draft", () => {
    const before = "2026-08-29T09:00:00.000Z";
    const after = "2026-08-29T11:00:00.000Z";

    it("reports nothing edited when the draft has not moved", () => {
        const out = latestPublication([publication()], [node(before), node(before)]);
        expect(out?.editedSince).toBe(0);
    });

    it("counts the stations saved since", () => {
        const out = latestPublication([publication()], [node(after), node(before), node(after)]);
        expect(out?.editedSince).toBe(2);
    });

    it("accepts a Date as readily as an ISO string", () => {
        // The payload is JSON, but a locally updated node carries a Date.
        const out = latestPublication([publication()], [node(new Date(after))]);
        expect(out?.editedSince).toBe(1);
    });

    it("does not treat an unreadable timestamp as an edit", () => {
        // Claiming the asset is stale when it is not sends the author to
        // republish for nothing.
        const out = latestPublication([publication()], [node(null), node(undefined as any), node("nonsense")]);
        expect(out?.editedSince).toBe(0);
    });

    it("does not count a station saved at the moment of publishing", () => {
        // Publishing compiles what is already saved, so an equal timestamp is
        // the publish itself, not a change to it.
        const out = latestPublication([publication()], [node(PUBLISHED_AT)]);
        expect(out?.editedSince).toBe(0);
    });

    it("compares against the newest publish, not the first", () => {
        const out = latestPublication(
            [
                publication({ versionTag: "v1.0", publishedAt: "2026-08-01T10:00:00.000Z" }),
                publication({ versionTag: "v2.0", publishedAt: after }),
            ],
            [node("2026-08-29T10:30:00.000Z")],
        );

        expect(out?.versionTag).toBe("v2.0");
        expect(out?.editedSince).toBe(0);
    });
});

describe("relativeTime", () => {
    const now = Date.parse("2026-08-29T12:00:00.000Z");

    it.each([
        ["2026-08-29T11:59:30.000Z", "just now"],
        ["2026-08-29T11:57:00.000Z", "3 minutes ago"],
        ["2026-08-29T11:59:00.000Z", "1 minute ago"],
        ["2026-08-29T09:00:00.000Z", "3 hours ago"],
        ["2026-08-29T11:00:00.000Z", "1 hour ago"],
        ["2026-08-28T10:00:00.000Z", "yesterday"],
        ["2026-08-20T10:00:00.000Z", "9 days ago"],
    ])("renders %s as %s", (iso, expected) => {
        expect(relativeTime(iso, now)).toBe(expected);
    });

    it("falls back to a date once it is no longer recent", () => {
        expect(relativeTime("2026-01-05T10:00:00.000Z", now)).toMatch(/\d/);
        expect(relativeTime("2026-01-05T10:00:00.000Z", now)).not.toMatch(/ago/);
    });

    it("never says a publish is in the future", () => {
        // A client clock behind the server's would otherwise read "in 2 minutes".
        expect(relativeTime("2026-08-29T12:02:00.000Z", now)).toBe("just now");
    });

    it("says nothing for an unreadable timestamp", () => {
        expect(relativeTime("nonsense", now)).toBe("");
    });
});
