import { describe, expect, it } from "vitest";
import {
    migrateFileToGallery,
    renderMigrationDiff,
} from "@domain/apps/core/gallery-migration.service.js";

/**
 * The deterministic half of a migration.
 *
 * Deterministic because sending a working application back through a model to
 * "restyle" it is how business logic changes during what was asked to be a
 * styling pass. What this cannot do mechanically it reports, and reporting is
 * the difference between a migration and a silent replacement.
 */
describe("migrateFileToGallery — what it rewrites", () => {
    it("maps the drop-in controls and adds their imports", () => {
        const before = `export default function Page() {
  return <div><button onClick={go}>Save</button><input value={x}/></div>;
}`;
        const m = migrateFileToGallery("app/page.tsx", before);

        expect(m.changed).toBe(true);
        expect(m.after).toContain("<Button onClick={go}>Save</Button>");
        expect(m.after).toContain("<Input value={x}/>");
        expect(m.after).toContain('import { Button } from "@/components/ui/button";');
        expect(m.after).toContain('import { Input } from "@/components/ui/input";');
    });

    it("keeps props and children exactly as they were", () => {
        const before = `<button className="w-full" disabled={busy} aria-label="Save">{label}</button>`;
        const m = migrateFileToGallery("a.tsx", before);
        expect(m.after).toContain(`<Button className="w-full" disabled={busy} aria-label="Save">{label}</Button>`);
    });

    it("adds imports below existing ones so a directive stays first", () => {
        const before = `"use client";
import React from "react";

export default () => <button>Go</button>;`;
        const after = migrateFileToGallery("a.tsx", before).after;

        expect(after.indexOf('"use client"')).toBe(0);
        expect(after.indexOf('import { Button }')).toBeGreaterThan(after.indexOf('import React'));
    });

    /*
     * Re-importing a name the file already has is a duplicate-identifier error,
     * which would turn a styling migration into a build failure.
     */
    it("does not import a component the file already imports", () => {
        const before = `import { Button } from "@/components/ui/button";
export default () => <div><Button/><button>Raw</button></div>;`;
        const after = migrateFileToGallery("a.tsx", before).after;

        expect(after.match(/import \{ Button \}/g)).toHaveLength(1);
    });

    it("does not rewrite markup written inside a string or a comment", () => {
        const before = `// replaces the old <button> element
const help = "use <button> for actions";
export default () => <div><button>Real</button></div>;`;
        const after = migrateFileToGallery("a.tsx", before).after;

        expect(after).toContain("// replaces the old <button> element");
        expect(after).toContain(`"use <button> for actions"`);
        expect(after).toContain("<Button>Real</Button>");
    });
});

describe("migrateFileToGallery — what it refuses to rewrite", () => {
    /*
     * The boundary that matters. Select is a composed Radix component whose
     * children are SelectItem, not <option>, so renaming the tag produces
     * markup that renders an empty control — worse than leaving it alone.
     */
    it.each([
        ["select", "<select><option>a</option></select>"],
        ["table", "<table><tr><td>a</td></tr></table>"],
        ["dialog", "<dialog open>hi</dialog>"],
        ["form", "<form onSubmit={s}><input/></form>"],
    ])("reports <%s> for review instead of renaming it", (tag, markup) => {
        const m = migrateFileToGallery("a.tsx", `export default () => (${markup});`);

        expect(m.after).toContain(`<${tag}`);
        expect(m.notes.some((n) => n.kind === "needs-review" && n.detail.includes(`<${tag}>`))).toBe(true);
    });

    it("reports a hardcoded colour rather than guessing which token was meant", () => {
        const m = migrateFileToGallery("a.tsx", `export default () => <div className="bg-[#ff0000]"><button>x</button></div>;`);

        expect(m.after).toContain("bg-[#ff0000]");
        expect(m.notes.some((n) => n.detail.includes("semantic token"))).toBe(true);
    });

    it("leaves a file with nothing to map untouched", () => {
        const before = `import { Button } from "@/components/ui/button";\nexport default () => <Button/>;`;
        const m = migrateFileToGallery("a.tsx", before);

        expect(m.changed).toBe(false);
        expect(m.after).toBe(before);
    });

    it("still reports review items for a file it did not change", () => {
        const m = migrateFileToGallery("a.tsx", `export default () => <select><option>a</option></select>;`);
        expect(m.changed).toBe(false);
        expect(m.notes.some((n) => n.kind === "needs-review")).toBe(true);
    });
});

describe("renderMigrationDiff", () => {
    it("shows the change as a reviewable diff", () => {
        const m = migrateFileToGallery("app/page.tsx", `export default () => <button>Go</button>;`);
        const diff = renderMigrationDiff(m);

        expect(diff).toContain("--- app/page.tsx");
        expect(diff).toContain("- export default () => <button>Go</button>;");
        expect(diff).toContain("+ ");
        expect(diff).toContain("Button");
    });

    it("renders nothing for an unchanged file", () => {
        const m = migrateFileToGallery("a.tsx", `export default () => <div/>;`);
        expect(renderMigrationDiff(m)).toBe("");
    });
});
