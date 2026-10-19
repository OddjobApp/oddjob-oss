export interface SpatialEntityRef {
  type: string;
  id: string;
}

export type SpatialViewId = 'signals' | 'sources' | 'backbone' | 'subscriptions' | 'wizard' | 'catalog';

export interface SpatialContext {
  signalId?: string;
  entityRefs: SpatialEntityRef[];
  scenarioId?: string;
  compare?: string;
  timeHorizon?: string;
  view?: SpatialViewId;
}

export interface CausalLink {
  id: string;
  targetEntityType: string;
  targetEntityId: string;
  impactConfidence: number;
  blastRadius: number;
}

export interface RecommendedAction {
  type: string;
  label: string;
  requiresApproval: boolean;
}

export interface SpatialAssessment {
  severity: string;
  confidence: number;
  blastRadius: number;
  causalLinks: CausalLink[];
  recommendedActions: RecommendedAction[];
}

const SPATIAL_PATH = '/workspace/spatial';

const VALID_VIEWS: readonly SpatialViewId[] = ['signals', 'sources', 'backbone', 'subscriptions', 'wizard', 'catalog'];

export function parseSpatialContext(search: string): SpatialContext {
  const params = new URLSearchParams(search);
  const entityType = params.get('entityType')?.trim();
  const entityId = params.get('entityId')?.trim();
  const rawView = params.get('view')?.trim() as SpatialViewId | undefined;
  const view = rawView && VALID_VIEWS.includes(rawView) ? rawView : undefined;

  return {
    signalId: params.get('signal')?.trim() || undefined,
    entityRefs: entityType && entityId ? [{ type: entityType, id: entityId }] : [],
    scenarioId: params.get('scenario')?.trim() || undefined,
    compare: params.get('compare')?.trim() || undefined,
    timeHorizon: params.get('horizon')?.trim() || undefined,
    view,
  };
}

export function buildSpatialUrl(context: Partial<SpatialContext> = {}): string {
  const params = new URLSearchParams();
  if (context.signalId) params.set('signal', context.signalId);
  const entity = context.entityRefs?.[0];
  if (entity) {
    params.set('entityType', entity.type);
    params.set('entityId', entity.id);
  }
  if (context.scenarioId) params.set('scenario', context.scenarioId);
  if (context.compare) params.set('compare', context.compare);
  if (context.timeHorizon) params.set('horizon', context.timeHorizon);
  if (context.view) params.set('view', context.view);
  const query = params.toString();

  let basePath = SPATIAL_PATH;
  if (typeof window !== 'undefined') {
    const p = window.location.pathname;
    if (p.startsWith('/workspace/signals') || p.startsWith('/signals')) {
      basePath = '/workspace/signals';
    } else if (p.startsWith('/workspace/spatial') || p.startsWith('/spatial')) {
      basePath = '/workspace/spatial';
    }
  }

  return query ? `${basePath}?${query}` : basePath;
}

export function replaceSpatialContext(context: Partial<SpatialContext>): void {
  if (typeof window === 'undefined') return;
  window.history.replaceState(window.history.state, '', buildSpatialUrl(context));
}
