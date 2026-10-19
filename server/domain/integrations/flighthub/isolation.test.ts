import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  const page = { goto: vi.fn(), url: () => 'https://www.flighthub.com/', evaluate: vi.fn().mockResolvedValue('verify you are human') };
  const isolated = { newPage: vi.fn().mockResolvedValue(page), close: vi.fn().mockResolvedValue(undefined) };
  const browser = { newContext: vi.fn().mockResolvedValue(isolated), contexts: vi.fn(), close: vi.fn().mockResolvedValue(undefined) };
  return { page, isolated, browser, createSession: vi.fn().mockResolvedValue({ id: 'new-session' }) };
});
vi.mock('../trycua/trycua-service.js', () => ({ trycuaService: { createSession: mocks.createSession, assertEnabled: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('../trycua/org-desktop.service.js', () => ({ orgDesktopService: { ensureBrowser: vi.fn().mockResolvedValue('cdp') } }));
vi.mock('../trycua/skill-recorder.js', () => ({ connectDesktopBrowser: vi.fn().mockResolvedValue(mocks.browser) }));
import { FlightHubBrowserProvider } from './browser-provider.js';

describe('FlightHub browser isolation', () => {
  it('creates a clean context and closes it without reading shared user tabs or cookies', async () => {
    const result = await new FlightHubBrowserProvider().search({ origin: 'YYZ', destination: 'YVR', departDate: '2026-12-01', tripType: 'oneway', adults: 1, children: 0, infants: 0, cabinClass: 'economy', maxResults: 8 }, { organizationId: 342, userId: 'owner' });
    expect(mocks.browser.newContext).toHaveBeenCalledWith();
    expect(mocks.browser.contexts).not.toHaveBeenCalled();
    expect(mocks.page.goto).toHaveBeenCalledWith('https://www.flighthub.com/', expect.any(Object));
    expect(result).toHaveProperty('blocked', 'challenge');
    expect(mocks.isolated.close).toHaveBeenCalled();
    expect(mocks.browser.close).toHaveBeenCalled();
  });
});
