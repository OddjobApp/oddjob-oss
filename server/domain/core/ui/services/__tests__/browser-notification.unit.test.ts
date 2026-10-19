/**
 * BrowserNotificationService - Unit Tests
 *
 * Tests for Requirements 6.1, 6.4, 6.6, 6.7:
 * - 6.1: Permission prompt flow — requestPermission() calls Notification.requestPermission()
 * - 6.4: Suppression when tab is focused — no browser notifications dispatched
 * - 6.6: Default config is high-risk only
 * - 6.7: Unsupported Notification API disables feature
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BrowserNotificationService } from '../browser-notification.service.js';
import type { DecisionNewEvent } from '../decision-sse-client.js';

// ─── Mock Infrastructure ────────────────────────────────────────────────────

class MockNotification {
  static permission: NotificationPermission = 'default';
  static requestPermission = vi.fn<() => Promise<NotificationPermission>>().mockResolvedValue('granted');
  static instances: MockNotification[] = [];

  title: string;
  options: NotificationOptions;
  onclick: ((event: Event) => void) | null = null;
  close = vi.fn();

  constructor(title: string, options?: NotificationOptions) {
    this.title = title;
    this.options = options ?? {};
    MockNotification.instances.push(this);
  }

  static reset(): void {
    MockNotification.permission = 'default';
    MockNotification.requestPermission.mockResolvedValue('granted');
    MockNotification.instances = [];
  }

  static latest(): MockNotification | undefined {
    return MockNotification.instances[MockNotification.instances.length - 1];
  }
}

class MockBroadcastChannel {
  static instances: MockBroadcastChannel[] = [];

  name: string;
  onmessage: ((event: MessageEvent) => void) | null = null;
  postMessage = vi.fn();
  close = vi.fn();

  constructor(name: string) {
    this.name = name;
    MockBroadcastChannel.instances.push(this);
  }

  static reset(): void {
    MockBroadcastChannel.instances = [];
  }

  static latest(): MockBroadcastChannel | undefined {
    return MockBroadcastChannel.instances[MockBroadcastChannel.instances.length - 1];
  }
}

function createDecisionEvent(overrides: Partial<DecisionNewEvent> = {}): DecisionNewEvent {
  return {
    type: 'decision:new',
    requestId: 1,
    toolName: 'shell',
    riskLevel: 'high',
    description: 'Execute deployment script on production',
    missionId: 7,
    createdAt: '2024-01-15T10:30:00.000Z',
    ...overrides,
  };
}

// ─── Test Suite ─────────────────────────────────────────────────────────────

describe('BrowserNotificationService', () => {
  let service: BrowserNotificationService;
  let originalVisibilityState: PropertyDescriptor | undefined;
  let originalHasFocus: () => boolean;

  beforeEach(() => {
    vi.useFakeTimers();
    MockNotification.reset();
    MockBroadcastChannel.reset();

    // Set up global mocks
    (globalThis as any).Notification = MockNotification;
    (globalThis as any).BroadcastChannel = MockBroadcastChannel;

    // Save original values
    originalVisibilityState = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    originalHasFocus = document.hasFocus;

    // Default: tab is NOT focused
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      writable: true,
      configurable: true,
    });
    document.hasFocus = vi.fn().mockReturnValue(false);

    // Mock window.focus and window.location
    vi.spyOn(window, 'focus').mockImplementation(() => {});
    Object.defineProperty(window, 'location', {
      value: { href: '/' },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    if (service) {
      service.dispose();
    }
    vi.useRealTimers();
    vi.restoreAllMocks();

    // Restore document.visibilityState
    if (originalVisibilityState) {
      Object.defineProperty(document, 'visibilityState', originalVisibilityState);
    } else {
      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        writable: true,
        configurable: true,
      });
    }
    document.hasFocus = originalHasFocus;

    delete (globalThis as any).Notification;
    delete (globalThis as any).BroadcastChannel;
  });

  function createServiceAsLeader(): BrowserNotificationService {
    service = new BrowserNotificationService();
    // Wait for the claim timeout to make the service become leader
    vi.advanceTimersByTime(250);
    return service;
  }

  // ─── Permission Prompt Flow (Requirement 6.1) ─────────────────────────

  describe('Permission prompt flow', () => {
    it('should call Notification.requestPermission() when requestPermission is invoked', async () => {
      service = createServiceAsLeader();

      await service.requestPermission();

      expect(MockNotification.requestPermission).toHaveBeenCalledTimes(1);
    });

    it('should set enabled=true and permissionState=granted when permission is granted', async () => {
      MockNotification.requestPermission.mockResolvedValue('granted');
      service = createServiceAsLeader();

      const result = await service.requestPermission();

      expect(result).toBe('granted');
      expect(service.getConfig().enabled).toBe(true);
      expect(service.getConfig().permissionState).toBe('granted');
    });

    it('should set enabled=false and permissionState=denied when permission is denied', async () => {
      MockNotification.requestPermission.mockResolvedValue('denied');
      service = createServiceAsLeader();

      const result = await service.requestPermission();

      expect(result).toBe('denied');
      expect(service.getConfig().enabled).toBe(false);
      expect(service.getConfig().permissionState).toBe('denied');
    });

    it('should return "unsupported" when Notification API is not in window', async () => {
      delete (globalThis as any).Notification;
      service = new BrowserNotificationService();
      vi.advanceTimersByTime(250);

      const result = await service.requestPermission();

      expect(result).toBe('unsupported');
      expect(service.getConfig().enabled).toBe(false);
      expect(service.getConfig().permissionState).toBe('unsupported');
    });

    it('should handle requestPermission throwing an error gracefully', async () => {
      MockNotification.requestPermission.mockRejectedValue(new Error('Browser error'));
      service = createServiceAsLeader();

      const result = await service.requestPermission();

      expect(result).toBe('denied');
      expect(service.getConfig().enabled).toBe(false);
      expect(service.getConfig().permissionState).toBe('denied');
    });
  });

  // ─── Default Config (Requirement 6.6) ─────────────────────────────────

  describe('Default config is high-risk only', () => {
    it('should default riskLevels to ["high"]', () => {
      service = createServiceAsLeader();

      const config = service.getConfig();

      expect(config.riskLevels).toEqual(['high']);
    });

    it('should default enabled to false', () => {
      service = createServiceAsLeader();

      const config = service.getConfig();

      expect(config.enabled).toBe(false);
    });

    it('should default permissionState to the current Notification.permission', () => {
      MockNotification.permission = 'default';
      service = createServiceAsLeader();

      const config = service.getConfig();

      expect(config.permissionState).toBe('default');
    });

    it('should allow updating riskLevels via setConfig', () => {
      service = createServiceAsLeader();

      service.setConfig({ riskLevels: ['low', 'medium', 'high'] });

      expect(service.getConfig().riskLevels).toEqual(['low', 'medium', 'high']);
    });
  });

  // ─── Suppression When Tab Focused (Requirement 6.4) ───────────────────

  describe('Suppression when tab focused', () => {
    it('should NOT dispatch notification when tab is focused (visible + hasFocus)', () => {
      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        writable: true,
        configurable: true,
      });
      (document.hasFocus as ReturnType<typeof vi.fn>).mockReturnValue(true);

      service = createServiceAsLeader();
      service.setConfig({ enabled: true, permissionState: 'granted', riskLevels: ['high'] });

      service.dispatch(createDecisionEvent({ riskLevel: 'high' }));

      expect(MockNotification.instances).toHaveLength(0);
    });

    it('should dispatch notification when tab is hidden', () => {
      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        writable: true,
        configurable: true,
      });
      (document.hasFocus as ReturnType<typeof vi.fn>).mockReturnValue(false);

      service = createServiceAsLeader();
      service.setConfig({ enabled: true, permissionState: 'granted', riskLevels: ['high'] });

      service.dispatch(createDecisionEvent({ riskLevel: 'high' }));

      expect(MockNotification.instances).toHaveLength(1);
    });

    it('should dispatch notification when visibilityState is visible but hasFocus is false', () => {
      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        writable: true,
        configurable: true,
      });
      (document.hasFocus as ReturnType<typeof vi.fn>).mockReturnValue(false);

      service = createServiceAsLeader();
      service.setConfig({ enabled: true, permissionState: 'granted', riskLevels: ['high'] });

      service.dispatch(createDecisionEvent({ riskLevel: 'high' }));

      expect(MockNotification.instances).toHaveLength(1);
    });

    it('should NOT dispatch when visibilityState is hidden but hasFocus is true (edge case)', () => {
      // This edge case: visibilityState = hidden but hasFocus = true
      // The service checks both: visibilityState === 'visible' && hasFocus()
      // So hidden + hasFocus => tabFocused = false => SHOULD dispatch
      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        writable: true,
        configurable: true,
      });
      (document.hasFocus as ReturnType<typeof vi.fn>).mockReturnValue(true);

      service = createServiceAsLeader();
      service.setConfig({ enabled: true, permissionState: 'granted', riskLevels: ['high'] });

      service.dispatch(createDecisionEvent({ riskLevel: 'high' }));

      // Tab is NOT considered focused because visibilityState != 'visible'
      expect(MockNotification.instances).toHaveLength(1);
    });
  });

  // ─── Notification Click (Requirement 6.3) ────────────────────────────

  describe('Notification click focuses tab and navigates', () => {
    it('should call window.focus() when notification is clicked', () => {
      service = createServiceAsLeader();
      service.setConfig({ enabled: true, permissionState: 'granted', riskLevels: ['high'] });

      service.dispatch(createDecisionEvent({ riskLevel: 'high' }));

      const notification = MockNotification.latest()!;
      expect(notification).toBeDefined();
      expect(notification.onclick).not.toBeNull();

      // Simulate click
      notification.onclick!(new Event('click'));

      expect(window.focus).toHaveBeenCalled();
    });

    it('should navigate to /control/decisions when notification is clicked', () => {
      service = createServiceAsLeader();
      service.setConfig({ enabled: true, permissionState: 'granted', riskLevels: ['high'] });

      service.dispatch(createDecisionEvent({ riskLevel: 'high' }));

      const notification = MockNotification.latest()!;
      notification.onclick!(new Event('click'));

      expect(window.location.href).toBe('/control/decisions');
    });

    it('should close the notification after click', () => {
      service = createServiceAsLeader();
      service.setConfig({ enabled: true, permissionState: 'granted', riskLevels: ['high'] });

      service.dispatch(createDecisionEvent({ riskLevel: 'high' }));

      const notification = MockNotification.latest()!;
      notification.onclick!(new Event('click'));

      expect(notification.close).toHaveBeenCalled();
    });
  });

  // ─── Unsupported API (Requirement 6.7) ────────────────────────────────

  describe('Unsupported API disables feature', () => {
    it('should set permissionState to "unsupported" when Notification is not in window', () => {
      delete (globalThis as any).Notification;

      service = new BrowserNotificationService();
      vi.advanceTimersByTime(250);

      const config = service.getConfig();
      expect(config.permissionState).toBe('unsupported');
    });

    it('should set enabled to false when Notification is not supported', () => {
      delete (globalThis as any).Notification;

      service = new BrowserNotificationService();
      vi.advanceTimersByTime(250);

      const config = service.getConfig();
      expect(config.enabled).toBe(false);
    });

    it('should report isNotificationApiSupported() as false when Notification is missing', () => {
      delete (globalThis as any).Notification;

      service = new BrowserNotificationService();
      vi.advanceTimersByTime(250);

      expect(service.isNotificationApiSupported()).toBe(false);
    });

    it('should report isNotificationApiSupported() as true when Notification exists', () => {
      service = createServiceAsLeader();

      expect(service.isNotificationApiSupported()).toBe(true);
    });
  });

  // ─── Leader Election (Requirement 6.8) ────────────────────────────────

  describe('Leader election — only leader tab dispatches', () => {
    it('should become leader after claim timeout (no rejection)', () => {
      service = new BrowserNotificationService();

      // Before timeout, not yet leader
      expect(service.getIsLeader()).toBe(false);

      // After 200ms timeout, should be leader
      vi.advanceTimersByTime(250);
      expect(service.getIsLeader()).toBe(true);
    });

    it('should NOT dispatch notification when not leader', () => {
      service = new BrowserNotificationService();
      // Don't advance timers — service is NOT leader yet
      service.setConfig({ enabled: true, permissionState: 'granted', riskLevels: ['high'] });

      service.dispatch(createDecisionEvent({ riskLevel: 'high' }));

      expect(MockNotification.instances).toHaveLength(0);
    });

    it('should dispatch notification when leader', () => {
      service = createServiceAsLeader();
      service.setConfig({ enabled: true, permissionState: 'granted', riskLevels: ['high'] });

      service.dispatch(createDecisionEvent({ riskLevel: 'high' }));

      expect(MockNotification.instances).toHaveLength(1);
    });

    it('should lose leadership when receiving a reject message', () => {
      service = new BrowserNotificationService();

      const bc = MockBroadcastChannel.latest()!;
      expect(bc).toBeDefined();

      // Simulate a reject from another leader tab
      bc.onmessage!(new MessageEvent('message', {
        data: { type: 'reject', tabId: 'other-tab-123' },
      }));

      // Even after timeout, should NOT be leader because of rejection
      vi.advanceTimersByTime(250);
      expect(service.getIsLeader()).toBe(false);
    });

    it('should send release message on dispose when leader', () => {
      service = createServiceAsLeader();

      const bc = MockBroadcastChannel.latest()!;

      service.dispose();

      expect(bc.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'release' })
      );
    });

    it('should fall back to always dispatching when BroadcastChannel is unavailable', () => {
      delete (globalThis as any).BroadcastChannel;

      service = new BrowserNotificationService();
      service.setConfig({ enabled: true, permissionState: 'granted', riskLevels: ['high'] });

      // Should be leader immediately (fallback mode)
      expect(service.getIsLeader()).toBe(true);

      service.dispatch(createDecisionEvent({ riskLevel: 'high' }));

      expect(MockNotification.instances).toHaveLength(1);
    });
  });

  // ─── Risk Level Filtering ─────────────────────────────────────────────

  describe('Risk level filtering', () => {
    it('should NOT dispatch notification for risk level not in config', () => {
      service = createServiceAsLeader();
      service.setConfig({ enabled: true, permissionState: 'granted', riskLevels: ['high'] });

      service.dispatch(createDecisionEvent({ riskLevel: 'low' }));

      expect(MockNotification.instances).toHaveLength(0);
    });

    it('should dispatch notification for risk level in config', () => {
      service = createServiceAsLeader();
      service.setConfig({ enabled: true, permissionState: 'granted', riskLevels: ['high'] });

      service.dispatch(createDecisionEvent({ riskLevel: 'high' }));

      expect(MockNotification.instances).toHaveLength(1);
    });

    it('should dispatch for medium when medium is configured', () => {
      service = createServiceAsLeader();
      service.setConfig({ enabled: true, permissionState: 'granted', riskLevels: ['medium', 'high'] });

      service.dispatch(createDecisionEvent({ riskLevel: 'medium' }));

      expect(MockNotification.instances).toHaveLength(1);
    });

    it('should NOT dispatch when enabled is false even if risk level matches', () => {
      service = createServiceAsLeader();
      service.setConfig({ enabled: false, permissionState: 'granted', riskLevels: ['high'] });

      service.dispatch(createDecisionEvent({ riskLevel: 'high' }));

      expect(MockNotification.instances).toHaveLength(0);
    });

    it('should NOT dispatch when permission is not granted', () => {
      service = createServiceAsLeader();
      service.setConfig({ enabled: true, permissionState: 'default', riskLevels: ['high'] });

      service.dispatch(createDecisionEvent({ riskLevel: 'high' }));

      expect(MockNotification.instances).toHaveLength(0);
    });
  });

  // ─── Desktop shell (desktop/src/preload.cjs) ──────────────────────────

  describe('Inside the desktop shell', () => {
    const bridge = { isDesktop: true as const, notify: vi.fn(), setBadge: vi.fn() };

    beforeEach(() => {
      bridge.notify.mockReset();
      window.oddjobDesktop = bridge;
    });

    afterEach(() => {
      delete window.oddjobDesktop;
    });

    it('starts enabled for every risk level without a permission prompt', () => {
      service = createServiceAsLeader();

      expect(service.getConfig()).toEqual({
        enabled: true,
        riskLevels: ['low', 'medium', 'high'],
        permissionState: 'granted',
      });
    });

    it('sends through the bridge, not the Notification API', () => {
      service = createServiceAsLeader();

      service.dispatch(createDecisionEvent({ riskLevel: 'low', toolName: 'send_email' }));

      expect(bridge.notify).toHaveBeenCalledWith(
        'send_email — LOW risk',
        'Execute deployment script on production',
        '/assistant/workbench',
      );
      expect(MockNotification.instances).toHaveLength(0);
    });

    it('still stays quiet while the window is focused', () => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true, configurable: true });
      (document.hasFocus as ReturnType<typeof vi.fn>).mockReturnValue(true);
      service = createServiceAsLeader();

      service.dispatch(createDecisionEvent());

      expect(bridge.notify).not.toHaveBeenCalled();
    });
  });

  it('stays disabled in a plain browser', () => {
    service = createServiceAsLeader();

    expect(service.getConfig().enabled).toBe(false);
  });
});
