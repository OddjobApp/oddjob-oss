import type { SelectedWorkspaceItem } from '@shared/crew-workspace-results';

export function CrewContextTray({ items, onRemove, onClear }: {
  items: SelectedWorkspaceItem[]; onRemove: (item: SelectedWorkspaceItem) => void; onClear: () => void;
}) {
  if (!items.length) return null;
  return <section aria-label="Selected context for next message" className="mb-2 rounded-lg border border-border bg-card p-2">
    <div className="flex items-center justify-between gap-2 text-xs"><strong>Next message · {items.length} selected</strong><button type="button" className="underline" onClick={onClear}>Clear all</button></div>
    <ul className="mt-2 space-y-1">{items.map(item => <li key={`${item.turnId}:${item.tool}:${item.itemId}`} className="flex items-start gap-2 text-xs">
      <details className="min-w-0 flex-1">
        <summary className="cursor-pointer truncate" title={item.item.title}>{item.item.title}</summary>
        <div className="my-2 space-y-1 border-l border-border pl-2">
          <p className="text-muted-foreground">{item.item.platform ?? 'Source'} · {item.item.kind} · <a className="underline" href={`#turn-${item.turnId}`}>Source turn {item.turnId}</a></p>
          <p className="whitespace-pre-wrap break-words">{(item.item.preview || item.item.body || 'No saved preview. The agent will read the source before acting.').slice(0, 4000)}</p>
        </div>
      </details>
      <button type="button" className="shrink-0 rounded px-2 py-1 hover:bg-muted" aria-label={`Remove ${item.item.title} from context`} onClick={() => onRemove(item)}>×</button>
    </li>)}</ul>
    <p className="mt-2 text-xs text-muted-foreground">Selected for your next message. Room files remain available separately. Source content is read before acting; changes still require approval.</p>
  </section>;
}
