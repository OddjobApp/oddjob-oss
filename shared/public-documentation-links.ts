import { PUBLIC_FEATURE_DOCS } from "./public-feature-docs";
const anchor = (text: string) => text.toLowerCase().replace(/[^a-z0-9 -]/g, "").replace(/ /g, "-");
/** Only approved source links become public guide links. Never expose arbitrary repository paths. */
export function publicDocumentationLink(href: string | undefined, slug: string): string | undefined {
  if (!href) return undefined;
  if (href === "/docs" || PUBLIC_FEATURE_DOCS.some(doc => href === `/docs/${doc.slug}`)) return href;
  if (href.startsWith("#")) return href;
  const topic = PUBLIC_FEATURE_DOCS.find(doc => doc.slug === slug);
  try {
    const url = new URL(href, `https://platform.invalid/${topic?.guide ?? "docs/README.md"}`);
    let source = decodeURIComponent(url.pathname).replace(/^\//, "");
    const github = url.hostname === "github.com" || url.hostname.endsWith(".github.com");
    if (github) source = source.replace(/^OddjobApp\/oddjob-oss\/blob\/(?:main|codex\/login-announcements)\//, "");
    const found = PUBLIC_FEATURE_DOCS.find(doc => doc.guide === source && (!doc.section || `#${anchor(doc.section)}` === url.hash));
    if (found) return `/docs/${found.slug}`;
    if (github) return undefined;
    if (url.hostname === "platform.invalid") {
      if (source === "docs/README.md") return "/docs";
      if (source.startsWith("docs/") || source.startsWith("server/") || /\.md$/i.test(source)) return undefined;
      if (source === "docs" || source.startsWith("docs/")) return `/${source}${url.hash}`;
      // Keep guide links from turning internal admin paths into public navigation.
      return undefined;
    }
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch { return undefined; }
}
