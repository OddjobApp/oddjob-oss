/**
 * Semantic HTML Pruner for AI Context Optimization.
 * Strips non-essential structural tags and minimizes whitespace to reduce token footprint.
 */
export function pruneHtmlForAi(html: string): string {
    if (!html) return "";

    let pruned = html;

    // 1. Strip script tags and their content
    pruned = pruned.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gim, "");

    // 2. Strip style tags and their content
    pruned = pruned.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gim, "");

    // 3. Strip SVG tags (usually large and redundant for selector healing)
    pruned = pruned.replace(/<svg\b[^>]*>([\s\S]*?)<\/svg>/gim, "<!-- SVG Removed -->");

    // 4. Strip link, meta, and comment tags
    pruned = pruned.replace(/<link\b[^>]*>/gim, "");
    pruned = pruned.replace(/<meta\b[^>]*>/gim, "");
    pruned = pruned.replace(/<!--[\s\S]*?-->/g, "");

    // 5. Minimal whitespace cleanup
    // Collapse multiple spaces/tabs/newlines into single characters
    pruned = pruned.replace(/\s{2,}/g, " ");
    
    // 6. Optional: Remove data attributes that are likely redundant (e.g. tracking, styling)
    // We keep data-testid or custom app attributes as they are often used for selectors
    // pruned = pruned.replace(/ data-[a-zA-Z0-9-]+="[^"]*"/g, ""); // Too aggressive? Let's keep it for now.

    return pruned.trim();
}
