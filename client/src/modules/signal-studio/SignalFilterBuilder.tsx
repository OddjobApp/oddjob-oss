import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import {
  Filter,
  Plus,
  Trash2,
  CheckCircle2,
  SlidersHorizontal,
  Sparkles,
  Search,
  Eye,
  RefreshCw,
  Tag,
  AlertCircle,
  HelpCircle,
  FolderPlus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  useSignalFilters,
  matchesSignalFilter,
  type SignalFilter,
  type SignalFilterMatchMode,
  type AttributeCondition,
} from './signal-filters-store';

const PRESET_ICONS = ['⚠️', '🔨', '💰', '🚫', '⚖️', '🚢', '📦', '⚡', '🏢', '🛡️', '🎯', '📊', '🔍', '🚨'];

const COMMON_ATTRIBUTES = [
  { field: 'interestRate', label: 'Interest Rate (%)', defaultOp: 'less_than_or_equal', example: '3.5' },
  { field: 'remainingBalance', label: 'Remaining Balance ($)', defaultOp: 'less_than_or_equal', example: '400000' },
  { field: 'estimatedValue', label: 'Estimated Value ($)', defaultOp: 'greater_than_or_equal', example: '650000' },
  { field: 'loanType', label: 'Loan Type', defaultOp: 'equals', example: 'FHA' },
  { field: 'severity', label: 'Severity Level', defaultOp: 'equals', example: 'CRITICAL' },
  { field: 'confidenceScore', label: 'Confidence Score', defaultOp: 'greater_than_or_equal', example: '0.85' },
];

export interface SignalFilterBuilderProps {
  className?: string;
  onFilterSelected?: (filter: SignalFilter) => void;
  onOpenSpatialRadar?: () => void;
}

