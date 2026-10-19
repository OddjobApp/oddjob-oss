import React from 'react';
import { AlertTriangle, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * What a card's state means, never which studio drew it: `attention` asks to be
 * read before acting, `success` is settled in your favour, `danger` is refused
 * or destructive.
 */
export type CrewCardTone = 'default' | 'attention' | 'success' | 'danger';

const ICON_TONE: Record<CrewCardTone, string> = {
  default: 'bg-primary/10 text-primary ring-primary/15',
  attention: 'bg-amber-500/15 text-amber-600 ring-amber-500/20 dark:text-amber-400',
  success: 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/20 dark:text-emerald-400',
  danger: 'bg-red-500/10 text-red-600 ring-red-500/20 dark:text-red-400',
};

const STATUS_TONE: Record<CrewCardTone, string> = {
  default: 'bg-muted text-foreground',
  attention: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  success: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  danger: 'bg-red-500/10 text-red-700 dark:text-red-300',
};

/**
 * The shared anatomy of a card in the CREW transcript.
 *
 * Every card answers three questions in the same places: what this is (the
 * header), what it holds (the body), and what happens when you act (the
 * footer). The request a card answers is quoted with a rule, so it reads as the
 * person's own words rather than as another box of data.
 *
 * Cards share one surface and one accent. A card earns a different colour only
 * for what it says — a check that needs reading — never for which studio drew it.
 */
export function CrewCard({
  children,
  className,
  testId,
  label,
}: {
  children: React.ReactNode;
  className?: string;
  testId?: string;
  /** Accessible name for the card when its title alone is not enough. */
  label?: string;
}) {
  return (
    <section
      className={cn('mt-3 overflow-hidden rounded-xl border border-border/70 bg-card text-card-foreground', className)}
      data-testid={testId}
      aria-label={label}
    >
      {children}
    </section>
  );
}

export function CrewCardHeader({
  icon,
  title,
  description,
  aside,
  tone = 'default',
  plainIcon = false,
  className,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Right-hand detail: a status badge, an estimate. */
  aside?: React.ReactNode;
  /** Colours the icon by what the card's state means. */
  tone?: CrewCardTone;
  /** A brand mark (Gmail, YouTube) keeps its own colours on a neutral tile. */
  plainIcon?: boolean;
  className?: string;
}) {
  return (
    <header className={cn('flex items-start gap-3 border-b border-border/60 px-4 py-3', className)}>
      {icon && (
        <div
          aria-hidden
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset [&_svg]:h-4 [&_svg]:w-4',
            plainIcon ? 'bg-muted/60 ring-border/60' : ICON_TONE[tone],
          )}
        >
          {icon}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold leading-snug text-foreground">{title}</h3>
        {description && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      {aside && <div className="shrink-0">{aside}</div>}
    </header>
  );
}

/** A short state label, e.g. "Accepted". Sentence case; the tone carries the meaning. */
export function CrewCardStatus({ tone = 'default', children }: { tone?: CrewCardTone; children: React.ReactNode }) {
  return (
    <span className={cn('inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium', STATUS_TONE[tone])}>
      {children}
    </span>
  );
}

const FACT_TONE: Record<CrewCardTone, string> = {
  default: 'text-foreground',
  attention: 'text-amber-700 dark:text-amber-300',
  success: 'text-emerald-700 dark:text-emerald-300',
  danger: 'text-red-700 dark:text-red-300',
};

const FACT_COLUMNS = ['', 'grid-cols-1', 'grid-cols-2', 'grid-cols-3', 'grid-cols-2 sm:grid-cols-4'];

/** A row of measured facts, each a label over a value. Hairlines, not boxes, between them. */
export function CrewCardFacts({ facts }: { facts: Array<{ label: React.ReactNode; value: React.ReactNode; tone?: CrewCardTone }> }) {
  if (facts.length === 0) return null;
  return (
    <dl
      className={cn(
        'grid gap-px overflow-hidden rounded-lg border border-border/60 bg-border/60',
        FACT_COLUMNS[Math.min(facts.length, 4)],
      )}
    >
      {facts.map((fact, index) => (
        <div key={index} className="min-w-0 bg-card px-3 py-2">
          <dt className="truncate text-[11px] text-muted-foreground">{fact.label}</dt>
          <dd className={cn('mt-0.5 truncate text-sm font-semibold tabular-nums', FACT_TONE[fact.tone ?? 'default'])}>
            {fact.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function CrewCardBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('space-y-3 px-4 py-3 text-xs', className)}>{children}</div>;
}

/** The action row. The primary action comes first; `note` says what it does next. */
export function CrewCardFooter({
  children,
  note,
  className,
}: {
  children?: React.ReactNode;
  note?: React.ReactNode;
  className?: string;
}) {
  return (
    <footer
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border/60 bg-muted/30 px-4 py-2.5',
        className,
      )}
    >
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
      {note && <p className="min-w-0 flex-1 text-xs text-muted-foreground">{note}</p>}
    </footer>
  );
}

/** The request this card answers, quoted. */
export function CrewCardQuote({
  children,
  source,
  testId,
}: {
  children: React.ReactNode;
  /** Optional lead-in, e.g. "About scene 3:". */
  source?: React.ReactNode;
  testId?: string;
}) {
  return (
    <blockquote
      className="border-l-2 border-primary/40 pl-3 text-xs leading-relaxed text-foreground/90"
      data-testid={testId}
    >
      {source && <span className="text-muted-foreground">{source} </span>}
      {children}
    </blockquote>
  );
}

export function CrewCardList({ items, label }: { items: React.ReactNode[]; label: string }) {
  if (items.length === 0) return null;
  return (
    <ul className="list-disc space-y-1 pl-4 text-xs marker:text-primary" aria-label={label}>
      {items.map((item, index) => (
        <li key={index} className="pl-0.5">
          {item}
        </li>
      ))}
    </ul>
  );
}

/** Something to read before acting. Amber because it asks for attention. */
export function CrewCardNotice({ title, items }: { title: React.ReactNode; items: React.ReactNode[] }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
      <p className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-300">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {title}
      </p>
      <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

/** Secondary detail that most people skip: folded away, one line when closed. */
export function CrewCardDisclosure({ summary, items }: { summary: React.ReactNode; items: React.ReactNode[] }) {
  if (items.length === 0) return null;
  return (
    <details className="group text-xs text-muted-foreground">
      <summary className="cursor-pointer rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {summary}
      </summary>
      <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </details>
  );
}

/**
 * A receipt about a turn — what was loaded, what was checked — rather than a
 * card asking for anything. One quiet line until it is opened.
 */
export function CrewReceipt({
  icon,
  summary,
  children,
}: {
  icon?: React.ReactNode;
  summary: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <details className="group mt-3 rounded-lg border border-border/60 text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-lg px-3 py-2 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-3 w-3 shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden />
        {icon && <span aria-hidden className="shrink-0 [&_svg]:h-3.5 [&_svg]:w-3.5">{icon}</span>}
        <span className="font-medium">{summary}</span>
      </summary>
      <div className="space-y-2 border-t border-border/60 px-3 py-2.5">{children}</div>
    </details>
  );
}
