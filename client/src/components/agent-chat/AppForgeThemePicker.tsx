import { useEffect, useState } from 'react';
import { Palette, Sparkles } from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

export interface AppForgeThemeChoice {
  designStyleId?: string;
  aiEmbellishment?: string;
}

export function AppForgeThemePicker({
  value,
  onChange,
  compact = false,
  disabled = false,
}: {
  value: AppForgeThemeChoice;
  onChange: (value: AppForgeThemeChoice) => void;
  compact?: boolean;
  disabled?: boolean;
}) {
  const [styles, setStyles] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    apiRequest('GET', '/api/apps/forge/design-catalog')
      .then((response) => response.ok ? response.json() : [])
      .then((items) => { if (active) setStyles(Array.isArray(items) ? items : []); })
      .catch(() => { if (active) setStyles([]); })
      .finally(() => { if (active) setIsLoading(false); });
    return () => { active = false; };
  }, []);

  return (
    <div className={cn('space-y-2 rounded-md border border-violet-500/20 bg-violet-500/5', compact ? 'p-2' : 'p-3')} data-testid="app-forge-theme-picker">
      <div className="flex items-center gap-1.5">
        <Palette className="h-3.5 w-3.5 text-violet-400" />
        <Label className="text-[11px] font-semibold">App Forge theme</Label>
      </div>
      <Select
        disabled={disabled || isLoading}
        value={value.designStyleId || 'preserve'}
        onValueChange={(next) => onChange({
          ...value,
          designStyleId: next === 'preserve' ? undefined : next,
          ...(next === 'preserve' ? { aiEmbellishment: undefined } : {}),
        })}
      >
        <SelectTrigger className={cn(compact && 'h-7 text-[10px]')}>
          <SelectValue placeholder={isLoading ? 'Loading themes…' : 'Choose a theme'} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="preserve">Preserve current design</SelectItem>
          {styles.map((style) => <SelectItem key={style.id} value={style.id}>{style.name}</SelectItem>)}
        </SelectContent>
      </Select>
      {value.designStyleId && (
        <div className="space-y-1">
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Sparkles className="h-3 w-3" /> Optional AI embellishment
          </div>
          <Textarea
            disabled={disabled}
            rows={compact ? 2 : 3}
            className={cn('resize-none', compact && 'min-h-12 text-[10px]')}
            value={value.aiEmbellishment || ''}
            onChange={(event) => onChange({ ...value, aiEmbellishment: event.target.value })}
            placeholder="e.g. restrained motion and warmer hospitality details"
          />
        </div>
      )}
      <p className="text-[9px] leading-relaxed text-muted-foreground">Visual-only: app behavior, content, routes, and data stay intact.</p>
    </div>
  );
}
