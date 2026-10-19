# @oddjob/behavioral-sdk

Lightweight JavaScript SDK for the Oddjob Behavioral Intelligence Engine. Track user behavior, emit scoring signals, and read real-time scores from your application.

**< 15KB gzipped** | Zero dependencies | TypeScript-first

## Installation

```bash
npm install @oddjob/behavioral-sdk
```

## Quick Start

```typescript
import { BehavioralSDK } from '@oddjob/behavioral-sdk';

const sdk = BehavioralSDK.init({
  apiKey: 'bi_291_abc123_...',  // From Oddjob management console
  endpoint: 'https://your-oddjob.com/api/v1/behavioral',
});

// Auto-track page views, clicks, scroll depth
const cleanup = sdk.autoTrack({ pageViews: true, clicks: true, scrollDepth: true });

// Emit custom signals
sdk.signal('pricing_page_viewed', { tier: 'enterprise' });
sdk.signal('demo_requested', { persona: 'VP Engineering' });

// Identify the user (merges anonymous → known)
sdk.identify('user-123', { name: 'Sarah Chen', company: 'Acme Corp' });

// Read current score
const score = await sdk.getScore();
console.log(score?.vectors); // { Budget: { decayed: 0.72 }, Authority: { decayed: 0.65 } }

// Subscribe to threshold crossings
sdk.onThreshold('sales_qualified', (event) => {
  showCelebration();
  notifyAE(event.entity_id);
});
```

## Configuration

```typescript
BehavioralSDK.init({
  apiKey: 'bi_...',              // Required: API key from management console
  endpoint: '/api/v1/behavioral', // API endpoint (default: relative path)
  entityType: 'contact',         // Entity type (default: "contact")
  flushIntervalMs: 1000,         // Batch flush interval (default: 1s)
  maxBatchSize: 10,              // Max events before auto-flush (default: 10)
  consent: true,                 // Enable/disable tracking (default: true)
  debug: false,                  // Console logging (default: false)
  captureEnvironmental: false,   // Capture device context (default: false)
});
```

## API

### `sdk.signal(eventType, payload?)`
Emit a custom behavioral signal.

### `sdk.identify(knownId, attributes?)`
Associate the anonymous session with a known user. Merges scores server-side.

### `sdk.setAttributes(attributes)`
Set qualification attributes (non-behavioral signals like CRM data).

### `sdk.getScore()`
Read the current decay-adjusted score for this entity.

### `sdk.autoTrack(options?)`
Enable automatic tracking. Returns a cleanup function.

### `sdk.onThreshold(name, callback)`
Subscribe to threshold crossing events. Returns an unsubscribe function.

### `sdk.setConsent(granted)`
Update consent status. If `false`, stops all tracking and clears the queue.

### `sdk.flush()`
Force-flush all queued events immediately.

### `sdk.destroy()`
Clean up the SDK instance (flushes remaining events).

## Offline Support

Events are queued in `localStorage` when offline and automatically replayed when connectivity is restored. The SDK uses `navigator.onLine` and the `online`/`offline` events for detection.

## Consent

```typescript
// Initialize with consent disabled
const sdk = BehavioralSDK.init({ apiKey: '...', consent: false });

// Later, when user grants consent:
sdk.setConsent(true);

// If user revokes consent:
sdk.setConsent(false); // Stops tracking, clears queue
```

## Environmental Context

When `captureEnvironmental: true`, the SDK captures:
- Timezone (IANA identifier)
- Connection type (4g, wifi, etc.)
- Downlink speed (Mbps)
- Round-trip time (ms)

GPS altitude and signal dBm require explicit permission and are only captured when the host application provides them via `sdk.signal()` payload.
