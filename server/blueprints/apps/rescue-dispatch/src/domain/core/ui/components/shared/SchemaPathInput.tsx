import { useState, useRef, useEffect } from 'react';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import {
  findSchemaSuggestions,
  getTypeBadgeVariant,
  type PathSuggestion
} from '@/utils/schema-path-autocomplete';
import type { JobOutputSchema } from "@shared/schema/jobs/types";
import { ChevronRight, Key } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SchemaPathInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  schema?: JobOutputSchema | null;
  className?: string;
  readOnly?: boolean;
}

export default function SchemaPathInput({
  value,
  onChange,
  placeholder = "e.g., step.0.output.category",
  schema,
  className,
  readOnly,
}: SchemaPathInputProps) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [suggestions, setSuggestions] = useState<PathSuggestion[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Update suggestions when value or schema changes
  useEffect(() => {
    if (!schema || !showSuggestions) {
      setSuggestions([]);
      return;
    }

    const newSuggestions = findSchemaSuggestions(schema, value);
    setSuggestions(newSuggestions);
    setSelectedIndex(0);
  }, [value, schema, showSuggestions]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    onChange(newValue);
    setShowSuggestions(true);
  };

  const handleInputFocus = () => {
    if (schema) {
      setShowSuggestions(true);
    }
  };

  const handleInputBlur = (e: React.FocusEvent) => {
    // Delay hiding to allow clicking on suggestions
    setTimeout(() => {
      if (!suggestionsRef.current?.contains(document.activeElement)) {
        setShowSuggestions(false);
      }
    }, 200);
  };

  const handleSuggestionSelect = (suggestion: PathSuggestion) => {
    onChange(suggestion.path + '.');
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showSuggestions || suggestions.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev < suggestions.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : 0));
        break;
      case 'Enter':
      case 'Tab':
        e.preventDefault();
        if (suggestions[selectedIndex]) {
          handleSuggestionSelect(suggestions[selectedIndex]);
        }
        break;
      case 'Escape':
        setShowSuggestions(false);
        break;
    }
  };

  // Scroll selected suggestion into view
  useEffect(() => {
    if (showSuggestions && suggestionsRef.current) {
      const selectedElement = suggestionsRef.current.querySelector(
        `[data-suggestion-index="${selectedIndex}"]`
      );
      selectedElement?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex, showSuggestions]);

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        value={value}
        onChange={handleInputChange}
        onFocus={handleInputFocus}
        onBlur={handleInputBlur}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={className}
        disabled={readOnly}
      />

      {showSuggestions && suggestions.length > 0 && (
        <div
          ref={suggestionsRef}
          className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-lg max-h-60 overflow-auto"
          onMouseDown={(e) => e.preventDefault()} // Prevent input blur
        >
          <div className="p-1">
            {suggestions.map((suggestion, index) => (
              <div
                key={suggestion.fullPath}
                data-suggestion-index={index}
                className={cn(
                  "flex items-center justify-between rounded-sm px-2 py-1.5 text-sm cursor-pointer",
                  "hover:bg-accent hover:text-accent-foreground",
                  index === selectedIndex && "bg-accent text-accent-foreground"
                )}
                onClick={() => handleSuggestionSelect(suggestion)}
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <ChevronRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                  <span className="font-mono text-xs truncate">
                    {suggestion.displayPath}
                  </span>
                  {suggestion.fieldDef.isKey && (
                    <Key className="h-3 w-3 text-yellow-600 flex-shrink-0" />
                  )}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Badge
                    variant="outline"
                    className={cn("text-xs", getTypeBadgeVariant(suggestion.fieldDef.type))}
                  >
                    {suggestion.fieldDef.type}
                  </Badge>
                  {suggestion.fieldDef.required && (
                    <Badge variant="outline" className="text-xs text-red-600">
                      required
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
          {suggestions.length > 0 && (
            <div className="border-t px-2 py-1 text-xs text-muted-foreground">
              Use ↑↓ to navigate, Enter to select, Esc to close
            </div>
          )}
        </div>
      )}

      {showSuggestions && suggestions.length === 0 && schema && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-lg p-2 text-sm text-muted-foreground">
          No matching fields found
        </div>
      )}
    </div>
  );
}

