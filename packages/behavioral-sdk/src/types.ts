/**
 * SDK Configuration
 */
export interface SDKConfig {
  /** API key for authentication (format: bi_{orgId}_{keyId}_{...}) */
  apiKey: string;
  /** Endpoint URL (default: /api/v1/behavioral) */
  endpoint?: string;
  /** Entity type for this SDK instance (default: "contact") */
  entityType?: string;
  /** Flush interval in milliseconds (default: 1000) */
  flushIntervalMs?: number;
  /** Maximum batch size before auto-flush (default: 10) */
  maxBatchSize?: number;
  /** Enable consent mode — if false, no events are emitted (default: true) */
  consent?: boolean;
  /** Enable debug logging to console (default: false) */
  debug?: boolean;
  /** Capture device environmental context (GPS, signal, connection) */
  captureEnvironmental?: boolean;
}

/**
 * A behavioral event to be sent to the scoring engine
 */
export interface SDKEvent {
  event_type: string;
  entity_type: string;
  entity_id: string;
  timestamp: string;
  source: "sdk";
  signal_category: "behavioral" | "qualification";
  payload: Record<string, any>;
  environmental?: EnvironmentalData;
}

/**
 * Environmental context captured from the device
 */
export interface EnvironmentalData {
  latitude?: number;
  longitude?: number;
  altitude_m?: number;
  timezone?: string;
  signal_dbm?: number;
  connection_type?: string;
  downlink_mbps?: number;
  rtt_ms?: number;
}

/**
 * Score response from the API
 */
export interface SDKScore {
  entity_type: string;
  entity_id: string;
  vectors: Record<string, { raw: number; decayed: number; source: string }>;
  rfg: { recency: number };
  queried_at: string;
}

/**
 * Auto-tracking configuration
 */
export interface AutoTrackOptions {
  /** Track page views (default: true) */
  pageViews?: boolean;
  /** Track element clicks (default: false) */
  clicks?: boolean;
  /** Track scroll depth (default: false) */
  scrollDepth?: boolean;
  /** Track time on page (default: false) */
  timeOnPage?: boolean;
  /** CSS selector for click tracking (default: "a, button, [data-track]") */
  clickSelector?: string;
}

/**
 * Threshold crossing callback
 */
export interface ThresholdEvent {
  threshold_id: string;
  threshold_name: string;
  entity_id: string;
  vector_values: Record<string, number>;
  crossed_at: string;
}
