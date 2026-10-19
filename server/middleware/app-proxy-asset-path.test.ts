import { describe, it, expect } from 'vitest';
import { appProxyAssetPath } from './app-proxy-asset-path.js';
describe('Next.js app proxy assets', () => {
  it.each(['/forged/sdlc-workbench-fszvh', '/app/sdlc-workbench-fszvh'])('strips %s before fetching the PM page chunk', (prefix) => {
    expect(appProxyAssetPath(`${prefix}/_next/static/chunks/app/pm-workbench/page.js`)).toBe('/_next/static/chunks/app/pm-workbench/page.js');
  });
  it('keeps native asset paths and unrelated routes intact', () => {
    expect(appProxyAssetPath('/_next/static/chunks/998.js')).toBe('/_next/static/chunks/998.js');
    expect(appProxyAssetPath('/app/example/api/oddjob/events')).toBe('/app/example/api/oddjob/events');
  });
});
