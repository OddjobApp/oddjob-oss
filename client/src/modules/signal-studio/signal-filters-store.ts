import { useState, useEffect, useCallback, useMemo } from 'react';

export type SignalFilterMatchMode = 'keywords' | 'attributes' | 'composite';

export interface AttributeCondition {
  field: string;
  operator: 'equals' | 'contains' | 'less_than_or_equal' | 'greater_than_or_equal';
  value: string | number;
}

export interface SignalFilter {
  id: string;
  label: string;
  icon: string;
  category: string;
  description?: string;
  matchMode: SignalFilterMatchMode;
  keywords: string[];
  attributeConditions?: AttributeCondition[];
  enabled: boolean;
  isPreset?: boolean;
  createdAt: string;
}

/**
 * Canonical default presets — includes the 5 residential distress filters
 * plus multi-domain presets (maritime, supply chain, infrastructure)
 * to maintain general-purpose event harvesting capabilities.
 */
export const DEFAULT_SIGNAL_FILTERS: SignalFilter[] = [
  // ─── Real Estate Distress Filters ──────────────────────────────────────
  {
    id: 'nod',
    label: 'Notice of Default (NOD)',
    icon: '⚠️',
    category: 'Real Estate Distress',
    description: 'Recorded notice of default filings, pre-foreclosures, and mortgage delinquency notices.',
    matchMode: 'keywords',
    keywords: ['notice of default', 'default', 'nod', 'pre-foreclosure'],
    enabled: true,
    isPreset: true,
    createdAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'auction',
    label: 'Scheduled Trustee Auction',
    icon: '🔨',
    category: 'Real Estate Distress',
    description: 'Notice of trustee sale, sheriff auction, or foreclosure sale dates.',
    matchMode: 'keywords',
    keywords: ['auction', 'trustee', 'foreclosure sale', 'sheriff sale'],
    enabled: true,
    isPreset: true,
    createdAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'tax',
    label: 'Delinquent Property Taxes',
    icon: '💰',
    category: 'Real Estate Distress',
    description: 'County property tax delinquency, municipal tax liens, and tax deed notices.',
    matchMode: 'keywords',
    keywords: ['tax', 'delinquent tax', 'tax lien', 'tax default'],
    enabled: true,
    isPreset: true,
    createdAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'substandard',
    label: 'Substandard / Red-Tag',
    icon: '🚫',
    category: 'Real Estate Distress',
    description: 'Municipal code enforcement red-tags, substandard housing declarations, and habitability citations.',
    matchMode: 'keywords',
    keywords: ['substandard', 'red-tag', 'code violation', 'uninhabitable'],
    enabled: true,
    isPreset: true,
    createdAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'probate',
    label: 'Probate Acceleration',
    icon: '⚖️',
    category: 'Real Estate Distress',
    description: 'Probate filings, estate executor liquidations, and inheritance title transfers.',
    matchMode: 'keywords',
    keywords: ['probate', 'estate', 'decedent', 'heirship'],
    enabled: true,
    isPreset: true,
    createdAt: '2026-01-01T00:00:00Z',
  },
  // ─── Cross-Domain Harvester Filters (General Purpose) ───────────────────
  {
    id: 'maritime_ais_drift',
    label: 'Vessel AIS Anomaly & Drift',
    icon: '🚢',
    category: 'Maritime Logistics',
    description: 'Vessel tracking deviations, abnormal loitering outside anchorage, and transponder loss.',
    matchMode: 'keywords',
    keywords: ['ais', 'vessel', 'maritime', 'anchorage', 'port congestion'],
    enabled: false,
    isPreset: true,
    createdAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'supply_chain_bottleneck',
    label: 'Supply Chain Bottleneck',
    icon: '📦',
    category: 'Global Trade',
    description: 'Intermodal freight delays, container yard dwell spikes, and railhead embargoes.',
    matchMode: 'keywords',
    keywords: ['supply chain', 'dwell', 'congestion', 'intermodal', 'freight'],
    enabled: false,
    isPreset: true,
    createdAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'critical_infrastructure',
    label: 'Critical Infrastructure Outage',
    icon: '⚡',
    category: 'Energy & Power',
    description: 'Substation trips, pipeline flow disruptions, and grid frequency abnormalities.',
    matchMode: 'keywords',
    keywords: ['substation', 'pipeline', 'grid', 'outage', 'power', 'telemetry'],
    enabled: false,
    isPreset: true,
    createdAt: '2026-01-01T00:00:00Z',
  },
];

const STORAGE_KEY = 'oddjob_signal_studio_filters_v1';
const FILTER_CHANGE_EVENT = 'oddjob_signal_filters_changed';

/**
 * Evaluates whether a signal event matches a given SignalFilter.
 */
