import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { conversationStorageKey, useCopilotConversations } from './use-copilot-conversations';

beforeEach(() => localStorage.clear());
describe('Copilot conversation continuity', () => {
    it('restores messages, draft, context and the same session after remount', () => {
        const key = conversationStorageKey('user', 7, 'project');
        const first = renderHook(() => useCopilotConversations(key));
        const id = first.result.current.current.id;
        act(() => {
            first.result.current.setMessages([{ id: 'one', role: 'user', content: 'Review this form', timestamp: 1 }]);
            first.result.current.setInput('Continue with');
            first.result.current.setContext({ pageMode: 'pinned', pinnedUrl: '/forms/7', selectionMode: 'excluded', selection: null });
        });
        first.unmount();
        const second = renderHook(() => useCopilotConversations(key));
        expect(second.result.current.current).toMatchObject({ id, input: 'Continue with', context: { pinnedUrl: '/forms/7' } });
        expect(second.result.current.current.messages[0].content).toBe('Review this form');
    });
    it('separates users, organizations including null, and projects', () => {
        const scopes = [['u', 1, 'a'], ['v', 1, 'a'], ['u', null, 'a'], ['u', 2, 'a'], ['u', 1, 'b']] as const;
        const keys = scopes.map(([user, org, project]) => conversationStorageKey(user, org, project));
        expect(new Set(keys).size).toBe(scopes.length);
        const first = renderHook(() => useCopilotConversations(keys[0]));
        act(() => first.result.current.setInput('private draft'));
        for (const key of keys.slice(1)) expect(renderHook(() => useCopilotConversations(key)).result.current.current.input).toBe('');
    });
    it('retains a previous discussion on new chat and deletes only the selected discussion', () => {
        const { result } = renderHook(() => useCopilotConversations('test'));
        const original = result.current.current.id;
        act(() => result.current.setInput('original'));
        act(() => result.current.newConversation());
        expect(result.current.current.id).not.toBe(original);
        act(() => result.current.selectConversation(original));
        expect(result.current.current.input).toBe('original');
        act(() => result.current.deleteConversation());
        expect(result.current.conversations.some(c => c.id === original)).toBe(false);
    });
    it('recovers from malformed storage and reports failed persistence', () => {
        localStorage.setItem('broken', '{');
        const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
        try {
            const { result } = renderHook(() => useCopilotConversations('broken'));
            expect(result.current.current.messages).toEqual([]);
            expect(result.current.storageError).toBe(true);
        } finally { spy.mockRestore(); }
    });
    it('normalizes legacy stored conversations lacking submitted or context fields', () => {
        const legacyStore = {
            version: 1,
            activeId: 'legacy-1',
            conversations: [{
                id: 'legacy-1',
                messages: [{ id: 'm1', role: 'user', content: 'legacy message', timestamp: 100 }],
                input: 'legacy input',
                mode: 'explain',
                // No submitted property and no context property
            }],
        };
        localStorage.setItem('legacy-key', JSON.stringify(legacyStore));
        const { result } = renderHook(() => useCopilotConversations('legacy-key'));
        expect(result.current.current.submitted).toEqual({});
        expect(result.current.current.context).toMatchObject({ pageMode: 'follow', selectionMode: 'follow' });
    });
    it('switches conversation context when storageKey changes', () => {
        const keyA = conversationStorageKey('user-1', 1, 'proj-a');
        const keyB = conversationStorageKey('user-1', 1, 'proj-b');
        const { result, rerender } = renderHook(({ key }) => useCopilotConversations(key), {
            initialProps: { key: keyA },
        });
        act(() => {
            result.current.setInput('Draft A');
        });
        expect(result.current.current.input).toBe('Draft A');

        rerender({ key: keyB });
        expect(result.current.current.input).toBe('');

        rerender({ key: keyA });
        expect(result.current.current.input).toBe('Draft A');
    });
});
