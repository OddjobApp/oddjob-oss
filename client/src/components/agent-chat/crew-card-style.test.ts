// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Transcript cards share one anatomy (CrewCard.tsx): one flat surface, colour
 * only for what a state means, and text no smaller than 11px. Each rule below
 * was broken by cards drawn before that anatomy existed, and regrew after it,
 * so the card files are scanned rather than trusted.
 *
 * Scope is every card the transcript renders: *Card.tsx and *ItemView.tsx here,
 * TurnRow.tsx, and everything under turns/ and approvals/. A line may opt out
 * with `crew-card-lint-ignore` or `theme-lint-ignore` and a reason, e.g. a badge
 * drawn over a video thumbnail.
 */
const RULES: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /text-\[(?:9|10|10\.5)px\]/, why: 'text below 11px' },
  { pattern: /\bshadow-(?:md|xl|2xl)\b/, why: 'a card casts no shadow; it sits flat on the transcript' },
  { pattern: /\buppercase\b[^"'`]*\btracking-/, why: 'all-caps eyebrow; labels are sentence case' },
  { pattern: /\bbg-[a-z]+-950\//, why: 'dark-only tint that turns muddy in light mode' },
];

const here = __dirname;
const cardFiles = [
  ...readdirSync(here).filter((f) => /(?:Card|ItemView)\.tsx$/.test(f) || f === 'TurnRow.tsx'),
  ...['turns', 'approvals'].flatMap((dir) => readdirSync(join(here, dir)).filter((f) => f.endsWith('.tsx')).map((f) => `${dir}/${f}`)),
].filter((f) => !/\.test\.tsx$/.test(f));

describe('CREW transcript card style', () => {
  it('scans the card files it claims to', () => {
    // A guard that matches nothing reports green while checking nothing.
    expect(cardFiles).toEqual(expect.arrayContaining(['TurnRow.tsx', 'InlineApprovalCard.tsx', 'WorkspaceResultCard.tsx']));
    expect(cardFiles.some((f) => f.startsWith('turns/'))).toBe(true);
    expect(cardFiles.length).toBeGreaterThan(20);
  });

  it.each(cardFiles)('%s follows the card anatomy', (file) => {
    const violations = readFileSync(join(here, file), 'utf8')
      .split(/\r?\n/)
      .flatMap((line, index) =>
        /(?:crew-card|theme)-lint-ignore/.test(line)
          ? []
          : RULES.filter((rule) => rule.pattern.test(line)).map((rule) => `${file}:${index + 1} ${rule.why}`),
      );
    expect(violations).toEqual([]);
  });
});
