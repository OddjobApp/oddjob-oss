import React from 'react';
import { Badge } from '@/components/ui/badge';
import { ArrowRight } from 'lucide-react';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselPrevious,
  CarouselNext,
} from '@/components/ui/carousel';

export interface TurnAssistantCarouselCardProps {
  payload: Record<string, any>;
}

export function TurnAssistantCarouselCard({ payload: p }: TurnAssistantCarouselCardProps) {
  const carouselItems = (p.items as any[]) || [];

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-border/70 bg-card" data-testid="turn-artifact">
      {(p.title || p.description) && (
        <div className="border-b border-border/40 px-3.5 py-2.5">
          {p.title && <span className="text-xs font-bold text-foreground">{p.title as string}</span>}
          {p.description && <p className="mt-0.5 text-xs text-muted-foreground">{p.description as string}</p>}
        </div>
      )}
      <div className="px-10 py-3">
        <Carousel opts={{ align: 'start', loop: false }} className="w-full">
          <CarouselContent className="-ml-2">
            {carouselItems.map((item: any, ii: number) => (
              <CarouselItem key={ii} className="pl-2 basis-full sm:basis-[65%] lg:basis-[45%]">
                <div className="flex h-full flex-col overflow-hidden rounded-lg border border-border/50 bg-background/60">
                  {item.imageUrl && (
                    <img src={item.imageUrl as string} alt={String(item.title || '')} className="h-28 w-full object-cover" />
                  )}
                  <div className="flex flex-1 flex-col gap-1.5 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs font-semibold leading-snug text-foreground">{item.title}</span>
                      {item.badge && (
                        <Badge variant="outline" className="shrink-0 text-xs">{item.badge}</Badge>
                      )}
                    </div>
                    {item.subtitle && <span className="text-xs font-medium text-foreground/70">{item.subtitle}</span>}
                    {item.description && (
                      <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">{item.description}</p>
                    )}
                    {Array.isArray(item.meta) && item.meta.length > 0 && (
                      <div className="mt-1 space-y-0.5">
                        {item.meta.slice(0, 4).map((m: any, mi: number) => (
                          <div key={mi} className="flex justify-between gap-2 text-xs">
                            <span className="text-muted-foreground">{m.label}</span>
                            <span className="truncate font-medium text-foreground/80">{m.value}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {Array.isArray(item.tags) && item.tags.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {item.tags.slice(0, 4).map((tag: any, ti: number) => (
                          <span key={ti} className="rounded-md bg-muted/60 px-1.5 py-0.5 text-xs text-muted-foreground">{String(tag)}</span>
                        ))}
                      </div>
                    )}
                    {item.ctaLabel && item.ctaHref && (
                      <a
                        href={String(item.ctaHref)}
                        target={String(item.ctaHref).startsWith('http') ? '_blank' : undefined}
                        rel="noreferrer"
                        className="mt-auto inline-flex items-center gap-1 pt-1 text-xs font-medium text-primary hover:underline"
                      >
                        {item.ctaLabel} <ArrowRight className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>
              </CarouselItem>
            ))}
          </CarouselContent>
          <CarouselPrevious className="-left-8" />
          <CarouselNext className="-right-8" />
        </Carousel>
      </div>
    </div>
  );
}
