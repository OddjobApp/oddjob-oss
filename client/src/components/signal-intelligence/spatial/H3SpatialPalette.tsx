import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  latLngToCell,
  cellToLatLng,
  cellToBoundary,
  gridDisk,
  cellToParent,
  cellToChildren,
  getResolution,
  isValidCell,
} from 'h3-js';
import {
  Search,
  MapPin,
  Compass,
  Layers,
  Check,
  RotateCcw,
  Sparkles,
  Shield,
  Radio,
  Sliders,
  Crosshair,
  Maximize2,
  Minimize2,
  Navigation,
  Hand,
  Brush,
  Eraser,
  BoxSelect,
  HelpCircle,
  Copy,
  CheckCheck,
  Keyboard,
  Radar,
  Plus,
  Minus,
  Trash2,
  Pencil,
  Hexagon,
  FileCode,
  Globe,
  Flame,
  Activity,
  UploadCloud,
  ChevronDown,
  Wand2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  GROUP_AGGREGATION_CATALOG,
  GEOFENCE_TRIGGER_CATALOG,
  makeCellGroupId,
  requiredMatchCount,
  type GroupAggregation,
  type SpatialCellGroup,
  type GeofenceTrigger,
  type SpatialPersistenceConfig,
} from '@shared/contracts/spatial-predicates';
import {
  Clock,
  Timer,
  Zap,
  SlidersHorizontal,
  Info,
  TrendingUp,
} from 'lucide-react';

export const H3_RESOLUTION_AREAS_KM2: Record<number, number> = {
  0: 4250546.8,
  1: 607220.9,
  2: 86745.8,
  3: 12392.2,
  4: 1770.3,
  5: 252.9,
  6: 36.129,
  7: 5.161,
  8: 0.737,
  9: 0.105,
  10: 0.015,
  11: 0.0021,
  12: 0.000307,
  13: 0.000044,
  14: 0.0000063,
  15: 0.0000009,
};

export function getH3ResolutionArea(res: number): string {
  const km2 = H3_RESOLUTION_AREAS_KM2[res] ?? 5.161;
  if (km2 >= 1) {
    return `~${km2.toLocaleString(undefined, { maximumFractionDigits: 2 })} km²`;
  }
  const m2 = km2 * 1_000_000;
  if (m2 >= 1000) {
    return `~${Math.round(m2).toLocaleString()} m²`;
  }
  return `~${m2.toFixed(1)} m²`;
}

export interface SpatialRegionSelection {
  regionName: string;
  centerLat: number;
  centerLng: number;
  h3Resolution: number;
  /** Union of every group's tiles — kept for callers that want a flat set. */
  selectedHexes: string[];
  /** Named tile sets, each with its own aggregation policy. */
  cellGroups: SpatialCellGroup[];
  radiusKm: number;
  summaryLabel: string;
  /** Optional temporal geofence trigger configuration */
  temporalTrigger?: GeofenceTrigger;
  dwellSlaMinutes?: number;
  approachBufferKm?: number;
  persistence?: SpatialPersistenceConfig;
}

export interface StrategicSectorPreset {
  id: string;
  name: string;
  category: 'Maritime Chokepoint' | 'Logistics Hub' | 'Energy Corridor' | 'Defense Corridor' | 'Critical Infrastructure' | 'Aerospace';
  lat: number;
  lng: number;
  resolution: number;
  kRing: number;
  description: string;
}

export const STRATEGIC_SECTOR_PRESETS: StrategicSectorPreset[] = [
  {
    id: 'suez_canal',
    name: 'Suez Canal Chokepoint',
    category: 'Maritime Chokepoint',
    lat: 29.975,
    lng: 32.559,
    resolution: 7,
    kRing: 2,
    description: 'Vital maritime arterial link between the Mediterranean and the Red Sea.',
  },
  {
    id: 'strait_of_malacca',
    name: 'Strait of Malacca / Singapore',
    category: 'Maritime Chokepoint',
    lat: 1.290,
    lng: 103.851,
    resolution: 8,
    kRing: 2,
    description: 'Global container shipping bottleneck connecting the Indian and Pacific Oceans.',
  },
  {
    id: 'port_of_rotterdam',
    name: 'Port of Rotterdam Terminal',
    category: 'Logistics Hub',
    lat: 51.924,
    lng: 4.477,
    resolution: 8,
    kRing: 2,
    description: 'Largest deep-water seaport in Europe, handling critical petrochemicals and freight.',
  },
  {
    id: 'strait_of_hormuz',
    name: 'Strait of Hormuz',
    category: 'Energy Corridor',
    lat: 26.566,
    lng: 56.250,
    resolution: 7,
    kRing: 2,
    description: 'Primary global petroleum transit artery between the Persian Gulf and Gulf of Oman.',
  },
  {
    id: 'port_of_la_long_beach',
    name: 'Port of LA & Long Beach',
    category: 'Logistics Hub',
    lat: 33.743,
    lng: -118.267,
    resolution: 8,
    kRing: 2,
    description: 'Busiest container port complex in the Western Hemisphere.',
  },
  {
    id: 'panama_canal',
    name: 'Panama Canal Locks',
    category: 'Maritime Chokepoint',
    lat: 9.120,
    lng: -79.695,
    resolution: 8,
    kRing: 2,
    description: 'Interoceanic canal joining the Atlantic and Pacific maritime routes.',
  },
  {
    id: 'taiwan_strait',
    name: 'Taiwan Strait Transit Zone',
    category: 'Defense Corridor',
    lat: 24.000,
    lng: 119.500,
    resolution: 6,
    kRing: 2,
    description: 'Strategic international maritime corridor with high-density global trade.',
  },
  {
    id: 'nord_stream_corridor',
    name: 'Baltic Energy Infrastructure',
    category: 'Critical Infrastructure',
    lat: 55.500,
    lng: 15.500,
    resolution: 7,
    kRing: 2,
    description: 'Critical subsea pipeline and maritime cable corridor in the Baltic Sea.',
  },
  {
    id: 'lax_perimeter',
    name: 'LAX International Airspace',
    category: 'Aerospace',
    lat: 33.941,
    lng: -118.408,
    resolution: 8,
    kRing: 2,
    description: 'High-density terminal radar airspace and perimeter security envelope.',
  },
];

export interface SignalTelemetryItem {
  id: string;
  h3Cell?: string;
  lat?: number;
  lng?: number;
  severity?: 'critical' | 'high' | 'medium' | 'low' | 'info' | string;
}

interface H3SpatialPaletteProps {
  initialRegion?: string;
  initialResolution?: number;
  initialHexes?: string[];
  initialGroups?: SpatialCellGroup[];
  onSelectRegion?: (region: SpatialRegionSelection) => void;
  onClose?: () => void;
  /**
   * IANA timezone used to pick the opening map centre, normally the
   * organization's configured zone.
   */
  timeZone?: string | null;
  /** Streaming signals passed from dashboard for live density heatmaps and cross-filtering */
  activeSignals?: SignalTelemetryItem[];
  /** Callback fired when a cell is hovered on the map */
  onHoverCell?: (cellId: string | null) => void;
  /** Callback fired when a cell is clicked to filter signals */
  onFilterCell?: (cellId: string | null) => void;
}

/** Map interaction tool. Pan moves viewport; paint/erase edit active set; marquee batch-selects within bounding box. */
type MapTool = 'pan' | 'paint' | 'erase' | 'marquee';

/** Metric visualization layer modes */
export type MetricOverlayMode = 'groups' | 'density' | 'threat';

/**
 * Palette for tile groups.
 */
const GROUP_COLORS = [
  { token: 'cyan', stroke: '#22D3EE', fill: 'rgba(34, 211, 238, 0.28)', text: 'text-cyan-300', bg: 'bg-cyan-500/15', border: 'border-cyan-500/40' },
  { token: 'amber', stroke: '#FBBF24', fill: 'rgba(251, 191, 36, 0.28)', text: 'text-amber-300', bg: 'bg-amber-500/15', border: 'border-amber-500/40' },
  { token: 'emerald', stroke: '#34D399', fill: 'rgba(52, 211, 153, 0.28)', text: 'text-emerald-300', bg: 'bg-emerald-500/15', border: 'border-emerald-500/40' },
  { token: 'fuchsia', stroke: '#E879F9', fill: 'rgba(232, 121, 249, 0.28)', text: 'text-fuchsia-300', bg: 'bg-fuchsia-500/15', border: 'border-fuchsia-500/40' },
  { token: 'orange', stroke: '#FB923C', fill: 'rgba(251, 146, 60, 0.28)', text: 'text-orange-300', bg: 'bg-orange-500/15', border: 'border-orange-500/40' },
  { token: 'violet', stroke: '#A78BFA', fill: 'rgba(167, 139, 250, 0.28)', text: 'text-violet-300', bg: 'bg-violet-500/15', border: 'border-violet-500/40' },
] as const;

function groupColor(token: string | undefined) {
  return GROUP_COLORS.find((c) => c.token === token) ?? GROUP_COLORS[0];
}

const FALLBACK_UTC_OFFSET_HOURS = -8;

/** UTC offset in hours for a zone at a specific instant. DST-aware. */
function offsetHoursAt(ianaTimeZone: string, at: Date): number | null {
  try {
    const tzName = new Intl.DateTimeFormat("en-US", {
      timeZone: ianaTimeZone,
      timeZoneName: "shortOffset",
    })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")?.value;

    if (tzName === "GMT") return 0;
    const match = tzName?.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    if (!match) return null;

    const sign = match[1] === "-" ? -1 : 1;
    const hours = parseInt(match[2], 10);
    const minutes = match[3] ? parseInt(match[3], 10) : 0;
    return sign * (hours + minutes / 60);
  } catch {
    return null;
  }
}

/**
 * The zone's STANDARD (non-DST) offset.
 */
export function standardOffsetHours(ianaTimeZone?: string | null): number {
  if (ianaTimeZone) {
    const year = new Date().getUTCFullYear();
    const jan = offsetHoursAt(ianaTimeZone, new Date(Date.UTC(year, 0, 15)));
    const jul = offsetHoursAt(ianaTimeZone, new Date(Date.UTC(year, 6, 15)));
    if (jan !== null && jul !== null) return Math.min(jan, jul);
    if (jan !== null) return jan;
    if (jul !== null) return jul;
  }

  try {
    const year = new Date().getFullYear();
    const janOffset = -new Date(year, 0, 15).getTimezoneOffset() / 60;
    const julOffset = -new Date(year, 6, 15).getTimezoneOffset() / 60;
    if (Number.isFinite(janOffset) && Number.isFinite(julOffset)) {
      return Math.min(janOffset, julOffset);
    }
  } catch {
    /* Non-browser environment. */
  }
  return FALLBACK_UTC_OFFSET_HOURS;
}

/**
 * The zone's offset RIGHT NOW, including DST.
 */
