import React, { useState, useRef, useCallback } from 'react';
import { X, Plus, Database } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';

interface TagInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  suggestionSource?: 'datasets' | 'none';
  maxTags?: number;
}

export function TagInput({ 
  value, 
  onChange, 
  placeholder = "Type and press Enter...", 
  suggestionSource = 'none',
  maxTags = 10
}: TagInputProps) {
  const [input, setInput] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch existing collection names for suggestions
  const { data: suggestions = [] } = useQuery<string[]>({
    queryKey: ['/api/datasets/collections'],
    queryFn: async () => {
      if (suggestionSource !== 'datasets') return [];
      const res = await apiRequest('GET', '/api/datasets/collections');
      if (!res.ok) return [];
      return res.json();
    },
    enabled: suggestionSource === 'datasets' && showSuggestions,
  });

  const filteredSuggestions = suggestions.filter(s => 
    s.toLowerCase().includes(input.toLowerCase()) && !value.includes(s)
  ).slice(0, 5);

  const addTag = useCallback((tag: string) => {
    const trimmed = tag.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (trimmed && !value.includes(trimmed) && value.length < maxTags) {
      onChange([...value, trimmed]);
    }
    setInput('');
    setShowSuggestions(false);
  }, [value, onChange, maxTags]);

  const removeTag = useCallback((tag: string) => {
    onChange(value.filter(v => v !== tag));
  }, [value, onChange]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (input.trim()) addTag(input);
    } else if (e.key === 'Backspace' && !input && value.length > 0) {
      removeTag(value[value.length - 1]);
    }
  };

  return (
    <div className="relative">
      <div 
        onClick={() => inputRef.current?.focus()}
        className={cn(
          "min-h-[38px] flex flex-wrap items-center gap-1.5 p-1.5 border rounded-md bg-background/20 cursor-text transition-all",
          "border-foreground/10 hover:border-foreground/20 focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20"
        )}
      >
        {value.map(tag => (
          <span 
            key={tag} 
            className="flex items-center gap-1 px-2 py-0.5 text-xs bg-primary/10 text-primary border border-primary/20 rounded-md"
          >
            <Database className="w-3 h-3" />
            {tag}
            <button
              title="Remove tag"
              onClick={(e) => { e.stopPropagation(); removeTag(tag); }}
              className="hover:text-rose-400 transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        
        <input
          ref={inputRef}
          value={input}
          onChange={e => { setInput(e.target.value); setShowSuggestions(true); }}
          onKeyDown={handleKeyDown}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
          placeholder={value.length === 0 ? placeholder : ''}
          disabled={value.length >= maxTags}
          className="flex-1 min-w-[80px] bg-transparent text-sm text-foreground placeholder:text-foreground/30 focus:outline-none px-1"
        />
        
        {value.length >= maxTags && (
          <span className="text-xs text-amber-400">Max {maxTags}</span>
        )}
      </div>

      {/* Suggestions dropdown */}
      {showSuggestions && filteredSuggestions.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-card border border-foreground/10 rounded-md shadow-xl overflow-hidden">
          <div className="py-1">
            {filteredSuggestions.map(suggestion => (
              <button
                key={suggestion}
                onClick={() => addTag(suggestion)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-foreground/5 transition-colors text-left"
              >
                <Database className="w-3.5 h-3.5 text-blue-400" />
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Quick add button when input has text */}
      {input.trim() && !value.includes(input.trim().toLowerCase()) && (
        <button
          title="Quick add tag"
          onClick={() => addTag(input)}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-xs text-primary hover:text-primary/80 transition-colors"
        >
          <Plus className="w-4 h-4" />
        </button>
      )}

      <p className="text-[10px] text-foreground/30 mt-1">
        {value.length} / {maxTags} collections{value.length > 0 && ' • lowercase letters, numbers, underscores only'}
      </p>
    </div>
  );
}
