/**
 * The selection engine behind preview annotation.
 *
 * Two things carry the feature and are worth pinning: a selection has to describe
 * an element in terms that still resolve after the app is rebuilt, and the prompt
 * it produces has to confine the change to what was selected. An unscoped "make
 * this blue" is how a whole page gets rewritten.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePreviewSelection } from './usePreviewSelection.js';

function makeFrame(html: string) {
    // createHTMLDocument gives a document with no browsing context, so
    // doc.defaultView is null — events are constructed from the global instead.
    const doc = document.implementation.createHTMLDocument('preview');
    doc.body.innerHTML = html;
    // getBoundingClientRect is not implemented in jsdom; the hook only needs numbers.
    const rect = () => ({ top: 10, left: 20, width: 100, height: 40, right: 120, bottom: 50, x: 20, y: 10, toJSON: () => ({}) });
    doc.querySelectorAll('*').forEach(el => { (el as any).getBoundingClientRect = rect; });

    const frame = {
        contentDocument: doc,
        getBoundingClientRect: rect,
    } as unknown as HTMLIFrameElement;

    return { doc, ref: { current: frame } };
}

describe('usePreviewSelection', () => {
    beforeEach(() => vi.clearAllMocks());

    it('returns the instruction unchanged when nothing is selected', () => {
        const { ref } = makeFrame('<div>hi</div>');
        const { result } = renderHook(() => usePreviewSelection(ref));

        expect(result.current.buildScopedPrompt('make it blue')).toBe('make it blue');
    });

    it('reports when the preview has not loaded rather than silently doing nothing', () => {
        const ref = { current: null } as React.RefObject<HTMLIFrameElement | null>;
        const { result } = renderHook(() => usePreviewSelection(ref));

        act(() => { result.current.setSelectMode(true); });

        expect(result.current.unavailable).toMatch(/not loaded/i);
    });

    it('captures a clicked element and describes it by its visible text', () => {
        const { doc, ref } = makeFrame('<section><button aria-label="Save record">Save</button></section>');
        const { result } = renderHook(() => usePreviewSelection(ref));

        act(() => { result.current.setSelectMode(true); });
        act(() => {
            doc.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        expect(result.current.selections).toHaveLength(1);
        // aria-label wins: it is the name a user would recognise.
        expect(result.current.selections[0].label).toBe('Save record');
        expect(result.current.selections[0].tag).toBe('button');
    });

    it('builds a structural path that does not depend on a live node reference', () => {
        const { doc, ref } = makeFrame('<main><div><p>one</p><p>two</p></div></main>');
        const { result } = renderHook(() => usePreviewSelection(ref));

        act(() => { result.current.setSelectMode(true); });
        act(() => {
            doc.querySelectorAll('p')[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        const { selector } = result.current.selections[0];
        // The second <p> among siblings has to be distinguishable from the first,
        // or the model cannot tell which one was meant after a rebuild.
        expect(selector).toContain('p:nth-of-type(2)');
        // And it must still resolve against an equivalent document.
        expect(doc.querySelector(selector)?.textContent).toBe('two');
    });

    it('clicking a selected element again removes it', () => {
        const { doc, ref } = makeFrame('<div><span>target</span></div>');
        const { result } = renderHook(() => usePreviewSelection(ref));

        act(() => { result.current.setSelectMode(true); });
        const fire = () => doc.querySelector('span')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        act(() => { fire(); });
        expect(result.current.selections).toHaveLength(1);
        act(() => { fire(); });
        expect(result.current.selections).toHaveLength(0);
    });

    it('measures rects against the pane, so a highlight cannot escape it', () => {
        // The chat composer sits in a sibling rail. Highlights are drawn inside the
        // preview pane and clipped by its overflow, so their coordinates have to be
        // pane-relative — viewport coordinates would let a wide element paint over
        // the composer.
        const { doc, ref } = makeFrame('<div><button>Wide</button></div>');
        const paneRect = { top: 100, left: 400, width: 800, height: 600, right: 1200, bottom: 700, x: 400, y: 100, toJSON: () => ({}) };
        const containerRef = { current: { getBoundingClientRect: () => paneRect } } as unknown as React.RefObject<HTMLElement | null>;

        const { result } = renderHook(() => usePreviewSelection(ref, containerRef));
        act(() => { result.current.setSelectMode(true); });
        act(() => {
            doc.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        // iframe box and element box are both {top:10,left:20}; against a pane at
        // {100,400} the offset is negative, so the rect stays pane-relative rather
        // than inheriting the pane's viewport position.
        const { rect } = result.current.selections[0];
        expect(rect.top).toBe(10 + (10 - 100));
        expect(rect.left).toBe(20 + (20 - 400));
    });

    it('confines the change to the selection', () => {
        const { doc, ref } = makeFrame('<div><h2>Fleet Readiness</h2></div>');
        const { result } = renderHook(() => usePreviewSelection(ref));

        act(() => { result.current.setSelectMode(true); });
        act(() => {
            doc.querySelector('h2')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        const prompt = result.current.buildScopedPrompt('use a smaller heading');

        expect(prompt).toMatch(/ONLY to the following selected element/);
        expect(prompt).toMatch(/leaving the rest of the page untouched/);
        expect(prompt).toContain('Fleet Readiness');
        expect(prompt).toContain('use a smaller heading');
    });
});
