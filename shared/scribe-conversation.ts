/** Explicit conversational controls, not words quoted inside document prose. */
export function scribeConversationIntent(message: string): "pause" | "resume" | "review" | "revise" | "other" {
    const text = message.trim().replace(/[.!]+$/, "").toLowerCase();
    if (/^(?:please\s+)?(?:hold on|wait|pause|stop|pause the agents|stop the agents|let me (?:edit|change)(?: this| that| the document)?)(?:\s+please)?$/.test(text)) return "pause";
    if (/^(?:please\s+)?(?:continue|resume|carry on|keep going|resume (?:writing|the agents|the review))(?:\s+please)?$/.test(text)) return "resume";
    // Review-only is the request itself ("review this section", "can you audit the
    // draft") or an explicit ban on editing. A review word anywhere else names
    // content: "add a section about our audit process" is an edit, and matching it
    // blocked every Scribe write for that turn.
    const asksForReview = /^(?:(?:please|can you|could you|would you|just|only)\s+)*(?:review|audit|critique|assess|check|proofread)\b/.test(text);
    const asksToApply = /\b(?:apply|rewrite|fix|edit|implement)\b/.test(text);
    if (asksForReview && !asksToApply) return "review";
    // Only a ban with no object, or on the document itself: "without changing the
    // meaning" constrains a rewrite rather than forbidding one.
    if (/\b(?:do not|don't|without)\s+(?:edit(?:ing)?|chang(?:e|ing)|rewrit(?:e|ing)|apply(?:ing)?)(?:\s+(?:it|this|that|anything|the\s+(?:document|manuscript|draft|section|text)))?\s*(?:[,.;:!?]|$)/.test(text)) return "review";
    if (/\b(?:rewrite|revise|try (?:that|this|it) again|less formal|more formal|change direction|keep the .+ paragraph)\b/.test(text)) return "revise";
    return "other";
}

export function scribeConversationDirective(message: string): string {
    const intent = scribeConversationIntent(message);
    if (intent === "review") return "Review the current manuscript or selected passage against the author's goals. Read the current document. Return findings with exact passages, reasons and proposed prose. Do not change, publish, reset or restructure the document. Distinguish incomplete or failed review from a clean review.";
    if (intent === "resume") return "Resume the last unfinished authoring request from the conversation using the CURRENT document. Read it again before acting. Preserve manual edits and protected passages. Do not repeat completed work. If no unfinished request is identifiable, ask what to continue.";
    return "The latest user direction supersedes conflicting earlier plans. Keep recommendations in chat and final prose in the document. Preserve every passage the user asks to keep. Read current text before rewriting; never reconstruct an undo from memory or overwrite intervening edits. Ask a short question only when the target or a consequential choice is ambiguous.";
}
