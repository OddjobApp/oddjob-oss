import React, { useEffect, useRef, useState } from 'react';
import { apiRequest } from '@/lib/queryClient';
import type { CycleFleetApp } from './CrewCycleAppCanvas';

export interface InstalledBlueprint {
  app: { id: number; name: string; slug: string };
  deployment: { id: number; organizationId?: number; publicSlug?: string | null; status?: string | null };
}

export interface InstallableAppItem {
  slug: string;
  title: string;
  description: string | null;
  availability: 'installed' | 'advertised' | 'template';
  appId?: number;
  href?: string;
}

export function blueprintSurfaces(rows: InstalledBlueprint[], organizationId?: number): CycleFleetApp[] {
  return rows.filter((row) => row.app && row.deployment?.publicSlug
    && (organizationId == null || row.deployment.organizationId == null || row.deployment.organizationId === organizationId)
    && (organizationId == null || !/\(Org \d+\)/i.test(row.app.name) || row.app.name.includes(`(Org ${organizationId})`))
    && !['failed', 'error', 'stopped', 'uninstalled'].includes(row.deployment.status ?? ''))
    .map(({ app, deployment }) => ({
      id: deployment.id, appId: app.id, title: app.name, description: null,
      slug: app.slug, publicSlug: deployment.publicSlug!,
      publicPath: `/app/${encodeURIComponent(deployment.publicSlug!)}`,
      status: deployment.status ?? 'unknown', isLive: deployment.status === 'running', blueprint: app.slug,
    })).sort((a, b) => {
      // Provisioned suites can coexist with a catalogue template under the same
      // blueprint family. Prefer the named suite rather than its generic shell.
      const rank = (app: CycleFleetApp) => /sdlc workbench suite/i.test(app.title) ? 2 : app.slug === 'sdlc-workbench' ? 1 : 0;
      return rank(b) - rank(a) || a.title.localeCompare(b.title);
    });
}

/**
 * What a render_app_surface artifact carries when the tool resolved the target
 * to an installed org app deployment — the identifiers the canvas needs to
 * select it.
 */
export interface CycleAppMountRef {
    publicSlug?: string;
    deploymentId?: number | null;
    appId?: number | null;
    slug?: string;
    title?: string;
    blueprint?: string;
    publicPath?: string;
}

/** The fleet app a launch artifact names, or null when none of them match. */
export function matchCycleFleetApp(apps: CycleFleetApp[] | null | undefined, ref: CycleAppMountRef): CycleFleetApp | null {
    return (apps ?? []).find((a) =>
        (ref.deploymentId != null && a.id === ref.deploymentId) ||
        (ref.appId != null && a.appId === ref.appId) ||
        (ref.publicSlug && (a.publicSlug === ref.publicSlug || a.slug === ref.publicSlug)) ||
        (ref.slug && a.slug === ref.slug)
    ) ?? null;
}

/**
 * A fleet entry built from the artifact alone. The installed list can lag the
 * deployment by a fetch, and the canvas only needs publicPath to serve the
 * surface — synthesizing keeps the mount working in that window.
 */
export function cycleAppFromLaunchRef(ref: CycleAppMountRef): CycleFleetApp | null {
    if (!ref.publicSlug) return null;
    return {
        id: ref.deploymentId ?? 0,
        appId: ref.appId ?? 0,
        title: ref.title || ref.publicSlug,
        description: null,
        slug: ref.slug || ref.publicSlug,
        publicSlug: ref.publicSlug,
        publicPath: ref.publicPath || `/app/${encodeURIComponent(ref.publicSlug)}`,
        status: 'unknown',
        isLive: true,
        blueprint: ref.blueprint ?? null,
    };
}

export function BlueprintStudioLauncher({ organizationId, onMount }: {
  organizationId: number | null | undefined;
  onMount: (apps: CycleFleetApp[]) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installables, setInstallables] = useState<InstallableAppItem[] | null>(null);
  const [installingId, setInstallingId] = useState<number | null>(null);
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!installables) return;
    const onDocClick = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setInstallables(null);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [installables]);

  const loadSurfaces = async (): Promise<CycleFleetApp[]> => {
    const response = await apiRequest('GET', `/api/apps/installed?organizationId=${organizationId}`);
    if (!response.ok) throw new Error('Could not load installed app surfaces.');
    const rows = await response.json();
    return blueprintSurfaces(Array.isArray(rows) ? rows : [], organizationId ?? undefined);
  };

  const open = async () => {
    if (organizationId == null) { setError('Select an organization to open an app studio.'); return; }
    setLoading(true); setError(null); setInstallables(null);
    try {
      const apps = await loadSurfaces();
      if (apps.length) { onMount(apps); return; }
      // Nothing usable is installed — offer installable surfaces instead of a dead end.
      const catalog = await apiRequest('GET', `/api/apps/fleet-for-copilot?organizationId=${organizationId}`);
      const items: InstallableAppItem[] = catalog.ok ? await catalog.json().catch(() => []) : [];
      const installable = items.filter((i) => i.availability === 'advertised' && typeof i.appId === 'number');
      const templates = items.filter((i) => i.availability === 'template' && i.href);
      if (installable.length || templates.length) { setInstallables([...installable, ...templates]); return; }
      setError('No app surfaces available — install a blueprint from the Armory to open one here.');
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not open app studio.'); }
    finally { setLoading(false); }
  };

  const install = async (item: InstallableAppItem) => {
    if (item.availability === 'template' || typeof item.appId !== 'number') {
      if (item.href) window.location.href = item.href;
      return;
    }
    setInstallingId(item.appId); setError(null);
    try {
      const response = await apiRequest('POST', `/api/apps/install?organizationId=${organizationId}`, { appId: item.appId });
      if (!response.ok) throw new Error(`Install failed (${response.status})`);
      setInstallables(null);
      const apps = await loadSurfaces();
      if (apps.length) onMount(apps);
      else setError(`Installed ${item.title}, but no mountable surface appeared yet — the deployment may still be building.`);
    } catch (error) { setError(error instanceof Error ? error.message : `Could not install ${item.title}.`); }
    finally { setInstallingId(null); }
  };

  return <span ref={rootRef} className="relative inline-flex items-center gap-2">
    <button type="button" className="rounded-md border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground" disabled={loading} onClick={() => void open()}>{loading ? 'Loading apps…' : 'App studio'}</button>
    {installables && <div role="menu" aria-label="Installable app surfaces" className="absolute right-0 top-full z-50 mt-1 w-72 rounded-md border border-border/60 bg-popover p-2 shadow-lg">
      <p className="px-1 pb-1.5 text-[11px] text-muted-foreground">No installed app surface in this organization.</p>
      <ul className="max-h-64 space-y-1 overflow-y-auto">
        {installables.map((item) => <li key={`${item.availability}-${item.slug}`} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted/60">
          <span className="min-w-0">
            <span className="block truncate text-xs font-medium text-foreground">{item.title}</span>
            {item.description && <span className="block truncate text-[10px] text-muted-foreground">{item.description}</span>}
          </span>
          {item.availability === 'advertised' && typeof item.appId === 'number'
            ? <button type="button" className="shrink-0 rounded-md border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50" disabled={installingId != null} onClick={() => void install(item)}>{installingId === item.appId ? 'Installing…' : 'Install'}</button>
            : <button type="button" className="shrink-0 rounded-md border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground" onClick={() => void install(item)}>Create</button>}
        </li>)}
      </ul>
    </div>}
    {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
  </span>;
}
