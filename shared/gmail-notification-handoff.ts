/** Keep the triggering alert identity through push and inbox navigation. */
export function gmailAlertRoute(route: unknown, eventId: number): string {
    if (typeof route !== 'string' || !route.startsWith('/workspace/chat/') || route.startsWith('//') || !Number.isInteger(eventId) || eventId < 1) return '/';
    const url = new URL(route, 'http://oddjob.local');
    if (url.origin !== 'http://oddjob.local') return '/';
    url.searchParams.set('gmailAlert', String(eventId));
    return url.pathname + url.search;
}
