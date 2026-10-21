import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

// Publication requires a reviewed source change, never tenant-controlled metadata.
// Generated organization specs and uploads must never enter this manifest.
export const PLATFORM_DOCUMENTATION_MANIFEST = [
  { slug: "documentation", file: "README.md", title: "Oddjob documentation" },
  { slug: "first-mission", file: "guides/first-mission-in-10-minutes.md", title: "Your first mission" },
  { slug: "keys-and-credentials", file: "developer-guides/KEYS_AND_CREDENTIALS.md", title: "Keys and credentials" },
  { slug: "blueprint-maturity", file: "guides/blueprint-maturity.md", title: "Blueprint maturity" },
  { slug: "external-agents", file: "guides/managing-external-agents.md", title: "Managing external agents" },
  { slug: "cycles", file: "CYCLES.md", title: "Cycles" },
  { slug: "app-forge", file: "APP_FORGE_LIFECYCLE.md", title: "App Forge lifecycle" },
  { slug: "architecture", file: "SYSTEM_ARCHITECTURE.md", title: "System architecture" },
] as const;

export interface PlatformDocument {
  id: string;
  title: string;
  sourceType: "platform_documentation";
  scope: "platform";
  readOnly: true;
  url: string;
  sourceUrl: string;
  version: string;
  textContent: string;
}
interface IndexedChunk { document: PlatformDocument; content: string; terms: Map<string, number>; length: number; order: number }
const STOP_WORDS = new Set("a an and are as at be by can do does for from how i in is it of on or our that the this to use what when where which who why with you your".split(" "));
function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9_]+/g) || []).filter(t => t.length > 1 && !STOP_WORDS.has(t));
}
export function hasOrganization(organizationId: number | null | undefined): organizationId is number {
  return typeof organizationId === "number" && Number.isSafeInteger(organizationId) && organizationId > 0;
}

/** Immutable per-process text index. No database, embeddings, credentials or tenant content. */
export function createPlatformDocumentationLibrary(root = path.resolve(process.cwd(), "docs")) {
  const base = realpathSync(root);
  const documents: PlatformDocument[] = PLATFORM_DOCUMENTATION_MANIFEST.map(entry => {
    const file = realpathSync(path.resolve(base, entry.file));
    if (!file.startsWith(base + path.sep)) throw new Error("Platform documentation path escaped publication root");
    const textContent = readFileSync(file, "utf8");
    if (!textContent.trim()) throw new Error(`Published platform document is empty: ${entry.file}`);
    return { id: `platform:${entry.slug}`, title: entry.title, sourceType: "platform_documentation",
      scope: "platform", readOnly: true, url: `/knowledge/platform-docs?id=${entry.slug}`,
      sourceUrl: `https://github.com/OddjobApp/oddjob-oss/blob/main/docs/${entry.file}`,
      version: createHash("sha256").update(textContent).digest("hex"), textContent };
  });
  const chunks: IndexedChunk[] = [];
  for (const document of documents) {
    for (let start = 0, order = 0; start < document.textContent.length; start += 1050, order++) {
      const content = document.textContent.slice(start, start + 1200);
      const terms = new Map<string, number>();
      const words = tokens(document.title + " " + content);
      for (const term of words) terms.set(term, (terms.get(term) || 0) + 1);
      chunks.push({ document, content, terms, length: words.length, order });
    }
  }
  const frequencies = new Map<string, number>();
  for (const chunk of chunks) for (const term of chunk.terms.keys()) frequencies.set(term, (frequencies.get(term) || 0) + 1);
  const averageLength = chunks.reduce((n, c) => n + c.length, 0) / chunks.length;
  return {
    list(organizationId: number | null | undefined) {
      return hasOrganization(organizationId) ? documents.map(({ textContent, ...doc }) => ({ ...doc })) : [];
    },
    get(id: string, organizationId: number | null | undefined): PlatformDocument | null {
      if (!hasOrganization(organizationId)) return null;
      const doc = documents.find(d => d.id === id);
      return doc ? { ...doc } : null;
    },
    search(query: string, organizationId: number | null | undefined, limit = 5) {
      if (!hasOrganization(organizationId) || typeof query !== "string" || !query.trim()) return [];
      const terms = [...new Set(tokens(query.slice(0, 1000)))];
      if (!terms.length) return [];
      const ranked = chunks.map(chunk => {
        let rank = 0, matched = 0;
        for (const term of terms) {
          const count = chunk.terms.get(term) || 0;
          if (!count) continue;
          matched++;
          const frequency = frequencies.get(term) || 0;
          const idf = Math.log(1 + (chunks.length - frequency + 0.5) / (frequency + 0.5));
          rank += idf * count * 2.2 / (count + 1.2 * (0.25 + 0.75 * chunk.length / averageLength));
        }
        return { chunk, rank, coverage: matched / terms.length };
      }).filter(hit => hit.rank > 0 && hit.coverage >= 0.5).sort((a, b) => b.rank - a.rank);
      const seen = new Set<string>();
      return ranked.filter(hit => {
        if (seen.has(hit.chunk.document.id)) return false;
        seen.add(hit.chunk.document.id); return true;
      }).slice(0, Math.min(50, Math.max(1, Number.isFinite(limit) ? Math.floor(limit) : 5))).map(({ chunk, rank, coverage }) => ({
        id: chunk.document.id, type: "document" as const, title: chunk.document.title,
        description: chunk.content.slice(0, 180), textContent: chunk.content, url: chunk.document.url,
        score: 0.5 + 0.25 * coverage + 0.15 * rank / (rank + 5),
        metadata: { scope: "platform", readOnly: true, sourceType: "platform_documentation", sourceUrl: chunk.document.sourceUrl,
          version: chunk.document.version, assetKey: chunk.document.id, name: chunk.document.title,
          chunkId: `${chunk.document.id}:${chunk.order}`, url: chunk.document.url },
      }));
    },
  };
}
let library: ReturnType<typeof createPlatformDocumentationLibrary> | undefined;
export function getPlatformDocumentationLibrary() {
  return library ??= createPlatformDocumentationLibrary();
}
