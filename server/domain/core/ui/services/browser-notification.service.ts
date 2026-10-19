/**
 * BrowserNotificationService
 *
 * Client-side service that dispatches native browser notifications for
 * pending approval decisions when the Oddjob tab is not focused.
 *
 * Features:
 * - Requests Notification API permission on user opt-in
 * - Dispatches notifications filtered by risk level configuration
 * - Suppresses notifications when the tab is focused (Page Visibility API)
 * - Uses BroadcastChannel for leader election — only one tab dispatches
 * - Handles permission denied, unsupported API, and BroadcastChannel unavailability
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8
 */

import type { DecisionNewEvent } from './decision-sse-client';
import { getDesktopBridge } from '@/lib/desktop-bridge';

// ─── Public Interfaces ──────────────────────────────────────────────────────

export interface BrowserNotificationConfig {
  enabled: boolean;
  riskLevels: ('low' | 'medium' | 'high')[];
  permissionState: NotificationPermission | 'unsupported';
}

// ─── Utility Function (exported for testing — Property 12) ──────────────────

/**
 * Determines whether a browser notification should be dispatched given
 * the event's risk level, the user's configured risk levels, and tab focus state.
 *
 * A notification is dispatched if and only if:
 * 1. The risk level is in the configured set
 * 2. The tab is NOT focused
 */
export function shouldDispatchBrowserNotification(
  riskLevel: string,
  config: Set<string>,
  tabFocused: boolean,
): boolean {
  return config.has(riskLevel) && !tabFocused;
}

// ─── Leader Election Protocol ───────────────────────────────────────────────

/**
 * Simple leader election messages over BroadcastChannel.
 *
 * Protocol:
 * - On construction, a tab sends 'claim' with its id
 * - If no 'reject' is received within 200ms, the tab becomes leader
 * - When the leader tab closes (beforeunload), it sends 'release'
 * - On 'release', remaining tabs attempt to claim leadership
 * - If a tab receives a 'claim' while it is already leader, it sends 'reject'
 */
interface LeaderMessage {
  type: 'claim' | 'reject' | 'release';
  tabId: string;
}

// ─── Service Class ──────────────────────────────────────────────────────────

const BROADCAST_CHANNEL_NAME = 'oddjob-decision-notifications';
const LEADER_CLAIM_TIMEOUT_MS = 200;
const NOTIFICATION_DESCRIPTION_MAX_LENGTH = 120;
/** Where /control/decisions redirects to; the desktop shell opens it directly. */
const DECISIONS_PATH = '/assistant/workbench';

