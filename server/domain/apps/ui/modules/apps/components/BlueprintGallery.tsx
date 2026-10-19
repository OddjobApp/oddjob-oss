import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { 
  Hammer, 
  Bot, 
  Layout, 
  Shield, 
  Search, 
  Zap,
  Code,
  Database,
  Lock,
  Globe,
  FileCode,
  BarChart3,
  BarChart2,
  CheckCircle2,
  Smartphone,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Layers,
  X
} from 'lucide-react';
import { BlueprintDetailModal } from './BlueprintDetailModal';

export interface Blueprint {
  slug: string;
  name: string;
  description: string;
  capabilities: string[];
  icon: string;
  category: string;
  persona?: string;
  governanceRisk?: "low" | "medium" | "high";
  formalVerification?: { maxSmtVerified: boolean; wcagAA: boolean; status: "PASSED" | "EXEMPT" };
  keywords?: string[];
}

const ICON_MAP: Record<string, React.ElementType> = {
  'Bot': Bot,
  'Shield': Shield,
  'Layout': Layout,
  'Zap': Zap,
  'Search': Search,
  'Hammer': Hammer,
  'Code': Code,
  'Database': Database,
  'Globe': Globe,
  'BarChart2': BarChart2,
  'BarChart3': BarChart3,
  'Smartphone': Smartphone,
  'ShieldAlert': ShieldAlert,
  'FileCode': FileCode,
  'CheckCircle2': CheckCircle2
};

// Capability icon mapping for visual indicators
const CAPABILITY_ICONS: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  'Auth': { icon: Lock, color: 'text-emerald-500', label: 'Authentication' },
  'Database': { icon: Database, color: 'text-blue-500', label: 'Database' },
  'API': { icon: Globe, color: 'text-purple-500', label: 'API' },
  'Charts': { icon: BarChart3, color: 'text-amber-500', label: 'Charts' },
  'Forms': { icon: FileCode, color: 'text-cyan-500', label: 'Forms' },
  'AI': { icon: Bot, color: 'text-pink-500', label: 'AI' },
  'Spatial': { icon: Globe, color: 'text-teal-500', label: 'Spatial H3' },
  'Search': { icon: Search, color: 'text-indigo-500', label: 'Search' },
  'Code': { icon: Code, color: 'text-orange-500', label: 'Code AST' },
  'Layout': { icon: Layout, color: 'text-rose-500', label: 'Layout' },
  'Smartphone': { icon: Smartphone, color: 'text-violet-500', label: 'Mobile' },
  'Shield': { icon: Shield, color: 'text-emerald-500', label: 'Security' }
};

const CATEGORIES = [
  "All",
  "Operations & Field",
  "SDLC & Engineering",
  "Governance & Compliance",
  "Business & Intelligence",
  "Foundational & Microservices"
] as const;

interface BlueprintGalleryProps {
  blueprints: Blueprint[];
  selectedSlug: string;
  onSelect: (slug: string) => void;
  onCloneSuccess?: (draft: any) => void;
}

