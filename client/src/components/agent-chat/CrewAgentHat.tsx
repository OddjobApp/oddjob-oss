import React from 'react';
import { cn } from '@/lib/utils';
import { accentFor } from './crew-style-helpers';

/**
 * Agent hats: one silhouette per kind of work, drawn as duotone glyphs in
 * `currentColor` so they take the agent's accent and stay legible at pill
 * size (14px) as well as roster size. Each hat is told apart by its outline
 * alone; there is no detail that only shows at large sizes.
 */
export const HATS = ['bowler', 'top-hat', 'fedora', 'flat-cap', 'beret', 'deerstalker', 'hard-hat', 'mortarboard', 'cowboy'] as const;
export type HatKind = (typeof HATS)[number];

/** First match wins, so the more specific trades come before the generic ones. */
const RULES: Array<[RegExp, HatKind]> = [
  [/copilot/, 'bowler'],
  [/trainer|wrangl/, 'cowboy'],
  [/secur|audit|complian|legal|counsel|regulat|risk|chaos/, 'deerstalker'],
  [/research|knowledge|literature|documentation|teach|tutor|evaluat|coach/, 'mortarboard'],
  [/creative|artist|writer|media|design|ux\b|marketing|content|seo|brand|visual/, 'beret'],
  [/coder|develop|engineer|devops|sre\b|reliab|backend|frontend|mobile|database|sql|deploy|release|\bqa\b|test|code|repositor|pull request|technical|observab|browser/, 'hard-hat'],
  [/analyst|financ|tax|treasur|account|sales|deal|forecast|reconcil|procure|vendor/, 'fedora'],
  [/dispatch|support|ticket|customer|onboard|logistic|fleet|\bhr\b|human resources|coordinator|service/, 'flat-cap'],
  [/architect|director|producer|manager|lead|strateg|supervisor|master|orchestrat|commander/, 'top-hat'],
];

/** Keyed on the name alone: mention pills and turn avatars only know the name. */
export function hatFor(name: string, personaType?: string | null): HatKind {
  const key = `${name} ${personaType ?? ''}`.toLowerCase().replace(/[-_]/g, ' ');
  for (const [pattern, hat] of RULES) if (pattern.test(key)) return hat;
  let seed = 0;
  for (let i = 0; i < name.length; i++) seed = (seed * 31 + name.charCodeAt(i)) | 0;
  return HATS[Math.abs(seed) % HATS.length];
}

const HAT_LABEL: Record<HatKind, string> = {
  bowler: 'Bowler',
  'top-hat': 'Top hat',
  fedora: 'Fedora',
  'flat-cap': 'Flat cap',
  beret: 'Beret',
  deerstalker: 'Deerstalker',
  'hard-hat': 'Hard hat',
  mortarboard: 'Mortarboard',
  cowboy: 'Cowboy hat',
};

/** Secondary tone: bands, top faces and undersides, so the crown reads as the shape. */
const TONE = 0.5;

/**
 * Every hat in the same three-quarter view, turned to face left and seen from
 * slightly above: brims are tilted ellipses, fronts (visors, pinches, the
 * larger deerstalker peak) point left. `brim` is drawn first and knocked out
 * around `body`, so the two stay separate at pill size.
 *
 * `t` and `ink` let the same shapes be drawn as a solid silhouette for that
 * knockout mask.
 */
