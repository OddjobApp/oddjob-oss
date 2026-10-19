import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BlueprintStudioLauncher, blueprintSurfaces, matchCycleFleetApp, cycleAppFromLaunchRef } from './BlueprintStudioLauncher';
const request = vi.hoisted(() => vi.fn());
vi.mock('@/lib/queryClient', () => ({ apiRequest: request }));
describe('Blueprint studio launcher', () => {
  it('prefers the provisioned suite for the room organization over generic and other-org shells', () => {
    const apps = blueprintSurfaces([
      { app: { id: 1, name: 'sdlc-workbench', slug: 'sdlc-workbench' }, deployment: { id: 1, publicSlug: 'sdlc-workbench', organizationId: 342 } },
      { app: { id: 2, name: 'SDLC Workbench Suite (Org 291)', slug: 'sdlc-suite-291' }, deployment: { id: 2, publicSlug: 'sdlc-291', organizationId: 342 } },
      { app: { id: 3, name: 'SDLC Workbench Suite (Org 342)', slug: 'sdlc-suite-342' }, deployment: { id: 3, publicSlug: 'sdlc-342', organizationId: 342 } },
      { app: { id: 4, name: 'Other tenant', slug: 'other' }, deployment: { id: 4, publicSlug: 'other', organizationId: 291 } },
    ], 342);
    expect(apps.map((app) => app.appId)).toEqual([3, 1]);
  });
  it('prefers the SDLC workbench and uses the installed deployment slug', () => {
    const apps = blueprintSurfaces([
      { app: { id: 1, name: 'Budget', slug: 'budgetmaster-workbench' }, deployment: { id: 10, publicSlug: 'budget-org342', status: 'installed' } },
      { app: { id: 2, name: 'SDLC', slug: 'sdlc-workbench' }, deployment: { id: 20, publicSlug: 'sdlc-org342', status: 'installed' } },
      { app: { id: 3, name: 'Broken', slug: 'broken' }, deployment: { id: 30, publicSlug: 'broken', status: 'failed' } },
    ]);
    expect(apps.map((app) => app.appId)).toEqual([2, 1]);
    expect(apps[0].publicPath).toBe('/app/sdlc-org342');
  });
  it('loads the organization catalogue only after an explicit mount request', async () => {
    request.mockResolvedValue({ ok: true, json: async () => [{ app: { id: 2, name: 'SDLC', slug: 'sdlc-workbench' }, deployment: { id: 20, publicSlug: 'sdlc-org342' } }] });
    const mount = vi.fn();
    render(<BlueprintStudioLauncher organizationId={342} onMount={mount} />);
    expect(request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'App studio' }));
    await waitFor(() => expect(mount).toHaveBeenCalledOnce());
    expect(request).toHaveBeenCalledWith('GET', '/api/apps/installed?organizationId=342');
  });
  it('offers installable and template surfaces when nothing is installed, then mounts after install', async () => {
    request.mockImplementation(async (method: string, url: string) => {
      if (url.startsWith('/api/apps/installed')) return { ok: true, json: async () => [] };
      if (url.startsWith('/api/apps/fleet-for-copilot')) return { ok: true, json: async () => [
        { slug: 'it-ticketing', title: 'IT Ticketing', description: null, availability: 'advertised', appId: 77, href: '/armory/apps/77' },
        { slug: 'ops-kit', title: 'Ops Kit', description: null, availability: 'template', href: '/armory/new?blueprint=ops-kit' },
      ] };
      if (url.startsWith('/api/apps/install')) return { ok: true, json: async () => ({}) };
      return { ok: false, status: 404, json: async () => ({}) };
    });
    const mount = vi.fn();
    render(<BlueprintStudioLauncher organizationId={342} onMount={mount} />);
    fireEvent.click(screen.getByRole('button', { name: 'App studio' }));
    await waitFor(() => expect(screen.getByRole('menu', { name: 'Installable app surfaces' })).toBeDefined());
    expect(mount).not.toHaveBeenCalled();
    // Install an advertised app — installer refreshes surfaces and mounts.
    request.mockImplementation(async (method: string, url: string) => {
      if (url.startsWith('/api/apps/installed')) return { ok: true, json: async () => [
        { app: { id: 77, name: 'IT Ticketing', slug: 'it-ticketing' }, deployment: { id: 5, publicSlug: 'it-342', organizationId: 342 } },
      ] };
      if (url.startsWith('/api/apps/install')) return { ok: true, json: async () => ({}) };
      return { ok: false, status: 404, json: async () => ({}) };
    });
    fireEvent.click(screen.getByRole('button', { name: 'Install' }));
    await waitFor(() => expect(mount).toHaveBeenCalledOnce());
    expect(request).toHaveBeenCalledWith('POST', '/api/apps/install?organizationId=342', { appId: 77 });
    expect(mount.mock.calls[0][0][0].publicPath).toBe('/app/it-342');
  });
  it('surfaces the install failure for non-admin users instead of mounting silently', async () => {
    request.mockImplementation(async (method: string, url: string) => {
      if (url.startsWith('/api/apps/installed')) return { ok: true, json: async () => [] };
      if (url.startsWith('/api/apps/fleet-for-copilot')) return { ok: true, json: async () => [
        { slug: 'x', title: 'X App', description: null, availability: 'advertised', appId: 9, href: '/armory/apps/9' },
      ] };
      if (url.startsWith('/api/apps/install')) return { ok: false, status: 403, json: async () => ({}) };
      return { ok: false, status: 404, json: async () => ({}) };
    });
    const mount = vi.fn();
    render(<BlueprintStudioLauncher organizationId={342} onMount={mount} />);
    fireEvent.click(screen.getByRole('button', { name: 'App studio' }));
    await waitFor(() => expect(screen.getByRole('menu', { name: 'Installable app surfaces' })).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: 'Install' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('403'));
    expect(mount).not.toHaveBeenCalled();
  });
  it('navigates a template item to its creation route', async () => {
    request.mockImplementation(async (method: string, url: string) => {
      if (url.startsWith('/api/apps/installed')) return { ok: true, json: async () => [] };
      if (url.startsWith('/api/apps/fleet-for-copilot')) return { ok: true, json: async () => [
        { slug: 'ops-kit', title: 'Ops Kit', description: null, availability: 'template', href: '/armory/new?blueprint=ops-kit' },
      ] };
      return { ok: false, status: 404, json: async () => ({}) };
    });
    const originalLocation = window.location;
    const fakeLocation = { ...originalLocation, href: '' };
    Object.defineProperty(window, 'location', { configurable: true, value: fakeLocation });
    try {
      render(<BlueprintStudioLauncher organizationId={342} onMount={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: 'App studio' }));
      await waitFor(() => expect(screen.getByRole('menu', { name: 'Installable app surfaces' })).toBeDefined());
      fireEvent.click(screen.getByRole('button', { name: 'Create' }));
      expect(fakeLocation.href).toBe('/armory/new?blueprint=ops-kit');
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    }
  });
});

