import { useEffect, useState } from 'react';
import { Shell } from './PublicPages';
type Release = { title: string; version: string; publishedAt: string; summary: string };
export default function PublicReleaseNotes() {
  const [releases, setReleases] = useState<Release[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const response = await fetch('/api/public/documentation/releases', {credentials: 'omit', signal: controller.signal});
        if (!response.ok) throw new Error('Unavailable');
        const data = await response.json();
        if (active) { setReleases(data.releases); setError(false); }
      } catch { if (active) setError(true); }
    };
    void refresh();
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    return () => { active = false; controller.abort(); window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, []);
  return <Shell title="Oddjob release notes" intro="Customer-facing updates published by the Oddjob team. This feed refreshes as new release summaries are published.">
    <a className="inline-flex min-h-11 items-center underline" href="/docs">Feature documentation</a>
    {error && <p role="alert">Release notes could not be refreshed. Please try again shortly.</p>}
    {!releases ? <p role="status">Loading release notes…</p> : releases.length === 0 ? <p className="rounded-xl border border-border p-6 text-muted-foreground">No public release notes have been published yet.</p> : <div className="space-y-5" aria-live="polite">{releases.map(release => <article key={release.version} className="rounded-2xl border border-border bg-card p-6">
      <p className="text-sm text-muted-foreground">Version {release.version} · <time dateTime={release.publishedAt}>{new Date(release.publishedAt).toLocaleDateString()}</time></p>
      <h2 className="mt-2 text-2xl font-semibold">{release.title}</h2>
      <p className="mt-4 whitespace-pre-wrap leading-7">{release.summary}</p>
    </article>)}</div>}
  </Shell>;
}
