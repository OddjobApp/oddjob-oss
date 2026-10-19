import { formatCrewMoney } from '@shared/crew-money';
import { isFlightHubUrl } from '@shared/flighthub-links';
import { useState } from 'react';
import { isAmazonUrl } from '@shared/amazon-links';
import { Check, ExternalLink } from 'lucide-react';
import { GoogleWorkspaceIcon } from './GoogleWorkspaceIcon';
import { CopyButton } from '@/components/ui/copy-button';
import { crewCardCopyText } from './crew-card-copy';
import { Button } from '@/components/ui/button';
import { FinancialReportItemView } from './FinancialReportItemView';
import { CalculationItemView } from './CalculationItemView';
import { ForecastItemView } from './ForecastItemView';
import { FinancialSnapshotItemView } from './FinancialSnapshotItemView';
import { CrewCard, CrewCardFooter, CrewCardHeader } from './CrewCard';
import type { SelectedWorkspaceItem, WorkspaceContextRef, WorkspaceResultItem, WorkspaceResultPayload } from '@shared/crew-workspace-results';

function displayTime(value?: string, zone?: string) {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value} · All day`;
  try { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', ...(zone ? { timeZone: zone } : {}) }).format(new Date(value)) + (zone ? ` · ${zone}` : ''); } catch { return value; }
}
/**
 * A timed event as one range: "Oct 7, 2026, 6:00 – 7:00 PM" on one day, the
 * full second date only when it differs. All-day and open-ended items keep the
 * plain form.
 */
function eventRange(start: string, end: string | undefined, zone?: string) {
  if (!end || /^\d{4}-\d{2}-\d{2}$/.test(start) || /^\d{4}-\d{2}-\d{2}$/.test(end)) return null;
  try {
    const format = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', ...(zone ? { timeZone: zone } : {}) });
    const from = new Date(start);
    const to = new Date(end);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || typeof (format as any).formatRange !== 'function') return null;
    return (format as any).formatRange(from, to) + (zone ? ` · ${zone}` : '');
  } catch { return null; }
}
function releaseDate(value?: string) {
  if (!value) return '';
  try { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value)); } catch { return value; }
}
function formatDuration(seconds?: number) {
  if (!Number.isFinite(seconds)) return '';
  const total = Math.round(seconds ?? 0);
  const hours = Math.floor(total / 3600), minutes = Math.floor((total % 3600) / 60), rest = total % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}` : `${minutes}:${String(rest).padStart(2, '0')}`;
}
function compactCount(value?: number) {
  return Number.isFinite(value) ? new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value!) : '';
}
function openSourceWindow(event: React.MouseEvent<HTMLAnchorElement>) {
  event.preventDefault();
  window.open(event.currentTarget.href, '_blank', 'popup=yes,width=1100,height=850,noopener,noreferrer');
}
const YT_THUMBNAIL = /^https:\/\/(?:i\.ytimg\.com|i[0-9]\.ytimg\.com|yt[0-9]\.ggpht\.com)\//;
const AMZ_IMAGE = /^https:\/\/(?:[\w-]+\.)*media-amazon\.com\//;
const AMZ_URL = { test: isAmazonUrl };

/** Every "Open in …" link on a result shares one look: a small ghost button that opens a window. */
function SourceLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Button asChild variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs text-primary hover:text-primary">
    <a href={href} target="_blank" rel="noopener noreferrer" onClick={openSourceWindow}>{children}<ExternalLink className="h-3 w-3" aria-hidden /></a>
  </Button>;
}

const PRODUCT_TILE = 'flex h-24 w-24 shrink-0 self-start items-center justify-center overflow-hidden rounded-md border border-border bg-white p-1'; // theme-lint-ignore — transparent product PNGs assume a white tile

