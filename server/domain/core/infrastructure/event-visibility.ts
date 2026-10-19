/**
 * Who may see an event on the live stream (`/api/events/stream`, `/api/events/live`).
 *
 * The stream used to forward every event in the process to every authenticated
 * client, narrowed only by an `organizationId` query parameter the client chose
 * for itself, so one tenant's interventions, forge logs and mission events
 * reached every other tenant's browser.
 *
 * Rules:
 * - An event tagged with an organization is visible only to viewers whose
 *   resolved org (membership-checked by `getUserOrgContext`) is that org.
 * - An event with no organization is system-wide and visible to everyone. This
 *   matches the REST history endpoints, which read `org = $1 OR org IS NULL`.
 * - Psychologist intent events carry the user they were inferred for in
 *   `payload.user_id`; they go to that user only.
 */

export interface StreamViewer {
    userId: string;
    organizationId: number | null;
}

interface StreamEvent {
    eventType?: string;
    source?: string;
    payload?: Record<string, any> | null;
    context?: Record<string, any> | null;
}

export function isEventVisibleTo(event: StreamEvent, viewer: StreamViewer): boolean {
    if (event.source === "psychologist") {
        const target = event.payload?.user_id;
        return target != null && String(target) === String(viewer.userId);
    }

    const eventOrg = event.context?.organizationId;
    if (eventOrg == null) return true;
    return viewer.organizationId != null && Number(eventOrg) === viewer.organizationId;
}

/**
 * Compile the stream's `type` filter. `*` matches one dot-separated segment,
 * `**` any number; a comma separates alternatives.
 */
export function compileEventTypeFilter(filter: string | undefined): ((eventType: string) => boolean) | null {
    if (!filter || filter === "all") return null;
    const patterns = filter.split(",").map((p) => p.trim()).filter(Boolean).map((p) =>
        new RegExp(
            "^" +
            p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
                .replace(/\*\*/g, "\u0000")
                .replace(/\*/g, "[^.]*")
                .replace(/\u0000/g, ".*") +
            "$",
        ),
    );
    if (patterns.length === 0) return null;
    return (eventType: string) => patterns.some((re) => re.test(eventType));
}