export function currentOffsetHours(ianaTimeZone?: string | null): number {
  if (ianaTimeZone) {
    const now = offsetHoursAt(ianaTimeZone, new Date());
    if (now !== null) return now;
  }
  try {
    const offset = -new Date().getTimezoneOffset() / 60;
    if (Number.isFinite(offset)) return offset;
  } catch {
    /* Non-browser environment. */
  }
  return FALLBACK_UTC_OFFSET_HOURS;
}

export function defaultMapCenter(ianaTimeZone?: string | null): { lat: number; lng: number } {
  const offset = standardOffsetHours(ianaTimeZone);
  const targetLng = Math.max(-180, Math.min(180, offset * 15));
  return { lat: 35, lng: targetLng };
}

export function parseCoordinateQuery(query: string): { lat: number; lng: number } | null {
  const match = query.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return null;
  }
  return { lat, lng };
}

/**
 * Parse natural language geofencing commands into structured queries.
 * Examples:
 * - "5km buffer around Rotterdam"
 * - "Suez canal res 7 k=2"
 * - "Port of Singapore exclusion zone"
 */
export function parseNaturalLanguageGeofence(prompt: string): {
  locationQuery: string;
  resolution?: number;
  kRing?: number;
  suggestedName?: string;
} | null {
  const trimmed = prompt.trim();
  if (!trimmed) return null;

  let cleaned = trimmed;
  let resolution: number | undefined;
  let kRing: number | undefined;

  // Extract explicit resolution
  const resMatch = cleaned.match(/\bres(?:olution)?\s*[:=]?\s*(\d+)\b/i);
  if (resMatch) {
    const r = parseInt(resMatch[1], 10);
    if (r >= 6 && r <= 10) resolution = r;
    cleaned = cleaned.replace(resMatch[0], ' ');
  }

  // Extract explicit k-ring radius or km buffer
  const kMatch = cleaned.match(/\bk\s*[:=]?\s*(\d+)\b/i);
  if (kMatch) {
    const k = parseInt(kMatch[1], 10);
    if (k >= 0 && k <= 5) kRing = k;
    cleaned = cleaned.replace(kMatch[0], ' ');
  } else {
    const kmMatch = cleaned.match(/(\d+(?:\.\d+)?)\s*(?:km|kilometers|kilo?meter|mi|miles)\b/i);
    if (kmMatch) {
      const dist = parseFloat(kmMatch[1]);
      if (dist <= 2) kRing = 1;
      else if (dist <= 8) kRing = 2;
      else kRing = 3;
      cleaned = cleaned.replace(kmMatch[0], ' ');
    }
  }

  // Clean intent boilerplate words
  const boilerplate = /\b(create|draw|make|set\s+up|buffer|perimeter|geofence|exclusion\s+zone|around|at|for|in|near|the)\b/gi;
  let location = cleaned.replace(boilerplate, ' ').replace(/\s+/g, ' ').trim();

  if (!location) location = trimmed;

  return {
    locationQuery: location,
    resolution,
    kRing: kRing ?? 1,
    suggestedName: location.charAt(0).toUpperCase() + location.slice(1),
  };
}

/**
 * Parses GeoJSON Polygon / MultiPolygon or FeatureCollection coordinates into [lat, lng] array.
 */
export function parseGeoJsonPolygon(jsonStr: string): Array<[number, number]> | null {
  try {
    const data = JSON.parse(jsonStr);
    let coords: any[] = [];

    if (data.type === 'FeatureCollection' && Array.isArray(data.features) && data.features[0]) {
      const geom = data.features[0].geometry;
      if (geom?.type === 'Polygon') coords = geom.coordinates[0];
      else if (geom?.type === 'MultiPolygon') coords = geom.coordinates[0][0];
    } else if (data.type === 'Feature' && data.geometry) {
      const geom = data.geometry;
      if (geom.type === 'Polygon') coords = geom.coordinates[0];
      else if (geom.type === 'MultiPolygon') coords = geom.coordinates[0][0];
    } else if (data.type === 'Polygon' && Array.isArray(data.coordinates)) {
      coords = data.coordinates[0];
    } else if (data.type === 'MultiPolygon' && Array.isArray(data.coordinates)) {
      coords = data.coordinates[0][0];
    } else if (Array.isArray(data) && Array.isArray(data[0])) {
      coords = data;
    }

    if (!Array.isArray(coords) || coords.length < 3) return null;

    // GeoJSON is [lng, lat] — convert to [lat, lng]
    const result: Array<[number, number]> = [];
    for (const pt of coords) {
      if (Array.isArray(pt) && pt.length >= 2) {
        const lng = Number(pt[0]);
        const lat = Number(pt[1]);
        if (Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
          result.push([lat, lng]);
        }
      }
    }
    return result.length >= 3 ? result : null;
  } catch {
    return null;
  }
}

/**
 * Tessellates a polygon defined by [lat, lng] points into H3 cells using bounding box sampling.
 */
export function tessellatePolygonToH3(coords: Array<[number, number]>, resolution: number): string[] {
  if (coords.length < 3) return [];

  let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
  for (const [lat, lng] of coords) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }

  // Point in polygon ray-casting test
  const isInside = (lat: number, lng: number) => {
    let inside = false;
    for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
      const xi = coords[i][1], yi = coords[i][0];
      const xj = coords[j][1], yj = coords[j][0];
      const intersect = ((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  };

  const hexSet = new Set<string>();

  // Add vertices
  for (const [lat, lng] of coords) {
    try {
      hexSet.add(latLngToCell(lat, lng, resolution));
    } catch {}
  }

  // Sample interior bounding box
  const step = resolution >= 9 ? 0.002 : resolution === 8 ? 0.008 : resolution === 7 ? 0.03 : 0.1;
  for (let lat = minLat; lat <= maxLat; lat += step) {
    for (let lng = minLng; lng <= maxLng; lng += step) {
      if (isInside(lat, lng)) {
        try {
          hexSet.add(latLngToCell(lat, lng, resolution));
        } catch {}
      }
    }
  }

  return Array.from(hexSet);
}

const RESOLUTION_SPECS = [
  { res: 6, radiusKm: 36.1, zoom: 9, label: 'Res 6 (~36km - Tactical Area)', short: 'Res 6' },
  { res: 7, radiusKm: 5.1, zoom: 11, label: 'Res 7 (~5.1km - District / Harbor)', short: 'Res 7' },
  { res: 8, radiusKm: 1.0, zoom: 13, label: 'Res 8 (~1.0km - Facility Precinct)', short: 'Res 8' },
  { res: 9, radiusKm: 0.17, zoom: 15, label: 'Res 9 (~170m - Precision Perimeter)', short: 'Res 9' },
];

/**
 * Standard EPSG:3857 (Spherical Web Mercator) & Uber H3 Hierarchical Projection System
 */
export class WebMercatorProjectionSystem {
  public static project(lat: number, lng: number, zoom: number): { x: number; y: number } {
    const n = Math.pow(2, zoom) * 256;
    const x = ((lng + 180) / 360) * n;
    const latRad = (lat * Math.PI) / 180;
    const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
    return { x, y };
  }

  public static unproject(x: number, y: number, zoom: number): { lat: number; lng: number } {
    const n = Math.pow(2, zoom) * 256;
    const lng = (x / n) * 360 - 180;
    const latRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y / n))));
    const lat = (latRad * 180) / Math.PI;
    return { lat, lng };
  }

  public static projectToScreen(
    lat: number,
    lng: number,
    centerLat: number,
    centerLng: number,
    zoom: number,
    canvasCenterX = 250,
    canvasCenterY = 180
  ): { x: number; y: number } {
    const centerMerc = WebMercatorProjectionSystem.project(centerLat, centerLng, zoom);
    const targetMerc = WebMercatorProjectionSystem.project(lat, lng, zoom);
    return {
      x: canvasCenterX + (targetMerc.x - centerMerc.x),
      y: canvasCenterY + (targetMerc.y - centerMerc.y),
    };
  }

  public static unprojectFromScreen(
    screenX: number,
    screenY: number,
    centerLat: number,
    centerLng: number,
    zoom: number,
    canvasCenterX = 250,
    canvasCenterY = 180
  ): { lat: number; lng: number } {
    const centerMerc = WebMercatorProjectionSystem.project(centerLat, centerLng, zoom);
    const worldX = centerMerc.x + (screenX - canvasCenterX);
    const worldY = centerMerc.y + (screenY - canvasCenterY);
    return WebMercatorProjectionSystem.unproject(worldX, worldY, zoom);
  }

  public static getOptimalH3Resolution(zoom: number): number {
    if (zoom <= 9) return 6;
    if (zoom <= 11) return 7;
    if (zoom <= 13) return 8;
    if (zoom <= 15) return 9;
    return 10;
  }

  public static getOptimalZoom(resolution: number): number {
    if (resolution <= 6) return 9;
    if (resolution === 7) return 11;
    if (resolution === 8) return 13;
    if (resolution === 9) return 15;
    return 16;
  }

  public static sampleViewportH3Cells(
    centerLat: number,
    centerLng: number,
    zoom: number,
    resolution: number,
    width = 500,
    height = 360
  ): string[] {
    const uniqueHexSet = new Set<string>();

    try {
      const origin = latLngToCell(centerLat, centerLng, resolution);
      gridDisk(origin, 2).forEach((c) => uniqueHexSet.add(c));
    } catch {}

    const stepPx = resolution >= 10 ? 10 : resolution === 9 ? 12 : resolution === 8 ? 15 : 18;
    for (let sx = -40; sx <= width + 40; sx += stepPx) {
      for (let sy = -40; sy <= height + 40; sy += stepPx) {
        try {
          const pt = WebMercatorProjectionSystem.unprojectFromScreen(
            sx,
            sy,
            centerLat,
            centerLng,
            zoom,
            width / 2,
            height / 2
          );
          const cell = latLngToCell(pt.lat, pt.lng, resolution);
          uniqueHexSet.add(cell);
        } catch {}
      }
    }

    return Array.from(uniqueHexSet);
  }
}

export function parseH3Resolution(val: string | number | undefined): number {
  if (typeof val === 'number') {
    return val >= 0 && val <= 15 ? val : 7;
  }
  if (!val) return 7;
  const match = String(val).match(/Res\s*(\d+)/i) || String(val).match(/^(\d+)/);
  if (match) {
    const parsed = parseInt(match[1], 10);
    if (parsed >= 0 && parsed <= 15) return parsed;
  }
  return 7;
}