function ProductItemView({ item }: { item: WorkspaceResultItem }) {
  const image = item.thumbnailUrl && AMZ_IMAGE.test(item.thumbnailUrl) ? item.thumbnailUrl : null;
  return <div className="flex gap-3">
    {image && <div className={PRODUCT_TILE}>
      <img src={image} alt="" loading="lazy" className="max-h-full max-w-full object-contain" />
    </div>}
    <div className="min-w-0 flex-1">
      <h4 className="line-clamp-2 break-words text-sm font-semibold leading-snug">{item.title}</h4>
      {(item.brand || item.asin) && <p className="mt-0.5 truncate text-xs text-muted-foreground">{[item.brand, item.asin].filter(Boolean).join(' · ')}</p>}
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {item.priceDisplay && <span className="text-sm font-semibold">{item.currency ? formatCrewMoney(item.price ?? item.priceDisplay, item.currency) : item.priceDisplay}</span>}
        {item.listPriceDisplay && item.listPriceDisplay !== item.priceDisplay && <span className="text-xs text-muted-foreground line-through">{item.currency ? formatCrewMoney(item.listPriceDisplay, item.currency) : item.listPriceDisplay}</span>}
        {item.isPrime && <span className="rounded-sm bg-sky-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-sky-600 dark:text-sky-400">Prime</span>}
      </div>
      {(item.rating != null || item.availability) && <p className="mt-1 text-xs text-muted-foreground">
        {[item.rating != null ? `★ ${item.rating.toFixed(1)}${item.reviewCount != null ? ` (${compactCount(item.reviewCount)})` : ''}` : '', item.availability].filter(Boolean).join(' · ')}
      </p>}
      {item.preview && <p className="mt-2 line-clamp-2 break-words text-xs leading-relaxed text-muted-foreground">{item.preview}</p>}
    </div>
  </div>;
}

function FlightItemView({ item }: { item: WorkspaceResultItem }) {
  return <div className="flex gap-3">
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40">
      <GoogleWorkspaceIcon kind="flight" platform="flighthub" className="h-6 w-6" />
    </span>
    <div className="min-w-0 flex-1">
      <h4 className="flex flex-wrap items-baseline gap-x-2 break-words text-sm font-semibold leading-snug">
        {[item.originCode, item.destinationCode].filter(Boolean).join(' → ') || item.title}
        {item.priceDisplay && <span className="text-sm font-semibold text-primary">{item.currency ? formatCrewMoney(item.price ?? item.priceDisplay, item.currency) : item.priceDisplay}</span>}
      </h4>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">
        {[item.airlineName, item.flightNumbers?.length ? item.flightNumbers.join(', ') : ''].filter(Boolean).join(' · ') || item.sender}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {[item.departAt && item.arriveAt ? `${item.departAt} → ${item.arriveAt}` : item.departAt || item.arriveAt, item.durationDisplay, item.stopsDisplay, item.cabinClass].filter(Boolean).join(' · ')}
      </p>
      {item.preview && !item.departAt && <p className="mt-1 line-clamp-2 break-words text-xs text-muted-foreground">{item.preview}</p>}
    </div>
  </div>;
}

function YouTubeStat({ value, label }: { value?: number; label: string }) {
  if (!Number.isFinite(value)) return null;
  return <span className="inline-flex items-baseline gap-1 rounded-md bg-muted/60 px-2 py-1"><b className="text-xs font-semibold">{compactCount(value)}</b><span className="text-[11px] text-muted-foreground">{label}</span></span>;
}

