/**
 * Hashtag Extractor Utility
 * Extracts hashtags from message text for use as knowledge graph topics
 *
 * Delegates the grammar to shared/topic-tags.ts — the same module the crew
 * rooms use — so `#[multi word]` works from Slack/Teams exactly as it does in
 * the composer. This module keeps only the bridge-specific extras: Slack
 * `<@user>` and `<url|label>` markup, and the {hashtags, cleanText} contract
 * (the bridge stores the stripped text; rooms keep the tag in place).
 *
 * Usage:
 *   const { hashtags, cleanText } = extractHashtags("Check the #docs for #[project alpha]");
 *   // hashtags: ['docs', 'project alpha']
 *   // cleanText: "Check the for"
 *
 *   const topics = extractTopicsFromText("Important #security-patch needed");
 *   // topics: ['Security Patch']
 */

import { extractTopicTags, normalizeTagLabel, stripTopicTags } from "@shared/topic-tags.js";

export interface ExtractedHashtags {
    hashtags: string[];
    cleanText: string;
}

/**
 * Extract hashtags from text (e.g., Slack messages)
 * Supports: #hashtag, #multi-word-tag, #[multi word tag], #CamelCase
 * Ignores: URLs, code blocks, mentions (<@userid> and @name), markdown
 * headings, pure hex colors.
 */
export function extractHashtags(text: string): ExtractedHashtags {
    if (!text || typeof text !== 'string') {
        return { hashtags: [], cleanText: text || '' };
    }

    // Platform markup the shared grammar does not know: Slack <@U123>
    // mentions and <https://x|label> links (rewritten to their label so the
    // label's words still reach the tag scan).
    const sanitizedText = text
        .replace(/<@[^>]+>/g, '')
        .replace(/<https?:\/\/[^|]+\|([^>]+)>/g, '$1');

    const tags = extractTopicTags(sanitizedText);
    const hashtags = tags.map((t) => t.raw.toLowerCase().trim());

    // The bridge's contract: the KB document stores the text without its tags.
    const cleanText = stripTopicTags(sanitizedText)
        .replace(/\s+/g, ' ')
        .trim();

    return { hashtags, cleanText };
}

/**
 * Convert hashtags to topic names (title case, replace hyphens with spaces)
 * e.g., "project-alpha" -> "Project Alpha"
 */
export function hashtagToTopicName(hashtag: string): string {
    return normalizeTagLabel(hashtag);
}

/**
 * Extract hashtags and convert to topic names in one call
 */
export function extractTopicsFromText(text: string): string[] {
    const { hashtags } = extractHashtags(text);
    return hashtags.map(hashtagToTopicName);
}