export function SignalFilterBuilder({
  className,
  onFilterSelected,
  onOpenSpatialRadar,
}: SignalFilterBuilderProps) {
  const { toast } = useToast();
  const { filters, enabledFilters, categories, toggleFilter, addFilter, removeFilter, resetDefaults } =
    useSignalFilters();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  // New Filter Draft State
  const [draftName, setDraftName] = useState('');
  const [draftIcon, setDraftIcon] = useState('⚠️');
  const [draftCategory, setDraftCategory] = useState('Real Estate Distress');
  const [draftDescription, setDraftDescription] = useState('');
  const [draftMode, setDraftMode] = useState<SignalFilterMatchMode>('keywords');
  const [draftKeywordsInput, setDraftKeywordsInput] = useState('');
  const [draftKeywords, setDraftKeywords] = useState<string[]>([]);
  const [draftConditions, setDraftConditions] = useState<AttributeCondition[]>([]);

  // Query live events for live matching testing
  const { data: rawEvents = [], isLoading: eventsLoading } = useQuery<any[]>({
    queryKey: ['/api/event-primitives?limit=100'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/event-primitives?limit=100');
      return res.json();
    },
  });

  // Filter Catalog Search and Category Filter
  const filteredCatalog = useMemo(() => {
    return filters.filter((f) => {
      const matchesCat = selectedCategory === 'all' || f.category === selectedCategory;
      const matchesSearch =
        !searchQuery ||
        f.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        f.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
        f.keywords.some((k) => k.toLowerCase().includes(searchQuery.toLowerCase()));
      return matchesCat && matchesSearch;
    });
  }, [filters, selectedCategory, searchQuery]);

  // Compute live match counts for each filter in catalog
  const matchCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    filters.forEach((f) => {
      const count = rawEvents.filter((ev) => {
        const text = `${ev.badge || ''} ${ev.title || ''} ${ev.eventType || ''} ${ev.summary || ''}`;
        return matchesSignalFilter(f, text, ev.payload || ev);
      }).length;
      counts[f.id] = count;
    });
    return counts;
  }, [filters, rawEvents]);

  // Live tester for the filter currently being drafted in the modal
  const liveDraftMatches = useMemo(() => {
    if (!draftName && draftKeywords.length === 0 && draftConditions.length === 0) return [];
    const testFilter: SignalFilter = {
      id: 'draft',
      label: draftName || 'Draft',
      icon: draftIcon,
      category: draftCategory,
      matchMode: draftMode,
      keywords: draftKeywords,
      attributeConditions: draftConditions,
      enabled: true,
      createdAt: '',
    };
    return rawEvents.filter((ev) => {
      const text = `${ev.badge || ''} ${ev.title || ''} ${ev.eventType || ''} ${ev.summary || ''}`;
      return matchesSignalFilter(testFilter, text, ev.payload || ev);
    });
  }, [draftName, draftIcon, draftCategory, draftMode, draftKeywords, draftConditions, rawEvents]);

  const handleAddKeyword = () => {
    const trimmed = draftKeywordsInput.trim().toLowerCase();
    if (!trimmed) return;
    if (!draftKeywords.includes(trimmed)) {
      setDraftKeywords([...draftKeywords, trimmed]);
    }
    setDraftKeywordsInput('');
  };

  const handleRemoveKeyword = (kw: string) => {
    setDraftKeywords(draftKeywords.filter((k) => k !== kw));
  };

  const handleAddCondition = () => {
    setDraftConditions([
      ...draftConditions,
      { field: 'interestRate', operator: 'less_than_or_equal', value: 4.0 },
    ]);
  };

  const handleRemoveCondition = (idx: number) => {
    setDraftConditions(draftConditions.filter((_, i) => i !== idx));
  };

  const handleCreateFilter = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draftName.trim()) {
      toast({
        title: 'Filter Name Required',
        description: 'Please give your custom signal filter a name.',
        variant: 'destructive',
      });
      return;
    }
    if (draftKeywords.length === 0 && draftConditions.length === 0) {
      toast({
        title: 'Criteria Required',
        description: 'Add at least one keyword or payload attribute condition to match signals.',
        variant: 'destructive',
      });
      return;
    }

    const id = draftName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || `filter_${Date.now()}`;
    addFilter({
      id,
      label: draftName.trim(),
      icon: draftIcon,
      category: draftCategory.trim() || 'Custom',
      description: draftDescription.trim(),
      matchMode: draftMode,
      keywords: draftKeywords,
      attributeConditions: draftConditions.length ? draftConditions : undefined,
      enabled: true,
      isPreset: false,
    });

    toast({
      title: '✨ Signal Filter Created',
      description: `"${draftName}" has been added and activated across Signal Studio and the Spatial Radar.`,
    });

    // Reset modal
    setDraftName('');
    setDraftIcon('⚠️');
    setDraftCategory('Real Estate Distress');
    setDraftDescription('');
    setDraftKeywords([]);
    setDraftConditions([]);
    setIsCreateModalOpen(false);
  };

  return (
    <div className={cn('space-y-4 p-4', className)}>
      {/* Header Banner */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-border/80 bg-card/60 p-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <SlidersHorizontal className="h-4 w-4" />
            </div>
            <h2 className="text-base font-bold text-foreground">Custom Signal Filter Builder</h2>
            <Badge variant="outline" className="border-primary/40 text-primary text-[10px]">
              {enabledFilters.length} Active / {filters.length} Total
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Author, test, and manage domain signal criteria. Custom filters instantly synchronize into the Spatial H3
            Radar, Signals Workbench, and CREW Assemblies.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {onOpenSpatialRadar && (
            <Button
              variant="outline"
              size="sm"
              onClick={onOpenSpatialRadar}
              className="text-xs h-8 border-border"
            >
              <Eye className="h-3.5 w-3.5 mr-1 text-cyan-400" />
              View on Radar
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => setIsCreateModalOpen(true)}
            className="text-xs h-8 font-semibold shadow-xs"
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Create Signal Filter
          </Button>
        </div>
      </div>

      {/* Filter Category Tabs & Search Bar */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs scrollbar-none">
          <button
            type="button"
            onClick={() => setSelectedCategory('all')}
            className={cn(
              'rounded-lg px-2.5 py-1 text-xs font-medium transition-all shrink-0 border',
              selectedCategory === 'all'
                ? 'border-primary/40 bg-primary/10 text-primary font-semibold'
                : 'border-border/60 bg-background/50 text-muted-foreground hover:bg-muted/40 hover:text-foreground'
            )}
          >
            All Categories ({filters.length})
          </button>
          {categories.map((cat) => {
            const count = filters.filter((f) => f.category === cat).length;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={cn(
                  'rounded-lg px-2.5 py-1 text-xs font-medium transition-all shrink-0 border',
                  selectedCategory === cat
                    ? 'border-primary/40 bg-primary/10 text-primary font-semibold'
                    : 'border-border/60 bg-background/50 text-muted-foreground hover:bg-muted/40 hover:text-foreground'
                )}
              >
                {cat} ({count})
              </button>
            );
          })}
        </div>

        <div className="relative w-full sm:w-64 shrink-0">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search filters, tags, keywords..."
            className="h-8 pl-8 text-xs bg-background"
          />
        </div>
      </div>

      {/* Filters Grid */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filteredCatalog.map((filter) => {
          const matchCount = matchCounts[filter.id] || 0;
          return (
            <div
              key={filter.id}
              className={cn(
                'flex flex-col justify-between rounded-xl border p-3.5 transition-all',
                filter.enabled
                  ? 'border-border/80 bg-card/70 hover:border-primary/40'
                  : 'border-border/40 bg-muted/20 opacity-70'
              )}
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xl shrink-0">{filter.icon}</span>
                    <div>
                      <h4 className="text-xs font-semibold text-foreground leading-tight">{filter.label}</h4>
                      <span className="text-[10px] text-muted-foreground">{filter.category}</span>
                    </div>
                  </div>
                  <Switch
                    checked={filter.enabled}
                    onCheckedChange={() => toggleFilter(filter.id)}
                    aria-label={`Toggle ${filter.label}`}
                  />
                </div>

                {filter.description && (
                  <p className="mt-2 text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">
                    {filter.description}
                  </p>
                )}

                {/* Keywords Chips */}
                <div className="mt-2.5 flex flex-wrap gap-1">
                  {filter.keywords.map((kw) => (
                    <span
                      key={kw}
                      className="rounded bg-secondary/80 px-1.5 py-0.5 text-[9px] font-mono text-secondary-foreground"
                    >
                      "{kw}"
                    </span>
                  ))}
                  {filter.attributeConditions?.map((cond, idx) => (
                    <span
                      key={idx}
                      className="rounded bg-primary/10 border border-primary/20 px-1.5 py-0.5 text-[9px] font-mono text-primary"
                    >
                      {cond.field} {cond.operator === 'less_than_or_equal' ? '≤' : cond.operator === 'greater_than_or_equal' ? '≥' : '='} {cond.value}
                    </span>
                  ))}
                </div>
              </div>

              {/* Card Footer */}
              <div className="mt-3 pt-2.5 border-t border-border/50 flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  <span className="text-[10px] text-muted-foreground">
                    Matches <strong className="text-foreground">{matchCount}</strong> live events
                  </span>
                </div>

                <div className="flex items-center gap-1">
                  {filter.isPreset ? (
                    <Badge variant="secondary" className="text-[9px] h-4 px-1">
                      Preset
                    </Badge>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeFilter(filter.id)}
                      className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                      title="Delete custom filter"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {filteredCatalog.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/80 p-8 text-center">
          <Filter className="h-8 w-8 text-muted-foreground/60 mb-2" />
          <h3 className="text-sm font-semibold text-foreground">No matching signal filters found</h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm">
            Try adjusting your search query or create a new filter to harvest signals with this criteria.
          </p>
          <Button
            size="sm"
            onClick={() => setIsCreateModalOpen(true)}
            className="mt-3 text-xs"
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Create Filter
          </Button>
        </div>
      )}

      {/* Reset Defaults Action */}
      <div className="flex justify-end pt-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={resetDefaults}
          className="text-[10px] text-muted-foreground hover:text-foreground h-6 px-2"
        >
          <RefreshCw className="h-3 w-3 mr-1" />
          Reset to Default Preset Filters
        </Button>
      </div>

      {/* ─── Create Custom Filter Dialog ──────────────────────────────────── */}
      <Dialog open={isCreateModalOpen} onOpenChange={setIsCreateModalOpen}>
        <DialogContent className="max-w-xl bg-card border-border shadow-2xl p-5 text-foreground max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Create Custom Signal Filter
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Define match patterns, tokens, and payload thresholds to filter signals harvested across any industry domain.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateFilter} className="space-y-4 pt-2">
            {/* Filter Name & Emoji */}
            <div className="grid grid-cols-4 gap-2">
              <div className="col-span-1">
                <label className="text-[11px] font-semibold text-muted-foreground">Icon / Badge</label>
                <div className="flex items-center gap-1 mt-1">
                  <Input
                    value={draftIcon}
                    onChange={(e) => setDraftIcon(e.target.value)}
                    className="h-8 text-center text-sm font-bold bg-background"
                    maxLength={2}
                  />
                </div>
              </div>
              <div className="col-span-3">
                <label className="text-[11px] font-semibold text-muted-foreground">Filter Name</label>
                <Input
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  placeholder="e.g. Notice of Default, Low Note Rate, AIS Drift..."
                  className="h-8 mt-1 text-xs bg-background"
                  required
                />
              </div>
            </div>

            {/* Quick Emoji Presets */}
            <div className="flex items-center gap-1 overflow-x-auto pb-1">
              <span className="text-[10px] text-muted-foreground mr-1">Presets:</span>
              {PRESET_ICONS.map((ico) => (
                <button
                  key={ico}
                  type="button"
                  onClick={() => setDraftIcon(ico)}
                  className={cn(
                    'h-6 w-6 rounded border text-xs flex items-center justify-center transition-colors',
                    draftIcon === ico
                      ? 'border-primary bg-primary/10'
                      : 'border-border/60 hover:bg-muted/40'
                  )}
                >
                  {ico}
                </button>
              ))}
            </div>

            {/* Category & Mode */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] font-semibold text-muted-foreground">Industry Category</label>
                <Input
                  value={draftCategory}
                  onChange={(e) => setDraftCategory(e.target.value)}
                  placeholder="Real Estate Distress, Maritime, Finance..."
                  className="h-8 mt-1 text-xs bg-background"
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-muted-foreground">Matching Strategy</label>
                <select
                  value={draftMode}
                  onChange={(e) => setDraftMode(e.target.value as SignalFilterMatchMode)}
                  className="h-8 mt-1 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground"
                >
                  <option value="keywords">Keyword / Text Tokens</option>
                  <option value="attributes">Payload Attributes (Numeric / Value)</option>
                  <option value="composite">Composite (Keywords + Attributes)</option>
                </select>
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="text-[11px] font-semibold text-muted-foreground">Description (Optional)</label>
              <Input
                value={draftDescription}
                onChange={(e) => setDraftDescription(e.target.value)}
                placeholder="What this filter identifies or operational risk it captures..."
                className="h-8 mt-1 text-xs bg-background"
              />
            </div>

            {/* Section 1: Keywords Input */}
            {(draftMode === 'keywords' || draftMode === 'composite') && (
              <div className="rounded-lg border border-border/70 bg-background/50 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <Tag className="h-3.5 w-3.5 text-primary" />
                    Target Keywords &amp; Phrases
                  </label>
                  <span className="text-[10px] text-muted-foreground">Case-insensitive substring match</span>
                </div>

                <div className="flex items-center gap-2">
                  <Input
                    value={draftKeywordsInput}
                    onChange={(e) => setDraftKeywordsInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddKeyword();
                      }
                    }}
                    placeholder="Type keyword and press Add (e.g. notice of default, lien, auction)..."
                    className="h-8 text-xs bg-background"
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleAddKeyword}
                    className="h-8 text-xs shrink-0"
                  >
                    Add
                  </Button>
                </div>

                <div className="flex flex-wrap gap-1.5 min-h-[28px] pt-1">
                  {draftKeywords.map((kw) => (
                    <span
                      key={kw}
                      className="inline-flex items-center gap-1 rounded-md bg-primary/10 border border-primary/20 px-2 py-0.5 text-xs text-primary"
                    >
                      <span>{kw}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveKeyword(kw)}
                        className="hover:text-destructive ml-0.5"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {draftKeywords.length === 0 && (
                    <span className="text-[11px] text-muted-foreground italic">
                      No keywords added yet. Type a term and press Add.
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Section 2: Attribute Conditions */}
            {(draftMode === 'attributes' || draftMode === 'composite') && (
              <div className="rounded-lg border border-border/70 bg-background/50 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <SlidersHorizontal className="h-3.5 w-3.5 text-indigo-400" />
                    Payload Field Conditions
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleAddCondition}
                    className="h-6 text-[10px] px-2"
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Add Condition
                  </Button>
                </div>

                <div className="space-y-2">
                  {draftConditions.map((cond, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-xs">
                      <Input
                        value={cond.field}
                        onChange={(e) => {
                          const updated = [...draftConditions];
                          updated[idx].field = e.target.value;
                          setDraftConditions(updated);
                        }}
                        placeholder="field (e.g. interestRate)"
                        className="h-7 text-xs bg-background flex-1"
                      />
                      <select
                        value={cond.operator}
                        onChange={(e) => {
                          const updated = [...draftConditions];
                          updated[idx].operator = e.target.value as any;
                          setDraftConditions(updated);
                        }}
                        className="h-7 rounded border border-border bg-background px-1 text-xs"
                      >
                        <option value="less_than_or_equal">≤</option>
                        <option value="greater_than_or_equal">≥</option>
                        <option value="equals">=</option>
                        <option value="contains">contains</option>
                      </select>
                      <Input
                        value={cond.value}
                        onChange={(e) => {
                          const updated = [...draftConditions];
                          updated[idx].value = e.target.value;
                          setDraftConditions(updated);
                        }}
                        placeholder="value"
                        className="h-7 text-xs bg-background flex-1"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveCondition(idx)}
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive shrink-0"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                  {draftConditions.length === 0 && (
                    <span className="text-[11px] text-muted-foreground italic">
                      No attribute conditions added. Click "+ Add Condition" to filter by loan rate, balance, etc.
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Live Tester Feedback Bar */}
            <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 p-2.5 flex items-center justify-between text-xs text-foreground">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-cyan-400 shrink-0" />
                <span>
                  Live evaluation:{' '}
                  <strong>{liveDraftMatches.length}</strong> of{' '}
                  <strong>{rawEvents.length}</strong> incoming events match this filter.
                </span>
              </div>
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsCreateModalOpen(false)}
                className="text-xs h-8"
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" className="text-xs h-8 font-semibold">
                Save &amp; Activate Filter
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default SignalFilterBuilder;
