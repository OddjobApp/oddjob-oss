/**
 * @oddjob/behavioral-sdk
 *
 * Lightweight JavaScript SDK for the Oddjob Behavioral Intelligence Engine.
 * Target: <15KB gzipped.
 *
 * Features:
 * - Auto-tracking (page views, clicks, scroll depth, time-on-page)
 * - Explicit signal methods (signal, identify, setAttributes)
 * - Event batching (flush every 1s or 10 events)
 * - Offline queue (localStorage) with replay on reconnect
 * - Consent parameter (prevent emission when false)
 * - Optional device context (GPS altitude, signal dBm, connection type)
 *
 * Usage:
 * ```typescript
 * import { BehavioralSDK } from '@oddjob/behavioral-sdk';
 *
 * const sdk = BehavioralSDK.init({
 *   apiKey: 'bi_291_abc123_...',
 *   endpoint: 'https://your-oddjob.com/api/v1/behavioral',
 * });
 *
 * sdk.signal('pricing_page_viewed', { tier: 'enterprise' });
 * sdk.identify('user-123', { name: 'Sarah', company: 'Acme' });
 * ```
 */

export { BehavioralSDK } from './sdk';
export type { SDKConfig, SDKEvent, SDKScore, AutoTrackOptions } from './types';
