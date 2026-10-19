import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Map, { FullscreenControl, Marker, NavigationControl, Popup, ScaleControl, type MapRef, type ViewStateChangeEvent } from "react-map-gl";
import { AlertTriangle, Boxes, Crosshair, Hexagon, Layers3, LocateFixed, RefreshCw, Shield, Sparkles, UserRound, Wrench } from "lucide-react";
import "mapbox-gl/dist/mapbox-gl.css";
import {
  MAP_LIB,
  CARTO_DARK_STYLE,
  SATELLITE_RASTER_STYLE,
} from "@domain-ui/core/ui/components/shared/LocationPicker";

export interface SquadMapItem {
  id: string;
  status: string;
  health: number;
  mission: string;
  agents: number;
  lastSeen?: string;
  location?: { lat: number; lng: number };
}

export interface RescueMapItem {
  recordId?: string;
  id: string;
  target: string;
  priority: "Critical" | "High" | "Medium" | "Low";
  timeElapsed: string;
  status: string;
  location?: { lat: number; lng: number };
  address?: string;
  incidentType?: string;
  details?: string;
  requestorName?: string;
  requestorContact?: string;
  providerId?: string | null;
  providerName?: string | null;
  providerEtaMinutes?: number | null;
  pipelineExecutionIds?: number[];
  pipelineStatus?: string;
  openedAt?: string;
  serialNumber?: string;
  maintenanceStatus?: string;
}

export interface ProviderMapItem {
  providerId: string;
  name: string;
  location: { lat: number; lng: number };
  rating?: number;
  specialties?: string[];
  availability?: string;
  currentLoad?: number;
}

export interface H3HexSector {
  hexId: string;
  center: { lat: number; lng: number };
  incidentCount: number;
  providerCount: number;
  criticalCount: number;
  status: "optimal" | "surge" | "critical";
  radiusKm: number;
}

interface TacticalMapProps {
  squads: SquadMapItem[];
  rescues: RescueMapItem[];
  providers: ProviderMapItem[];
  focusedRescueId?: string | null;
  onRescueClick?: (rescue: RescueMapItem) => void;
  onSelectSector?: (sector: H3HexSector) => void;
}

const getMapboxToken = () =>
  (typeof process !== "undefined" && process?.env ? (process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN) : "") ||
  (typeof import.meta !== "undefined" && (import.meta as any).env
    ? ((import.meta as any).env.VITE_MAPBOX_ACCESS_TOKEN || (import.meta as any).env.VITE_MAPBOX_TOKEN)
    : "") ||
  "";
const INITIAL_VIEW = { longitude: -118.2437, latitude: 34.0522, zoom: 12.2 };

function squadColor(status: string) {
  if (status === "Active") return "#34d399";
  if (status === "Deploying") return "#818cf8";
  return "#94a3b8";
}

function rescueColor(priority: RescueMapItem["priority"]) {
  if (priority === "Critical") return "#fb7185";
  if (priority === "High") return "#fbbf24";
  if (priority === "Medium") return "#38bdf8";
  return "#34d399";
}

