import { describe, it, expect } from "vitest";
import { renderMarkdownToSafeHtml, preProcessSandboxBlocks } from "./markdown-html";
import { turndownInstance } from "./editor-turndown";
import { sandboxHtml } from "./document-macros";

describe("CORE Scribe Sandbox Macro Round-Trip", () => {
    it("generates valid sandbox macro HTML", () => {
        const html = sandboxHtml("scene_01", "adult", "static_reinsert", "Terrace reconciliation", "Intense romantic dialogue.");
        expect(html).toContain('class="scribe-sandbox');
        expect(html).toContain('data-sandbox-id="scene_01"');
        expect(html).toContain('data-type="adult"');
        expect(html).toContain('data-mode="static_reinsert"');
        expect(html).toContain('data-summary="Terrace reconciliation"');
        expect(html).toContain("Intense romantic dialogue.");
    });

    it("pre-processes :::sandbox markdown container into scribe-sandbox HTML", () => {
        const md = `
# Title

:::sandbox id="scene_noir" type="violence" mode="static_reinsert" summary="Alley altercation."
Marcus struck the match and waited in the shadow of the fire escape.
:::

Footsteps echoed on the cobblestones.
`.trim();

        const html = preProcessSandboxBlocks(md);
        expect(html).toContain('class="scribe-sandbox');
        expect(html).toContain('data-sandbox-id="scene_noir"');
        expect(html).toContain('data-type="violence"');
        expect(html).toContain("Marcus struck the match");

        // Passes safely through marked + DOMPurify without attribute stripping
        const safeHtml = renderMarkdownToSafeHtml(md);
        expect(safeHtml).toContain('class="scribe-sandbox');
        expect(safeHtml).toContain('data-sandbox-id="scene_noir"');
        expect(safeHtml).toContain('data-type="violence"');
        expect(safeHtml).toContain('data-summary="Alley altercation."');
    });

    it("turndown converts scribe-sandbox HTML back to :::sandbox markdown block", () => {
        const html = `
<div class="scribe-sandbox my-3 rounded-lg border border-border bg-card p-3" data-sandbox-id="scene_02" data-type="forensic" data-mode="generate_local" data-summary="Forensic lab report analysis.">
  <div class="scribe-sandbox-header"><span>🛡️ Vault: forensic</span></div>
  <p class="scribe-sandbox-body">The chemical markers in the blood vial matched synthetic neurotoxin delta-9.</p>
</div>
`.trim();

        const md = turndownInstance.turndown(html);
        expect(md).toContain(':::sandbox id="scene_02" type="forensic" mode="generate_local" summary="Forensic lab report analysis."');
        expect(md).toContain("The chemical markers in the blood vial matched synthetic neurotoxin delta-9.");
        expect(md).toContain(":::");
    });

    it("survives full markdown -> HTML -> turndown -> markdown roundtrip without loss", () => {
        const initialMd = `:::sandbox id="vault_beat" type="adult" mode="static_reinsert" summary="Intimate conversation."
Elena pulled her collar against the rain and took his hand.
:::`;

        const html = renderMarkdownToSafeHtml(initialMd);
        const roundtrippedMd = turndownInstance.turndown(html).trim();

        expect(roundtrippedMd).toContain(':::sandbox id="vault_beat" type="adult" mode="static_reinsert" summary="Intimate conversation."');
        expect(roundtrippedMd).toContain("Elena pulled her collar against the rain and took his hand.");
        expect(roundtrippedMd.endsWith(":::"));
    });
});