function hatShapes(hat: HatKind, t: number, ink: string): { brim: React.ReactNode; body: React.ReactNode } {
  switch (hat) {
    case 'bowler':
      return {
        brim: <ellipse cx="12.2" cy="17.4" rx="9" ry="2.9" transform="rotate(-8 12.2 17.4)" />,
        body: (
          <>
            <path d="M6.6 13.9C6.4 8.6 8.7 5.4 12.4 5.4s5.6 3.1 5.3 7.9c-3.3 1.7-7.6 1.8-11.1.6Z" />
            <path d="M6.6 14.6c3.4 1.2 7.8 1.1 11.1-.6l-.1 2.2c-3.3 1.7-7.7 1.8-10.9.6Z" opacity={t} />
          </>
        ),
      };
    case 'top-hat':
      return {
        brim: <ellipse cx="12.2" cy="17.6" rx="10" ry="3.1" transform="rotate(-8 12.2 17.6)" />,
        body: (
          <>
            <path d="M7.1 5.9l.35 7.2c2.8 1.1 6.3 1 9.3-.6l.35-7.3c-1.6 1.4-8.4 1.9-10-.7Z" />
            <path d="M7.1 5.9c1.6 1.2 8.4.7 10-.7 0-1.1-10-.5-10 .7Z" opacity={t} />
            <path d="M7.5 13.8c2.7 1.1 6.2 1 9.2-.6l-.2 3.4c-2.9 1.6-6.1 1.8-8.8.7Z" opacity={t} />
          </>
        ),
      };
    case 'fedora':
      return {
        brim: <ellipse cx="12" cy="16.6" rx="11" ry="3.3" transform="rotate(-11 12 16.6)" />,
        body: (
          <>
            <path d="M7.4 13.1l.7-5.6c.3-1.2 1.3-1.5 2.1-.7 1.4 1 3.2-.3 4.9-.8 1.2-.3 1.8.5 1.9 1.7l.3 4.8c-3.1 1.6-6.9 1.8-9.9.6Z" />
            <path d="M8.9 8.3l1.1-.2-.2 3-1.1.3Z" opacity={t} />
            <path d="M7.35 13.8c3.1 1.1 6.9.9 10-.7l.1 2.5c-3.2 1.7-7.1 1.8-10.2.7Z" opacity={t} />
          </>
        ),
      };
    case 'flat-cap':
      return {
        brim: <path d="M1.1 17.2c.4-1.6 3.4-2.4 6.8-2.1l.3 2.4c-2.7 1-6.3 1.2-7.1-.3Z" />,
        body: (
          <>
            <path d="M5 15.2c.3-3 3.5-5.3 8.4-5.5 4.6-.2 8 1.3 8.3 3.9v1c-4.6 1.4-11.6 1.6-16.7.6Z" />
            <circle cx="12.6" cy="9.8" r=".8" />
            <path d="M5 15.9c5.1 1 12.1.8 16.7-.6v1.4c-4.6 1.5-11.6 1.7-16.7.7Z" opacity={t} />
          </>
        ),
      };
    case 'beret':
      return {
        brim: <path d="M6.4 15.3c3 1 8.2 1 11.2-.2l-.2 2.2c-2.8 1-8 1-10.8 0Z" opacity={t} />,
        body: (
          <>
            <path d="M2.6 12.4C2.4 9.4 6.6 7.1 12.4 7c5.8-.1 9.4 2 9.1 4.6-.3 2.4-4.2 3.8-9.3 3.9-5 .1-9.4-1.1-9.6-3.1Z" />
            <path d="M11.8 7.1l-.7-2.3" stroke={ink} strokeWidth="1.4" strokeLinecap="round" fill="none" />
          </>
        ),
      };
    case 'deerstalker':
      return {
        brim: (
          <>
            <path d="M.7 17.6c1.4-2 4.7-2.9 7.2-2.6v2.5c-2.5.6-5.8 1-7.2.1Z" />
            <path d="M21.8 15.6c-1-1.1-2.7-1.4-4.2-1.3V16c1.5.3 3.2.3 4.2-.4Z" />
          </>
        ),
        body: (
          <>
            <path d="M6.7 14c0-4.4 2.4-7 5.6-7s5.4 2.6 5.4 6.7c-3.4 1.2-7.4 1.3-11 .3Z" />
            <path d="M9.9 6.6c.8-1.2 1.8-1.1 2.4-.4.6-.7 1.6-.8 2.4.4-.9.5-1.8.5-2.4.1-.6.4-1.5.4-2.4-.1Z" />
            <path d="M6.7 14.7c3.6 1 7.6.9 11-.3v1.8c-3.4 1.2-7.4 1.3-11 .3Z" opacity={t} />
            <path d="M8.3 17l.5 3.2 2-2.8Z" opacity={t} />
          </>
        ),
      };
    case 'hard-hat':
      return {
        brim: <path d="M1.4 16.4c.4-1.4 3.4-1.9 6.4-1.6h13.4c.9 1.3-.4 2.7-2.9 3.1-4.6.7-9.4.7-13.6.2-2.2-.3-3.6-.9-3.3-1.7Z" />,
        body: (
          <>
            <path fillRule="evenodd" d="M5.2 14.6C5.2 10.1 8.3 7 12.3 7s6.8 3 6.8 7.3c-4.4 1.1-9.4 1.2-13.9.3Zm4.5-6.7c.6 2 .8 4.4.8 6.9l2.3.1c-.1-2.6.1-5 .5-7.2-1.3-.4-2.6-.3-3.6.2Z" />
            <path d="M9.7 7.9c1-.5 2.3-.6 3.6-.2-.4 2.2-.6 4.6-.5 7.2l-2.3-.1c0-2.5-.2-4.9-.8-6.9Z" opacity={t} />
          </>
        ),
      };
    case 'mortarboard':
      return {
        brim: <path d="M6.6 10.8v4c0 1.6 2.5 2.9 5.6 2.9s5.6-1.3 5.6-2.9v-4.4L13 13Z" opacity={t} />,
        body: (
          <>
            <path d="M10.9 3.6l11.5 3.9L13 12.6 1.6 8.3Z" />
            <path d="M1.6 8.3L13 12.6l9.4-5.1v1L13 13.6 1.6 9.2Z" opacity={t} />
            <path d="M21.2 8.4v5.4" stroke={ink} strokeWidth="1.2" strokeLinecap="round" fill="none" />
            <path d="M20.5 13.6h1.4l.5 3.4H20Z" />
          </>
        ),
      };
    case 'cowboy':
      return {
        brim: <path d="M1.4 11.6c.6 2.8 3.2 4.4 5.6 4.7 3.3.4 6.7.4 10 0 2.4-.3 4.7-1.4 5.6-3.4.6 2.9-1.6 5.9-6.8 6.6-2.7.4-5.3.4-8 .1-5.3-.6-7.3-4.4-6.4-8Z" />,
        body: (
          <>
            <path d="M7.4 13l.7-5.4c.3-1.5 1.7-1.8 2.7-.9l1.1.9 1.2-1c1.1-.9 2.7-.8 3.1.7l.6 5.2c-3 1.4-6.6 1.5-9.4.5Z" />
            <path d="M9 7.9l.9.1-.2 2.8-.9.2Z" opacity={t} />
            <path d="M7.3 13.7c2.8 1 6.4.9 9.5-.5l.1 1.9c-3.1 1.5-6.8 1.6-9.7.5Z" opacity={t} />
          </>
        ),
      };
  }
}

function HatGlyph({ hat }: { hat: HatKind }) {
  // useId yields colons/guillemets, which break a url(#…) reference.
  const mask = `hat-mask-${React.useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const { brim, body } = hatShapes(hat, TONE, 'currentColor');
  const silhouette = hatShapes(hat, 1, 'black').body;
  return (
    <>
      <defs>
        <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
          <rect width="24" height="24" fill="white" />
          <g fill="black" stroke="black" strokeWidth="1.3" strokeLinejoin="round">{silhouette}</g>
        </mask>
      </defs>
      <g mask={`url(#${mask})`}>{brim}</g>
      {body}
    </>
  );
}

export function CrewAgentHat({
  name,
  personaType,
  className,
  title,
}: {
  name: string;
  personaType?: string | null;
  className?: string;
  /** Adds an accessible label; by default the hat is decorative beside the agent's name. */
  title?: boolean;
}) {
  const hat = hatFor(name, personaType);
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={cn('h-6 w-6 shrink-0', accentFor(name).text, className)}
      data-hat={hat}
      role={title ? 'img' : undefined}
      aria-label={title ? `${HAT_LABEL[hat]} for ${name}` : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <HatGlyph hat={hat} />
    </svg>
  );
}
