import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Loader2, Search, Check, Palette, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

interface ForgeDesignStyle {
    id: string;
    name: string;
    author: string;
    tags: string[];
    tagline: string;
}

interface ForgeStyleGalleryProps {
    selectedStyleId?: string;
    onSelect: (styleId: string | undefined) => void;
}

// All unique tags from the catalog (pre-computed for UX speed)
const ALL_TAGS = [
    'Dark', 'Minimal', 'Bold', 'Warm', 'Cool', 'Serif', 'Sans', 'Mono',
    'Playful', 'Editorial', 'Technical', 'Organic', 'Corporate', 'Soft',
    'Finance', 'Healthcare', 'Gameplay', 'Fashion', 'Food', 'Travel',
];

// A deterministic color function for tags
const TAG_COLORS: Record<string, string> = {
    Dark: 'bg-muted text-foreground border-border',
    Minimal: 'bg-muted/60 text-foreground border-border',
    Bold: 'bg-red-900/40 text-red-300 border-red-800',
    Warm: 'bg-amber-900/40 text-amber-300 border-amber-800',
    Cool: 'bg-sky-900/40 text-sky-300 border-sky-800',
    Serif: 'bg-muted/60 text-foreground border-border',
    Sans: 'bg-muted/60 text-foreground border-border',
    Mono: 'bg-green-900/40 text-green-300 border-green-800',
    Playful: 'bg-purple-900/40 text-purple-300 border-purple-800',
    Editorial: 'bg-teal-900/40 text-teal-300 border-teal-800',
    Technical: 'bg-blue-900/40 text-blue-300 border-blue-800',
    Organic: 'bg-lime-900/40 text-lime-300 border-lime-800',
    Corporate: 'bg-indigo-900/40 text-indigo-300 border-indigo-800',
    Soft: 'bg-pink-900/40 text-pink-300 border-pink-800',
    Finance: 'bg-emerald-900/40 text-emerald-300 border-emerald-800',
    Healthcare: 'bg-cyan-900/40 text-cyan-300 border-cyan-800',
    Gameplay: 'bg-violet-900/40 text-violet-300 border-violet-800',
    Fashion: 'bg-rose-900/40 text-rose-300 border-rose-800',
    Food: 'bg-orange-900/40 text-orange-300 border-orange-800',
    Travel: 'bg-blue-800/40 text-blue-200 border-blue-700',
};

// Derive 5 preview swatches from a style's parsed tokens (fetched lazily, or estimated from tagline+tags)
// We use a small palette heuristic based on the style's tags when full tokens aren't loaded
function getPaletteEstimate(style: ForgeDesignStyle): string[] {
    const tags = style.tags.map(t => t.toLowerCase());
    if (tags.includes('dark')) return ['#0d0d0f', '#1a1a1f', '#3b3b4f', '#8888aa', '#6366f1'];
    if (tags.includes('warm') && tags.includes('serif')) return ['#faf5eb', '#e8d9b5', '#c4a35a', '#7b5c2a', '#d97706'];
    if (tags.includes('cool') && tags.includes('minimal')) return ['#f8fafc', '#e2e8f0', '#94a3b8', '#3b82f6', '#1e40af'];
    if (tags.includes('bold') && tags.includes('primary')) return ['#ffffff', '#f8fafc', '#ef4444', '#facc15', '#3b82f6'];
    if (tags.includes('mono') || tags.includes('technical')) return ['#0d1117', '#161b22', '#21262d', '#3fb950', '#8b949e'];
    if (tags.includes('warm') && tags.includes('organic')) return ['#fdf6ec', '#e8cfa0', '#b5713a', '#7a4528', '#c4622a'];
    if (tags.includes('soft') && tags.includes('playful')) return ['#fff0f6', '#ffd6e7', '#ff8fab', '#c77dff', '#7b2d8b'];
    if (tags.includes('finance') || tags.includes('corporate')) return ['#0a0a14', '#1a1a2e', '#16213e', '#0f3460', '#e94560'];
    return ['#f9fafb', '#f3f4f6', '#e5e7eb', '#6b7280', '#2563eb'];
}

