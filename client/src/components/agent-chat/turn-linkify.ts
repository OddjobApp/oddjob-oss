/**
 * Links crew models write that never become markdown link nodes:
 * raw <a> markup (handled separately by rehype-raw) and bare domains such as
 * `youtube.com/watch?v=…` that gfm autolink only accepts with a scheme or www.
 * A bare domain must carry a path, query or fragment — `src/index.ts` and
 * `vitest.config.ts` stay text.
 */
const BARE_URL_RE = /\b(?:https?:\/\/[^\s<>"'`]+|www\.[^\s<>"'`]+|(?:[a-z0-9][a-z0-9-]*\.)+[a-z]{2,}(?:[/?#][^\s<>"'`)\]]*)+)/gi;
const TRAILING = /[.,;:!?'")\]}]+$/;

export function linkifyText(value: string): Array<{ type: 'text' | 'link'; value?: string; url?: string }> | null {
  const out: Array<{ type: 'text' | 'link'; value?: string; url?: string }> = [];
  let last = 0;
  BARE_URL_RE.lastIndex = 0;
  for (let match = BARE_URL_RE.exec(value); match; match = BARE_URL_RE.exec(value)) {
    let raw = match[0];
    let trailing = '';
    const trimmed = raw.replace(TRAILING, '');
    if (!trimmed) continue;
    trailing = raw.slice(trimmed.length);
    raw = trimmed;
    // Keep balanced ')' — drop it when it was an English parenthesis.
    while (raw.endsWith(')') && (raw.split('(').length - 1) < (raw.split(')').length - 1)) {
      trailing = ')' + trailing;
      raw = raw.slice(0, -1);
    }
    if (match.index > last) out.push({ type: 'text', value: value.slice(last, match.index) });
    out.push({ type: 'link', url: /^https?:\/\//i.test(raw) ? raw : `https://${raw}` });
    if (trailing) out.push({ type: 'text', value: trailing });
    last = match.index + match[0].length;
  }
  if (!out.length) return null;
  if (last < value.length) out.push({ type: 'text', value: value.slice(last) });
  return out;
}

export function remarkLinkifyBareUrls() {
  const processChildren = (parent: any) => {
    const children = Array.isArray(parent?.children) ? parent.children : [];
    const out: any[] = [];
    for (const child of children) {
      if (child?.type === 'text' && typeof child.value === 'string') {
        const parts = linkifyText(child.value);
        if (parts) {
          out.push(...parts.map((part: any) => part.type === 'link'
            ? { type: 'link', url: part.url, children: [{ type: 'text', value: part.url.replace(/^https?:\/\//i, '') }] }
            : part));
          continue;
        }
      }
      out.push(child);
    }
    parent.children = out;
    for (const child of children) {
      if (child?.type && !['link', 'linkReference', 'inlineCode', 'code', 'html', 'definition', 'image', 'imageReference'].includes(child.type)) processChildren(child);
    }
  };
  return (tree: any) => { processChildren(tree); };
}
