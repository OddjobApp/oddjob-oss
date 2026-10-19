import { useCallback, useMemo, useRef, useState } from 'react';
import { Filter, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  type BulkAction,
  type FilterState,
  type IntelligenceSignal,
  type SnoozeDuration,
  type SortOption,
  severityToColor,
  sortSignals,
} from './utils';
import { BulkActionToolbar } from './BulkActionToolbar';

/**
 * SignalFeedPanel — Left-column signal list with sort, filter, multi-select,
 * and keyboard navigation.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.8, 4.9, 6.4
 */

export interface SignalFeedPanelProps {
  signals: IntelligenceSignal[];
  selectedId: string | null;
  multiSelect: Set<string>;
  sortBy: SortOption;
  filter: FilterState;
  isLoading: boolean;
  isBulkActionPending?: boolean;
  onSelect: (id: string) => void;
  onMultiSelectToggle: (id: string) => void;
  onSortChange: (sort: SortOption) => void;
  onFilterChange: (filter: FilterState) => void;
  onBulkAction: (action: BulkAction, ids: string[]) => void;
  onBulkSnooze?: (ids: string[], duration: SnoozeDuration) => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'severity', label: 'Severity' },
  { value: 'confidence', label: 'Confidence' },
  { value: 'recency', label: 'Recency' },
  { value: 'blast-radius', label: 'Blast Radius' },
];

const TIME_RANGES: { value: FilterState['timeRange']; label: string }[] = [
  { value: '1h', label: '1h' },
  { value: '4h', label: '4h' },
  { value: '12h', label: '12h' },
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: 'all', label: 'All' },
];

const SEVERITY_LEVELS = ['Critical', 'High', 'Medium', 'Low'] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Filter signals by the current FilterState. */
function applyFilters(
  signals: IntelligenceSignal[],
  filter: FilterState,
): IntelligenceSignal[] {
  return signals.filter((signal) => {
    // Kind filter
    if (filter.kind !== 'all' && signal.kind !== filter.kind) return false;

    // Text query
    if (
      filter.query &&
      !signal.title.toLowerCase().includes(filter.query.toLowerCase())
    )
      return false;

    // Severity filter
    if (
      filter.severities.size > 0 &&
      !filter.severities.has(signal.event.severity)
    )
      return false;

    // Confidence threshold
    if (signal.event.confidenceScore * 100 < filter.minConfidence) return false;

    // Time range filter
    const now = Date.now();
    const extractionTime = new Date(
      signal.event.extractionTimestamp,
    ).getTime();
    const rangeMs = timeRangeToMs(filter.timeRange);
    if (now - extractionTime > rangeMs) return false;

    return true;
  });
}

