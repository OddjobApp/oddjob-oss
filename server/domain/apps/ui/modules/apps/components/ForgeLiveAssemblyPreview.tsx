import React, { Suspense, useEffect, useState } from 'react';
import { Blocks, Braces, CheckCircle2, Database, ExternalLink, FileCode2, Loader2, Monitor, ShieldCheck, Sparkles } from 'lucide-react';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { cn } from '@/lib/utils';
import { getLazyPackagedComponent } from '@domain-ui/core/ui/components/packaged/registry';

export interface LiveAssemblyBlock {
  module: string;
  componentName: string;
  category: string;
  description: string;
  props: Record<string, any>;
  span: number;
  status: 'selected' | 'assembling' | 'mounted' | 'failed';
}

export interface LiveAssemblyModel {
  title: string;
  slug: string;
  source: 'component-gallery';
  phase: 'planning' | 'assembling' | 'preview' | 'failed';
  blocks: LiveAssemblyBlock[];
  api: LiveApiContract;
  files: string[];
  activeTask?: string;
  previewUrl?: string;
  updatedAt: string;
  /**
   * True when this model was rebuilt locally instead of streamed by the forge —
   * a guess at the composition, not a report of it. Set only by
   * createGalleryFallbackAssembly, and surfaced in the header so a reconstruction
   * is never mistaken for what the server actually selected.
   */
  reconstructed?: boolean;
}

export interface LiveApiEndpoint {
  id: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  summary: string;
  resource: string;
  auth: 'bearer' | 'session' | 'public';
  status: 'specifying' | 'generating' | 'ready' | 'failed';
  implementationFiles: string[];
}

export interface LiveApiContract {
  openapi: '3.1.0';
  title: string;
  version: string;
  basePath: string;
  status: 'specifying' | 'generating' | 'ready' | 'failed';
  certification: string;
  endpoints: LiveApiEndpoint[];
  schemas: Array<{ name: string; fields: Array<{ name: string; type: string; required: boolean }> }>;
  generatedFiles: string[];
  document: Record<string, any>;
}

function fallbackApi(title: string, slug: string): LiveApiContract {
  const basePath = `/api/${slug}`;
  const resource = slug;
  const endpointSeed: Array<[LiveApiEndpoint['method'], string, string]> = [
    ['GET', `${basePath}/${resource}`, `List ${resource}`],
    ['POST', `${basePath}/${resource}`, `Create ${resource}`],
    ['GET', `${basePath}/${resource}/{id}`, `Get ${resource} by id`],
    ['PATCH', `${basePath}/${resource}/{id}`, `Update ${resource}`],
    ['DELETE', `${basePath}/${resource}/{id}`, `Delete ${resource}`],
  ];
  const endpoints = endpointSeed.map(([method, path, summary], index) => ({
    id: `${method.toLowerCase()}-${index}`,
    method,
    path,
    summary,
    resource,
    auth: 'bearer' as const,
    status: 'generating' as const,
    implementationFiles: [],
  }));
  const schemaName = title.replace(/[^a-z0-9]/gi, '') || 'Record';
  const schemas = [{ name: schemaName, fields: [
    { name: 'id', type: 'string', required: true },
    { name: 'name', type: 'string', required: true },
    { name: 'status', type: 'string', required: true },
    { name: 'createdAt', type: 'string', required: true },
  ] }];
  const paths = endpoints.reduce<Record<string, any>>((result, endpoint) => {
    result[endpoint.path] ||= {};
    result[endpoint.path][endpoint.method.toLowerCase()] = {
      summary: endpoint.summary,
      operationId: endpoint.id,
      security: [{ bearerAuth: [] }],
      responses: { '200': { description: 'Successful response' } },
    };
    return result;
  }, {});
  return {
    openapi: '3.1.0', title: `${title} API`, version: '1.0.0', basePath,
    // A locally reconstructed contract is certified by nothing. Saying otherwise
    // here would restate the claim the service side no longer makes.
    status: 'generating', certification: 'Reconstructed locally; unverified', endpoints, schemas, generatedFiles: [],
    document: {
      openapi: '3.1.0',
      info: { title: `${title} API`, version: '1.0.0' },
      servers: [{ url: basePath }],
      paths,
      components: {
        schemas: { [schemaName]: { type: 'object', required: ['id', 'name', 'status', 'createdAt'], properties: {
          id: { type: 'string' }, name: { type: 'string' }, status: { type: 'string' }, createdAt: { type: 'string' },
        } } },
        securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      },
    },
  };
}