export function H3SpatialPalette({
  initialRegion = '',
  initialResolution = 7,
  initialHexes = [],
  initialGroups,
  onSelectRegion,
  onClose,
  timeZone,
  activeSignals = [],
  onHoverCell,
  onFilterCell,
}: H3SpatialPaletteProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [currentRegionName, setCurrentRegionName] = useState(initialRegion);
  const [centerLat, setCenterLat] = useState<number>(() => defaultMapCenter(timeZone).lat);
  const [centerLng, setCenterLng] = useState<number>(() => defaultMapCenter(timeZone).lng);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [resolution, setResolution] = useState<number>(() => parseH3Resolution(initialResolution));
  const [zoomLevel, setZoomLevel] = useState<number>(() =>
    WebMercatorProjectionSystem.getOptimalZoom(parseH3Resolution(initialResolution))
  );
  const [mapStyle, setMapStyle] = useState<'dark' | 'satellite' | 'streets'>('dark');
  const [diskK, setDiskK] = useState<number>(1);
  const [hoveredHex, setHoveredHex] = useState<{ id: string; lat: number; lng: number } | null>(null);
  const [showHotkeyHelp, setShowHotkeyHelp] = useState(false);
  const [showPresetDropdown, setShowPresetDropdown] = useState(false);
  const [showGeoJsonModal, setShowGeoJsonModal] = useState(false);
  const [geoJsonInput, setGeoJsonInput] = useState('');
  const [geoJsonError, setGeoJsonError] = useState<string | null>(null);
  const [metricOverlay, setMetricOverlay] = useState<MetricOverlayMode>('groups');
  const [radarSweep, setRadarSweep] = useState(false);
  const [marqueeBox, setMarqueeBox] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [copiedHexId, setCopiedHexId] = useState<string | null>(null);

  // ---- Sidebar Tabs & Temporal Triggers ----------------------------------
  const [sidebarTab, setSidebarTab] = useState<'geometry' | 'temporal' | 'tokens'>('geometry');
  const [enableTemporalTrigger, setEnableTemporalTrigger] = useState(false);
  const [temporalTrigger, setTemporalTrigger] = useState<GeofenceTrigger>('ON_ENTER');
  const [dwellSlaMinutes, setDwellSlaMinutes] = useState<number>(15);
  const [approachBufferKm, setApproachBufferKm] = useState<number>(5.0);
  const [persistenceHits, setPersistenceHits] = useState<number>(1);
  const [persistenceMisses, setPersistenceMisses] = useState<number>(1);
  const [persistenceWindowMs, setPersistenceWindowMs] = useState<number>(60000);

  // ---- Tile groups -------------------------------------------------------
  const [groups, setGroups] = useState<SpatialCellGroup[]>(() => {
    if (initialGroups?.length) return initialGroups;
    return [
      {
        groupId: makeCellGroupId('Primary Sector'),
        name: 'Primary Sector',
        cells: initialHexes ?? [],
        resolution: parseH3Resolution(initialResolution),
        aggregation: 'any' as GroupAggregation,
        weight: 1,
        colorToken: 'cyan',
      },
    ];
  });
  const [activeGroupId, setActiveGroupId] = useState<string>(() =>
    (initialGroups?.length ? initialGroups[0].groupId : '')
  );
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  // ---- Map interaction ---------------------------------------------------
  const [tool, setTool] = useState<MapTool>('paint');
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{
    mode: 'pan' | 'paint' | 'erase' | 'marquee';
    startX?: number;
    startY?: number;
    lastX: number;
    lastY: number;
    touched: Set<string>;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);

  const activeGroup = useMemo(
    () => groups.find((g) => g.groupId === activeGroupId) ?? groups[0],
    [groups, activeGroupId]
  );

  useEffect(() => {
    if (!activeGroupId && groups.length) setActiveGroupId(groups[0].groupId);
  }, [activeGroupId, groups]);

  /** Cell → owning group, for map colouring and O(1) hit tests. */
  const cellOwnership = useMemo(() => {
    const map = new Map<string, SpatialCellGroup>();
    for (const group of groups) {
      for (const cell of group.cells) map.set(cell, group);
    }
    return map;
  }, [groups]);

  const selectedHexSet = useMemo(() => new Set(cellOwnership.keys()), [cellOwnership]);

  // Telemetry metric aggregations per H3 cell
  const signalDensityMap = useMemo(() => {
    const counts = new Map<string, number>();
    const threatScores = new Map<string, number>();

    for (const sig of activeSignals) {
      let cell = sig.h3Cell;
      if (!cell && typeof sig.lat === 'number' && typeof sig.lng === 'number') {
        try {
          cell = latLngToCell(sig.lat, sig.lng, resolution);
        } catch {}
      }
      if (cell) {
        counts.set(cell, (counts.get(cell) || 0) + 1);
        const score =
          sig.severity === 'critical' ? 4 : sig.severity === 'high' ? 3 : sig.severity === 'medium' ? 2 : 1;
        threatScores.set(cell, Math.max(threatScores.get(cell) || 0, score));
      }
    }
    return { counts, threatScores };
  }, [activeSignals, resolution]);

  // Tactical keyboard shortcuts listener
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        if (svgRef.current) e.preventDefault();
        setSpaceHeld(true);
        return;
      }

      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (isInput) return;

      if (e.key === 'p' || e.key === 'P') {
        setTool('paint');
      } else if (e.key === 'e' || e.key === 'E') {
        setTool('erase');
      } else if (e.key === 'h' || e.key === 'H') {
        setTool('pan');
      } else if (e.key === 'm' || e.key === 'M') {
        setTool('marquee');
      } else if (e.key === '[') {
        setResolution((prev) => {
          const next = Math.max(6, prev - 1);
          setZoomLevel(WebMercatorProjectionSystem.getOptimalZoom(next));
          return next;
        });
      } else if (e.key === ']') {
        setResolution((prev) => {
          const next = Math.min(9, prev + 1);
          setZoomLevel(WebMercatorProjectionSystem.getOptimalZoom(next));
          return next;
        });
      } else if (e.key === '+' || e.key === '=') {
        setZoomLevel((prevZoom) => {
          const nextZoom = Math.min(18, prevZoom + 1);
          const nextRes = WebMercatorProjectionSystem.getOptimalH3Resolution(nextZoom);
          setResolution(nextRes);
          return nextZoom;
        });
      } else if (e.key === '-' || e.key === '_') {
        setZoomLevel((prevZoom) => {
          const nextZoom = Math.max(3, prevZoom - 1);
          const nextRes = WebMercatorProjectionSystem.getOptimalH3Resolution(nextZoom);
          setResolution(nextRes);
          return nextZoom;
        });
      } else if (e.key === 'z' || e.key === 'Z' || e.key === 'r' || e.key === 'R') {
        const def = defaultMapCenter(timeZone);
        setCenterLat(def.lat);
        setCenterLng(def.lng);
        setZoomLevel(WebMercatorProjectionSystem.getOptimalZoom(resolution));
      } else if (e.key === '?') {
        setShowHotkeyHelp((prev) => !prev);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceHeld(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [timeZone, resolution]);

  // Compute authentic H3 sector tiles covering viewport gaplessly
  const allMapSectorHexes = useMemo(() => {
    return WebMercatorProjectionSystem.sampleViewportH3Cells(
      centerLat,
      centerLng,
      zoomLevel,
      resolution,
      500,
      360
    );
  }, [centerLat, centerLng, resolution, zoomLevel]);

  const seededRef = useRef(false);

  const focusOn = (lat: number, lng: number, label: string, targetRes?: number, targetK?: number) => {
    const resToUse = targetRes ?? resolution;
    const kToUse = targetK ?? diskK;
    setCenterLat(lat);
    setCenterLng(lng);
    setCurrentRegionName(label);
    if (targetRes && targetRes !== resolution) {
      setResolution(targetRes);
      setZoomLevel(WebMercatorProjectionSystem.getOptimalZoom(targetRes));
    }
    try {
      const origin = latLngToCell(lat, lng, resToUse);
      paintCells(gridDisk(origin, kToUse));
    } catch (e) {
      console.error(e);
    }
  };

  const handleApplyPreset = (preset: StrategicSectorPreset) => {
    setShowPresetDropdown(false);
    focusOn(preset.lat, preset.lng, preset.name, preset.resolution, preset.kRing);
  };

  const handleCustomCoordinatesSearch = async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;

    setSearchError(null);

    // Check if it's a natural language geofence command
    const parsedNl = parseNaturalLanguageGeofence(trimmed);
    const targetQuery = parsedNl?.locationQuery ?? trimmed;

    // Check direct coordinate input
    const coordinates = parseCoordinateQuery(targetQuery);
    if (coordinates) {
      focusOn(
        coordinates.lat,
        coordinates.lng,
        parsedNl?.suggestedName || `Custom Sector (${coordinates.lat.toFixed(3)}, ${coordinates.lng.toFixed(3)})`,
        parsedNl?.resolution,
        parsedNl?.kRing
      );
      return;
    }

    setSearching(true);
    try {
      const res = await fetch(`/api/rescue/geocode?address=${encodeURIComponent(targetQuery)}`, {
        credentials: 'include',
      });

      if (res.status === 404) {
        setSearchError(`No match for "${targetQuery}". Try a city, strategic hub, or "lat, lng".`);
        return;
      }
      if (!res.ok) {
        setSearchError('Location lookup is unavailable right now.');
        return;
      }

      const result = await res.json();
      const lat = result?.location?.lat;
      const lng = result?.location?.lng;
      if (typeof lat !== 'number' || typeof lng !== 'number' || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        setSearchError(`Could not resolve coordinates for "${targetQuery}".`);
        return;
      }

      focusOn(
        lat,
        lng,
        result.resolvedAddress || result.address || parsedNl?.suggestedName || targetQuery,
        parsedNl?.resolution,
        parsedNl?.kRing
      );
    } catch {
      setSearchError('Location lookup failed. Check your connection and try again.');
    } finally {
      setSearching(false);
    }
  };

  const handleImportGeoJson = () => {
    setGeoJsonError(null);
    const coords = parseGeoJsonPolygon(geoJsonInput);
    if (!coords) {
      setGeoJsonError('Invalid GeoJSON Polygon format. Expected Polygon or FeatureCollection coordinates.');
      return;
    }

    const hexes = tessellatePolygonToH3(coords, resolution);
    if (hexes.length === 0) {
      setGeoJsonError('Polygon could not be mapped to any H3 cells at the current resolution.');
      return;
    }

    // Center map on polygon centroid
    const avgLat = coords.reduce((sum, p) => sum + p[0], 0) / coords.length;
    const avgLng = coords.reduce((sum, p) => sum + p[1], 0) / coords.length;
    setCenterLat(avgLat);
    setCenterLng(avgLng);
    setCurrentRegionName(`Imported GeoJSON Zone (${hexes.length} tiles)`);

    paintCells(hexes);
    setShowGeoJsonModal(false);
    setGeoJsonInput('');
  };

  // ---- Group mutations ---------------------------------------------------

  const paintCells = useCallback(
    (cellIds: string[]) => {
      if (!cellIds.length) return;
      setGroups((prev) => {
        const targetId = activeGroupId || prev[0]?.groupId;
        if (!targetId) return prev;
        const incoming = new Set(cellIds);
        return prev.map((g) =>
          g.groupId === targetId
            ? { ...g, cells: Array.from(new Set([...g.cells, ...cellIds])) }
            : { ...g, cells: g.cells.filter((c) => !incoming.has(c)) }
        );
      });
    },
    [activeGroupId]
  );

  const eraseCells = useCallback((cellIds: string[]) => {
    if (!cellIds.length) return;
    const doomed = new Set(cellIds);
    setGroups((prev) => prev.map((g) => ({ ...g, cells: g.cells.filter((c) => !doomed.has(c)) })));
  }, []);

  const toggleHexSelection = useCallback(
    (hexId: string) => {
      if (selectedHexSet.has(hexId)) eraseCells([hexId]);
      else paintCells([hexId]);
    },
    [selectedHexSet, eraseCells, paintCells]
  );

  useEffect(() => {
    if (seededRef.current || selectedHexSet.size > 0 || allMapSectorHexes.length === 0) return;
    seededRef.current = true;
    try {
      const origin = latLngToCell(centerLat, centerLng, resolution);
      paintCells(gridDisk(origin, diskK));
    } catch {
      paintCells(allMapSectorHexes.slice(0, 7));
    }
  }, [allMapSectorHexes, centerLat, centerLng, resolution, diskK, selectedHexSet.size, paintCells]);

  const handleSelectAll = () => paintCells(allMapSectorHexes);

  const handleClearSelection = () => {
    setGroups((prev) => prev.map((g) => ({ ...g, cells: [] })));
  };

  const handleAddGroup = () => {
    const index = groups.length;
    const next: SpatialCellGroup = {
      groupId: makeCellGroupId(`Tile Set ${index + 1}`),
      name: `Tile Set ${index + 1}`,
      cells: [],
      resolution,
      aggregation: 'any',
      weight: 1,
      colorToken: GROUP_COLORS[index % GROUP_COLORS.length].token,
    };
    setGroups((prev) => [...prev, next]);
    setActiveGroupId(next.groupId);
    setTool('paint');
  };

  const handleRemoveGroup = (groupId: string) => {
    setGroups((prev) => {
      const remaining = prev.filter((g) => g.groupId !== groupId);
      if (!remaining.length) {
        return [
          {
            groupId: makeCellGroupId('Primary Sector'),
            name: 'Primary Sector',
            cells: [],
            resolution,
            aggregation: 'any',
            weight: 1,
            colorToken: 'cyan',
          },
        ];
      }
      return remaining;
    });
    if (activeGroupId === groupId) setActiveGroupId('');
  };

  const updateGroup = (groupId: string, patch: Partial<SpatialCellGroup>) => {
    setGroups((prev) => prev.map((g) => (g.groupId === groupId ? { ...g, ...patch } : g)));
  };

  // ---- Pan & paint interaction -------------------------------------------

  const toSvgPoint = useCallback((e: React.PointerEvent | PointerEvent) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: ((e.clientX - rect.left) / rect.width) * 500,
      y: ((e.clientY - rect.top) / rect.height) * 360,
    };
  }, []);

  const cellAtPointer = useCallback(
    (e: React.PointerEvent | PointerEvent): string | null => {
      const pt = toSvgPoint(e);
      if (!pt) return null;
      try {
        const geo = WebMercatorProjectionSystem.unprojectFromScreen(
          pt.x,
          pt.y,
          centerLat,
          centerLng,
          zoomLevel,
          250,
          180
        );
        return latLngToCell(geo.lat, geo.lng, resolution);
      } catch {
        return null;
      }
    },
    [toSvgPoint, centerLat, centerLng, zoomLevel, resolution]
  );

  const effectiveTool = (e: React.PointerEvent): MapTool => {
    if (spaceHeld || e.button === 1 || e.altKey) return 'pan';
    return tool;
  };

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 && e.button !== 1) return;
    const mode = effectiveTool(e);
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();

    const pt = toSvgPoint(e);
    dragRef.current = {
      mode,
      startX: pt?.x ?? 0,
      startY: pt?.y ?? 0,
      lastX: e.clientX,
      lastY: e.clientY,
      touched: new Set(),
    };
    setIsDragging(true);

    if (mode === 'marquee' && pt) {
      setMarqueeBox({ x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y });
    } else if (mode === 'paint' || mode === 'erase') {
      const cell = cellAtPointer(e);
      if (cell) {
        dragRef.current.touched.add(cell);
        mode === 'paint' ? paintCells([cell]) : eraseCells([cell]);
        if (onFilterCell) onFilterCell(cell);
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;

    if (!drag) {
      const cell = cellAtPointer(e);
      if (cell) {
        const [lat, lng] = cellToLatLng(cell);
        setHoveredHex({ id: cell, lat, lng });
        if (onHoverCell) onHoverCell(cell);
      } else {
        if (onHoverCell) onHoverCell(null);
      }
      return;
    }

    if (drag.mode === 'marquee') {
      const pt = toSvgPoint(e);
      if (pt && drag.startX !== undefined && drag.startY !== undefined) {
        setMarqueeBox({
          x1: Math.min(drag.startX, pt.x),
          y1: Math.min(drag.startY, pt.y),
          x2: Math.max(drag.startX, pt.x),
          y2: Math.max(drag.startY, pt.y),
        });
      }
      return;
    }

    if (drag.mode === 'pan') {
      const dx = e.clientX - drag.lastX;
      const dy = e.clientY - drag.lastY;
      if (dx === 0 && dy === 0) return;
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;

      const svg = svgRef.current;
      const rect = svg?.getBoundingClientRect();
      const scaleX = rect?.width ? 500 / rect.width : 1;
      const scaleY = rect?.height ? 360 / rect.height : 1;

      const centerMerc = WebMercatorProjectionSystem.project(centerLat, centerLng, zoomLevel);
      const moved = WebMercatorProjectionSystem.unproject(
        centerMerc.x - dx * scaleX,
        centerMerc.y - dy * scaleY,
        zoomLevel
      );
      setCenterLat(Math.max(-85, Math.min(85, moved.lat)));
      setCenterLng(((moved.lng + 540) % 360) - 180);
      return;
    }

    const cell = cellAtPointer(e);
    if (!cell || drag.touched.has(cell)) return;
    drag.touched.add(cell);
    drag.mode === 'paint' ? paintCells([cell]) : eraseCells([cell]);
  };

  const endDrag = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragRef.current) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}

    if (dragRef.current.mode === 'marquee' && marqueeBox) {
      const minX = marqueeBox.x1;
      const maxX = marqueeBox.x2;
      const minY = marqueeBox.y1;
      const maxY = marqueeBox.y2;
      if (maxX - minX > 4 || maxY - minY > 4) {
        const matchingHexes = visualHexagons
          .filter((h) => h.cx >= minX && h.cx <= maxX && h.cy >= minY && h.cy <= maxY)
          .map((h) => h.id);
        if (matchingHexes.length > 0) {
          paintCells(matchingHexes);
        }
      }
      setMarqueeBox(null);
    }

    dragRef.current = null;
    setIsDragging(false);
  };

  const cursorClass =
    spaceHeld || tool === 'pan'
      ? isDragging
        ? 'cursor-grabbing'
        : 'cursor-grab'
      : tool === 'erase'
        ? 'cursor-cell'
        : 'cursor-crosshair';

  const handleApply = () => {
    const hexArray = Array.from(selectedHexSet);
    const spec = RESOLUTION_SPECS.find((s) => s.res === resolution) || RESOLUTION_SPECS[1];

    const populatedGroups = groups
      .filter((g) => g.cells.length > 0)
      .map((g) => ({ ...g, resolution }));

    const summary =
      populatedGroups.length > 1
        ? `Spatial Region: ${currentRegionName} (Res ${resolution}, ${populatedGroups.length} tile sets, ${hexArray.length} H3 tiles)`
        : `Spatial Region: ${currentRegionName} (Res ${resolution}, ${hexArray.length} H3 Tiles)`;

    if (onSelectRegion) {
      onSelectRegion({
        regionName: currentRegionName,
        centerLat,
        centerLng,
        h3Resolution: resolution,
        selectedHexes: hexArray,
        cellGroups: populatedGroups,
        radiusKm: spec.radiusKm,
        summaryLabel: summary,
        temporalTrigger: enableTemporalTrigger ? temporalTrigger : undefined,
        dwellSlaMinutes: enableTemporalTrigger && temporalTrigger === 'ON_DWELL' ? dwellSlaMinutes : undefined,
        approachBufferKm: enableTemporalTrigger && temporalTrigger === 'ON_APPROACH' ? approachBufferKm : undefined,
        persistence:
          enableTemporalTrigger && (persistenceHits > 1 || persistenceMisses > 1)
            ? {
                requiredConsecutiveHits: persistenceHits,
                releaseAfterMisses: persistenceMisses,
                windowMs: persistenceWindowMs,
              }
            : undefined,
      });
    }
  };

  const visualHexagons = useMemo(() => {
    if (allMapSectorHexes.length === 0) return [];
    const originHex = latLngToCell(centerLat, centerLng, resolution);

    return allMapSectorHexes.map((hexId) => {
      const boundaryCoords = cellToBoundary(hexId);
      const centroid = cellToLatLng(hexId);
      const isOrigin = hexId === originHex;
      const isSelected = selectedHexSet.has(hexId);

      const pointsStr = boundaryCoords
        .map(([lat, lng]) => {
          const pt = WebMercatorProjectionSystem.projectToScreen(
            lat,
            lng,
            centerLat,
            centerLng,
            zoomLevel,
            250,
            180
          );
          return `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
        })
        .join(' ');

      const centerPt = WebMercatorProjectionSystem.projectToScreen(
        centroid[0],
        centroid[1],
        centerLat,
        centerLng,
        zoomLevel,
        250,
        180
      );

      const owner = cellOwnership.get(hexId);
      const palette = groupColor(owner?.colorToken);

      // Metric calculations
      const signalCount = signalDensityMap.counts.get(hexId) || 0;
      const threatScore = signalDensityMap.threatScores.get(hexId) || 0;

      // Annotated as string: inferred from `palette` these narrow to that palette's
      // literal union, which the density/threat overlays below cannot satisfy.
      let strokeColor: string = palette.stroke;
      let fillColor: string = palette.fill;

      if (metricOverlay === 'density' && signalCount > 0) {
        strokeColor = signalCount > 5 ? '#EF4444' : signalCount > 2 ? '#F59E0B' : '#3B82F6';
        fillColor = signalCount > 5 ? 'rgba(239, 68, 68, 0.45)' : signalCount > 2 ? 'rgba(245, 158, 11, 0.4)' : 'rgba(59, 130, 246, 0.35)';
      } else if (metricOverlay === 'threat' && threatScore > 0) {
        strokeColor = threatScore >= 4 ? '#EF4444' : threatScore === 3 ? '#F97316' : threatScore === 2 ? '#FBBF24' : '#10B981';
        fillColor = threatScore >= 4 ? 'rgba(239, 68, 68, 0.5)' : threatScore === 3 ? 'rgba(249, 115, 22, 0.42)' : threatScore === 2 ? 'rgba(251, 191, 36, 0.35)' : 'rgba(16, 185, 129, 0.3)';
      }

      return {
        id: hexId,
        shortToken: hexId.slice(0, 7),
        cx: centerPt.x,
        cy: centerPt.y,
        pointsStr,
        lat: centroid[0],
        lng: centroid[1],
        isOrigin,
        isSelected,
        groupId: owner?.groupId,
        groupName: owner?.name,
        isActiveGroup: owner != null && owner.groupId === activeGroup?.groupId,
        strokeColor,
        fillColor,
        signalCount,
        threatScore,
      };
    });
  }, [
    allMapSectorHexes,
    cellOwnership,
    activeGroup?.groupId,
    centerLat,
    centerLng,
    resolution,
    zoomLevel,
    metricOverlay,
    signalDensityMap,
  ]);

  const tileGrid = useMemo(() => {
    const centerMerc = WebMercatorProjectionSystem.project(centerLat, centerLng, zoomLevel);
    const tileX = Math.floor(centerMerc.x / 256);
    const tileY = Math.floor(centerMerc.y / 256);

    const offsetX = centerMerc.x - tileX * 256;
    const offsetY = centerMerc.y - tileY * 256;

    const tiles: Array<{ x: number; y: number; z: number; left: number; top: number }> = [];
    for (const dx of [-1, 0, 1]) {
      for (const dy of [-1, 0, 1]) {
        tiles.push({
          x: tileX + dx,
          y: tileY + dy,
          z: zoomLevel,
          left: 250 - offsetX + dx * 256,
          top: 180 - offsetY + dy * 256,
        });
      }
    }
    return tiles;
  }, [centerLat, centerLng, zoomLevel]);

  const getTileUrl = (x: number, y: number, z: number) => {
    if (mapStyle === 'satellite') {
      return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
    }
    if (mapStyle === 'streets') {
      return `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
    }
    return `https://cartodb-basemaps-a.global.ssl.fastly.net/dark_all/${z}/${x}/${y}.png`;
  };

  const handleZoomIn = () => {
    setZoomLevel((prevZoom) => {
      const nextZoom = Math.min(18, prevZoom + 1);
      const nextRes = WebMercatorProjectionSystem.getOptimalH3Resolution(nextZoom);
      setResolution(nextRes);
      return nextZoom;
    });
  };

  const handleZoomOut = () => {
    setZoomLevel((prevZoom) => {
      const nextZoom = Math.max(3, prevZoom - 1);
      const nextRes = WebMercatorProjectionSystem.getOptimalH3Resolution(nextZoom);
      setResolution(nextRes);
      return nextZoom;
    });
  };

  const handleSelectResolution = (targetRes: number) => {
    const previousRes = resolution;
    setResolution(targetRes);
    setZoomLevel(WebMercatorProjectionSystem.getOptimalZoom(targetRes));

    if (targetRes === previousRes) return;

    setGroups((prev) =>
      prev.map((g) => {
        const remapped = new Set<string>();
        for (const cell of g.cells) {
          if (!isValidCell(cell)) continue;
          const res = getResolution(cell);
          try {
            if (res === targetRes) remapped.add(cell);
            else if (res > targetRes) remapped.add(cellToParent(cell, targetRes));
            else for (const child of cellToChildren(cell, targetRes)) remapped.add(child);
          } catch {}
        }
        return { ...g, cells: Array.from(remapped), resolution: targetRes };
      })
    );
  };

  return (
    <div className="w-full bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col text-foreground relative">
      {/* Header Bar */}
      <div className="bg-card border-b border-border px-4 py-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
            <Compass className="h-5 w-5 animate-pulse" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
              <span>H3 Spatial Region Palette &amp; Geofence</span>
              <span className="rounded bg-cyan-900/40 border border-cyan-700/50 px-2 py-0.5 text-[10px] font-mono text-cyan-300">
                Res {resolution}
              </span>
            </h3>
            <p className="text-xs text-muted-foreground">{currentRegionName || 'No region selected'}</p>
          </div>
        </div>

        {/* Tactical Actions & Presets */}
        <div className="flex items-center gap-2">
          {/* Sector Presets Dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowPresetDropdown((prev) => !prev)}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-muted/80 hover:bg-muted text-xs font-semibold rounded-lg border border-border transition-colors text-cyan-300"
            >
              <Globe className="w-3.5 h-3.5" />
              <span>Presets</span>
              <ChevronDown className="w-3 h-3 text-muted-foreground" />
            </button>

            {showPresetDropdown && (
              <div className="absolute right-0 top-9 z-50 w-72 bg-card border border-border rounded-xl shadow-2xl p-2 space-y-1 animate-in fade-in max-h-80 overflow-y-auto">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-2 py-1">
                  Strategic Chokepoints &amp; Hubs
                </div>
                {STRATEGIC_SECTOR_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => handleApplyPreset(preset)}
                    className="w-full text-left p-2 rounded-lg hover:bg-cyan-500/10 hover:border-cyan-500/30 border border-transparent transition-all text-xs flex flex-col gap-0.5"
                  >
                    <div className="font-semibold text-foreground flex items-center justify-between">
                      <span>{preset.name}</span>
                      <span className="text-[9px] font-mono text-cyan-400 bg-cyan-950/60 px-1 py-0.2 rounded">
                        Res {preset.resolution}
                      </span>
                    </div>
                    <div className="text-[10px] text-muted-foreground leading-tight line-clamp-1">
                      {preset.description}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* GeoJSON Import Button */}
          <button
            onClick={() => setShowGeoJsonModal(true)}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-muted/80 hover:bg-muted text-xs font-semibold rounded-lg border border-border transition-colors text-muted-foreground hover:text-foreground"
          >
            <UploadCloud className="w-3.5 h-3.5" />
            <span>Import GeoJSON</span>
          </button>

          {/* Hotkey Helper Trigger */}
          <button
            onClick={() => setShowHotkeyHelp(true)}
            title="Keyboard Shortcuts (?)"
            className="flex items-center gap-1 px-2 py-1.5 text-xs text-muted-foreground hover:text-cyan-300 rounded-lg hover:bg-cyan-500/10 border border-transparent hover:border-cyan-500/30 transition-all"
          >
            <Keyboard className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Hotkeys</span>
          </button>

          {onClose && (
            <button
              onClick={onClose}
              className="px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors"
            >
              Close
            </button>
          )}

          <button
            onClick={handleApply}
            disabled={!currentRegionName || selectedHexSet.size === 0}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-foreground rounded-lg text-xs font-bold shadow-lg shadow-cyan-900/20 transition-all disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Apply Geofence</span>
          </button>
        </div>
      </div>

      {/* AI Natural Language / Coordinate Search Bar */}
      <div className="p-3 bg-background border-b border-border space-y-2">
        <div className="relative flex items-center">
          <Wand2 className="absolute left-3 top-2.5 h-4 w-4 text-cyan-400" />
          <input
            type="text"
            placeholder="Search address, coordinates, or type AI prompt e.g. '5km buffer around Port of Rotterdam'..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCustomCoordinatesSearch(searchQuery);
            }}
            className="w-full h-9 pl-9 pr-24 bg-card border border-border rounded-xl text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-cyan-500 transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => handleCustomCoordinatesSearch(searchQuery)}
              disabled={searching}
              className="absolute right-2 top-1.5 px-2.5 py-1 bg-cyan-600/30 hover:bg-cyan-600/50 disabled:opacity-50 text-cyan-300 border border-cyan-500/40 rounded-lg text-[11px] font-semibold transition-colors"
            >
              {searching ? 'Processing…' : 'Generate'}
            </button>
          )}
        </div>

        {searchError && (
          <div className="text-[11px] text-amber-400/90" role="status">
            {searchError}
          </div>
        )}
      </div>

      {/* Main Interactive Map & Controls Area */}
      <div className="flex flex-col lg:flex-row flex-1 min-h-[380px] bg-background">
        {/* Left Interactive Mapbox Canvas */}
        <div
          className="flex-1 relative flex items-center justify-center p-0 bg-background overflow-hidden border-b lg:border-b-0 lg:border-r border-border min-h-[360px]"
          onWheel={(e) => {
            if (e.deltaY < 0) {
              handleZoomIn();
            } else if (e.deltaY > 0) {
              handleZoomOut();
            }
          }}
        >
          {/* Live Geographic Tile Layer Background */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none select-none">
            {tileGrid.map((tile) => (
              <img
                key={`${tile.z}-${tile.x}-${tile.y}-${mapStyle}`}
                src={getTileUrl(tile.x, tile.y, tile.z)}
                alt="map tile"
                className="absolute w-[256px] h-[256px] opacity-85 transition-opacity duration-300"
                style={{
                  left: `${tile.left}px`,
                  top: `${tile.top}px`,
                }}
                loading="eager"
              />
            ))}
            <div className="absolute inset-0 bg-radial from-transparent via-background/30 to-background/80 pointer-events-none" />
          </div>

          {/* Tool Palette — pan / paint / erase / marquee */}
          <div className="absolute top-3 left-3 z-20 flex flex-col gap-1 bg-card/90 backdrop-blur-md border border-border rounded-xl p-1 shadow-2xl">
            {(
              [
                { id: 'pan' as MapTool, icon: Hand, label: 'Pan', key: 'H', hint: 'Pan viewport (H or Hold Space)' },
                { id: 'paint' as MapTool, icon: Brush, label: 'Paint', key: 'P', hint: 'Paint tiles into active group (P)' },
                { id: 'erase' as MapTool, icon: Eraser, label: 'Erase', key: 'E', hint: 'Erase tiles (E)' },
                { id: 'marquee' as MapTool, icon: BoxSelect, label: 'Box', key: 'M', hint: 'Marquee box batch select (M)' },
              ]
            ).map(({ id, icon: Icon, label, key, hint }) => {
              const isActive = tool === id && !spaceHeld;
              return (
                <button
                  key={id}
                  onClick={() => setTool(id)}
                  title={hint}
                  aria-label={label}
                  aria-pressed={isActive}
                  data-testid={`h3-tool-${id}`}
                  className={cn(
                    'flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wide transition-all',
                    isActive
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted border border-transparent'
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <Icon className="w-3.5 h-3.5" />
                    <span>{label}</span>
                  </div>
                  <kbd className="text-[9px] font-mono px-1 py-0.2 rounded bg-background/60 border border-border text-muted-foreground">
                    {key}
                  </kbd>
                </button>
              );
            })}
          </div>

          {/* Metric Overlay Selector & Sonar Toggle */}
          <div className="absolute top-3 right-3 z-20 flex items-center gap-1.5 bg-card/90 backdrop-blur-md border border-border rounded-xl p-1 shadow-2xl">
            <div className="flex items-center bg-background/80 rounded-lg p-0.5 border border-border">
              <button
                onClick={() => setMetricOverlay('groups')}
                className={cn(
                  'px-2 py-0.5 rounded text-[10px] font-bold transition-all',
                  metricOverlay === 'groups'
                    ? 'bg-cyan-500/20 text-cyan-300'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                Tile Sets
              </button>
              <button
                onClick={() => setMetricOverlay('density')}
                className={cn(
                  'px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 transition-all',
                  metricOverlay === 'density'
                    ? 'bg-blue-500/20 text-blue-300'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Activity className="w-3 h-3" />
                <span>Density</span>
              </button>
              <button
                onClick={() => setMetricOverlay('threat')}
                className={cn(
                  'px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 transition-all',
                  metricOverlay === 'threat'
                    ? 'bg-red-500/20 text-red-300'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Flame className="w-3 h-3" />
                <span>Threat</span>
              </button>
            </div>

            <div className="h-4 w-px bg-accent mx-0.5" />
            <button
              onClick={() => setMapStyle('dark')}
              className={cn(
                'px-1.5 py-1 rounded-lg text-[10px] font-bold uppercase transition-all',
                mapStyle === 'dark' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40' : 'text-muted-foreground'
              )}
            >
              🌑
            </button>
            <button
              onClick={() => setMapStyle('satellite')}
              className={cn(
                'px-1.5 py-1 rounded-lg text-[10px] font-bold uppercase transition-all',
                mapStyle === 'satellite' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40' : 'text-muted-foreground'
              )}
            >
              🛰️
            </button>
            <button
              onClick={() => setRadarSweep((prev) => !prev)}
              title="Toggle Live Sonar Sweep"
              className={cn(
                'flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold uppercase transition-all',
                radarSweep ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40' : 'text-muted-foreground'
              )}
            >
              <Radar className={cn('w-3.5 h-3.5', radarSweep && 'text-cyan-400 animate-spin')} />
              <span>Sonar</span>
            </button>
          </div>

          {/* Metric & Density Color Ramp Gradient Legend */}
          {metricOverlay !== 'groups' && (
            <div className="absolute top-14 right-3 z-20 bg-card/90 backdrop-blur-md border border-border rounded-xl px-2.5 py-1.5 shadow-xl text-[10px] space-y-1 animate-in fade-in">
              <div className="flex items-center justify-between gap-3 text-muted-foreground font-semibold">
                <span>{metricOverlay === 'density' ? 'Signal Density' : 'Threat Level'}</span>
                <span className="font-mono text-[9px] text-cyan-300">
                  {metricOverlay === 'density' ? `${activeSignals.length} events` : 'Severity Index'}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] text-muted-foreground font-mono">Low</span>
                <div
                  className={cn(
                    'h-2 w-24 rounded-full',
                    metricOverlay === 'density'
                      ? 'bg-gradient-to-r from-blue-500 via-amber-500 to-red-500'
                      : 'bg-gradient-to-r from-emerald-500 via-amber-500 to-red-600'
                  )}
                />
                <span className="text-[9px] text-muted-foreground font-mono">High</span>
              </div>
            </div>
          )}

          {/* SVG Map Hexagon Canvas */}
          <svg
            ref={svgRef}
            viewBox="0 0 500 360"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onPointerLeave={() => {
              setHoveredHex(null);
              if (onHoverCell) onHoverCell(null);
            }}
            onContextMenu={(e) => e.preventDefault()}
            className={cn(
              'w-full h-full max-h-[380px] drop-shadow-2xl select-none relative z-10 touch-none',
              cursorClass
            )}
          >
            <defs>
              <radialGradient id="sonarGradient" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#22D3EE" stopOpacity="0.35" />
                <stop offset="70%" stopColor="#0891B2" stopOpacity="0.12" />
                <stop offset="100%" stopColor="#0891B2" stopOpacity="0" />
              </radialGradient>
            </defs>

            {/* Radar Rings */}
            <circle cx="250" cy="180" r="45" fill="none" stroke="#38BDF8" strokeWidth="1" strokeDasharray="3 3" opacity="0.25" />
            <circle cx="250" cy="180" r="100" fill="none" stroke="#38BDF8" strokeWidth="1" strokeDasharray="4 4" opacity="0.15" />
            <circle cx="250" cy="180" r="160" fill="none" stroke="#38BDF8" strokeWidth="1" strokeDasharray="5 5" opacity="0.08" />

            {/* Radar Sweep Beam */}
            {radarSweep && (
              <g transform="translate(250, 180)">
                <circle r="160" fill="url(#sonarGradient)" opacity="0.4" />
                <line
                  x1="0"
                  y1="0"
                  x2="160"
                  y2="0"
                  stroke="#22D3EE"
                  strokeWidth="1.5"
                  opacity="0.8"
                  className="animate-spin origin-center"
                  style={{ animationDuration: '4s', transformOrigin: '0 0' }}
                />
              </g>
            )}

            {/* Interactive Hexagons */}
            {visualHexagons.map((hex) => {
              return (
                <g key={hex.id} className="transition-all group">
                  <polygon
                    points={hex.pointsStr}
                    fill={hex.isSelected || hex.signalCount > 0 ? hex.fillColor : 'rgba(6, 182, 212, 0.02)'}
                    fillOpacity={hex.isSelected ? (hex.isActiveGroup ? 1 : 0.6) : hex.signalCount > 0 ? 0.8 : 1}
                    stroke={hex.isSelected || hex.signalCount > 0 ? hex.strokeColor : '#0891B2'}
                    strokeWidth={hex.isSelected ? (hex.isActiveGroup ? 1.6 : 1.1) : 0.6}
                    strokeOpacity={hex.isSelected ? (hex.isActiveGroup ? 0.95 : 0.55) : 0.28}
                    className="hover:fill-cyan-400/25 hover:stroke-cyan-200/80 transition-colors"
                  />
                  <circle
                    cx={hex.cx}
                    cy={hex.cy}
                    r={hex.isOrigin ? 3 : hex.isSelected ? 2 : 1.2}
                    fill={hex.isSelected ? '#FFFFFF' : '#38BDF8'}
                    opacity={hex.isSelected ? 0.9 : 0.35}
                  />
                  {hex.signalCount > 0 && metricOverlay !== 'groups' && (
                    <text
                      x={hex.cx}
                      y={hex.cy - 3}
                      textAnchor="middle"
                      fill="#FFFFFF"
                      fontSize="7.5"
                      fontFamily="monospace"
                      fontWeight="bold"
                    >
                      {hex.signalCount}
                    </text>
                  )}
                  {radarSweep && hex.isSelected && (
                    <circle
                      cx={hex.cx}
                      cy={hex.cy}
                      r="6"
                      fill="none"
                      stroke={hex.strokeColor}
                      strokeWidth="1"
                      opacity="0.6"
                      className="animate-ping origin-center"
                      style={{ animationDuration: '2.5s' }}
                    />
                  )}
                </g>
              );
            })}

            {/* Center Pin */}
            <g transform="translate(250, 180)">
              <circle r="8" fill="#06B6D4" opacity="0.6" className="animate-ping" />
              <circle r="3.5" fill="#FFFFFF" stroke="#06B6D4" strokeWidth="1.5" />
            </g>

            {/* Marquee Box */}
            {marqueeBox && (
              <rect
                x={marqueeBox.x1}
                y={marqueeBox.y1}
                width={marqueeBox.x2 - marqueeBox.x1}
                height={marqueeBox.y2 - marqueeBox.y1}
                fill="rgba(34, 211, 238, 0.18)"
                stroke="#22D3EE"
                strokeWidth="1.5"
                strokeDasharray="4 3"
                className="pointer-events-none"
              />
            )}
          </svg>

          {/* Hovered Hex Glassmorphic Dossier HUD */}
          {hoveredHex && (
            <div className="absolute top-3 left-28 z-30 bg-card/95 backdrop-blur-md border border-cyan-500/40 rounded-xl p-2.5 text-xs shadow-2xl animate-in fade-in max-w-[280px]">
              <div className="flex items-center justify-between gap-2 text-cyan-300 font-mono font-bold">
                <div className="flex items-center gap-1.5 truncate">
                  <Crosshair className="w-3.5 h-3.5 shrink-0 text-cyan-400" />
                  <span className="truncate">{hoveredHex.id}</span>
                </div>
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(hoveredHex.id);
                    setCopiedHexId(hoveredHex.id);
                    setTimeout(() => setCopiedHexId(null), 1500);
                  }}
                  title="Copy H3 Index"
                  className="p-1 hover:bg-cyan-500/20 text-muted-foreground hover:text-cyan-300 rounded transition-colors"
                >
                  {copiedHexId === hoveredHex.id ? (
                    <CheckCheck className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>

              <div className="text-[10.5px] text-muted-foreground mt-1 space-y-0.5 font-mono">
                <div>Lat: {hoveredHex.lat.toFixed(4)}, Lng: {hoveredHex.lng.toFixed(4)}</div>
                <div className="flex items-center gap-1.5 text-[10px]">
                  <span className="text-cyan-400">Res {resolution}</span>
                  <span>&bull;</span>
                  <span className="text-cyan-200">{getH3ResolutionArea(resolution)}</span>
                  <span>&bull;</span>
                  <span>{cellOwnership.has(hoveredHex.id) ? (
                    <span className="text-emerald-300 font-semibold">{cellOwnership.get(hoveredHex.id)?.name}</span>
                  ) : (
                    <span className="italic text-muted-foreground">Unassigned</span>
                  )}</span>
                </div>
                {signalDensityMap.counts.has(hoveredHex.id) && (
                  <div className="text-blue-300 font-semibold pt-0.5">
                    Live Signals: {signalDensityMap.counts.get(hoveredHex.id)} events
                  </div>
                )}
              </div>

              <div className="mt-2 pt-1.5 border-t border-border flex items-center gap-1.5">
                <button
                  onClick={() => {
                    try {
                      paintCells(gridDisk(hoveredHex.id, 1));
                    } catch (e) {
                      console.error(e);
                    }
                  }}
                  className="flex-1 px-1.5 py-0.5 bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-300 rounded text-[9.5px] font-semibold transition-colors text-center"
                >
                  + K-Ring (k=1)
                </button>
                <button
                  onClick={() => toggleHexSelection(hoveredHex.id)}
                  className="px-2 py-0.5 bg-muted hover:bg-accent text-foreground rounded text-[9.5px] font-semibold border border-border transition-colors"
                >
                  {selectedHexSet.has(hoveredHex.id) ? 'Erase' : 'Paint'}
                </button>
              </div>
            </div>
          )}

          {/* Floating Ergonomic Hotkey Action Bar */}
          <div className="absolute bottom-3 left-3 z-20 flex items-center gap-1 bg-card/90 backdrop-blur-md border border-border rounded-xl p-1 shadow-2xl">
            {[
              { id: 'pan' as MapTool, icon: Hand, label: 'Pan', key: 'H', hint: 'Pan viewport (H / Space)' },
              { id: 'paint' as MapTool, icon: Brush, label: 'Paint', key: 'P', hint: 'Paint brush (P)' },
              { id: 'erase' as MapTool, icon: Eraser, label: 'Erase', key: 'E', hint: 'Erase tiles (E)' },
              { id: 'marquee' as MapTool, icon: BoxSelect, label: 'Box', key: 'M', hint: 'Box marquee select (M)' },
            ].map(({ id, icon: Icon, label, key, hint }) => {
              const isActive = tool === id && !spaceHeld;
              return (
                <button
                  key={id}
                  onClick={() => setTool(id)}
                  title={hint}
                  aria-label={label}
                  aria-pressed={isActive}
                  className={cn(
                    'flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold transition-all',
                    isActive
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted border border-transparent'
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span className="font-mono text-[9px] opacity-75">{key}</span>
                </button>
              );
            })}

            <div className="h-3.5 w-px bg-border mx-0.5" />

            <button
              onClick={handleZoomIn}
              title="Zoom In (+)"
              className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleZoomOut}
              title="Zoom Out (-)"
              className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => {
                const center = defaultMapCenter(timeZone);
                setCenterLat(center.lat);
                setCenterLng(center.lng);
              }}
              title="Reset Center (R)"
              className="p-1 text-muted-foreground hover:text-cyan-300 hover:bg-muted rounded-lg transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Bottom Map Footprint Readout */}
          <div className="absolute bottom-3 right-3 z-20 bg-card/90 backdrop-blur-md border border-border rounded-xl px-3 py-1.5 text-xs text-muted-foreground flex items-center gap-2">
            <MapPin className="w-3.5 h-3.5 text-cyan-400" />
            <span className="font-semibold text-foreground">{selectedHexSet.size} Selected H3 Cells</span>
            <span className="text-[10px] text-muted-foreground">
              Zoom {zoomLevel} (Res {resolution}) &bull; Center: {centerLat.toFixed(3)}, {centerLng.toFixed(3)}
            </span>
          </div>
        </div>

        {/* GeoJSON Import Modal */}
        {showGeoJsonModal && (
          <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-card border border-border rounded-2xl p-5 shadow-2xl max-w-lg w-full space-y-4 animate-in fade-in zoom-in-95">
              <div className="flex items-center justify-between border-b border-border pb-3">
                <div className="flex items-center gap-2 text-foreground font-bold text-sm">
                  <UploadCloud className="w-4 h-4 text-cyan-400" />
                  <span>Import GeoJSON Polygon / Boundary</span>
                </div>
                <button
                  onClick={() => setShowGeoJsonModal(false)}
                  className="text-muted-foreground hover:text-foreground text-xs px-2 py-1 rounded-md hover:bg-muted"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">
                  Paste raw GeoJSON <code className="text-cyan-300">Feature</code>, <code className="text-cyan-300">Polygon</code>, or coordinate array:
                </label>
                <textarea
                  rows={6}
                  value={geoJsonInput}
                  onChange={(e) => setGeoJsonInput(e.target.value)}
                  placeholder={`{\n  "type": "Polygon",\n  "coordinates": [\n    [[4.45, 51.91], [4.49, 51.91], [4.49, 51.94], [4.45, 51.94], [4.45, 51.91]]\n  ]\n}`}
                  className="w-full bg-background border border-border rounded-xl p-3 font-mono text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-cyan-500"
                />
                {geoJsonError && (
                  <p className="text-xs text-red-400">{geoJsonError}</p>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                <button
                  onClick={() => setShowGeoJsonModal(false)}
                  className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={handleImportGeoJson}
                  disabled={!geoJsonInput.trim()}
                  className="px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-foreground text-xs font-bold rounded-lg shadow-md transition-all"
                >
                  Tessellate into H3 Grid
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Hotkey Helper Modal */}
        {showHotkeyHelp && (
          <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-card border border-cyan-500/40 rounded-2xl p-5 shadow-2xl max-w-md w-full space-y-4 animate-in fade-in zoom-in-95">
              <div className="flex items-center justify-between border-b border-border pb-3">
                <div className="flex items-center gap-2 text-cyan-400 font-bold text-sm">
                  <Keyboard className="w-4 h-4" />
                  <span>Tactical Keyboard Shortcuts</span>
                </div>
                <button
                  onClick={() => setShowHotkeyHelp(false)}
                  className="text-muted-foreground hover:text-foreground text-xs px-2 py-1 rounded-md hover:bg-muted"
                >
                  ✕
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                {[
                  { key: 'P', desc: 'Paint Brush tool' },
                  { key: 'E', desc: 'Eraser tool' },
                  { key: 'H', desc: 'Pan / Hand tool' },
                  { key: 'M', desc: 'Marquee Box Selection' },
                  { key: 'Space', desc: 'Hold to Pan temporarily' },
                  { key: '[ / ]', desc: 'Step Resolution down/up' },
                  { key: '+ / -', desc: 'Zoom In / Out' },
                  { key: 'Z / R', desc: 'Reset Center View' },
                  { key: '?', desc: 'Toggle Hotkey Helper' },
                  { key: 'Enter', desc: 'Trigger AI / Geo Search' },
                ].map((hk) => (
                  <div key={hk.key} className="flex items-center justify-between p-2 rounded-lg bg-background border border-border">
                    <span className="text-muted-foreground">{hk.desc}</span>
                    <kbd className="font-mono text-[10px] font-bold text-cyan-300 bg-cyan-950/40 border border-cyan-700/50 px-1.5 py-0.5 rounded">
                      {hk.key}
                    </kbd>
                  </div>
                ))}
              </div>

              <div className="pt-2 text-center">
                <button
                  onClick={() => setShowHotkeyHelp(false)}
                  className="w-full py-2 bg-cyan-600 hover:bg-cyan-500 text-foreground text-xs font-bold rounded-xl transition-all"
                >
                  Got It
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Right Configuration Palette Sidebar */}
        <div className="w-full lg:w-80 bg-background p-4 flex flex-col justify-between space-y-4">
          <div className="space-y-3.5">
            {/* Sidebar Navigation Tabs */}
            <div className="flex items-center bg-muted/60 p-0.5 rounded-xl border border-border">
              <button
                onClick={() => setSidebarTab('geometry')}
                className={cn(
                  'flex-1 py-1.5 text-[11px] font-bold rounded-lg transition-all text-center flex items-center justify-center gap-1.5',
                  sidebarTab === 'geometry'
                    ? 'bg-card text-cyan-300 shadow-sm border border-border'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Hexagon className="w-3.5 h-3.5" />
                <span>Geometry</span>
              </button>
              <button
                onClick={() => setSidebarTab('temporal')}
                className={cn(
                  'flex-1 py-1.5 text-[11px] font-bold rounded-lg transition-all text-center flex items-center justify-center gap-1.5 relative',
                  sidebarTab === 'temporal'
                    ? 'bg-card text-cyan-300 shadow-sm border border-border'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Clock className="w-3.5 h-3.5" />
                <span>Triggers</span>
                {enableTemporalTrigger && (
                  <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
                )}
              </button>
              <button
                onClick={() => setSidebarTab('tokens')}
                className={cn(
                  'flex-1 py-1.5 text-[11px] font-bold rounded-lg transition-all text-center flex items-center justify-center gap-1.5',
                  sidebarTab === 'tokens'
                    ? 'bg-card text-cyan-300 shadow-sm border border-border'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <FileCode className="w-3.5 h-3.5" />
                <span>Tokens</span>
              </button>
            </div>

            {/* TAB 1: GEOMETRY */}
            {sidebarTab === 'geometry' && (
              <div className="space-y-4 animate-in fade-in">
                {/* Resolution Selector */}
                <div>
                  <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                    <span>H3 Hex Resolution</span>
                    <span className="text-cyan-400 font-mono">Res {resolution}</span>
                  </label>
                  <div className="grid grid-cols-2 gap-1.5 mt-1.5">
                    {RESOLUTION_SPECS.map((spec) => (
                      <button
                        key={spec.res}
                        onClick={() => handleSelectResolution(spec.res)}
                        className={cn(
                          'px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all text-left',
                          resolution === spec.res
                            ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300 shadow-sm'
                            : 'bg-background border-border text-muted-foreground hover:text-foreground'
                        )}
                      >
                        <div>{spec.short}</div>
                        <div className="text-[10px] text-muted-foreground font-normal">±{spec.radiusKm} km</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Grid Disk Ring Radius (k-ring) */}
                <div>
                  <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                    <span>Geofence Ring Radius (k)</span>
                    <span className="text-cyan-400 font-mono">k = {diskK}</span>
                  </label>
                  <div className="grid grid-cols-4 gap-1.5 mt-1.5">
                    {[0, 1, 2, 3].map((k) => (
                      <button
                        key={k}
                        onClick={() => {
                          setDiskK(k);
                          try {
                            const origin = latLngToCell(centerLat, centerLng, resolution);
                            paintCells(gridDisk(origin, k));
                          } catch (e) {
                            console.error(e);
                          }
                        }}
                        className={cn(
                          'py-1 text-xs font-bold rounded-lg border transition-all text-center',
                          diskK === k
                            ? 'bg-blue-600 border-blue-400 text-foreground'
                            : 'bg-background border-border text-muted-foreground hover:text-foreground'
                        )}
                      >
                        k={k}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Selection Quick Actions */}
                <div className="pt-2 border-t border-border flex items-center gap-2">
                  <button
                    onClick={handleSelectAll}
                    className="flex-1 py-1.5 bg-muted hover:bg-accent text-foreground rounded-lg text-xs font-medium border border-border transition-colors"
                  >
                    Select All ({allMapSectorHexes.length})
                  </button>
                  <button
                    onClick={handleClearSelection}
                    className="px-3 py-1.5 bg-muted hover:bg-accent text-muted-foreground hover:text-red-400 rounded-lg text-xs font-medium border border-border transition-colors"
                  >
                    Clear
                  </button>
                </div>

                {/* Tile Sets — named groups */}
                <div className="pt-2 border-t border-border">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <Hexagon className="w-3 h-3" /> Tile Sets ({groups.length})
                    </div>
                    <button
                      onClick={handleAddGroup}
                      data-testid="h3-add-group"
                      className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold text-cyan-300 bg-cyan-500/10 border border-cyan-500/30 hover:bg-cyan-500/20 transition-colors"
                    >
                      <Plus className="w-3 h-3" /> Add set
                    </button>
                  </div>

                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
                    {groups.map((group) => {
                      const palette = groupColor(group.colorToken);
                      const isActive = group.groupId === activeGroup?.groupId;
                      const needed = requiredMatchCount(group);
                      return (
                        <div
                          key={group.groupId}
                          data-testid={`h3-group-${group.groupId}`}
                          onClick={() => setActiveGroupId(group.groupId)}
                          className={cn(
                            'rounded-xl border p-2 cursor-pointer transition-all',
                            isActive
                              ? `${palette.bg} ${palette.border}`
                              : 'bg-background border-border hover:border-border'
                          )}
                        >
                          <div className="flex items-center gap-1.5">
                            <span
                              className="h-2.5 w-2.5 rounded-sm shrink-0"
                              style={{ backgroundColor: palette.stroke }}
                            />

                            {renamingGroupId === group.groupId ? (
                              <input
                                autoFocus
                                value={renameDraft}
                                onChange={(e) => setRenameDraft(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                onBlur={() => {
                                  if (renameDraft.trim()) updateGroup(group.groupId, { name: renameDraft.trim() });
                                  setRenamingGroupId(null);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') e.currentTarget.blur();
                                  if (e.key === 'Escape') setRenamingGroupId(null);
                                }}
                                className="flex-1 min-w-0 h-6 rounded-md border border-cyan-500/40 bg-background px-1.5 text-[11px] text-foreground outline-none"
                              />
                            ) : (
                              <span className="flex-1 min-w-0 truncate text-[11px] font-bold text-foreground">
                                {group.name}
                              </span>
                            )}

                            <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                              {group.cells.length}
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setRenamingGroupId(group.groupId);
                                setRenameDraft(group.name);
                              }}
                              title="Rename set"
                              className="p-0.5 text-muted-foreground hover:text-foreground transition-colors"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRemoveGroup(group.groupId);
                              }}
                              title="Delete set"
                              className="p-0.5 text-muted-foreground hover:text-red-400 transition-colors"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>

                          {/* Aggregation policy */}
                          <div className="mt-1.5 flex items-center gap-1.5">
                            <select
                              value={group.aggregation ?? 'any'}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) =>
                                updateGroup(group.groupId, {
                                  aggregation: e.target.value as GroupAggregation,
                                })
                              }
                              className="flex-1 min-w-0 h-6 rounded-md border border-border bg-background px-1 text-[10px] text-foreground outline-none focus:border-cyan-500"
                            >
                              {GROUP_AGGREGATION_CATALOG.map((a) => (
                                <option key={a.aggregation} value={a.aggregation} title={a.description}>
                                  {a.label}
                                </option>
                              ))}
                            </select>

                            {group.aggregation === 'at_least' && (
                              <input
                                type="number"
                                min={1}
                                max={Math.max(1, group.cells.length)}
                                value={group.atLeastK ?? 1}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) =>
                                  updateGroup(group.groupId, {
                                    atLeastK: Math.max(1, parseInt(e.target.value, 10) || 1),
                                  })
                                }
                                className="w-12 h-6 rounded-md border border-border bg-background px-1 text-[10px] text-foreground outline-none focus:border-cyan-500"
                              />
                            )}
                          </div>

                          <p className="mt-1 text-[9.5px] text-muted-foreground leading-snug">
                            Needs <span className={palette.text}>{needed}</span> of {group.cells.length || 0} tile
                            {group.cells.length === 1 ? '' : 's'} to match.
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: TEMPORAL TRIGGERS & PERSISTENCE */}
            {sidebarTab === 'temporal' && (
              <div className="space-y-3.5 animate-in fade-in">
                {/* Master Trigger Toggle */}
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-card border border-border">
                  <div className="flex items-center gap-2">
                    <Zap className={cn('w-4 h-4', enableTemporalTrigger ? 'text-cyan-400' : 'text-muted-foreground')} />
                    <div>
                      <div className="text-xs font-bold text-foreground">Temporal Geofence Engine</div>
                      <div className="text-[10px] text-muted-foreground">State-machine edge &amp; dwell dispatch</div>
                    </div>
                  </div>
                  <button
                    onClick={() => setEnableTemporalTrigger((prev) => !prev)}
                    className={cn(
                      'px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all border',
                      enableTemporalTrigger
                        ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50 shadow-sm'
                        : 'bg-muted text-muted-foreground border-border'
                    )}
                  >
                    {enableTemporalTrigger ? 'Active' : 'Disabled'}
                  </button>
                </div>

                {enableTemporalTrigger && (
                  <div className="space-y-3 pt-1">
                    {/* Trigger Mode */}
                    <div>
                      <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">
                        Transition Trigger Event
                      </label>
                      <div className="grid grid-cols-2 gap-1.5">
                        {GEOFENCE_TRIGGER_CATALOG.map((item) => (
                          <button
                            key={item.trigger}
                            onClick={() => setTemporalTrigger(item.trigger)}
                            className={cn(
                              'p-2 rounded-xl border text-left transition-all flex flex-col justify-between',
                              temporalTrigger === item.trigger
                                ? 'bg-cyan-500/15 border-cyan-500 text-cyan-300'
                                : 'bg-background border-border text-muted-foreground hover:text-foreground'
                            )}
                          >
                            <div className="font-bold text-[11px] flex items-center justify-between">
                              <span>{item.label}</span>
                              {temporalTrigger === item.trigger && (
                                <Check className="w-3 h-3 text-cyan-400" />
                              )}
                            </div>
                            <div className="text-[9px] text-muted-foreground line-clamp-1 mt-0.5">
                              {item.trigger}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Contextual Trigger Inputs */}
                    {temporalTrigger === 'ON_DWELL' && (
                      <div className="p-2.5 rounded-xl bg-card border border-border space-y-1.5">
                        <label className="text-[11px] font-bold text-foreground flex items-center justify-between">
                          <span className="flex items-center gap-1.5">
                            <Timer className="w-3.5 h-3.5 text-cyan-400" /> Dwell SLA Threshold
                          </span>
                          <span className="font-mono text-cyan-300">{dwellSlaMinutes} min</span>
                        </label>
                        <input
                          type="range"
                          min={1}
                          max={120}
                          step={1}
                          value={dwellSlaMinutes}
                          onChange={(e) => setDwellSlaMinutes(parseInt(e.target.value, 10))}
                          className="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-cyan-400"
                        />
                        <div className="flex justify-between text-[9px] text-muted-foreground font-mono">
                          <span>1 min (Quick)</span>
                          <span>30 min</span>
                          <span>120 min (Extended)</span>
                        </div>
                      </div>
                    )}

                    {temporalTrigger === 'ON_APPROACH' && (
                      <div className="p-2.5 rounded-xl bg-card border border-border space-y-1.5">
                        <label className="text-[11px] font-bold text-foreground flex items-center justify-between">
                          <span className="flex items-center gap-1.5">
                            <Shield className="w-3.5 h-3.5 text-cyan-400" /> Approach Perimeter Buffer
                          </span>
                          <span className="font-mono text-cyan-300">{approachBufferKm} km</span>
                        </label>
                        <input
                          type="range"
                          min={0.5}
                          max={25}
                          step={0.5}
                          value={approachBufferKm}
                          onChange={(e) => setApproachBufferKm(parseFloat(e.target.value))}
                          className="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-cyan-400"
                        />
                        <div className="flex justify-between text-[9px] text-muted-foreground font-mono">
                          <span>0.5 km</span>
                          <span>10 km</span>
                          <span>25 km</span>
                        </div>
                      </div>
                    )}

                    {/* Persistence & Debounce Gate */}
                    <div className="p-2.5 rounded-xl bg-card border border-border space-y-2">
                      <div className="text-[11px] font-bold text-foreground flex items-center justify-between">
                        <span className="flex items-center gap-1.5">
                          <SlidersHorizontal className="w-3.5 h-3.5 text-cyan-400" /> Jitter Debounce Gate
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-[10px]">
                        <div>
                          <label className="text-muted-foreground text-[9.5px]">Consecutive Passes</label>
                          <select
                            value={persistenceHits}
                            onChange={(e) => setPersistenceHits(parseInt(e.target.value, 10))}
                            className="w-full mt-0.5 h-7 rounded-lg border border-border bg-background px-1.5 text-foreground text-[10px] outline-none"
                          >
                            <option value={1}>1 (Immediate fire)</option>
                            <option value={2}>2 passes (Debounced)</option>
                            <option value={3}>3 passes (High confidence)</option>
                            <option value={5}>5 passes (Ultra strict)</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-muted-foreground text-[9.5px]">Release Misses</label>
                          <select
                            value={persistenceMisses}
                            onChange={(e) => setPersistenceMisses(parseInt(e.target.value, 10))}
                            className="w-full mt-0.5 h-7 rounded-lg border border-border bg-background px-1.5 text-foreground text-[10px] outline-none"
                          >
                            <option value={1}>1 miss (Immediate)</option>
                            <option value={2}>2 misses (Hysteresis)</option>
                            <option value={3}>3 misses (Sticky latch)</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: TOKENS */}
            {sidebarTab === 'tokens' && (
              <div className="space-y-3 animate-in fade-in">
                <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  <span>Selected H3 Indices ({selectedHexSet.size})</span>
                  <button
                    onClick={() => {
                      const allTokens = Array.from(selectedHexSet).join('\n');
                      navigator.clipboard?.writeText(allTokens);
                      setCopiedHexId('all');
                      setTimeout(() => setCopiedHexId(null), 1500);
                    }}
                    className="flex items-center gap-1 text-[10px] text-cyan-300 hover:text-cyan-200"
                  >
                    {copiedHexId === 'all' ? (
                      <>
                        <CheckCheck className="w-3 h-3 text-emerald-400" />
                        <span>Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copy All</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="bg-background border border-border rounded-xl p-2 max-h-64 overflow-y-auto font-mono text-[10px] text-cyan-300 space-y-1">
                  {Array.from(selectedHexSet).map((hex) => (
                    <div key={hex} className="flex items-center justify-between hover:bg-muted/40 p-1 rounded">
                      <span>{hex}</span>
                      <span className="text-muted-foreground text-[9px]">
                        {cellOwnership.get(hex)?.name ?? 'Primary'}
                      </span>
                    </div>
                  ))}
                  {selectedHexSet.size === 0 && (
                    <div className="text-muted-foreground italic text-center py-4">
                      No hexagons selected
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Bottom Commit Action */}
          <div className="pt-3 border-t border-border">
            <button
              onClick={handleApply}
              disabled={!currentRegionName || selectedHexSet.size === 0}
              className="w-full py-2.5 bg-cyan-600 hover:bg-cyan-500 text-foreground rounded-xl text-xs font-bold shadow-lg shadow-cyan-900/30 transition-all flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Check className="w-4 h-4" />
              <span>Apply Spatial Geofence</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default H3SpatialPalette;
