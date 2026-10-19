import React, { useMemo } from 'react';

export type ConsensusTrend = 'rising' | 'falling' | 'stable' | null;

export function computeConsensusTrend(
  currentConsensus: number | null,
  previousConsensus: number | null,
): ConsensusTrend {
  if (currentConsensus === null || previousConsensus === null) return null;
  const delta = currentConsensus - previousConsensus;
  if (delta >= 5) return 'rising';
  if (delta <= -5) return 'falling';
  return 'stable';
}

export const TREND_DISPLAY: Record<Exclude<ConsensusTrend, null>, { symbol: string; label: string; className: string }> = {
  rising: { symbol: '↑', label: 'rising', className: 'text-emerald-500' },
  falling: { symbol: '↓', label: 'falling', className: 'text-rose-500' },
  stable: { symbol: '→', label: 'stable', className: 'text-muted-foreground' },
};

/** Stable accent per speaker so an agent stays recognisable down the transcript. */
export const ACCENTS = [
  { ring: 'ring-sky-500/40', tile: 'bg-sky-500/15 text-sky-500', bar: 'bg-sky-500', text: 'text-sky-500' },
  { ring: 'ring-violet-500/40', tile: 'bg-violet-500/15 text-violet-500', bar: 'bg-violet-500', text: 'text-violet-500' },
  { ring: 'ring-emerald-500/40', tile: 'bg-emerald-500/15 text-emerald-500', bar: 'bg-emerald-500', text: 'text-emerald-500' },
  { ring: 'ring-amber-500/40', tile: 'bg-amber-500/15 text-amber-500', bar: 'bg-amber-500', text: 'text-amber-500' },
  { ring: 'ring-rose-500/40', tile: 'bg-rose-500/15 text-rose-500', bar: 'bg-rose-500', text: 'text-rose-500' },
  { ring: 'ring-cyan-500/40', tile: 'bg-cyan-500/15 text-cyan-500', bar: 'bg-cyan-500', text: 'text-cyan-500' },
];

export function accentFor(name: string = '') {
  const safeName = typeof name === 'string' ? name : 'agent';
  let hash = 0;
  for (let i = 0; i < safeName.length; i++) hash = (hash * 31 + safeName.charCodeAt(i)) | 0;
  return ACCENTS[Math.abs(hash) % ACCENTS.length];
}
