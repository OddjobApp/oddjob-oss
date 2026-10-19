import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Check, ChevronDown, Database, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Dataset {
  id: number;
  name: string;
  description?: string;
  recordCount?: number;
}

interface MultiSelectDatasetPickerProps {
  selected: number[];
  onChange: (ids: number[]) => void;
  placeholder?: string;
}

export function MultiSelectDatasetPicker({ selected, onChange, placeholder = "Select datasets..." }: MultiSelectDatasetPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');

  const { data: datasets = [], isLoading } = useQuery<Dataset[]>({
    queryKey: ['/api/datasets'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/datasets');
      if (!res.ok) return [];
      return res.json();
    },
  });

  const filtered = datasets.filter(d => 
    d.name.toLowerCase().includes(search.toLowerCase()) ||
    d.description?.toLowerCase().includes(search.toLowerCase())
  );

  const toggle = (id: number) => {
    if (selected.includes(id)) {
      onChange(selected.filter(s => s !== id));
    } else {
      onChange([...selected, id]);
    }
  };

  const selectedNames = datasets
    .filter(d => selected.includes(d.id))
    .map(d => d.name);

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
          <Database className="w-4 h-4 text-blue-400 shrink-0" />
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
                  placeholder="Search datasets..."
                  className="w-full pl-8 pr-3 py-1.5 text-sm bg-background/20 border border-foreground/10 rounded text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-primary/50"
                />
              </div>
            </div>

            <div className="max-h-60 overflow-y-auto">
              {isLoading ? (
                <div className="p-4 text-center text-sm text-foreground/40">Loading...</div>
              ) : filtered.length === 0 ? (
                <div className="p-4 text-center text-sm text-foreground/40">
                  {datasets.length === 0 ? 'No datasets found. Create one first.' : 'No matching datasets.'}
                </div>
              ) : (
                filtered.map(dataset => (
                  <button
                    key={dataset.id}
                    onClick={() => toggle(dataset.id)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-foreground/5 transition-colors",
                      selected.includes(dataset.id) && "bg-primary/10"
                    )}
                  >
                    <div className={cn(
                      "w-4 h-4 rounded border flex items-center justify-center transition-all",
                      selected.includes(dataset.id) ? "bg-primary border-primary" : "border-foreground/20"
                    )}>
                      {selected.includes(dataset.id) && <Check className="w-3 h-3 text-background" />}
                    </div>
                    <div className="flex-1 text-left">
                      <div className="font-medium">{dataset.name}</div>
                      {dataset.description && (
                        <div className="text-xs text-foreground/40 truncate">{dataset.description}</div>
                      )}
                    </div>
                    {dataset.recordCount !== undefined && (
                      <div className="text-xs text-foreground/30">{dataset.recordCount.toLocaleString()} rows</div>
                    )}
                  </button>
                ))
              )}
            </div>

            {selected.length > 0 && (
              <div className="p-2 border-t border-foreground/5 flex items-center justify-between">
                <span className="text-xs text-foreground/40">{selected.length} selected</span>
                <button 
                  onClick={() => onChange([])}
                  className="text-xs text-rose-400 hover:text-rose-300 flex items-center gap-1"
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
