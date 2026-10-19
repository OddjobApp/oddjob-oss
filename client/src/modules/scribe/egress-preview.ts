/**
 * Utility for client-side preview of CORE confidential egress sanitization.
 * Simulates the deterministic tokenization performed by CoreRedactionService
 * to guarantee that authors can inspect exactly what leaves their browser.
 */

export interface EgressPreviewResult {
    rawMarkdown: string;
    sanitizedEgress: string;
    sandboxedBlockCount: number;
    sandboxedWords: number;
    isClean: boolean;
    blocks: Array<{
        id: string;
        type: string;
        mode: string;
        summary: string;
        rawLength: number;
    }>;
}

export function generateEgressPreview(markdown: string): EgressPreviewResult {
    const sandboxRegex = /:::sandbox\s+([^\r\n]+?)\r?\n([\s\S]*?)\r?\n:::/gi;
    const blocks: EgressPreviewResult["blocks"] = [];
    let sandboxedWords = 0;

    const sanitizedEgress = markdown.replace(sandboxRegex, (_match, attrStr, body) => {
        const attrs: Record<string, string> = {};
        const attrRegex = /([a-zA-Z0-9_\-]+)=(?:"([^"]*)"|'([^']*)'|([^\s]+))/g;
        let m: RegExpExecArray | null;
        while ((m = attrRegex.exec(attrStr)) !== null) {
            attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
        }

        const id = attrs.id || attrs.slug || "sandbox_block";
        const type = attrs.type || "confidential";
        const mode = attrs.mode || "static_reinsert";
        const summary = attrs.summary || "Confidential narrative beat";
        const trimmedBody = body.trim();
        const wordCount = trimmedBody.split(/\s+/).filter(Boolean).length;
        sandboxedWords += wordCount;

        blocks.push({
            id,
            type,
            mode,
            summary,
            rawLength: trimmedBody.length,
        });

        // Deterministic mock token ID for preview
        const cleanSummary = summary.replace(/[\[\]]/g, "").trim();
        const hash = Math.abs(
            Array.from(id + cleanSummary).reduce((acc, c) => ((acc << 5) - acc) + c.charCodeAt(0), 0)
        ).toString(16).slice(0, 8).padStart(8, "0");

        return `[SCENE_BEAT: ${cleanSummary}] <<ODDJOB_MASK:${hash}>>`;
    });

    return {
        rawMarkdown: markdown,
        sanitizedEgress,
        sandboxedBlockCount: blocks.length,
        sandboxedWords,
        isClean: blocks.length > 0,
        blocks,
    };
}