export function createGalleryFallbackAssembly({
  title,
  slug,
  blueprint,
}: {
  title?: string;
  slug?: string;
  blueprint?: string;
}): LiveAssemblyModel {
  const appTitle = title || 'Forged Application';
  const appSlug = slug || 'forged-application';
  const context = (blueprint || '').toLowerCase();
  const modules = /chat|assistant|support/.test(context)
    ? ['AIAgentChat', 'StatusTimeline', 'MetricGrid']
    : /crud|ticket|sales/.test(context)
      ? ['MetricGrid', 'MissionControlTable', 'StatusTimeline']
      : ['IndustrialDashboardHero', 'MetricGrid', 'StatusTimeline'];
  const metadata: Record<string, Pick<LiveAssemblyBlock, 'componentName' | 'description' | 'span' | 'props'>> = {
    IndustrialDashboardHero: {
      componentName: 'Industrial Dashboard Hero',
      description: 'Operational overview selected from the component gallery.',
      span: 12,
      props: { title: appTitle, subtitle: 'Live application assembly preview', stats: [], data: [] },
    },
    MetricGrid: {
      componentName: 'Metric Grid',
      description: 'Live operational metrics.',
      span: 4,
      props: { columns: 3, metrics: [
        { label: 'Total', value: '1,248', change: 8.4, trend: 'up', iconName: 'activity' },
        { label: 'In progress', value: 32, change: 4.1, trend: 'up', iconName: 'loader' },
        { label: 'Completed', value: '96%', change: 1.8, trend: 'up', iconName: 'check-circle' },
      ] },
    },
    MissionControlTable: {
      componentName: 'Mission Control Table',
      description: 'Governed records surface.',
      span: 8,
      props: { title: `${appTitle} records`, collection: appSlug, columns: [
        { key: 'name', label: 'Name' }, { key: 'status', label: 'Status', variant: 'badge' },
      ] },
    },
    StatusTimeline: {
      componentName: 'Status Timeline',
      description: 'Assembly and runtime activity.',
      span: 4,
      props: { title: 'Recent activity', events: [
        { id: '1', timestamp: new Date().toISOString(), title: 'Application scaffold selected', status: 'completed' },
        { id: '2', timestamp: new Date().toISOString(), title: 'Components assembling', status: 'in_progress' },
      ] },
    },
    AIAgentChat: {
      componentName: 'AI Agent Chat',
      description: 'Assistant experience selected from the gallery.',
      span: 12,
      props: { personaName: `${appTitle} Assistant`, initialMessages: [
        { role: 'assistant', content: `Welcome to ${appTitle}. How can I help?` },
      ] },
    },
  };

  return {
    title: appTitle,
    slug: appSlug,
    source: 'component-gallery',
    phase: 'assembling',
    reconstructed: true,
    activeTask: 'Reconstructed locally — awaiting the forge’s own composition',
    updatedAt: new Date().toISOString(),
    files: [],
    api: fallbackApi(appTitle, appSlug),
    blocks: modules.map((module) => ({
      module,
      category: 'component-gallery',
      status: 'assembling' as const,
      ...metadata[module],
    })),
  };
}

class PreviewBoundary extends React.Component<{ children: React.ReactNode; name: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) {
      return <div className="p-6 text-center text-xs text-amber-300">{this.props.name} needs runtime data; its shell is still mounted.</div>;
    }
    return this.props.children;
  }
}

function BlockPreview({ block }: { block: LiveAssemblyBlock }) {
  const LazyBlock = getLazyPackagedComponent(block.module);
  return (
    <div
      className="min-w-0 overflow-hidden rounded-xl border border-border/80 bg-background shadow-sm"
      style={{ gridColumn: `span ${Math.min(12, Math.max(1, block.span || 12))} / span ${Math.min(12, Math.max(1, block.span || 12))}` }}
      data-testid={`forge-live-block-${block.module}`}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border/70 bg-muted/30 px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-[10px] font-bold">{block.componentName}</p>
          <p className="truncate font-mono text-[8px] text-muted-foreground">Gallery · {block.module}</p>
        </div>
        {block.status === 'mounted' ? (
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
        ) : (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-cyan-400" />
        )}
      </div>
      <div className="max-h-[300px] min-h-[120px] overflow-auto p-2">
        {!LazyBlock ? (
          <div className="p-6 text-center text-xs text-muted-foreground">Component unavailable in the runtime registry.</div>
        ) : (
          <PreviewBoundary name={block.componentName}>
            <Suspense fallback={<div className="flex h-28 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-cyan-400" /></div>}>
              <LazyBlock {...(block.props || {})} />
            </Suspense>
          </PreviewBoundary>
        )}
      </div>
    </div>
  );
}

