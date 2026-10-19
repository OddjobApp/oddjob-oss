export function isFlightHubUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && (url.hostname === 'flighthub.com' || url.hostname === 'www.flighthub.com');
  } catch { return false; }
}