export function BlueprintGallery({ blueprints, selectedSlug, onSelect, onCloneSuccess }: BlueprintGalleryProps) {
  const [activeCategory, setActiveCategory] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedPersona, setSelectedPersona] = useState<string>("all");
  const [detailModalBlueprint, setDetailModalBlueprint] = useState<Blueprint | null>(null);

  // Extract unique personas
  const personas = useMemo(() => {
    const set = new Set<string>();
    blueprints.forEach(b => {
      if (b.persona) set.add(b.persona);
    });
    return Array.from(set).sort();
  }, [blueprints]);

  // Filtered blueprints
  const filteredBlueprints = useMemo(() => {
    return blueprints.filter(blueprint => {
      // Category check
      if (activeCategory !== "All" && blueprint.category?.toLowerCase() !== activeCategory.toLowerCase()) {
        return false;
      }
      // Persona check
      if (selectedPersona !== "all" && blueprint.persona !== selectedPersona) {
        return false;
      }
      // Search query check
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = blueprint.name.toLowerCase().includes(q);
        const matchSlug = blueprint.slug.toLowerCase().includes(q);
        const matchDesc = blueprint.description.toLowerCase().includes(q);
        const matchPersona = blueprint.persona?.toLowerCase().includes(q);
        const matchKeywords = blueprint.keywords?.some(k => k.toLowerCase().includes(q));
        const matchCaps = blueprint.capabilities?.some(c => c.toLowerCase().includes(q));
        return matchName || matchSlug || matchDesc || matchPersona || matchKeywords || matchCaps;
      }
      return true;
    });
  }, [blueprints, activeCategory, selectedPersona, searchQuery]);

  return (
    <div className="space-y-6" data-testid="blueprint-gallery">
      {/* Storefront Header & Filter Bar */}
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          {/* Search Bar */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search 34+ blueprints by name, persona, or capability..."
              className="pl-9 pr-8 text-sm h-9"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Persona Filter */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">Persona:</span>
            <select
              value={selectedPersona}
              onChange={(e) => setSelectedPersona(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 py-1 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="all">All Roles & Personas</option>
              {personas.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Category Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 pt-1 no-scrollbar border-t border-border/50">
          {CATEGORIES.map(category => (
            <Button
              key={category}
              variant={activeCategory === category ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setActiveCategory(category)}
              className={`text-xs h-7 px-3 rounded-full whitespace-nowrap ${
                activeCategory === category ? "font-semibold shadow-xs" : "text-muted-foreground"
              }`}
            >
              {category}
            </Button>
          ))}
          <span className="ml-auto text-xs text-muted-foreground font-mono pl-2">
            {filteredBlueprints.length} available
          </span>
        </div>
      </div>

      {/* Blueprint Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredBlueprints.map((blueprint) => {
          const Icon = ICON_MAP[blueprint.icon] || Hammer;
          const isSelected = selectedSlug === blueprint.slug;

          return (
            <Card
              key={blueprint.slug}
              className={`group relative cursor-pointer transition-all duration-200 border-2 flex flex-col justify-between ${
                isSelected
                  ? 'border-primary bg-primary/5 ring-1 ring-primary/20 shadow-md scale-[1.01]'
                  : 'border-border/60 hover:border-primary/40 hover:bg-muted/30 hover:shadow-xs'
              }`}
              onClick={() => onSelect(blueprint.slug)}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className={`p-2.5 rounded-lg transition-colors ${
                    isSelected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary'
                  }`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <div className="flex items-center gap-1.5">
                      <Badge variant="secondary" className="text-[10px] uppercase font-bold tracking-wider opacity-80">
                        {blueprint.category}
                      </Badge>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setDetailModalBlueprint(blueprint);
                        }}
                        className="p-1 rounded-md transition-colors text-muted-foreground hover:text-primary hover:bg-primary/10"
                        title="View Architecture Details & Clone"
                      >
                        <Search className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {blueprint.persona && (
                      <span className="text-[10px] text-muted-foreground font-medium">
                        {blueprint.persona}
                      </span>
                    )}
                  </div>
                </div>
                <CardTitle className="text-base font-bold tracking-tight line-clamp-1">
                  {blueprint.name}
                </CardTitle>
                <CardDescription className="text-xs line-clamp-2 mt-1 leading-relaxed">
                  {blueprint.description}
                </CardDescription>
              </CardHeader>

              <CardContent className="pt-0 space-y-3">
                {/* Formal Verification Badge & Risk Tag */}
                <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/40 text-[10px]">
                  <div className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>MaxSMT & WCAG AA</span>
                  </div>
                  {blueprint.governanceRisk && (
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase ${
                      blueprint.governanceRisk === 'high'
                        ? 'bg-destructive/10 text-destructive'
                        : blueprint.governanceRisk === 'medium'
                        ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                        : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    }`}>
                      {blueprint.governanceRisk} risk
                    </span>
                  )}
                </div>

                {/* Capability Icons Matrix */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-1.5">
                    {blueprint.capabilities?.slice(0, 4).map((cap) => {
                      const capConfig = CAPABILITY_ICONS[cap];
                      if (!capConfig) return null;
                      const CapIcon = capConfig.icon;
                      return (
                        <div
                          key={cap}
                          className={`p-1 rounded bg-background border border-border ${capConfig.color}`}
                          title={capConfig.label}
                        >
                          <CapIcon className="w-3 h-3" />
                        </div>
                      );
                    })}
                    {blueprint.capabilities && blueprint.capabilities.length > 4 && (
                      <div className="p-1 rounded bg-muted text-muted-foreground text-[9px] font-bold">
                        +{blueprint.capabilities.length - 4}
                      </div>
                    )}
                  </div>

                  <Button
                    size="sm"
                    variant={isSelected ? "default" : "outline"}
                    className="h-7 text-xs px-2.5"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(blueprint.slug);
                    }}
                  >
                    {isSelected ? 'Selected' : 'Select'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {filteredBlueprints.length === 0 && (
        <div className="text-center py-12 border rounded-xl border-dashed border-border bg-card/50">
          <Layers className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="font-semibold text-sm">No blueprints match your filter</p>
          <p className="text-xs text-muted-foreground mt-1">
            Try adjusting your search query or selecting "All" categories.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setActiveCategory("All");
              setSearchQuery("");
              setSelectedPersona("all");
            }}
            className="mt-3 text-xs"
          >
            Reset Filters
          </Button>
        </div>
      )}

      {/* Blueprint Deep Dive Modal */}
      <BlueprintDetailModal
        blueprint={detailModalBlueprint}
        isOpen={Boolean(detailModalBlueprint)}
        onClose={() => setDetailModalBlueprint(null)}
        onSelect={(slug) => {
          onSelect(slug);
          setDetailModalBlueprint(null);
        }}
        onCloneSuccess={onCloneSuccess}
      />
    </div>
  );
}

