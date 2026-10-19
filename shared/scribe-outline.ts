/**
 * Splitting an imported document into Scribe stations.
 *
 * A Confluence page arrives as one markdown blob, but a Scribe manuscript is a
 * list of stations — the Subway Spine, the pacing telemetry and the per-station
 * critic passes all count them. Importing a page as a single station would put
 * the text in the canvas while leaving every one of those features looking at a
 * document with one item in it.
 *
 * So the import splits on headings, which is the structure the author already
 * expressed in the source. Shared rather than server-only because the same split
 * previews the result in the pod before anything is written.
 */

export interface OutlineStation {
    title: string;
    stationKey: string;
    content: string;
    sortOrder: number;
}

/** Matches an ATX heading and captures its depth and text. */
const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

/**
 * A stable, readable key for a heading.
 *
 * Slugged rather than positional so re-importing a page that gained a section
 * updates the matching station instead of shifting every key by one.
 */
export function stationKeyFromTitle(title: string, fallbackIndex: number): string {
    const slug = title
        .toLowerCase()
        .replace(/^\d+[.)]\s*/, "")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 40);
    return slug || `section_${fallbackIndex}`;
}

/**
 * The heading depth the document is organised at.
 *
 * A page whose body is all H2 under a single H1 title should split on the H2s,
 * not produce one station containing everything. So the split level is the
 * shallowest depth that occurs more than once; a document with one H1 and many
 * H2s splits on H2, and one with several H1s splits on H1.
 */
export function detectSplitLevel(markdown: string): number {
    const counts = new Map<number, number>();
    for (const line of markdown.split(/\r?\n/)) {
        const m = line.match(HEADING);
        if (m) counts.set(m[1].length, (counts.get(m[1].length) ?? 0) + 1);
    }
    if (counts.size === 0) return 0;

    const levels = [...counts.keys()].sort((a, b) => a - b);
    for (const level of levels) {
        if ((counts.get(level) ?? 0) > 1) return level;
    }
    // Every heading is unique at its depth: use the shallowest that has content
    // under it, which for a normal page is the one below the title.
    return levels.length > 1 ? levels[1] : levels[0];
}

/**
 * Split a markdown document into stations at its heading level.
 *
 * Text before the first heading becomes an opening station rather than being
 * dropped — on a Confluence page that is usually the summary paragraph, which is
 * exactly the part an author would notice missing.
 */
export function splitMarkdownIntoStations(
    markdown: string,
    options: { fallbackTitle?: string } = {},
): OutlineStation[] {
    const text = (markdown ?? "").replace(/\r\n/g, "\n").trim();
    if (!text) return [];

    const level = detectSplitLevel(text);
    const fallbackTitle = options.fallbackTitle?.trim() || "Overview";

    if (level === 0) {
        // No headings at all: one station, so the text still lands somewhere.
        return [
            {
                title: fallbackTitle,
                stationKey: stationKeyFromTitle(fallbackTitle, 1),
                content: text,
                sortOrder: 1,
            },
        ];
    }

    const lines = text.split("\n");
    const sections: Array<{ title: string; body: string[] }> = [];
    let preamble: string[] = [];

    for (const line of lines) {
        const m = line.match(HEADING);
        if (m && m[1].length === level) {
            sections.push({ title: m[2].trim(), body: [] });
        } else if (sections.length === 0) {
            preamble.push(line);
        } else {
            sections[sections.length - 1].body.push(line);
        }
    }

    const stations: OutlineStation[] = [];
    const preambleText = preamble.join("\n").trim();
    if (preambleText) {
        // Keep a title line out of the body: it becomes the station's own title.
        const firstHeading = preamble.find((l) => HEADING.test(l));
        const title = firstHeading ? firstHeading.replace(HEADING, "$2").trim() : fallbackTitle;
        const body = preambleText
            .split("\n")
            .filter((l) => l !== firstHeading)
            .join("\n")
            .trim();
        if (body) {
            stations.push({
                title,
                stationKey: stationKeyFromTitle(title, stations.length + 1),
                content: body,
                sortOrder: stations.length + 1,
            });
        }
    }

    const seen = new Set(stations.map((s) => s.stationKey));
    for (const section of sections) {
        let key = stationKeyFromTitle(section.title, stations.length + 1);
        if (seen.has(key)) key = `${key}_${stations.length + 1}`;
        seen.add(key);
        stations.push({
            title: section.title,
            stationKey: key,
            content: section.body.join("\n").trim(),
            sortOrder: stations.length + 1,
        });
    }

    return stations;
}