export function matchesSignalFilter(
  filter: SignalFilter,
  textOrBadge: string,
  rawPayload?: Record<string, unknown>
): boolean {
  const text = (textOrBadge || '').toLowerCase();
  
  // Keyword evaluation
  if (filter.matchMode === 'keywords' || filter.matchMode === 'composite') {
    const hasKeywordMatch = filter.keywords.some((kw) => text.includes(kw.toLowerCase()));
    if (!hasKeywordMatch) return false;
  }

  // Attribute evaluation
  if ((filter.matchMode === 'attributes' || filter.matchMode === 'composite') && filter.attributeConditions?.length) {
    if (!rawPayload) return false;
    for (const cond of filter.attributeConditions) {
      const val = rawPayload[cond.field];
      if (val === undefined || val === null) return false;

      if (cond.operator === 'equals') {
        if (String(val).toLowerCase() !== String(cond.value).toLowerCase()) return false;
      } else if (cond.operator === 'contains') {
        if (!String(val).toLowerCase().includes(String(cond.value).toLowerCase())) return false;
      } else if (cond.operator === 'less_than_or_equal') {
        const numVal = Number(val);
        const condNum = Number(cond.value);
        if (isNaN(numVal) || isNaN(condNum) || numVal > condNum) return false;
      } else if (cond.operator === 'greater_than_or_equal') {
        const numVal = Number(val);
        const condNum = Number(cond.value);
        if (isNaN(numVal) || isNaN(condNum) || numVal < condNum) return false;
      }
    }
  }

  return true;
}

/**
 * Loads all filters (presets + saved custom filters) from localStorage.
 */
export function getStoredSignalFilters(): SignalFilter[] {
  if (typeof window === 'undefined') return DEFAULT_SIGNAL_FILTERS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SIGNAL_FILTERS;
    const parsed = JSON.parse(raw) as SignalFilter[];
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_SIGNAL_FILTERS;

    // Ensure all default presets are represented
    const custom = parsed.filter((f) => !f.isPreset);
    const presetsWithState = DEFAULT_SIGNAL_FILTERS.map((preset) => {
      const existing = parsed.find((p) => p.id === preset.id);
      return existing ? { ...preset, enabled: existing.enabled } : preset;
    });

    return [...presetsWithState, ...custom];
  } catch {
    return DEFAULT_SIGNAL_FILTERS;
  }
}

/**
 * Persists filters to localStorage and emits an update event.
 */
export function saveStoredSignalFilters(filters: SignalFilter[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
    window.dispatchEvent(new Event(FILTER_CHANGE_EVENT));
  } catch (err) {
    console.error('Failed to save signal filters to localStorage:', err);
  }
}

/**
 * Adds or updates a custom signal filter.
 */
export function upsertSignalFilter(filter: SignalFilter): void {
  const current = getStoredSignalFilters();
  const existingIdx = current.findIndex((f) => f.id === filter.id);
  let updated: SignalFilter[];
  if (existingIdx >= 0) {
    updated = [...current];
    updated[existingIdx] = filter;
  } else {
    updated = [...current, filter];
  }
  saveStoredSignalFilters(updated);
}

/**
 * Removes a custom signal filter by id.
 */
export function deleteSignalFilter(filterId: string): void {
  const current = getStoredSignalFilters();
  const updated = current.filter((f) => f.id !== filterId || f.isPreset);
  saveStoredSignalFilters(updated);
}

/**
 * React hook to access and manage signal filters reactively across components.
 */
export function useSignalFilters() {
  const [filters, setFilters] = useState<SignalFilter[]>(getStoredSignalFilters);

  useEffect(() => {
    const handleUpdate = () => {
      setFilters(getStoredSignalFilters());
    };
    window.addEventListener(FILTER_CHANGE_EVENT, handleUpdate);
    window.addEventListener('storage', handleUpdate);
    return () => {
      window.removeEventListener(FILTER_CHANGE_EVENT, handleUpdate);
      window.removeEventListener('storage', handleUpdate);
    };
  }, []);

  const toggleFilter = useCallback((filterId: string) => {
    const current = getStoredSignalFilters();
    const updated = current.map((f) => (f.id === filterId ? { ...f, enabled: !f.enabled } : f));
    saveStoredSignalFilters(updated);
  }, []);

  const addFilter = useCallback((newFilter: Omit<SignalFilter, 'createdAt'>) => {
    const full: SignalFilter = {
      ...newFilter,
      createdAt: new Date().toISOString(),
    };
    upsertSignalFilter(full);
    return full;
  }, []);

  const removeFilter = useCallback((filterId: string) => {
    deleteSignalFilter(filterId);
  }, []);

  const resetDefaults = useCallback(() => {
    saveStoredSignalFilters(DEFAULT_SIGNAL_FILTERS);
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();
    filters.forEach((f) => set.add(f.category));
    return Array.from(set).sort();
  }, [filters]);

  const enabledFilters = useMemo(() => filters.filter((f) => f.enabled), [filters]);

  return {
    filters,
    enabledFilters,
    categories,
    toggleFilter,
    addFilter,
    removeFilter,
    resetDefaults,
  };
}
