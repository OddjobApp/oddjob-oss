import { forgeIntentResolver } from '@domain/intent-router/core/forge-intent-resolver.service.js';

type BriefTurn = { speakerType: string; content: string; artifacts?: Array<{ payload: Record<string, unknown> }> };

/** The latest app surface decides whether this is still a draft. */
export function hasPendingForgeDraft(turns: BriefTurn[]): boolean {
    for (const turn of [...turns].reverse()) {
        for (const art of turn.artifacts ?? []) {
            const p = art.payload;
            if (p.type === 'app_studio_pod') return !p.appId && !p.jobId;
            if (p.type === 'forge_confirmation_card') return true;
        }
    }
    return false;
}

export function isDraftRefinement(message: string): boolean {
    if (/^(?:what|why|how)\b/i.test(message.trim()) || /\b(?:do not|don't)\s+(?:change|edit|build|add|remove)\b/i.test(message)) return false;
    if (/\b(?:app|application|tool)\s+(?:should|must|needs? to)\b/i.test(message)) return true;
    const resolution = forgeIntentResolver.resolve(message, { appInPlay: true });
    return resolution.confidence >= 0.7 &&
        ['modify_app', 'add_surface', 'restyle_app', 'fix_app', 'continue_scaffold'].includes(resolution.intent || '');
}

/** User-authored requirements survive generic requests such as "build the app". */
export function roomForgeBrief(message: string, turns: BriefTurn[]): { name: string; requirements: string } {
    let name = '';
    let requirements: string[] = [];
    for (const turn of [...turns, { speakerType: 'user', content: message }]) {
        if (turn.speakerType !== 'user') {
            for (const art of turn.artifacts ?? []) {
                const p = art.payload;
                if (p.type !== 'forge_confirmation_card' && p.type !== 'app_studio_pod') continue;
                if (p.jobId || p.appId) continue;
                const title = String(p.name || p.title || '');
                if (!name && title && title !== 'New Application') name = title;
                if (!requirements.length && typeof p.requirements === 'string') requirements.push(p.requirements);
            }
            continue;
        }
        const text = turn.content.trim();
        if (/^(?:Build\s+"[^"\n]+"\s+now\.|I confirmed stage\s)/i.test(text)) continue;
        const resolution = forgeIntentResolver.resolve(text);
        const title = resolution.inferredTitle;
        // A fresh, specifically described app starts a new brief. Generic
        // follow-ups and refinements keep the existing user-authored requirements.
        if (title && /\b(?:build|create|develop|make)\b/i.test(text)) {
            requirements = [];
            name = title;
        }
        if (resolution.mode === 'forge' || /\b(?:app|application|tool)\s+(?:should|must|needs? to)\b/i.test(text) ||
            (requirements.length && (isDraftRefinement(text) || /^(?:add|include|use|support|name it|call it)\b/i.test(text)))) {
            if (!requirements.includes(text)) requirements.push(text);
        }
        const explicitName = text.match(/\b(?:name|call)\s+it\s+["“]([^"”]+)["”]/i);
        if (explicitName) name = explicitName[1];
    }
    return { name: name || 'New Application', requirements: requirements.join('\n\n') || message };
}
