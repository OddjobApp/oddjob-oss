/**
 * Element selection inside the forged-app preview.
 *
 * The preview is an iframe on the same origin as the studio (/forged/:slug on the
 * platform's own host) and is sandboxed with allow-same-origin, so the parent can
 * read its document. That is what makes this possible at all — a cross-origin
 * preview could only be annotated from inside the app itself.
 *
 * What a selection has to survive is a re-render: the forged app rebuilds on every
 * change request, so a selection captured now is described in terms that still
 * mean something afterwards — a structural path, the tag, and a short text sample
 * — rather than a node reference that dies with the DOM it came from.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface PreviewSelection {
    /** Stable-ish within a build: nth-of-type chain from the body. */
    selector: string;
    /** What the user actually clicked, for the chip and the prompt. */
    label: string;
    tag: string;
    /** First line of visible text, trimmed — the strongest hint for the model. */
    text: string;
    /**
     * Box relative to the preview pane, not the viewport. The highlight is drawn
     * inside that pane so the pane's own overflow clips it — a wide element cannot
     * paint across the chat rail and cover the composer.
     */
    rect: { top: number; left: number; width: number; height: number };
}

/** A path the model can act on, and a human can recognise. */
function buildSelector(el: Element): string {
    const parts: string[] = [];
    let node: Element | null = el;

    while (node && node.nodeType === 1 && node.tagName.toLowerCase() !== 'body' && parts.length < 6) {
        const tag = node.tagName.toLowerCase();
        const parent: Element | null = node.parentElement;
        if (!parent) { parts.unshift(tag); break; }
        const sameTag = [...parent.children].filter(c => c.tagName === node!.tagName);
        parts.unshift(sameTag.length > 1 ? `${tag}:nth-of-type(${sameTag.indexOf(node) + 1})` : tag);
        node = parent;
    }
    return parts.join(' > ');
}

function describe(el: Element): string {
    const tag = el.tagName.toLowerCase();
    // Prefer a name the user would recognise from the page over a class soup.
    const aria = el.getAttribute('aria-label');
    const heading = el.querySelector('h1,h2,h3,h4')?.textContent?.trim();
    const own = (el.textContent || '').trim().replace(/\s+/g, ' ');
    const label = aria || heading || own;
    if (!label) return `<${tag}>`;
    return label.length > 48 ? `${label.slice(0, 48)}…` : label;
}

export function usePreviewSelection(
    iframeRef: React.RefObject<HTMLIFrameElement | null>,
    /** The pane the highlights are drawn into; rects are measured against it. */
    containerRef?: React.RefObject<HTMLElement | null>,
) {
    const [selectMode, setSelectMode] = useState(false);
    const [selections, setSelections] = useState<PreviewSelection[]>([]);
    const [hoverRect, setHoverRect] = useState<PreviewSelection['rect'] | null>(null);
    const [unavailable, setUnavailable] = useState<string | null>(null);
    const cleanupRef = useRef<(() => void) | null>(null);

    const clear = useCallback(() => setSelections([]), []);
    const remove = useCallback((selector: string) => {
        setSelections(prev => prev.filter(s => s.selector !== selector));
    }, []);

    useEffect(() => {
        cleanupRef.current?.();
        cleanupRef.current = null;
        setHoverRect(null);

        if (!selectMode) return;

        const frame = iframeRef.current;
        let doc: Document | null = null;
        try {
            doc = frame?.contentDocument ?? null;
        } catch {
            // A cross-origin preview cannot be annotated from here. Say so rather
            // than leaving a toggle that silently does nothing.
            setUnavailable('This preview is cross-origin and cannot be annotated.');
            return;
        }
        if (!doc || !doc.body) {
            setUnavailable('The preview has not loaded yet.');
            return;
        }
        setUnavailable(null);

        // Offset from the iframe's content coordinates to the pane the overlay is
        // rendered in. Falls back to viewport coordinates only if no pane is given.
        const offset = () => {
            const box = frame!.getBoundingClientRect();
            const host = containerRef?.current?.getBoundingClientRect();
            return { x: box.left - (host?.left ?? 0), y: box.top - (host?.top ?? 0) };
        };

        const toRect = (el: Element) => {
            const r = el.getBoundingClientRect();
            const o = offset();
            return { top: r.top + o.y, left: r.left + o.x, width: r.width, height: r.height };
        };

        const onMove = (e: MouseEvent) => {
            const el = e.target as Element | null;
            if (!el || el.nodeType !== 1) return;
            setHoverRect(toRect(el));
        };

        const onClick = (e: MouseEvent) => {
            const el = e.target as Element | null;
            if (!el || el.nodeType !== 1) return;
            // The whole point is to pick the element instead of using the app.
            e.preventDefault();
            e.stopPropagation();

            const selector = buildSelector(el);
            const entry: PreviewSelection = {
                selector,
                label: describe(el),
                tag: el.tagName.toLowerCase(),
                text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120),
                rect: toRect(el),
            };
            setSelections(prev => prev.some(s => s.selector === selector)
                ? prev.filter(s => s.selector !== selector)   // click again to deselect
                : [...prev, entry]);
        };

        const onLeave = () => setHoverRect(null);

        doc.addEventListener('mousemove', onMove, true);
        doc.addEventListener('click', onClick, true);
        doc.addEventListener('mouseleave', onLeave, true);
        const previousCursor = doc.body.style.cursor;
        doc.body.style.cursor = 'crosshair';

        cleanupRef.current = () => {
            doc!.removeEventListener('mousemove', onMove, true);
            doc!.removeEventListener('click', onClick, true);
            doc!.removeEventListener('mouseleave', onLeave, true);
            doc!.body.style.cursor = previousCursor;
        };

        return () => {
            cleanupRef.current?.();
            cleanupRef.current = null;
        };
    }, [selectMode, iframeRef, containerRef]);

    /**
     * The scoped request handed to the chat. Names each selection so the model can
     * find it again after a rebuild, and states plainly that nothing else should
     * change — an unscoped "make this blue" is how a whole page gets rewritten.
     */
    const buildScopedPrompt = useCallback((instruction = ''): string => {
        if (selections.length === 0) return instruction;
        const lines = selections.map((s, i) =>
            `${i + 1}. <${s.tag}> "${s.label}"\n   path: ${s.selector}${s.text ? `\n   text: "${s.text}"` : ''}`);
        return [
            `Apply this change ONLY to the following selected element${selections.length > 1 ? 's' : ''}, leaving the rest of the page untouched:`,
            '',
            ...lines,
            '',
            `Change requested: ${instruction}`.trim(),
        ].join('\n');
    }, [selections]);

    return {
        selectMode,
        setSelectMode,
        selections,
        hoverRect,
        unavailable,
        clear,
        remove,
        buildScopedPrompt,
    };
}