export function ForgeLiveAssemblyPreview({ assembly }: { assembly: LiveAssemblyModel | null }) {
  const [tab, setTab] = useState<'preview' | 'api' | 'components' | 'files' | 'runtime'>('preview');

  useEffect(() => {
    if (tab === 'runtime' && !assembly?.previewUrl) setTab('preview');
  }, [assembly?.previewUrl, tab]);

  if (!assembly) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground" data-testid="forge-live-assembly-waiting">
        <Loader2 className="h-7 w-7 animate-spin text-cyan-400" />
        <div>
          <p className="text-xs font-bold text-foreground">Selecting UI components…</p>
          <p className="mt-1 text-[10px]">Forge is matching the requirements to the component gallery.</p>
        </div>
      </div>
    );
  }

  // Jobs persisted before the API-contract stream was introduced still need a
  // useful API surface instead of crashing on missing metadata.
  const api = assembly.api || fallbackApi(assembly.title, assembly.slug);

  const tabs: Array<{ id: typeof tab; label: string; icon: React.ElementType; count?: number }> = [
    { id: 'preview', label: 'Live canvas', icon: Monitor },
    { id: 'api', label: 'API', icon: Braces, count: api.endpoints.length },
    { id: 'components', label: 'Components', icon: Blocks, count: assembly.blocks.length },
    { id: 'files', label: 'Files', icon: FileCode2, count: assembly.files.length },
    ...(assembly.previewUrl ? [{ id: 'runtime' as const, label: 'Runtime', icon: ExternalLink }] : []),
  ];

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="forge-live-assembly">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 bg-background/80 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="rounded-md bg-cyan-500/10 p-1.5 text-cyan-400"><Sparkles className="h-4 w-4" /></div>
          <div className="min-w-0">
            <p className="truncate text-xs font-black">{assembly.title}</p>
            <p className="truncate text-[9px] text-muted-foreground">
              {assembly.reconstructed
                ? 'Reconstructed locally from the blueprint — not the forge’s own selection'
                : 'Assembling from the Oddjob Component Gallery'}
            </p>
          </div>
        </div>
        <Badge
          variant="outline"
          data-testid={assembly.reconstructed ? 'forge-live-assembly-reconstructed' : 'forge-live-assembly-phase'}
          className={cn(
            'text-[9px] uppercase',
            assembly.reconstructed
              ? 'border-amber-500/40 text-amber-300'
              : assembly.phase === 'preview' ? 'border-emerald-500/30 text-emerald-300' : 'border-cyan-500/30 text-cyan-300'
          )}
        >
          {assembly.reconstructed
            ? 'Reconstructed'
            : assembly.phase === 'preview' ? 'Preview ready' : assembly.activeTask || assembly.phase}
        </Badge>
      </div>

      <div className="flex items-center gap-1 overflow-x-auto border-b border-border/70 px-3 py-2">
        {tabs.map(({ id, label, icon: Icon, count }) => (
          <button key={id} type="button" onClick={() => setTab(id)} className={cn(
            'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[10px] font-bold transition-colors',
            tab === id ? 'bg-cyan-500/10 text-cyan-300' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
          )}>
            <Icon className="h-3.5 w-3.5" /> {label}
            {typeof count === 'number' && <span className="rounded bg-background px-1 font-mono text-[8px]">{count}</span>}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-muted/10 p-3">
        {tab === 'preview' && (
          <div className="mx-auto max-w-6xl overflow-hidden rounded-xl border border-border bg-card shadow-xl">
            <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-3 py-2">
              <span className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
              <span className="ml-2 flex-1 rounded bg-background px-2 py-1 font-mono text-[9px] text-muted-foreground">/{assembly.slug}</span>
            </div>
            <div className="grid grid-cols-12 gap-3 p-3">
              {assembly.blocks.map((block) => <BlockPreview key={block.module} block={block} />)}
            </div>
          </div>
        )}

        {tab === 'components' && (
          <div className="grid gap-2 md:grid-cols-2">
            {assembly.blocks.map((block, index) => (
              <div key={block.module} className="flex items-start gap-3 rounded-lg border border-border bg-background p-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-cyan-500/10 font-mono text-[10px] text-cyan-300">{index + 1}</div>
                <div className="min-w-0 flex-1"><p className="text-xs font-bold">{block.componentName}</p><p className="mt-1 text-[10px] text-muted-foreground">{block.description}</p></div>
                <Badge variant="outline" className="text-[8px]">{block.status}</Badge>
              </div>
            ))}
          </div>
        )}

        {tab === 'api' && (
          <div className="grid min-h-full gap-3 xl:grid-cols-[minmax(20rem,0.85fr)_minmax(28rem,1.15fr)]" data-testid="forge-api-contract">
            <div className="space-y-3">
              <div className="rounded-xl border border-border bg-background p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-black">{api.title}</p>
                    <p className="mt-1 font-mono text-[9px] text-muted-foreground">OpenAPI {api.openapi} · {api.basePath}</p>
                  </div>
                  <Badge variant="outline" className={cn('text-[8px] uppercase', api.status === 'ready' ? 'border-emerald-500/30 text-emerald-300' : 'border-cyan-500/30 text-cyan-300')}>
                    {api.status}
                  </Badge>
                </div>
                <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-[9px] text-emerald-300">
                  <ShieldCheck className="h-3.5 w-3.5" /> {api.certification}
                </div>
              </div>

              <div className="rounded-xl border border-border bg-background">
                <div className="flex items-center justify-between border-b border-border px-3 py-2">
                  <p className="text-[10px] font-black uppercase tracking-wider">Endpoints</p>
                  <Badge variant="outline" className="text-[8px]">{api.endpoints.length} operations</Badge>
                </div>
                <div className="max-h-[330px] divide-y divide-border/60 overflow-auto">
                  {api.endpoints.map((endpoint) => (
                    <div key={endpoint.id} className="grid grid-cols-[3.25rem_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2.5">
                      <span className={cn(
                        'rounded px-1.5 py-1 text-center font-mono text-[8px] font-black',
                        endpoint.method === 'GET' ? 'bg-cyan-500/10 text-cyan-300' :
                        endpoint.method === 'POST' ? 'bg-emerald-500/10 text-emerald-300' :
                        endpoint.method === 'DELETE' ? 'bg-rose-500/10 text-rose-300' : 'bg-amber-500/10 text-amber-300',
                      )}>{endpoint.method}</span>
                      <div className="min-w-0">
                        <p className="truncate font-mono text-[9px] text-foreground">{endpoint.path}</p>
                        <p className="mt-0.5 truncate text-[8px] text-muted-foreground">{endpoint.summary}</p>
                      </div>
                      {endpoint.status === 'ready' ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> : <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-400" />}
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-border bg-background p-3">
                <div className="mb-2 flex items-center gap-2"><Database className="h-3.5 w-3.5 text-violet-300" /><p className="text-[10px] font-black uppercase tracking-wider">Schemas</p></div>
                <div className="flex flex-wrap gap-2">
                  {api.schemas.map((schema) => <Badge key={schema.name} variant="outline" className="text-[8px]">{schema.name} · {schema.fields.length} fields</Badge>)}
                </div>
              </div>
            </div>

            <div className="flex min-h-[480px] flex-col overflow-hidden rounded-xl border border-border bg-[#07101f]">
              <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
                <div className="flex items-center gap-2"><FileCode2 className="h-3.5 w-3.5 text-cyan-400" /><span className="font-mono text-[9px] text-foreground/70">openapi.json</span></div>
                <Badge variant="outline" className="border-white/10 text-[8px] text-muted-foreground">contract source</Badge>
              </div>
              <pre className="min-h-0 flex-1 overflow-auto p-4 font-mono text-[9px] leading-relaxed text-cyan-100/80">{JSON.stringify(api.document, null, 2)}</pre>
              <div className="border-t border-white/10 px-3 py-2 font-mono text-[8px] text-muted-foreground">
                {api.generatedFiles.length ? api.generatedFiles.join(' · ') : 'Route and controller files will bind here as they are generated.'}
              </div>
            </div>
          </div>
        )}

        {tab === 'files' && (
          <div className="rounded-lg border border-border bg-background font-mono text-[10px]">
            {assembly.files.length ? assembly.files.map((file) => (
              <div key={file} className="flex items-center gap-2 border-b border-border/60 px-3 py-2 last:border-0"><FileCode2 className="h-3.5 w-3.5 text-cyan-400" />{file}</div>
            )) : <div className="p-8 text-center text-muted-foreground">Files will appear here as Forge writes them.</div>}
          </div>
        )}

        {tab === 'runtime' && assembly.previewUrl && (
          // This is the backdrop behind the forged app's own page, not a surface
          // of this UI: an app with a transparent body would otherwise show our
          // dark chrome through it, so white is the right ground for an
          // arbitrary document.
          <iframe title={`${assembly.title} runtime preview`} src={assembly.previewUrl} className={"h-full min-h-[480px] w-full rounded-xl border border-border bg-white" /* theme-lint-ignore */} sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts" />
        )}
      </div>
    </div>
  );
}

export default ForgeLiveAssemblyPreview;
