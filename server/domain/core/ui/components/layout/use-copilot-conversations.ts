import { useCallback, useEffect, useState, type SetStateAction } from 'react';
import type { ChatMode, Message, CopilotSelectedUiContext } from './copilot-chat-types';

export interface CopilotContextChoice {
    pageMode: 'follow' | 'pinned' | 'excluded';
    pinnedUrl?: string;
    selectionMode: 'follow' | 'pinned' | 'excluded';
    selection: CopilotSelectedUiContext | null;
}
interface Conversation {
    id: string;
    messages: Message[];
    input: string;
    mode: ChatMode;
    context: CopilotContextChoice;
    submitted: Record<string, Record<string, any>>;
    updatedAt: number;
}
interface Store { version: 1; activeId: string; conversations: Conversation[] }
export const conversationStorageKey = (userId: string, orgId: number | null, projectKey: string | null) =>
    `oddjob:copilot:conversations:${JSON.stringify([userId, orgId, projectKey])}`;
export function generateUUID(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

const fresh = (): Conversation => ({
    id: generateUUID(), messages: [], input: '', mode: 'explain', submitted: {},
    context: { pageMode: 'follow', selectionMode: 'follow', selection: null }, updatedAt: Date.now(),
});
function readStore(key: string): Store {
    try {
        const value = JSON.parse(localStorage.getItem(key) || 'null');
        if (value?.version === 1 && Array.isArray(value.conversations)) {
            const conversations = value.conversations.filter((c: any) =>
                typeof c?.id === 'string' && typeof c.input === 'string' &&
                ['explain', 'plan', 'execute', 'audit'].includes(c.mode) &&
                ['follow', 'pinned', 'excluded'].includes(c.context?.pageMode) &&
                ['follow', 'pinned', 'excluded'].includes(c.context?.selectionMode) &&
                Array.isArray(c.messages) && c.messages.every((m: any) =>
                    typeof m?.id === 'string' && typeof m.content === 'string' &&
                    ['agent', 'user'].includes(m.role) && typeof m.timestamp === 'number'))
            .map((c: any): Conversation => ({
                ...c,
                submitted: (c.submitted && typeof c.submitted === 'object') ? c.submitted : {},
                context: {
                    pageMode: c.context?.pageMode ?? 'follow',
                    pinnedUrl: c.context?.pinnedUrl,
                    selectionMode: c.context?.selectionMode ?? 'follow',
                    selection: c.context?.selection ?? null,
                },
                updatedAt: typeof c.updatedAt === 'number' ? c.updatedAt : Date.now(),
            }));
            if (conversations.length) return { version: 1, activeId: conversations.some((c: Conversation) => c.id === value.activeId) ? value.activeId : conversations[0].id, conversations };
        }
    } catch { /* Corrupt or unavailable storage starts a clean conversation. */ }
    const conversation = fresh();
    return { version: 1, activeId: conversation.id, conversations: [conversation] };
}

/** The owner is keyed by authenticated user, organization and project before mounting. */
export function useCopilotConversations(storageKey: string) {
    const [activeKey, setActiveKey] = useState(storageKey);
    const [store, setStore] = useState(() => readStore(storageKey));
    const [storageError, setStorageError] = useState(false);

    if (activeKey !== storageKey) {
        setActiveKey(storageKey);
        setStore(readStore(storageKey));
    }

    const current = store.conversations.find(c => c.id === store.activeId) || store.conversations[0] || fresh();
    useEffect(() => {
        try {
            localStorage.setItem(storageKey, JSON.stringify(store));
            setStorageError(false);
        } catch { setStorageError(true); }
    }, [storageKey, store]);
    const update = useCallback(<K extends keyof Conversation>(key: K, action: SetStateAction<Conversation[K]>) => {
        setStore(previous => ({ ...previous, conversations: previous.conversations.map(c => {
            if (c.id !== previous.activeId) return c;
            const value = typeof action === 'function' ? (action as (old: Conversation[K]) => Conversation[K])(c[key]) : action;
            return { ...c, [key]: key === 'messages' ? (value as Message[]).slice(-200) : value, updatedAt: Date.now() };
        }) }));
    }, []);
    const setMessages = useCallback((v: SetStateAction<Message[]>) => update('messages', v), [update]);
    const setInput = useCallback((v: SetStateAction<string>) => update('input', v), [update]);
    const setMode = useCallback((v: SetStateAction<ChatMode>) => update('mode', v), [update]);
    const setContext = useCallback((v: SetStateAction<CopilotContextChoice>) => update('context', v), [update]);
    const setSubmitted = useCallback((v: SetStateAction<Conversation['submitted']>) => update('submitted', v), [update]);
    const newConversation = () => {
        const next = fresh();
        setStore(previous => ({ version: 1, activeId: next.id, conversations: [next, ...previous.conversations].slice(0, 12) }));
    };
    const selectConversation = (id: string) => setStore(previous => previous.conversations.some(c => c.id === id) ? { ...previous, activeId: id } : previous);
    const deleteConversation = () => setStore(previous => {
        const remaining = previous.conversations.filter(c => c.id !== previous.activeId);
        if (!remaining.length) remaining.push(fresh());
        return { version: 1, activeId: remaining[0].id, conversations: remaining };
    });
    return { current, conversations: store.conversations, storageError, setMessages, setInput, setMode, setContext, setSubmitted, newConversation, selectConversation, deleteConversation };
}
