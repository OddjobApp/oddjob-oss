import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Check, ChevronDown, GitBranch, Layers, Play, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Pipeline {
  id: number;
  name: string;
  description?: string;
  stepCount?: number;
  lastRunAt?: string;
}

interface MultiSelectPipelinePickerProps {
  selected: number[];
  onChange: (ids: number[]) => void;
  placeholder?: string;
}

export function MultiSelectPipelinePicker({ selected, onChange, placeholder = "Select pipelines..." }: MultiSelectPipelinePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');

  const { data: pipelines = [], isLoading } = useQuery<Pipeline[]>({
    queryKey: ['/api/pipelines'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/pipelines');
      if (!res.ok) return [];
      return res.json();
    },
  });

  const filtered = pipelines.filter(p => 
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.description?.toLowerCase().includes(search.toLowerCase())
  );

  const toggle = (id: number) => {
    if (selected.includes(id)) {
      onChange(selected.filter(s => s !== id));
    } else {
      onChange([...selected, id]);
    }
  };

  const selectedNames = pipelines
    .filter(p => selected.includes(p.id))
    .map(p => p.name);

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "w-full flex items-center justify-between px-3 py-2 text-sm border rounded-md bg-background/20 transition-all",
          isOpen ? "border-primary/50 ring-1 ring-primary/20" : "border-foreground/10 hover:border-foreground/20"
        )}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <GitBranch className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className={cn("truncate", selectedNames.length === 0 && "text-foreground/40")}>
            {selectedNames.length > 0 
              ? selectedNames.join(', ') 
              : placeholder}
          </span>
        </div>
        <ChevronDown className={cn("w-4 h-4 text-foreground/40 transition-transform", isOpen && "rotate-180")} />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute z-50 w-full mt-1 bg-card border border-foreground/10 rounded-md shadow-xl overflow-hidden">
            <div className="p-2 border-b border-foreground/5">
              <div className="relative">
                <Search className="absolute left-2 top-2 w-4 h-4 text-foreground/30" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search pipelines..."
                  className="w-full pl-8 pr-3 py-1.5 text-sm bg-background/20 border border-foreground/10 rounded text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-primary/50"
                />
              </div>
            </div>

            <div className="max-h-60 overflow-y-auto">
              {isLoading ? (
                <div className="p-4 text-center text-sm text-foreground/40">Loading...</div>
              ) : filtered.length === 0 ? (
                <div className="p-4 text-center text-sm text-foreground/40">
                  {pipelines.length === 0 ? 'No pipelines found. Create one first.' : 'No matching pipelines.'}
                </div>
              ) : (
                filtered.map(pipeline => (
                  <button
                    key={pipeline.id}
                    onClick={() => toggle(pipeline.id)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-foreground/5 transition-colors",
                      selected.includes(pipeline.id) && "bg-primary/10"
                    )}
                  >
                    <div className={cn(
                      "w-4 h-4 rounded border flex items-center justify-center transition-all",
                      selected.includes(pipeline.id) ? "bg-primary border-primary" : "border-foreground/20"
                    )}>
                      {selected.includes(pipeline.id) && <Check className="w-3 h-3 text-background" />}
                    </div>
                    <div className="w-8 h-8 rounded bg-emerald-500/10 flex items-center justify-center shrink-0">
                      <Layers className="w-4 h-4 text-emerald-400" />
                    </div>
                    <div className="flex-1 text-left">
                      <div className="font-medium">{pipeline.name}</div>
                      {pipeline.description && (
                        <div className="text-xs text-foreground/40 truncate">{pipeline.description}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-foreground/30">
                      {pipeline.stepCount && (
                        <span className="flex items-center gap-1">
                          <Play className="w-3 h-3" /> {pipeline.stepCount} steps
                        </span>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>

            {selected.length > 0 && (
              <div className="p-2 border-t border-foreground/5 flex items-center justify-between">
                <span className="text-xs text-foreground/40">{selected.length} selected</span>
                <button 
                  onClick={() => onChange([])}
                  className="text-xs text-rose-400 hover:text-rose-700 dark:text-rose-300 flex items-center gap-1"
                >
                  <X className="w-3 h-3" /> Clear all
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
