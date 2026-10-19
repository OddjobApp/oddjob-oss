import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { PermissionRequiredPayload } from '@shared/crew-permission';
import { PermissionRequiredCard } from './PermissionRequiredCard';

const payload = (overrides: Partial<PermissionRequiredPayload> = {}): PermissionRequiredPayload => ({
  type: 'permission_required',
  key: '3:read QuickBooks Invoice records',
  title: 'QuickBooks access needed',
  action: 'read QuickBooks Invoice records',
  reason: 'You cannot read QuickBooks Invoice records on this project.',
  allowedRoles: ['Accounts receivable', 'Executive'],
  project: { id: 3, key: 'oddjob-system', name: 'Oddjob System' },
  organizationId: 342,
  steps: [
    { id: 'connect', label: 'Connect QuickBooks to Oddjob System', done: true },
    { id: 'join', label: 'Add you to Oddjob System', done: false },
    { id: 'grant', label: 'Give you the Accounts receivable or Executive finance role', done: false },
  ],
  grantedBy: 'an org admin',
  callerCanGrant: false,
  manageHref: '/projects/oddjob-system?tab=integrations&orgId=342',
  ...overrides,
});

describe('PermissionRequiredCard', () => {
  it('says what was refused, what would allow it, and the steps in order', () => {
    render(<PermissionRequiredCard payload={payload()} />);
    expect(screen.getByText('QuickBooks access needed')).toBeTruthy();
    expect(screen.getByText(/tried to read QuickBooks Invoice records in Oddjob System/)).toBeTruthy();
    const steps = screen.getByRole('list', { name: 'Steps to get access' }).querySelectorAll('li');
    expect([...steps].map((li) => li.textContent)).toEqual([
      expect.stringContaining('Connect QuickBooks'),
      expect.stringContaining('Add you to Oddjob System'),
      expect.stringContaining('finance role'),
    ]);
    expect(steps[0].textContent).toContain('(done)');
  });

  it('names who can grant access when the viewer cannot, with no button', () => {
    render(<PermissionRequiredCard payload={payload()} />);
    expect(screen.getByText('Ask an org admin to do these.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Open QuickBooks access' })).toBeNull();
  });

  it('links a viewer who can grant access to the project’s QuickBooks access', () => {
    render(<PermissionRequiredCard payload={payload({ callerCanGrant: true })} />);
    expect(screen.getByRole('link', { name: 'Open QuickBooks access' }).getAttribute('href'))
      .toBe('/projects/oddjob-system?tab=integrations&orgId=342');
  });

  it('never links outside the app, since the payload is replayed from storage', () => {
    render(<PermissionRequiredCard payload={payload({ callerCanGrant: true, manageHref: 'https://evil.example/projects/x?tab=1' })} />);
    expect(screen.queryByRole('link', { name: 'Open QuickBooks access' })).toBeNull();
  });
});
