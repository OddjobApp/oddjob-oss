/**
 * A coarse "we are serving degraded output right now" signal.
 *
 * Several subsystems have silent fallbacks — the RAG embedder swaps Gemini for
 * Ollama or a lexical-hash vector, and a search over those vectors can return
 * nothing without anything upstream knowing why. The failure was logged once,
 * deep inside the provider call, and every consumer down the line treated the
 * empty result as truth.
 *
 * This module exists so the fallback can mark itself and consumers can ask
 * "did this recently degrade?" without either side importing the other —
 * rag-langchain already depends on org-embeddings, so a shared neutral module
 * is the only place the mark can live without a cycle.
 *
 * Deliberately NOT per-request telemetry: a module-level map of kind → last
 * mark is enough, because the signal means "the process is in a degraded mode"
 * rather than "this call failed". Any call within the window inherits it.
 */

interface DegradationMark {
    at: number;
    reason: string;
}

const marks = new Map<string, DegradationMark>();

export function markDegradation(kind: string, reason: string): void {
    marks.set(kind, { at: Date.now(), reason });
}

export function recentDegradation(
    kind: string,
    windowMs = 5 * 60 * 1000,
): DegradationMark | null {
    const mark = marks.get(kind);
    if (!mark) return null;
    return Date.now() - mark.at <= windowMs ? mark : null;
}
