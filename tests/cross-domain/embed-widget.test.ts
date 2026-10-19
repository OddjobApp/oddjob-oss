/**
 * Embed Widget tests
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Embed Widget', () => {
  it('embed-widget.js exists and contains expected structure', () => {
    const clientPublic = path.resolve(process.cwd(), 'client', 'public', 'embed-widget.js');
    const distPublic = path.resolve(process.cwd(), 'dist', 'public', 'embed-widget.js');
    const widgetPath = fs.existsSync(clientPublic) ? clientPublic : distPublic;
    expect(fs.existsSync(widgetPath)).toBe(true);

    const content = fs.readFileSync(widgetPath, 'utf-8');
    expect(content).toContain('data-slug');
    expect(content).toContain('oddjob-widget');
    expect(content).toContain('embed=1');
    expect(content).toContain('widget=1');
    expect(content).toContain('oddjob:embed:ready');
  });

  // The FloatingWidget.tsx React wrapper was removed with the dead-frontend
  // cleanup (3fd45ae17); embed-widget.js under client/public is the shipped form.
});
