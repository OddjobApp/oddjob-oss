/**
 * Centralised route-path builders.
 *
 * Mission-run links were hand-built in ~6 places with two different bases
 * (`/missions/:m/runs/:r` — which only 302-redirects — and the canonical
 * `/operations/missions/:m/runs/:r`), so they drifted. Use these helpers so
 * every link points at the same, redirect-free route.
 */

/** Canonical detail route for a mission run (renders MissionRunPage). */
export function missionRunPath(missionId: number | string, runId: number | string): string {
    return `/operations/missions/${missionId}/runs/${runId}`;
}

/**
 * Run link when only the run id is known (e.g. the Autoresearch dashboard).
 * Resolves to the canonical route via the /mission-runs/:runId redirect.
 */
export function missionRunPathByRunId(runId: number | string): string {
    return `/mission-runs/${runId}`;
}