function timeRangeToMs(range: FilterState['timeRange']): number {
  switch (range) {
    case '1h':
      return 3_600_000;
    case '4h':
      return 14_400_000;
    case '12h':
      return 43_200_000;
    case '24h':
      return 86_400_000;
    case '7d':
      return 604_800_000;
    case 'all':
      return Number.POSITIVE_INFINITY;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SignalFeedPanel({
  signals,
  selectedId,
  multiSelect,
  sortBy,
  filter,
  isLoading,
  isBulkActionPending = false,
  onSelect,
  onMultiSelectToggle,
  onSortChange,
  onFilterChange,
  onBulkAction,
  onBulkSnooze,
}: SignalFeedPanelProps) {
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const [showFilters, setShowFilters] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Apply filters then sort
  const visibleSignals = useMemo(() => {
    const filtered = applyFilters(signals, filter);
    const selected = selectedId ? signals.find((signal) => signal.id === selectedId) : undefined;
    if (selected && !filtered.some((signal) => signal.id === selected.id)) filtered.unshift(selected);
    return sortSignals(filtered, sortBy);
  }, [signals, filter, sortBy, selectedId]);

  const activeFilterCount =
    (filter.kind !== 'all' ? 1 : 0) +
    (filter.query ? 1 : 0) +
    filter.severities.size +
    (filter.minConfidence > 0 ? 1 : 0) +
    (filter.timeRange !== 'all' ? 1 : 0);

  const clearFilters = useCallback(() => {
    onFilterChange({
      kind: 'all',
      query: '',
      severities: new Set<string>(),
      minConfidence: 0,
      timeRange: 'all',
    });
  }, [onFilterChange]);

  // ─── Keyboard Navigation (Req 4.8) ───────────────────────────────────────

  const handleListKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const count = visibleSignals.length;
      if (count === 0) return;

      let nextIndex = focusedIndex;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          nextIndex = focusedIndex < count - 1 ? focusedIndex + 1 : 0;
          break;
        case 'ArrowUp':
          e.preventDefault();
          nextIndex = focusedIndex > 0 ? focusedIndex - 1 : count - 1;
          break;
        case 'Enter':
          e.preventDefault();
          if (focusedIndex >= 0 && focusedIndex < count) {
            onSelect(visibleSignals[focusedIndex].id);
          }
          return;
        case 'Escape':
          e.preventDefault();
          setFocusedIndex(-1);
          return;
        default:
          return;
      }

      setFocusedIndex(nextIndex);
      itemRefs.current[nextIndex]?.focus();
    },
    [focusedIndex, visibleSignals, onSelect],
  );

  // ─── Filter Handlers ──────────────────────────────────────────────────────

  const handleQueryChange = useCallback(
    (query: string) => {
      onFilterChange({ ...filter, query });
    },
    [filter, onFilterChange],
  );

  const handleKindChange = useCallback(
    (kind: FilterState['kind']) => {
      onFilterChange({ ...filter, kind });
    },
    [filter, onFilterChange],
  );

  const handleSeverityToggle = useCallback(
    (severity: string) => {
      const next = new Set(filter.severities);
      if (next.has(severity)) {
        next.delete(severity);
      } else {
        next.add(severity);
      }
      onFilterChange({ ...filter, severities: next });
    },
    [filter, onFilterChange],
  );

  const handleConfidenceChange = useCallback(
    (value: number) => {
      onFilterChange({ ...filter, minConfidence: value });
    },
    [filter, onFilterChange],
  );

  const handleTimeRangeChange = useCallback(
    (timeRange: FilterState['timeRange']) => {
      onFilterChange({ ...filter, timeRange });
    },
    [filter, onFilterChange],
  );

  return (
    <aside
      className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card/35"
      aria-label="Signal Feed"
    >
      {/* ─── Header ──────────────────────────────────────────────────────── */}
      <div className="border-b border-border p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Signal Feed</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {visibleSignals.length} of {signals.length} visible · ranked by impact
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            className={cn(
              'relative flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              showFilters || activeFilterCount > 0
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-border bg-background/50 text-muted-foreground hover:bg-accent',
            )}
            aria-label="Toggle filters"
            title={activeFilterCount ? `${activeFilterCount} active filter${activeFilterCount === 1 ? '' : 's'}` : 'Filters'}
            aria-expanded={showFilters}
            aria-pressed={showFilters}
          >
            <Filter className="h-4 w-4" />
            {activeFilterCount > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        {/* Search */}
        <label className="mt-3 flex min-h-[40px] items-center gap-2 rounded-lg border border-border bg-background/60 px-3 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20">
          <span className="sr-only">Search signals</span>
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={filter.query}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder="Search signals"
            className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          />
        </label>

        {/* Kind filter tabs (Req 6.4) */}
        <div
          className="mt-3 flex gap-1"
          role="tablist"
          aria-label="Signal type filter"
        >
          {(['all', 'opportunity', 'threat'] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => handleKindChange(kind)}
              className={cn(
                'flex-1 rounded-md px-2 py-1.5 text-[11px] font-medium capitalize',
                filter.kind === kind
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              role="tab"
              aria-selected={filter.kind === kind}
            >
              {kind}
            </button>
          ))}
        </div>

        {/* Sort control (Req 4.1) */}
        <div className="mt-3 flex items-center gap-2">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Sort
          </span>
          <select
            value={sortBy}
            onChange={(e) => onSortChange(e.target.value as SortOption)}
            className="h-7 flex-1 rounded-md border border-border bg-background/60 px-2 text-xs outline-none focus:ring-2 focus:ring-ring"
            aria-label="Sort signals by"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex min-h-[32px] items-center gap-1 rounded-md px-2 text-[10px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Clear all signal filters"
            >
              <X className="h-3 w-3" /> Clear
            </button>
          )}
        </div>
      </div>

      {/* ─── Expanded Filters Panel (Req 4.9) ───────────────────────────── */}
      {showFilters && (
        <div className="border-b border-border p-3 space-y-3">
          {/* Severity Level Filter */}
          <div>
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Severity
            </span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {SEVERITY_LEVELS.map((sev) => (
                <button
                  key={sev}
                  type="button"
                  onClick={() => handleSeverityToggle(sev)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-medium transition-colors',
                    filter.severities.has(sev)
                      ? 'border-primary/50 bg-primary/10 text-foreground'
                      : 'border-border text-muted-foreground hover:text-foreground',
                  )}
                  aria-pressed={filter.severities.has(sev)}
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: severityToColor(sev) }}
                  />
                  {sev}
                </button>
              ))}
            </div>
          </div>

          {/* Confidence Threshold */}
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Min Confidence
              </span>
              <span className="text-[10px] font-semibold text-foreground">
                {filter.minConfidence}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={filter.minConfidence}
              onChange={(e) => handleConfidenceChange(Number(e.target.value))}
              className="mt-1.5 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-border [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
              aria-label="Minimum confidence threshold"
            />
          </div>

          {/* Time Range Filter */}
          <div>
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Time Range
            </span>
            <div
              className="mt-1.5 flex gap-1"
              role="tablist"
              aria-label="Time range filter"
            >
              {TIME_RANGES.map((range) => (
                <button
                  key={range.value}
                  type="button"
                  onClick={() => handleTimeRangeChange(range.value)}
                  className={cn(
                    'flex-1 rounded-md px-2 py-1.5 text-[10px] font-medium',
                    filter.timeRange === range.value
                      ? 'bg-accent text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                  role="tab"
                  aria-selected={filter.timeRange === range.value}
                >
                  {range.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ─── Bulk Action Toolbar (shown when multi-select active) ─────── */}
      {multiSelect.size >= 2 && (
        <BulkActionToolbar
          selectedCount={multiSelect.size}
          onDismiss={() => onBulkAction('dismiss', Array.from(multiSelect))}
          onEscalate={() => onBulkAction('escalate', Array.from(multiSelect))}
          onSnooze={(duration) => {
            if (onBulkSnooze) {
              onBulkSnooze(Array.from(multiSelect), duration);
            } else {
              onBulkAction('snooze', Array.from(multiSelect));
            }
          }}
          isPending={isBulkActionPending}
        />
      )}

      {/* ─── Signal List (Req 4.3, 4.8) ──────────────────────────────── */}
      <div
        ref={listRef}
        className="flex-1 divide-y divide-border/60 overflow-y-auto"
        role="listbox"
        aria-label="Intelligence signals"
        aria-activedescendant={
          focusedIndex >= 0
            ? `signal-item-${visibleSignals[focusedIndex]?.id}`
            : undefined
        }
        tabIndex={0}
        onKeyDown={handleListKeyDown}
      >
        {isLoading && (
          <div className="p-6 text-center text-xs text-muted-foreground">
            Loading signals…
          </div>
        )}

        {!isLoading && visibleSignals.length === 0 && (
          <div className="p-6 text-center">
            <p className="text-xs font-medium text-foreground">{signals.length ? 'No matching signals' : 'No signals yet'}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {signals.length ? 'Try a wider time range or clear the active filters.' : 'New intelligence will appear here as connected sources report events.'}
            </p>
            {activeFilterCount > 0 && (
              <button type="button" onClick={clearFilters} className="mt-3 min-h-[36px] rounded-lg border border-border px-3 text-xs font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                Clear filters
              </button>
            )}
          </div>
        )}

        {!isLoading && selectedId && signals.some((signal) => signal.id === selectedId) && !applyFilters(signals, filter).some((signal) => signal.id === selectedId) && (
          <div className="border-b border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-300">
            Selected signal is shown even though it falls outside the current filters.
          </div>
        )}

        {visibleSignals.map((signal, index) => {
          const isSelected = selectedId === signal.id;
          const isMultiSelected = multiSelect.has(signal.id);
          const isFocused = focusedIndex === index;

          return (
            <button
              key={signal.id}
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              id={`signal-item-${signal.id}`}
              type="button"
              role="option"
              aria-selected={isSelected}
              onClick={(e) => {
                if (e.ctrlKey || e.metaKey) {
                  onMultiSelectToggle(signal.id);
                } else {
                  onSelect(signal.id);
                }
              }}
              tabIndex={isFocused ? 0 : -1}
              className={cn(
                'flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-accent/50',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                isSelected && 'bg-accent/70 ring-1 ring-inset ring-primary/60',
                isMultiSelected &&
                  !isSelected &&
                  'bg-primary/5 ring-1 ring-inset ring-primary/30',
                isFocused && !isSelected && !isMultiSelected && 'bg-accent/30',
              )}
              data-testid={`signal-item-${signal.id}`}
            >
              {/* Severity colored dot (Req 4.3) */}
              <span
                className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                style={{
                  backgroundColor: severityToColor(signal.event.severity),
                }}
                aria-label={`Severity: ${signal.event.severity}`}
              />

              {/* Signal content */}
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 text-xs font-medium leading-5">
                  {signal.title}
                </span>
                <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                  {signal.subtitle}
                </span>
              </span>

              {/* Score & age */}
              <span className="text-right">
                <span className="block text-sm font-semibold">
                  {signal.score}
                </span>
                <span className="text-[9px] text-muted-foreground">
                  {signal.age}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