function YouTubeItemView({ item }: { item: WorkspaceResultItem }) {
  const thumbnail = item.thumbnailUrl && YT_THUMBNAIL.test(item.thumbnailUrl) ? item.thumbnailUrl : null;
  if (item.youtubeKind === 'channel') {
    return <div>
      <div className="flex items-center gap-3">
        {thumbnail ? <img src={thumbnail} alt="" loading="lazy" className="h-14 w-14 shrink-0 rounded-full object-cover" /> : <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-muted"><GoogleWorkspaceIcon kind="video" platform="youtube" className="h-6 w-6" /></span>}
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-sm font-semibold">{item.title}</h4>
          {item.customUrl && <p className="truncate text-xs text-muted-foreground">{item.customUrl}</p>}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <YouTubeStat value={item.subscriberCount} label="subscribers" />
        <YouTubeStat value={item.videoCount} label="videos" />
        <YouTubeStat value={item.viewCount} label="views" />
      </div>
      {item.preview && <p className="mt-3 line-clamp-3 break-words text-xs leading-relaxed text-muted-foreground">{item.preview}</p>}
    </div>;
  }
  if (item.youtubeKind === 'comment') {
    return <div>
      <h4 className="break-words text-sm font-semibold">{item.title}</h4>
      <p className="mt-1 text-xs text-muted-foreground">{[item.sender, releaseDate(item.date)].filter(Boolean).join(' · ')}</p>
      {item.preview && <p className="mt-2 line-clamp-4 break-words text-xs leading-relaxed text-muted-foreground">{item.preview}</p>}
      {Number.isFinite(item.likeCount) && <p className="mt-1 text-xs text-muted-foreground">{compactCount(item.likeCount)} likes</p>}
    </div>;
  }
  return <div className="flex gap-3">
    {thumbnail && <div className="relative aspect-video w-36 shrink-0 self-start overflow-hidden rounded-md bg-muted sm:w-44">
      <img src={thumbnail} alt="" loading="lazy" className="h-full w-full object-cover" />
      {item.hasCaptions && <span className="absolute left-1 top-1 rounded-sm bg-black/80 px-1 py-0.5 text-[10px] font-semibold leading-none text-white" /* theme-lint-ignore — badge sits on a fixed-color video thumbnail */>CC</span>}
      {item.youtubeKind === 'playlist' && Number.isFinite(item.itemCount) ? <span className="absolute bottom-1 right-1 rounded-sm bg-black/80 px-1 py-0.5 text-[10px] font-medium leading-none text-white" /* theme-lint-ignore — badge sits on a fixed-color video thumbnail */>{compactCount(item.itemCount)} videos</span> : item.duration != null && <span className="absolute bottom-1 right-1 rounded-sm bg-black/80 px-1 py-0.5 text-[10px] font-medium leading-none text-white" /* theme-lint-ignore — badge sits on a fixed-color video thumbnail */>{formatDuration(item.duration)}</span>}
    </div>}
    <div className="min-w-0 flex-1">
      <h4 className="line-clamp-2 break-words text-sm font-semibold leading-snug">{item.title}</h4>
      <p className="mt-1 text-xs text-muted-foreground">{[item.sender, Number.isFinite(item.viewCount) ? `${compactCount(item.viewCount)} views` : '', releaseDate(item.date)].filter(Boolean).join(' · ')}</p>
      {item.youtubeKind === 'playlist' && Number.isFinite(item.itemCount) && !thumbnail && <p className="mt-1 text-xs text-muted-foreground">{compactCount(item.itemCount)} videos</p>}
      {item.preview && <p className="mt-2 line-clamp-2 break-words text-xs leading-relaxed text-muted-foreground">{item.preview}</p>}
    </div>
  </div>;
}
export function WorkspaceResultCard({ payload, turnId, tool, resultIndex = 0, selected = [], onSelect, onDiscuss, onMore }: {
  payload: WorkspaceResultPayload; turnId: number; tool: string; selected?: WorkspaceContextRef[];
  resultIndex?: number;
  onSelect?: (items: SelectedWorkspaceItem[]) => void;
  onDiscuss?: (items: SelectedWorkspaceItem[], action: 'discuss' | 'respond' | 'summarize') => void;
  onMore?: (message: string) => void;
}) {
  const [agenda, setAgenda] = useState(payload.presentation === 'agenda');
  const [expanded, setExpanded] = useState<string | null>(null);
  const refs = payload.items.map(item => ({ turnId, tool, resultIndex, itemId: item.id, item }));
  const isSelected = (id: string) => selected.some(r => r.turnId === turnId && r.tool === tool && (r.resultIndex ?? 0) === resultIndex && r.itemId === id);
  const chosen = refs.filter(r => isSelected(r.itemId));
  const kind = payload.items[0]?.kind ?? (payload.sourceTool.startsWith('gmail') ? 'email' : payload.sourceTool.startsWith('gcal') ? 'calendar' : 'document');
  const count = `${payload.items.length} ${payload.items.length === 1 ? 'item' : 'items'}`;
  return <CrewCard className="w-full" label={`${payload.title} results`}>
    <CrewCardHeader
      icon={<GoogleWorkspaceIcon kind={kind} platform={payload.items[0]?.platform} />}
      plainIcon
      title={agenda ? 'Agenda' : payload.title}
      description={typeof payload.readCharacters === 'number'
        ? `${payload.readCharacters.toLocaleString()} characters read · ${payload.complete ? 'End of document reached' : 'Partial read — more text remains'}`
        : count}
      aside={<div className="flex flex-wrap items-center justify-end gap-1">
        {refs.length > 1 && payload.items[0]?.kind === 'calendar' && <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => setAgenda(!agenda)}>{agenda ? 'List view' : 'Agenda view'}</Button>}
        {refs.length > 1 && onSelect && <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => onSelect(chosen.length === refs.length ? [] : refs)}>{chosen.length === refs.length ? 'Clear list selection' : 'Select all'}</Button>}
        <CopyButton value={crewCardCopyText(payload)} size="sm" tooltipText="Copy card" />
      </div>}
    />
    {!refs.length && <p className="px-4 py-3 text-sm text-muted-foreground">Nothing came back for this request.</p>}
    <div className="divide-y divide-border/60">
      {refs.map((ref, index) => {
        const item = ref.item, active = isSelected(item.id);
        const gmailId = item.threadId || item.id;
        const gmailUrl = item.kind === 'email' && /^[a-zA-Z0-9_-]+$/.test(gmailId) ? `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(gmailId)}` : null;
        const day = item.start ? displayTime(item.start, item.timeZone).split(' · ')[0] : '';
        const previous = index > 0 ? refs[index - 1].item : undefined;
        const dayDate = (v?: string, zone?: string) => { try { return v && new Intl.DateTimeFormat(undefined, { dateStyle: 'full', ...(zone && v.length !== 10 ? { timeZone: zone } : { timeZone: 'UTC' }) }).format(new Date(v.length === 10 ? `${v}T12:00:00Z` : v)); } catch { return v; } };
        return <div key={item.id}>
          {agenda && dayDate(item.start, item.timeZone) !== dayDate(previous?.start, previous?.timeZone) && <h4 className="bg-muted/30 px-4 py-1.5 text-xs font-semibold text-muted-foreground">{dayDate(item.start, item.timeZone)}</h4>}
          <article
            className={`px-4 py-3 outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${onSelect ? `cursor-pointer ${active ? 'bg-primary/10 shadow-[inset_2px_0_0_hsl(var(--primary))] hover:bg-primary/15' : 'hover:bg-muted/40'}` : ''}`}
            role={onSelect ? 'checkbox' : undefined}
            aria-checked={onSelect ? active : undefined}
            aria-label={onSelect ? `Select ${item.title}` : undefined}
            tabIndex={onSelect ? 0 : undefined}
            onClick={onSelect ? event => { if ((event.target as HTMLElement).closest('button, a, input, textarea, select, label')) return; onSelect(active ? chosen.filter(r => r.itemId !== item.id) : [...chosen, ref]); } : undefined}
            onKeyDown={onSelect ? event => { if (event.target !== event.currentTarget) return; if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); onSelect(active ? chosen.filter(r => r.itemId !== item.id) : [...chosen, ref]); } } : undefined}
          >
            <div className="min-w-0 flex-1">
                {item.snapshot || item.snapshotComparison ? <FinancialSnapshotItemView item={item} /> : item.forecast ? <ForecastItemView item={item} /> : item.calculation ? <CalculationItemView item={item} /> : item.platform === 'amazon' ? <ProductItemView item={item} /> : item.platform === 'flighthub' ? <FlightItemView item={item} /> : item.platform === 'youtube' ? <YouTubeItemView item={item} /> : item.quickBooksReport ? <FinancialReportItemView item={item} /> : <>
                  <h4 className="flex items-start gap-2 break-words text-sm font-semibold"><GoogleWorkspaceIcon kind={item.kind} platform={item.platform} className="h-4 w-4 shrink-0" />{item.title}</h4>
                  {item.sender && <p className="mt-1 break-words text-xs text-muted-foreground">{item.sender}</p>}
                  {item.recipient && <p className="mt-1 break-words text-xs text-muted-foreground">To: {item.recipient}</p>}
                  {!!item.attachments?.length && <p className="mt-1 break-words text-xs text-muted-foreground">Attachments: {item.attachments.join(', ')}</p>}
                  {(item.start || item.date) && <p className="mt-1 text-xs text-muted-foreground">{(item.start && eventRange(item.start, item.end, item.timeZone)) || <>{item.start ? day : displayTime(item.date)}{item.end ? ` → ${displayTime(item.end, item.timeZone)}${item.end.length === 10 ? ' (exclusive end)' : ''}` : ''}</>}</p>}
                  {item.location && <p className="mt-1 text-xs text-muted-foreground">{item.location}</p>}
                  {item.preview && <p className="mt-2 line-clamp-3 break-words text-xs leading-relaxed text-muted-foreground">{item.kind === 'email' && <span className="font-medium">Email preview: </span>}{item.preview}</p>}
                </>}
                {expanded === item.id && item.body && !item.quickBooksReport && <div className="mt-3 w-full"><div className="max-h-72 w-full overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-3 text-sm">{item.body}</div><p className="mt-1 text-xs text-muted-foreground">Content preview. Discuss reads the live source for full context.</p></div>}
                {item.senderProfile && <details className="mt-3 border-l-2 border-border pl-3 text-sm">
                  <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">Important sender · profile and possible intentions</summary>
                  <p className="mt-2">{item.senderProfile.displayName || item.senderProfile.email}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{item.senderProfile.importanceReason} · {item.senderProfile.recentMessages.length} recent observed messages</p>
                  {item.senderProfile.intentions.map(intent => <div key={intent.messageId} className="mt-2"><p className="text-xs font-medium">Tentative: {intent.hypothesis}</p><blockquote className="mt-1 border-l-2 border-border pl-2 text-xs">{intent.evidence}</blockquote></div>)}
                  {item.senderProfile.unknowns.map(unknown => <p key={unknown} className="mt-2 text-xs text-muted-foreground">{unknown}</p>)}
                </details>}
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  {item.kind === 'email' && onDiscuss && <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => onDiscuss([ref], 'summarize')}>Summarize</Button>}
                  {gmailUrl && <SourceLink href={gmailUrl}><GoogleWorkspaceIcon kind="email" className="h-4 w-4" />Open in Gmail</SourceLink>}
                  {item.body && !item.quickBooksReport && <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setExpanded(expanded === item.id ? null : item.id)}>{expanded === item.id ? 'Hide content' : 'Preview content'}</Button>}
                  {onDiscuss && <><Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => onDiscuss([ref], 'discuss')}>Discuss</Button><Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => onDiscuss([ref], 'respond')}>{item.kind === 'email' || item.youtubeKind === 'comment' ? 'Draft reply' : item.kind === 'calendar' ? 'Respond / plan' : item.youtubeKind === 'channel' ? 'Plan channel content' : item.youtubeKind === 'playlist' ? 'Plan playlist' : item.kind === 'video' ? 'Plan content' : item.kind === 'product' ? 'Plan purchase' : item.quickBooksReport ? 'Analyze variance' : item.kind === 'accounting' ? 'Review next steps' : item.kind === 'flight' ? 'Review booking' : 'Review / edit'}</Button></>}
                  {item.platform === 'flighthub' && item.url && isFlightHubUrl(item.url) && <SourceLink href={item.url}><GoogleWorkspaceIcon kind="flight" platform="flighthub" className="h-4 w-4" />Open on FlightHub</SourceLink>}
                  {item.platform === 'youtube' && item.url && /^https:\/\/www\.youtube\.com\/(?:watch\?|channel\/|playlist\?)/.test(item.url) && <SourceLink href={item.url}><GoogleWorkspaceIcon kind={item.kind} platform="youtube" className="h-4 w-4" />Open in YouTube</SourceLink>}
                  {item.platform === 'amazon' && item.url && AMZ_URL.test(item.url) && <SourceLink href={item.url}><GoogleWorkspaceIcon kind={item.kind} platform="amazon" className="h-4 w-4" />Open on Amazon</SourceLink>}
                  {item.platform === 'amazon' && item.cartUrl && AMZ_URL.test(item.cartUrl) && <SourceLink href={item.cartUrl}><GoogleWorkspaceIcon kind={item.kind} platform="amazon" className="h-4 w-4" />Add to Amazon cart</SourceLink>}
                  {item.url && /^https:\/\/(?:(docs\.google\.com|drive\.google\.com|calendar\.google\.com)\/|www\.google\.com\/calendar\/)/.test(item.url) && <SourceLink href={item.url}><GoogleWorkspaceIcon kind={item.kind} className="h-4 w-4" />Open in Google</SourceLink>}
                  {item.platform === 'microsoft365' && item.url && /^https:\/\/(?:[a-z0-9-]+\.sharepoint\.com|onedrive\.live\.com|[a-z0-9.-]+\.office\.com|m365\.cloud\.microsoft)\//i.test(item.url) && <SourceLink href={item.url}><GoogleWorkspaceIcon kind={item.kind} platform={item.platform} className="h-4 w-4" />Open in Microsoft 365</SourceLink>}
                  {item.platform === 'granola' && item.url && /^https:\/\/(?:notes\.)?granola\.ai\//i.test(item.url) && <SourceLink href={item.url}><GoogleWorkspaceIcon kind="meeting" platform="granola" className="h-4 w-4" />Open in Granola</SourceLink>}
                  {active && <span className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-primary"><Check className="h-3 w-3" aria-hidden />In chat context</span>}
                </div>
            </div>
          </article>
        </div>;
      })}
    </div>
    {chosen.length > 1 && onDiscuss && <CrewCardFooter note={`${chosen.length} selected`}><Button size="sm" onClick={() => onDiscuss(chosen, 'respond')}>Prepare responses</Button><Button size="sm" variant="outline" onClick={() => onDiscuss(chosen, 'discuss')}>Discuss selected</Button>{chosen.every(r => r.item.kind === 'email') && <Button size="sm" variant="ghost" onClick={() => onDiscuss(chosen, 'summarize')}>Summarize selected</Button>}</CrewCardFooter>}
    {(payload.nextPageToken || payload.nextSkipToken || payload.nextOffset != null || payload.nextStart != null) && onMore && <div className="border-t border-border/60 px-4 py-2"><Button variant="ghost" size="sm" onClick={() => onMore(`Continue the result from ${payload.sourceTool} with these query parameters: ${JSON.stringify({ ...payload.sourceArgs, ...(payload.nextStart != null ? { start: payload.nextStart } : payload.nextPageToken ? { page_token: payload.nextPageToken } : payload.nextSkipToken ? { skip_token: payload.nextSkipToken } : { offset: payload.nextOffset }) })}. Display the next results.`)}>Load more</Button></div>}
  </CrewCard>;
}