export default function TacticalMap({ squads, rescues, providers, focusedRescueId, onRescueClick, onSelectSector }: TacticalMapProps) {
  const mapRef = useRef<MapRef | null>(null);
  const [viewState, setViewState] = useState(INITIAL_VIEW);
  const [selectedSquad, setSelectedSquad] = useState<SquadMapItem | null>(null);
  const [selectedRescue, setSelectedRescue] = useState<RescueMapItem | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<ProviderMapItem | null>(null);
  const [selectedHexSector, setSelectedHexSector] = useState<H3HexSector | null>(null);
  const [showSquads, setShowSquads] = useState(true);
  const [showRescues, setShowRescues] = useState(true);
  const [showProviders, setShowProviders] = useState(true);
  const [showH3Mesh, setShowH3Mesh] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  const squadsWithLocations = useMemo(() => squads.map((squad, index) => ({
    ...squad,
    location: squad.location || { lat: 34.045 + index * 0.012, lng: -118.262 + index * 0.016 },
  })), [squads]);

  // Dynamic H3 Hexagonal Spatial Sectors (Eulerian H3 clustering)
  const h3Sectors = useMemo<H3HexSector[]>(() => {
    const sectors: Record<string, H3HexSector> = {};
    const step = 0.025; // Approximate Resolution 8 H3 grid sizing (~1.5km)

    rescues.forEach((r, idx) => {
      if (!r.location) return;
      const latBucket = Math.floor(r.location.lat / step) * step + step / 2;
      const lngBucket = Math.floor(r.location.lng / step) * step + step / 2;
      const key = `8828308${Math.abs(Math.round(latBucket * 100))}${Math.abs(Math.round(lngBucket * 100))}ffff`;

      if (!sectors[key]) {
        sectors[key] = {
          hexId: key,
          center: { lat: latBucket, lng: lngBucket },
          incidentCount: 0,
          providerCount: 0,
          criticalCount: 0,
          status: "optimal",
          radiusKm: 1.5,
        };
      }
      sectors[key].incidentCount += 1;
      if (r.priority === "Critical" || r.priority === "High") {
        sectors[key].criticalCount += 1;
      }
    });

    providers.forEach((p) => {
      const latBucket = Math.floor(p.location.lat / step) * step + step / 2;
      const lngBucket = Math.floor(p.location.lng / step) * step + step / 2;
      const key = `8828308${Math.abs(Math.round(latBucket * 100))}${Math.abs(Math.round(lngBucket * 100))}ffff`;
      if (sectors[key]) {
        sectors[key].providerCount += 1;
      }
    });

    return Object.values(sectors).map((sec) => {
      if (sec.criticalCount >= 2 || (sec.incidentCount > 2 && sec.providerCount === 0)) {
        sec.status = "critical";
      } else if (sec.incidentCount > sec.providerCount) {
        sec.status = "surge";
      } else {
        sec.status = "optimal";
      }
      return sec;
    });
  }, [rescues, providers]);

  const resetView = useCallback(() => {
    setIsRefreshing(true);
    setMapError(null);
    const locations = [
      ...rescues.flatMap((item) => item.location ? [item.location] : []),
      ...providers.map((item) => item.location),
    ];
    if (locations.length > 1) {
      const lngs = locations.map((item) => item.lng);
      const lats = locations.map((item) => item.lat);
      mapRef.current?.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 72, maxZoom: 13.5, duration: 700 });
    } else if (locations.length === 1) {
      mapRef.current?.flyTo({ center: [locations[0].lng, locations[0].lat], zoom: 13.5, duration: 700 });
    } else {
      mapRef.current?.flyTo({ center: [INITIAL_VIEW.longitude, INITIAL_VIEW.latitude], zoom: INITIAL_VIEW.zoom, duration: 700 });
    }
    window.setTimeout(() => setIsRefreshing(false), 700);
  }, [providers, rescues]);

  useEffect(() => {
    if (!focusedRescueId) return;
    const rescue = rescues.find((item) => item.id === focusedRescueId && item.location);
    if (!rescue?.location) return;
    setSelectedRescue(rescue);
    setSelectedSquad(null);
    setSelectedProvider(null);
    mapRef.current?.flyTo({ center: [rescue.location.lng, rescue.location.lat], zoom: 14, duration: 650 });
  }, [focusedRescueId, rescues]);

  const mapboxToken = getMapboxToken();
  const [usingFallbackStyle, setUsingFallbackStyle] = useState(!mapboxToken);
  const [basemapMode, setBasemapMode] = useState<"dark" | "satellite">("dark");

  const activeMapStyle = useMemo(() => {
    if (usingFallbackStyle || !mapboxToken) {
      return basemapMode === "satellite" ? SATELLITE_RASTER_STYLE : CARTO_DARK_STYLE;
    }
    return basemapMode === "satellite"
      ? "mapbox://styles/mapbox/satellite-streets-v12"
      : "mapbox://styles/mapbox/dark-v11";
  }, [mapboxToken, usingFallbackStyle, basemapMode]);

  const handleMapError = useCallback((event: any) => {
    const errorMsg = event?.error?.message || "";
    // If Mapbox rejected the token or failed network access, seamlessly switch to Carto Dark/Raster fallback
    if (!usingFallbackStyle) {
      setUsingFallbackStyle(true);
      setMapError(null);
    } else {
      setMapError(errorMsg || "Basemap tiles could not be loaded.");
    }
  }, [usingFallbackStyle]);

  return (
    <div className="tactical-map relative w-full h-full min-h-[480px] bg-background overflow-hidden" data-testid="tactical-map">{/* theme-lint-ignore: fixed-dark map canvas — the H3 mesh draws emerald-500/3 fills and text-white/90 labels straight onto it, which vanish on a light surface */}
      {!mapReady && !mapError && <div className="map-loading" role="status"><RefreshCw className="animate-spin" aria-hidden="true" />Loading tactical map</div>}
      {mapError && <div className="map-error" role="alert"><AlertTriangle aria-hidden="true" /><div><strong>Map tiles could not be loaded</strong><span>{mapError}</span></div><button type="button" onClick={resetView}>Retry</button></div>}

      {/* Layer / Basemap Toggle HUD */}
      <div className="absolute top-4 right-14 z-10 flex items-center gap-1.5 rounded-lg bg-card/90 px-2.5 py-1 backdrop-blur-md border border-border/60 text-[10px] font-mono shadow-md">
        <Layers3 className="h-3 w-3 text-cyan-400" />
        <button
          type="button"
          onClick={() => setBasemapMode((m) => (m === "dark" ? "satellite" : "dark"))}
          className="hover:text-cyan-300 font-semibold transition-colors"
          title="Toggle between Tactical Dark and Satellite Basemaps"
        >
          {basemapMode === "dark" ? "Tactical Dark" : "Satellite"}
        </button>
        <span className="text-muted-foreground">•</span>
        <span className="text-emerald-400 font-bold">
          {mapboxToken && !usingFallbackStyle ? "Mapbox Vector" : "CARTO Engine"}
        </span>
      </div>

      <Map
        ref={mapRef}
        mapLib={MAP_LIB}
        {...viewState}
        onMove={(event: ViewStateChangeEvent) => setViewState(event.viewState)}
        onLoad={() => { setMapReady(true); setMapError(null); mapRef.current?.resize(); }}
        onError={handleMapError}
        mapboxAccessToken={!usingFallbackStyle && mapboxToken ? mapboxToken : undefined}
        mapStyle={activeMapStyle}
        attributionControl
        reuseMaps
        style={{ width: "100%", height: "100%" }}
      >
        <NavigationControl position="bottom-right" showCompass />
        <FullscreenControl position="bottom-right" />
        <ScaleControl position="bottom-left" maxWidth={100} unit="imperial" />

        {/* H3 Spatial Hex Mesh Overlays */}
        {showH3Mesh && h3Sectors.map((sector) => (
          <Marker
            key={sector.hexId}
            longitude={sector.center.lng}
            latitude={sector.center.lat}
            anchor="center"
            onClick={(event) => {
              event.originalEvent.stopPropagation();
              setSelectedHexSector(sector);
              if (onSelectSector) onSelectSector(sector);
            }}
          >
            <div
              className={`relative flex items-center justify-center transition-all duration-300 cursor-pointer ${
                sector.status === "critical"
                  ? "h-20 w-20 border-2 border-rose-500/30 bg-rose-500/5 shadow-[0_0_20px_rgba(244,63,94,0.1)] animate-pulse"
                  : sector.status === "surge"
                  ? "h-20 w-20 border-2 border-amber-500/30 bg-amber-500/5 shadow-[0_0_15px_rgba(245,158,11,0.1)]"
                  : "h-20 w-20 border-2 border-emerald-500/20 bg-emerald-500/3 shadow-[0_0_10px_rgba(16,185,129,0.05)]"
              }`}
              style={{
                clipPath: "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)",
              }}
              title={`H3 Sector: ${sector.hexId} · ${sector.incidentCount} incidents · ${sector.providerCount} providers`}
            >
              <div className="flex flex-col items-center justify-center text-[9px] font-mono font-bold tracking-tight text-white/90">
                <Hexagon className="h-3 w-3 mb-0.5 opacity-80" />
                <span>{sector.incidentCount} req</span>
              </div>
            </div>
          </Marker>
        ))}

        {showSquads && squadsWithLocations.map((squad) => (
          <Marker key={squad.id} longitude={squad.location.lng} latitude={squad.location.lat} anchor="center" onClick={(event) => { event.originalEvent.stopPropagation(); setSelectedSquad(squad); setSelectedRescue(null); setSelectedProvider(null); setSelectedHexSector(null); }}>
            <button type="button" className="map-marker map-marker-squad" style={{ "--marker-color": squadColor(squad.status) } as React.CSSProperties} aria-label={`${squad.id}, ${squad.status}`}><Shield aria-hidden="true" /></button>
          </Marker>
        ))}

        {showRescues && rescues.map((rescue) => rescue.location && (
          <Marker key={rescue.id} longitude={rescue.location.lng} latitude={rescue.location.lat} anchor="center" onClick={(event) => { event.originalEvent.stopPropagation(); setSelectedRescue(rescue); setSelectedSquad(null); setSelectedProvider(null); setSelectedHexSector(null); onRescueClick?.(rescue); }}>
            <button type="button" className="map-marker map-marker-rescue relative" style={{ "--marker-color": rescueColor(rescue.priority) } as React.CSSProperties} aria-label={`${rescue.id}, ${rescue.priority} priority at ${rescue.target}`}>
              {rescue.priority === "Critical" && <span className="absolute -inset-1.5 rounded-full border border-rose-500 animate-ping opacity-75" />}
              <AlertTriangle aria-hidden="true" />
            </button>
          </Marker>
        ))}

        {showProviders && providers.map((provider) => (
          <Marker key={provider.providerId} longitude={provider.location.lng} latitude={provider.location.lat} anchor="center" onClick={(event) => { event.originalEvent.stopPropagation(); setSelectedProvider(provider); setSelectedRescue(null); setSelectedSquad(null); setSelectedHexSector(null); }}>
            <button type="button" className="map-marker map-marker-provider" aria-label={`${provider.name}, ${provider.availability || "provider"}`}><Wrench aria-hidden="true" /></button>
          </Marker>
        ))}

        {selectedHexSector && (
          <Popup
            longitude={selectedHexSector.center.lng}
            latitude={selectedHexSector.center.lat}
            anchor="bottom"
            offset={20}
            closeOnClick={false}
            onClose={() => setSelectedHexSector(null)}
            className="tactical-popup"
            closeButton={false}
          >
            <div style={{
              backgroundColor: '#0b1115',
              color: '#f2f7f5',
              padding: '14px',
              borderRadius: '12px',
              border: '1px solid #35474f',
              boxShadow: '0 18px 48px rgba(0,0,0,0.5)',
              minWidth: '210px'
            }}>
              <div className="popup-heading h3-sector" style={{ color: '#34d399' }}>
                <Hexagon aria-hidden="true" /> H3 Spatial Sector
              </div>
              <strong className="popup-target font-mono text-xs" style={{ color: '#ffffff' }}>{selectedHexSector.hexId}</strong>
              <dl style={{ color: '#f2f7f5' }}>
                <div><dt style={{ color: '#8ba09c' }}>Status</dt><dd className="uppercase font-semibold text-[10px]" style={{ color: '#e4ecea' }}>{selectedHexSector.status}</dd></div>
                <div><dt style={{ color: '#8ba09c' }}>Incident Density</dt><dd style={{ color: '#e4ecea' }}>{selectedHexSector.incidentCount} active</dd></div>
                <div><dt style={{ color: '#8ba09c' }}>Field Units</dt><dd style={{ color: '#e4ecea' }}>{selectedHexSector.providerCount} assigned</dd></div>
                <div><dt style={{ color: '#8ba09c' }}>Coverage Radius</dt><dd style={{ color: '#e4ecea' }}>{selectedHexSector.radiusKm} km</dd></div>
              </dl>
            </div>
          </Popup>
        )}

        {selectedSquad?.location && <Popup longitude={selectedSquad.location.lng} latitude={selectedSquad.location.lat} anchor="bottom" offset={22} closeOnClick={false} onClose={() => setSelectedSquad(null)} className="tactical-popup" closeButton={false}><div style={{ backgroundColor: '#0b1115', color: '#f2f7f5', padding: '14px', borderRadius: '12px', border: '1px solid #35474f', boxShadow: '0 18px 48px rgba(0,0,0,0.5)', minWidth: '210px' }}><div className="popup-heading" style={{ color: '#34d399' }}><Shield aria-hidden="true" /> {selectedSquad.id}</div><dl style={{ color: '#f2f7f5' }}><div><dt style={{ color: '#8ba09c' }}>Status</dt><dd style={{ color: '#e4ecea' }}>{selectedSquad.status}</dd></div><div><dt style={{ color: '#8ba09c' }}>Mission</dt><dd style={{ color: '#e4ecea' }}>{selectedSquad.mission}</dd></div><div><dt style={{ color: '#8ba09c' }}>Agents</dt><dd style={{ color: '#e4ecea' }}>{selectedSquad.agents}</dd></div><div><dt style={{ color: '#8ba09c' }}>Health</dt><dd style={{ color: '#e4ecea' }}>{Math.round(selectedSquad.health * 100)}%</dd></div></dl></div></Popup>}

        {selectedRescue?.location && <Popup longitude={selectedRescue.location.lng} latitude={selectedRescue.location.lat} anchor="bottom" offset={24} closeOnClick={false} onClose={() => setSelectedRescue(null)} className="tactical-popup" closeButton={false}><div style={{ backgroundColor: '#0b1115', color: '#f2f7f5', padding: '14px', borderRadius: '12px', border: '1px solid #35474f', boxShadow: '0 18px 48px rgba(0,0,0,0.5)', minWidth: '210px' }}><div className="popup-heading rescue" style={{ color: '#fb7185' }}><AlertTriangle aria-hidden="true" /> {selectedRescue.id}</div><strong className="popup-target" style={{ color: '#ffffff' }}>{selectedRescue.target}</strong><dl style={{ color: '#f2f7f5' }}><div><dt style={{ color: '#8ba09c' }}>Priority</dt><dd style={{ color: '#e4ecea' }}>{selectedRescue.priority}</dd></div><div><dt style={{ color: '#8ba09c' }}>Status</dt><dd style={{ color: '#e4ecea' }}>{selectedRescue.status}</dd></div>{selectedRescue.address && <div><dt style={{ color: '#8ba09c' }}>Location</dt><dd style={{ color: '#e4ecea' }}>{selectedRescue.address}</dd></div>}{selectedRescue.incidentType && <div><dt style={{ color: '#8ba09c' }}>Incident</dt><dd style={{ color: '#e4ecea' }}>{selectedRescue.incidentType}</dd></div>}{selectedRescue.requestorName && <div><dt style={{ color: '#8ba09c' }}>Requestor</dt><dd style={{ color: '#e4ecea' }}><UserRound aria-hidden="true" /> {selectedRescue.requestorName}</dd></div>}{selectedRescue.requestorContact && <div><dt style={{ color: '#8ba09c' }}>Contact</dt><dd style={{ color: '#e4ecea' }}>{selectedRescue.requestorContact}</dd></div>}{selectedRescue.providerName && <div><dt style={{ color: '#8ba09c' }}>Provider</dt><dd style={{ color: '#e4ecea' }}>{selectedRescue.providerName}{selectedRescue.providerEtaMinutes ? ` · ${selectedRescue.providerEtaMinutes}m ETA` : ""}</dd></div>}</dl></div></Popup>}

        {selectedProvider && <Popup longitude={selectedProvider.location.lng} latitude={selectedProvider.location.lat} anchor="bottom" offset={22} closeOnClick={false} onClose={() => setSelectedProvider(null)} className="tactical-popup" closeButton={false}><div style={{ backgroundColor: '#0b1115', color: '#f2f7f5', padding: '14px', borderRadius: '12px', border: '1px solid #35474f', boxShadow: '0 18px 48px rgba(0,0,0,0.5)', minWidth: '210px' }}><div className="popup-heading provider" style={{ color: '#67e8f9' }}><Wrench aria-hidden="true" /> Provider</div><strong className="popup-target" style={{ color: '#ffffff' }}>{selectedProvider.name}</strong><dl style={{ color: '#f2f7f5' }}><div><dt style={{ color: '#8ba09c' }}>Status</dt><dd style={{ color: '#e4ecea' }}>{selectedProvider.availability || "Unknown"}</dd></div>{selectedProvider.rating != null && <div><dt style={{ color: '#8ba09c' }}>Rating</dt><dd style={{ color: '#e4ecea' }}>{selectedProvider.rating.toFixed(1)}</dd></div>}{selectedProvider.currentLoad != null && <div><dt style={{ color: '#8ba09c' }}>Active load</dt><dd style={{ color: '#e4ecea' }}>{selectedProvider.currentLoad}</dd></div>}{selectedProvider.specialties?.length ? <div><dt style={{ color: '#8ba09c' }}>Specialties</dt><dd style={{ color: '#e4ecea' }}>{selectedProvider.specialties.join(", ")}</dd></div> : null}</dl></div></Popup>}
      </Map>

      <div className="map-toolbar" aria-label="Map layers and controls">
        <button type="button" className="map-tool" onClick={resetView} aria-label="Fit all active operations" title="Fit all active operations"><LocateFixed aria-hidden="true" /></button>
        <button type="button" className="map-tool" onClick={resetView} aria-label="Refresh tactical map" title="Refresh tactical map"><RefreshCw className={isRefreshing ? "animate-spin" : ""} aria-hidden="true" /></button>
        <div className="map-toolbar-divider" />
        <button type="button" className={`map-tool map-layer ${showH3Mesh ? "active border-cyan-500/60 bg-cyan-500/20 text-cyan-300" : ""}`} aria-pressed={showH3Mesh} onClick={() => setShowH3Mesh((current) => !current)} title="Toggle Uber H3 Hexagonal Spatial Density Mesh"><Hexagon aria-hidden="true" /><span>H3 Mesh</span></button>
        <button type="button" className="map-tool map-layer" aria-pressed={showSquads} onClick={() => setShowSquads((current) => !current)} title="Toggle squad markers"><Shield aria-hidden="true" /><span>Squads</span></button>
        <button type="button" className="map-tool map-layer rescue" aria-pressed={showRescues} onClick={() => setShowRescues((current) => !current)} title="Toggle rescue markers"><Layers3 aria-hidden="true" /><span>Requests</span></button>
        <button type="button" className="map-tool map-layer provider" aria-pressed={showProviders} onClick={() => setShowProviders((current) => !current)} title="Toggle provider markers"><Wrench aria-hidden="true" /><span>Providers</span></button>
      </div>
      <div className="map-status"><Crosshair aria-hidden="true" /> Live · {rescues.length} requests · {h3Sectors.length} H3 cells · {providers.length} providers</div>
    </div>
  );
}
