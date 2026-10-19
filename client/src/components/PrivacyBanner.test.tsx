import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PrivacyBanner } from './PrivacyBanner';

beforeEach(() => {
  for (const name of ['oj_opt_out', 'oj_privacy_notice_dismissed']) document.cookie = `${name}=; Max-Age=0; Path=/`;
  Object.defineProperty(navigator, 'globalPrivacyControl', { configurable: true, value: false });
});
afterEach(cleanup);
describe('Privacy choices', () => {
  it('dismisses without granting consent and can reopen', () => {
    render(<PrivacyBanner />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notice' }));
    expect(document.cookie).not.toContain('oj_opt_out');
    expect(screen.queryByText('Your privacy choices')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Do Not Sell or Share My Personal Information' }));
    expect(screen.getByRole('link', { name: 'Privacy Policy' }).getAttribute('href')).toBe('/privacy');
    expect(screen.getByRole('link', { name: 'Terms of Service' }).getAttribute('href')).toBe('/terms');
  });
  it('persists opt-out independently of dismissal across mounts', () => {
    render(<PrivacyBanner />);
    fireEvent.click(screen.getByRole('button', { name: 'Do Not Sell or Share My Personal Information' }));
    expect(document.cookie).toContain('oj_opt_out=true');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notice' }));
    cleanup(); render(<PrivacyBanner />);
    expect(screen.queryByText('Your privacy choices')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Do Not Sell or Share My Personal Information' }));
    expect(screen.getByText('Your tracking opt-out is saved for this browser.')).toBeTruthy();
  });
  it('honors Global Privacy Control automatically', () => {
    Object.defineProperty(navigator, 'globalPrivacyControl', { configurable: true, value: true });
    render(<PrivacyBanner />);
    expect(document.cookie).toContain('oj_opt_out=true');
    expect(screen.getByText('Global Privacy Control is enabled. Your opt-out is active.')).toBeTruthy();
  });
});
