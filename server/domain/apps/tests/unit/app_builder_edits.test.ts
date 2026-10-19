import { describe, it, expect } from "vitest";
import { normalizeEdits } from "../../app-builder-edits.js";

const CODE = 'export default function App() { return <div />; }';

describe("normalizeEdits", () => {
    it("passes a plain path map through", () => {
        expect(normalizeEdits({ "src/App.tsx": CODE })).toEqual({ "src/App.tsx": CODE });
    });

    it("unwraps a list of { path, content } entries", () => {
        expect(normalizeEdits([{ path: "src/App.tsx", content: CODE }]))
            .toEqual({ "src/App.tsx": CODE });
    });

    it("accepts file/filename and code/body aliases", () => {
        expect(normalizeEdits([
            { file: "a.tsx", code: "A" },
            { filename: "b.tsx", body: "B" },
        ])).toEqual({ "a.tsx": "A", "b.tsx": "B" });
    });

    it("unwraps a nested files map", () => {
        expect(normalizeEdits({ files: { "src/App.tsx": CODE } }))
            .toEqual({ "src/App.tsx": CODE });
    });

    it("unwraps a nested files array", () => {
        expect(normalizeEdits({ files: [{ path: "src/App.tsx", content: CODE }] }))
            .toEqual({ "src/App.tsx": CODE });
    });

    it("unwraps a nested edits map", () => {
        expect(normalizeEdits({ edits: { "src/App.tsx": CODE } }))
            .toEqual({ "src/App.tsx": CODE });
    });

    // Regression: `edits` skipped the array branch that `files` had, so the
    // path map below produced files literally named "0" and "1".
    it("unwraps a nested edits ARRAY the same way as files", () => {
        const out = normalizeEdits({
            edits: [
                { path: "src/App.tsx", content: CODE },
                { path: "src/main.tsx", content: "main" },
            ],
        });
        expect(out).toEqual({ "src/App.tsx": CODE, "src/main.tsx": "main" });
        expect(Object.keys(out)).not.toContain("0");
    });

    it("unwraps per-file { content } objects", () => {
        expect(normalizeEdits({ "src/App.tsx": { content: CODE } }))
            .toEqual({ "src/App.tsx": CODE });
    });

    // Regression: `item.content || item.code || item.body` treated "" as absent,
    // so truncating a file to empty silently dropped the edit.
    it("keeps a file that is intentionally emptied", () => {
        expect(normalizeEdits([{ path: "src/dead.ts", content: "" }]))
            .toEqual({ "src/dead.ts": "" });
        expect(normalizeEdits({ "src/dead.ts": { content: "" } }))
            .toEqual({ "src/dead.ts": "" });
    });

    it("drops entries with no string content and keeps the rest", () => {
        expect(normalizeEdits({
            "src/App.tsx": CODE,
            "src/bad.tsx": { note: "no content here" },
            "src/worse.tsx": 42,
        })).toEqual({ "src/App.tsx": CODE });
    });

    it("drops list entries with no usable path", () => {
        expect(normalizeEdits([
            { content: "orphan" },
            { path: "", content: "empty path" },
            { path: "ok.tsx", content: "keep" },
        ])).toEqual({ "ok.tsx": "keep" });
    });

    it("returns an empty map for non-object payloads", () => {
        for (const bad of [null, undefined, "a string", 7, true]) {
            expect(normalizeEdits(bad)).toEqual({});
        }
    });
});
