import { describe, expect, it } from "vitest";
import { forgeValidatorService, isGalleryScannableFile } from "@domain/apps/core/forge-validator.service.js";

/**
 * Oddjob Component Gallery conformance in the forge validator.
 *
 * The gallery has always been mandatory in the prompt layer and checked
 * nowhere, so a run that ignored the instruction shipped raw controls silently.
 * These tests pin both halves of the rule: that it catches UI built outside the
 * gallery, and that it does not fail a build or fire on the platform's own
 * idioms.
 */

const RAW_UI = `
export default function Page() {
  return (
    <div>
      <button onClick={submit}>Save</button>
      <input value={name} />
    </div>
  );
}
`;

const GALLERY_UI = `
import { Button } from "@/components/ui/button";
import PlatformDatasetTableBlock from "@domain-ui/packaged/PlatformDatasetTableBlock";

export default function Page() {
  return (
    <div className="bg-background text-foreground">
      <Button onClick={submit}>Save</Button>
      <PlatformDatasetTableBlock datasetId={3} />
    </div>
  );
}
`;

const scan = (file: string, content: string) =>
    forgeValidatorService.scanGalleryConformance(file, content);

describe("gallery conformance — what it catches", () => {
    it("flags a web UI file assembled with no gallery imports", () => {
        const issues = scan("app/page.tsx", RAW_UI);

        expect(issues.length).toBeGreaterThan(0);
        expect(issues.every(i => i.type === "GALLERY_CONFORMANCE")).toBe(true);
        expect(issues.map(i => i.message)).toContainEqual(
            expect.stringContaining("assembled without any Oddjob Component Gallery imports"),
        );
        expect(issues.map(i => i.message)).toContainEqual(expect.stringContaining("Raw <button>"));
        expect(issues.map(i => i.message)).toContainEqual(expect.stringContaining("Raw <input>"));
    });

    it("points at the gallery component to use instead", () => {
        const button = scan("app/page.tsx", RAW_UI).find(i => i.message.includes("Raw <button>"));
        expect(button?.suggestion).toContain("Button from @/components/ui/button");
        expect(button?.line).toBe(5);
    });

    it("flags hardcoded colour literals, once per file", () => {
        const issues = scan(
            "app/page.tsx",
            `import { Button } from "@/components/ui/button";\nexport default () => <div className="bg-[#ff0000] p-2"><Button/></div>;`,
        );
        const colour = issues.filter(i => i.message.includes("Hardcoded colour"));
        expect(colour).toHaveLength(1);
        expect(colour[0].suggestion).toContain("bg-background");
    });

    /*
     * Composing is allowed by the rule — a custom component built out of gallery
     * primitives is the documented escape hatch. So a raw control in a file that
     * DOES use the gallery is a lower-grade finding than one in a file that does
     * not, and the two must not be reported at the same weight.
     */
    it("grades a raw control lower when the file otherwise composes the gallery", () => {
        const composing = scan(
            "app/widget.tsx",
            `import { Button } from "@/components/ui/button";\nexport default () => <div><Button/><input value={x}/></div>;`,
        );
        const raw = scan("app/widget.tsx", RAW_UI);

        expect(composing.find(i => i.message.includes("Raw <input>"))?.severity).toBe("low");
        expect(raw.find(i => i.message.includes("Raw <input>"))?.severity).toBe("medium");
        // The "no gallery imports at all" finding belongs only to the second.
        expect(composing.map(i => i.message)).not.toContainEqual(
            expect.stringContaining("assembled without any"),
        );
    });
});

describe("gallery conformance — what it leaves alone", () => {
    it("passes a file built from the gallery", () => {
        expect(scan("app/page.tsx", GALLERY_UI)).toEqual([]);
    });

    /*
     * The platform's own UI uses Tailwind palette classes constantly. Flagging
     * them would bury every real finding under hundreds of false ones.
     */
    it("does not flag Tailwind palette classes", () => {
        const issues = scan(
            "app/page.tsx",
            `import { Button } from "@/components/ui/button";\nexport default () => <div className="text-amber-500 bg-slate-800"><Button/></div>;`,
        );
        expect(issues).toEqual([]);
    });

    it("does not scan the gallery's own sources", () => {
        // These are copied into the workspace during assembly. Every primitive
        // is by definition a raw control wrapped in something better.
        expect(isGalleryScannableFile("src/components/ui/button.tsx")).toBe(false);
        expect(isGalleryScannableFile("src/domain/core/ui/components/packaged/MetricGrid.tsx")).toBe(false);
        expect(scan("src/components/ui/button.tsx", RAW_UI)).toEqual([]);
    });

    it("only judges web UI files", () => {
        expect(isGalleryScannableFile("server/routes/api.ts")).toBe(false);
        expect(isGalleryScannableFile("app/page.test.tsx")).toBe(false);
        expect(isGalleryScannableFile("app/page.tsx")).toBe(true);
        expect(scan("server/index.ts", RAW_UI)).toEqual([]);
    });

    it("ignores a module that renders no markup", () => {
        expect(scan("app/helpers.tsx", `export const label = "<button> is a tag";`)).toEqual([]);
    });

    it("does not read a comment as shipped markup", () => {
        const issues = scan(
            "app/page.tsx",
            [
                'import { Button } from "@/components/ui/button";',
                '/** Replaces the old <button> and its bg-[#ff0000] styling. */',
                '// was: <input value={x} />',
                'export default () => <div><Button/></div>;',
            ].join("\n"),
        );
        expect(issues).toEqual([]);
    });

    it("does not match a longer tag that merely starts the same way", () => {
        const issues = scan("app/page.tsx", `export default () => <div><Selection/><Inputs/></div>;`);
        expect(issues.map(i => i.message)).not.toContainEqual(expect.stringContaining("Raw <select>"));
        expect(issues.map(i => i.message)).not.toContainEqual(expect.stringContaining("Raw <input>"));
    });
});

describe("gallery conformance — never fails a build", () => {
    /*
     * validateCode marks a result invalid on critical/high, and forge-codegen
     * aborts on critical. An off-style app is not a dangerous one: blocking a
     * build over styling would be a worse bug than the one this closes.
     */
    it("keeps validation valid for a UI that ignores the gallery entirely", async () => {
        const result = await forgeValidatorService.validateCode({ "app/page.tsx": RAW_UI });

        const findings = forgeValidatorService.getGalleryFindings(result.issues);
        expect(findings.length).toBeGreaterThan(0);
        expect(result.valid).toBe(true);

        const summary = forgeValidatorService.getSummary(result.issues);
        expect(summary.critical).toBe(0);
        expect(summary.high).toBe(0);
    });

    it("separates conformance findings from security ones", async () => {
        const result = await forgeValidatorService.validateCode({
            "app/page.tsx": RAW_UI,
            "server/db.ts": `const q = "SELECT * FROM users WHERE id = " + req.params.id;`,
        });

        const findings = forgeValidatorService.getGalleryFindings(result.issues);
        expect(findings.every(f => f.file === "app/page.tsx")).toBe(true);
        expect(result.issues.some(i => i.type !== "GALLERY_CONFORMANCE")).toBe(true);
    });
});