export class BrowserNotificationService {
  private config: BrowserNotificationConfig;
  private broadcastChannel: BroadcastChannel | null = null;
  private isLeader = false;
  private tabId: string;
  private claimTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor() {
    this.tabId = this.generateTabId();

    // Default config: disabled, high-risk only, check API support. Nothing in the
    // web UI turns this on yet; installing the desktop shell is the opt-in, so
    // there it starts enabled for every risk level (the OS owns permission).
    this.config = getDesktopBridge()
      ? { enabled: true, riskLevels: ['low', 'medium', 'high'], permissionState: 'granted' }
      : {
          enabled: false,
          riskLevels: ['high'],
          permissionState: this.getInitialPermissionState(),
        };

    // Set up leader election via BroadcastChannel
    this.initBroadcastChannel();

    // Listen for tab close to release leadership
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', this.handleBeforeUnload);
    }
  }

  // ─── Public Methods ─────────────────────────────────────────────────────

  /**
   * Request Notification API permission from the user.
   * Called when the user enables browser notifications in settings.
   *
   * Requirements: 6.1, 6.5
   */
  async requestPermission(): Promise<NotificationPermission | 'unsupported'> {
    if (!this.isNotificationApiSupported()) {
      this.config.permissionState = 'unsupported';
      this.config.enabled = false;
      return 'unsupported';
    }

    try {
      const result = await Notification.requestPermission();
      this.config.permissionState = result;

      if (result === 'denied') {
        // Record denial — disable toggle, don't prompt again
        this.config.enabled = false;
      } else if (result === 'granted') {
        this.config.enabled = true;
      }

      return result;
    } catch {
      // Some browsers may throw on requestPermission
      this.config.permissionState = 'denied';
      this.config.enabled = false;
      return 'denied';
    }
  }

  /**
   * Dispatch a browser notification for a new decision event.
   * Checks risk level filtering, tab focus, leader status, and permission.
   *
   * Requirements: 6.2, 6.3, 6.4, 6.8
   */
  dispatch(event: DecisionNewEvent): void {
    if (this.disposed) return;
    if (!this.config.enabled) return;
    if (this.config.permissionState !== 'granted') return;

    // Only the leader tab dispatches (or fall back to always dispatch if no BroadcastChannel)
    if (this.broadcastChannel !== null && !this.isLeader) return;

    // Check risk level and tab focus
    const riskLevels = new Set<string>(this.config.riskLevels);
    const tabFocused = this.isTabFocused();

    if (!shouldDispatchBrowserNotification(event.riskLevel, riskLevels, tabFocused)) {
      return;
    }

    // Truncate description to 120 characters
    const description = this.truncateDescription(event.description);
    const title = `${event.toolName} — ${event.riskLevel.toUpperCase()} risk`;
    const body = description;

    // In the desktop shell the main process owns the notification, so a click
    // can raise and focus the window, which window.focus() cannot do there.
    const desktop = getDesktopBridge();
    if (desktop) {
      desktop.notify(title, body, DECISIONS_PATH);
      return;
    }

    try {
      const notification = new Notification(title, {
        body,
        tag: `decision-${event.requestId}`,
        requireInteraction: false,
      });

      // Focus Oddjob tab and navigate to decisions page on click
      notification.onclick = () => {
        window.focus();
        window.location.href = '/control/decisions';
        notification.close();
      };
    } catch {
      // Silently handle notification creation failures
    }
  }

  /**
   * Update the service configuration.
   * Persistence is handled by the settings UI (task 12.2).
   *
   * Requirements: 6.6
   */
  setConfig(config: Partial<BrowserNotificationConfig>): void {
    if (config.enabled !== undefined) {
      this.config.enabled = config.enabled;
    }
    if (config.riskLevels !== undefined) {
      this.config.riskLevels = config.riskLevels;
    }
    if (config.permissionState !== undefined) {
      this.config.permissionState = config.permissionState;
    }
  }

  /**
   * Get the current configuration (read-only snapshot).
   */
  getConfig(): Readonly<BrowserNotificationConfig> {
    return { ...this.config };
  }

  /**
   * Returns whether the Notification API is supported in the current browser.
   */
  isNotificationApiSupported(): boolean {
    return typeof window !== 'undefined' && 'Notification' in window;
  }

  /**
   * Returns the current leader status (for testing/debugging).
   */
  getIsLeader(): boolean {
    return this.isLeader;
  }

  /**
   * Tear down the service — clean up BroadcastChannel, timers, and event listeners.
   */
  dispose(): void {
    this.disposed = true;

    if (this.claimTimer) {
      clearTimeout(this.claimTimer);
      this.claimTimer = null;
    }

    if (this.broadcastChannel) {
      // Release leadership before closing
      if (this.isLeader) {
        this.sendMessage({ type: 'release', tabId: this.tabId });
      }
      this.broadcastChannel.close();
      this.broadcastChannel = null;
    }

    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', this.handleBeforeUnload);
    }
  }

  // ─── Private Methods ────────────────────────────────────────────────────

  private getInitialPermissionState(): NotificationPermission | 'unsupported' {
    if (!this.isNotificationApiSupported()) {
      return 'unsupported';
    }
    return Notification.permission;
  }

  private isTabFocused(): boolean {
    if (typeof document === 'undefined') return false;
    return document.visibilityState === 'visible' && document.hasFocus();
  }

  private truncateDescription(text: string): string {
    if (text.length <= NOTIFICATION_DESCRIPTION_MAX_LENGTH) {
      return text;
    }
    return text.slice(0, NOTIFICATION_DESCRIPTION_MAX_LENGTH) + '…';
  }

  private generateTabId(): string {
    return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  // ─── BroadcastChannel Leader Election ─────────────────────────────────

  private initBroadcastChannel(): void {
    if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
      // BroadcastChannel unavailable — fall back to always dispatching
      this.broadcastChannel = null;
      this.isLeader = true; // Always dispatch in fallback mode
      return;
    }

    try {
      this.broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      this.broadcastChannel.onmessage = this.handleBroadcastMessage;
      // Attempt to claim leadership
      this.claimLeadership();
    } catch {
      // BroadcastChannel construction failed — fall back to always dispatching
      this.broadcastChannel = null;
      this.isLeader = true;
    }
  }

  private claimLeadership(): void {
    this.sendMessage({ type: 'claim', tabId: this.tabId });

    // If no reject received within timeout, become leader
    this.claimTimer = setTimeout(() => {
      this.claimTimer = null;
      if (!this.isLeader) {
        this.isLeader = true;
      }
    }, LEADER_CLAIM_TIMEOUT_MS);
  }

  private handleBroadcastMessage = (event: MessageEvent<LeaderMessage>): void => {
    if (this.disposed) return;

    const message = event.data;

    switch (message.type) {
      case 'claim':
        // Another tab is claiming leadership
        if (this.isLeader) {
          // We are already leader — reject the claim
          this.sendMessage({ type: 'reject', tabId: this.tabId });
        }
        break;

      case 'reject':
        // Our claim was rejected — we are not leader
        if (this.claimTimer) {
          clearTimeout(this.claimTimer);
          this.claimTimer = null;
        }
        this.isLeader = false;
        break;

      case 'release':
        // Leader tab is closing — attempt to claim leadership
        this.claimLeadership();
        break;
    }
  };

  private sendMessage(message: LeaderMessage): void {
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage(message);
      } catch {
        // Channel may have been closed — ignore
      }
    }
  }

  private handleBeforeUnload = (): void => {
    if (this.isLeader && this.broadcastChannel) {
      this.sendMessage({ type: 'release', tabId: this.tabId });
    }
  };
}