export function ForgeStyleGallery({ selectedStyleId, onSelect }: ForgeStyleGalleryProps) {
    const [search, setSearch] = useState('');
    const [activeTag, setActiveTag] = useState<string | null>(null);

    const { data: styles = [], isLoading } = useQuery<ForgeDesignStyle[]>({
        queryKey: ['/api/apps/forge/design-catalog'],
        queryFn: async () => {
            const res = await apiRequest('GET', '/api/apps/forge/design-catalog');
            return res.json();
        },
        staleTime: 3600_000, // 1 hour
    });

    const filtered = useMemo(() => {
        return styles.filter(s => {
            const matchesSearch = !search ||
                s.name.toLowerCase().includes(search.toLowerCase()) ||
                s.tagline.toLowerCase().includes(search.toLowerCase());
            const matchesTag = !activeTag || s.tags.some(t => t.toLowerCase() === activeTag.toLowerCase());
            return matchesSearch && matchesTag;
        });
    }, [styles, search, activeTag]);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-12 gap-3 text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-sm font-medium">Loading 120+ design identities...</span>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Search + Clear */}
            <div className="flex items-center gap-3">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                    <Input
                        id="style-search"
                        placeholder="Search styles... (terminal, bauhaus, neon arcade...)"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="pl-9 bg-foreground/5 border-foreground/10 text-sm"
                    />
                </div>
                {selectedStyleId && (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onSelect(undefined)}
                        className="gap-1.5 text-muted-foreground hover:text-destructive shrink-0"
                    >
                        <X className="w-3.5 h-3.5" />
                        Clear
                    </Button>
                )}
            </div>

            {/* Tag Filters */}
            <div className="flex flex-wrap gap-1.5">
                {ALL_TAGS.map(tag => (
                    <button
                        key={tag}
                        onClick={() => setActiveTag(prev => prev === tag ? null : tag)}
                        className={cn(
                            'px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border transition-all',
                            activeTag === tag
                                ? 'bg-primary/20 text-primary border-primary/40 shadow-[0_0_8px_rgba(var(--primary),0.3)]'
                                : (TAG_COLORS[tag] || 'bg-foreground/5 text-muted-foreground border-foreground/10 hover:bg-foreground/10')
                        )}
                    >
                        {tag}
                    </button>
                ))}
            </div>

            {/* Results Count */}
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">
                {filtered.length} style{filtered.length !== 1 ? 's' : ''} available
                {selectedStyleId && (
                    <span className="ml-2 text-primary">
                        · {styles.find(s => s.id === selectedStyleId)?.name} selected
                    </span>
                )}
            </div>

            {/* Style Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 max-h-[480px] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-white/10">
                <AnimatePresence mode="popLayout">
                    {filtered.map((style, i) => {
                        const swatches = getPaletteEstimate(style);
                        const isSelected = style.id === selectedStyleId;
                        return (
                            <motion.button
                                key={style.id}
                                layout
                                initial={{ opacity: 0, scale: 0.96 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.94 }}
                                transition={{ delay: Math.min(i * 0.02, 0.2), duration: 0.15 }}
                                onClick={() => onSelect(isSelected ? undefined : style.id)}
                                className={cn(
                                    'relative p-3.5 rounded-xl border text-left transition-all duration-200 group',
                                    isSelected
                                        ? 'bg-primary/10 border-primary/50 shadow-[0_0_16px_rgba(var(--primary),0.2)]'
                                        : 'bg-foreground/3 border-foreground/8 hover:bg-foreground/6 hover:border-foreground/20'
                                )}
                            >
                                {/* Selected indicator */}
                                {isSelected && (
                                    <div className="absolute top-2.5 right-2.5 w-5 h-5 rounded-full bg-primary flex items-center justify-center shadow-md">
                                        <Check className="w-3 h-3 text-foreground" />
                                    </div>
                                )}

                                {/* Color Swatches */}
                                <div className="flex gap-1 mb-3">
                                    {swatches.map((color, ci) => (
                                        <div
                                            key={ci}
                                            className="flex-1 h-6 rounded-md border border-foreground/10 transition-transform group-hover:scale-y-110"
                                            style={{ backgroundColor: color }}
                                            title={color}
                                        />
                                    ))}
                                </div>

                                {/* Name + Tagline */}
                                <div className="mb-2">
                                    <div className={cn(
                                        "text-sm font-bold tracking-tight leading-none mb-1 transition-colors",
                                        isSelected ? "text-primary" : "text-foreground group-hover:text-primary/80"
                                    )}>
                                        {style.name}
                                    </div>
                                    <div className="text-[11px] text-muted-foreground font-medium leading-snug line-clamp-1">
                                        {style.tagline}
                                    </div>
                                </div>

                                {/* Tags */}
                                <div className="flex flex-wrap gap-1">
                                    {style.tags.slice(0, 3).map(tag => (
                                        <span
                                            key={tag}
                                            className={cn(
                                                'px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border',
                                                TAG_COLORS[tag] || 'bg-foreground/5 text-muted-foreground border-foreground/10'
                                            )}
                                        >
                                            {tag}
                                        </span>
                                    ))}
                                </div>
                            </motion.button>
                        );
                    })}
                </AnimatePresence>

                {filtered.length === 0 && (
                    <div className="col-span-full py-12 text-center text-muted-foreground">
                        <Palette className="w-10 h-10 mx-auto mb-3 opacity-20" />
                        <p className="text-sm font-medium">No styles match your filters.</p>
                        <button onClick={() => { setSearch(''); setActiveTag(null); }} className="text-xs text-primary mt-2 hover:underline">Clear filters</button>
                    </div>
                )}
            </div>
        </div>
    );
}
