import { describe, expect, it } from 'vitest';
import { linkifyText } from './turn-linkify';

describe('linkifyText', () => {
  it('linkifies bare domains that carry a path or query', () => {
    expect(linkifyText('Watch youtube.com/watch?v=abc123 now')).toEqual([
      { type: 'text', value: 'Watch ' },
      { type: 'link', url: 'https://youtube.com/watch?v=abc123' },
      { type: 'text', value: ' now' },
    ]);
  });

  it('linkifies short share domains like youtu.be', () => {
    expect(linkifyText('See youtu.be/abc123')).toEqual([
      { type: 'text', value: 'See ' },
      { type: 'link', url: 'https://youtu.be/abc123' },
    ]);
  });

  it('keeps scheme and www links intact', () => {
    expect(linkifyText('go to https://example.com/docs?page=2')).toEqual([
      { type: 'text', value: 'go to ' },
      { type: 'link', url: 'https://example.com/docs?page=2' },
    ]);
  });

  it('leaves filenames, commands and bare domains as text', () => {
    expect(linkifyText('edit src/index.ts, vitest.config.ts or run npm run verify')).toBeNull();
    expect(linkifyText('visit youtube.com')).toBeNull();
  });

  it('keeps trailing punctuation outside the link', () => {
    expect(linkifyText('Watch youtube.com/watch?v=x.')).toEqual([
      { type: 'text', value: 'Watch ' },
      { type: 'link', url: 'https://youtube.com/watch?v=x' },
      { type: 'text', value: '.' },
    ]);
  });

  it('drops an unbalanced closing parenthesis', () => {
    expect(linkifyText('(youtube.com/watch?v=x)')).toEqual([
      { type: 'text', value: '(' },
      { type: 'link', url: 'https://youtube.com/watch?v=x' },
      { type: 'text', value: ')' },
    ]);
  });
});