describe('cycle-app launch references', () => {
  const fleet = [
    { id: 20, appId: 2, title: 'SDLC', description: null, slug: 'sdlc-workbench', publicSlug: 'sdlc-org342', publicPath: '/app/sdlc-org342', status: 'installed', isLive: true, blueprint: 'sdlc-workbench' },
    { id: 30, appId: 3, title: 'Wayfare', description: null, slug: 'wayfare', publicSlug: 'wayfare-342', publicPath: '/app/wayfare-342', status: 'installed', isLive: true, blueprint: 'wayfare' },
  ];

  it('matches a mount ref by deployment id, app id, or public slug', () => {
    expect(matchCycleFleetApp(fleet, { deploymentId: 30 })?.slug).toBe('wayfare');
    expect(matchCycleFleetApp(fleet, { appId: 2 })?.slug).toBe('sdlc-workbench');
    expect(matchCycleFleetApp(fleet, { publicSlug: 'wayfare-342' })?.id).toBe(30);
    expect(matchCycleFleetApp(fleet, { publicSlug: 'wayfare' })?.id).toBe(30);
  });

  it('returns null when no fleet app matches', () => {
    expect(matchCycleFleetApp(fleet, { publicSlug: 'missing' })).toBeNull();
    expect(matchCycleFleetApp(null, { publicSlug: 'wayfare-342' })).toBeNull();
  });

  it('synthesizes a mountable surface from artifact fields alone', () => {
    const app = cycleAppFromLaunchRef({ publicSlug: 'wayfare-342', deploymentId: 30, title: 'Wayfare' });
    expect(app).toMatchObject({ id: 30, publicSlug: 'wayfare-342', publicPath: '/app/wayfare-342' });
    expect(cycleAppFromLaunchRef({ deploymentId: 30 })).toBeNull();
  });
});
