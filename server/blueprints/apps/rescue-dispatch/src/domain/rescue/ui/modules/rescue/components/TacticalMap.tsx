import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Map, { FullscreenControl, Marker, NavigationControl, Popup, ScaleControl, type MapRef, type ViewStateChangeEvent } from "react-map-gl/maplibre";
import maplibregl from "maplibre-gl";
import { AlertTriangle, Crosshair, Layers3, LocateFixed, RefreshCw, Shield, UserRound, Wrench } from "lucide-react";
import "maplibre-gl/dist/maplibre-gl.css";

export const MAP_LIB: any = {
  ...(maplibregl as any),
  supported: () => (maplibregl as any).supported?.() ?? true,
};

export const STREET_RASTER_STYLE: any = {
  version: 8,
  sources: {
    "osm-street": {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [
    {
      id: "osm-street-layer",
      type: "raster",
      source: "osm-street",
      minzoom: 0,
      maxzoom: 22,
    },
  ],
};

export const SATELLITE_RASTER_STYLE: any = {
  version: 8,
  sources: {
    "satellite-tiles": {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      attribution: "Esri, Maxar, Earthstar Geographics",
    },
  },
  layers: [
    {
      id: "satellite-tiles-layer",
      type: "raster",
      source: "satellite-tiles",
      minzoom: 0,
      maxzoom: 22,
    },
  ],
};

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

interface TacticalMapProps {
  squads: SquadMapItem[];
  rescues: RescueMapItem[];
  providers: ProviderMapItem[];
  focusedRescueId?: string | null;
  onRescueClick?: (rescue: RescueMapItem) => void;
}

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

export default function TacticalMap({ squads, rescues, providers, focusedRescueId, onRescueClick }: TacticalMapProps) {
  const mapRef = useRef<MapRef | null>(null);
  const [viewState, setViewState] = useState(INITIAL_VIEW);
  const [selectedSquad, setSelectedSquad] = useState<SquadMapItem | null>(null);
  const [selectedRescue, setSelectedRescue] = useState<RescueMapItem | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<ProviderMapItem | null>(null);
  const [showSquads, setShowSquads] = useState(true);
  const [showRescues, setShowRescues] = useState(true);
  const [showProviders, setShowProviders] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  const squadsWithLocations = useMemo(() => squads.map((squad, index) => ({
    ...squad,
    location: squad.location || { lat: 34.045 + index * 0.012, lng: -118.262 + index * 0.016 },
  })), [squads]);

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

  const [basemapMode, setBasemapMode] = useState<"dark" | "satellite">("dark");

  // Public raster basemaps use MapLibre and require no Mapbox credentials.
  const activeMapStyle = basemapMode === "satellite" ? SATELLITE_RASTER_STYLE : STREET_RASTER_STYLE;
  const handleMapError = useCallback((event: any) => {
    setMapError(event?.error?.message || "Basemap tiles could not be loaded.");
  }, []);

  return (
    <div className="tactical-map relative w-full h-full min-h-[480px] bg-background overflow-hidden" data-testid="tactical-map">
      {!mapReady && !mapError && <div className="map-loading" role="status"><RefreshCw className="animate-spin" aria-hidden="true" />Loading tactical map</div>}
      {mapError && <div className="map-error" role="alert"><AlertTriangle aria-hidden="true" /><div><strong>Map tiles could not be loaded</strong><span>{mapError}</span></div><button type="button" onClick={resetView}>Retry</button></div>}

      {/* Layer / Basemap Toggle HUD */}
      <div className="absolute top-4 right-14 z-10 flex items-center gap-1.5 rounded-lg bg-card/90 px-2.5 py-1 backdrop-blur-md border border-border/60 text-[10px] font-mono shadow-md">
        <Layers3 className="h-3 w-3 text-cyan-400" />
        <button
          type="button"
          onClick={() => setBasemapMode((m) => (m === "dark" ? "satellite" : "dark"))}
          className="hover:text-cyan-300 font-semibold transition-colors"
          title="Toggle between Street map and Satellite Basemaps"
        >
          {basemapMode === "dark" ? "Street map" : "Satellite"}
        </button>
        <span className="text-muted-foreground">•</span>
        <span className="text-emerald-400 font-bold">
          {basemapMode === "satellite" ? "Esri imagery" : "OpenStreetMap"}
        </span>
      </div>

      <Map
        ref={mapRef}
        mapLib={MAP_LIB}
        {...viewState}
        onMove={(event: ViewStateChangeEvent) => setViewState(event.viewState)}
        onLoad={() => { setMapReady(true); setMapError(null); mapRef.current?.resize(); }}
        onError={handleMapError}
        mapStyle={activeMapStyle}
        attributionControl
        reuseMaps
        style={{ width: "100%", height: "100%" }}
      >
        <NavigationControl position="bottom-right" showCompass />
        <FullscreenControl position="bottom-right" />
        <ScaleControl position="bottom-left" maxWidth={100} unit="imperial" />

        {showSquads && squadsWithLocations.map((squad) => (
          <Marker key={squad.id} longitude={squad.location.lng} latitude={squad.location.lat} anchor="center" onClick={(event) => { event.originalEvent.stopPropagation(); setSelectedSquad(squad); setSelectedRescue(null); setSelectedProvider(null); }}>
            <button type="button" className="map-marker map-marker-squad" style={{ "--marker-color": squadColor(squad.status) } as React.CSSProperties} aria-label={`${squad.id}, ${squad.status}`}><Shield aria-hidden="true" /></button>
          </Marker>
        ))}

        {showRescues && rescues.map((rescue) => rescue.location && (
          <Marker key={rescue.id} longitude={rescue.location.lng} latitude={rescue.location.lat} anchor="center" onClick={(event) => { event.originalEvent.stopPropagation(); setSelectedRescue(rescue); setSelectedSquad(null); setSelectedProvider(null); onRescueClick?.(rescue); }}>
            <button type="button" className="map-marker map-marker-rescue" style={{ "--marker-color": rescueColor(rescue.priority) } as React.CSSProperties} aria-label={`${rescue.id}, ${rescue.priority} priority at ${rescue.target}`}><AlertTriangle aria-hidden="true" /></button>
          </Marker>
        ))}

        {showProviders && providers.map((provider) => (
          <Marker key={provider.providerId} longitude={provider.location.lng} latitude={provider.location.lat} anchor="center" onClick={(event) => { event.originalEvent.stopPropagation(); setSelectedProvider(provider); setSelectedRescue(null); setSelectedSquad(null); }}>
            <button type="button" className="map-marker map-marker-provider" aria-label={`${provider.name}, ${provider.availability || "provider"}`}><Wrench aria-hidden="true" /></button>
          </Marker>
        ))}

        {selectedSquad?.location && <Popup longitude={selectedSquad.location.lng} latitude={selectedSquad.location.lat} anchor="bottom" offset={22} closeOnClick={false} onClose={() => setSelectedSquad(null)} className="tactical-popup"><div className="popup-heading"><Shield aria-hidden="true" /> {selectedSquad.id}</div><dl><div><dt>Status</dt><dd>{selectedSquad.status}</dd></div><div><dt>Mission</dt><dd>{selectedSquad.mission}</dd></div><div><dt>Agents</dt><dd>{selectedSquad.agents}</dd></div><div><dt>Health</dt><dd>{Math.round(selectedSquad.health * 100)}%</dd></div></dl></Popup>}

        {selectedRescue?.location && <Popup longitude={selectedRescue.location.lng} latitude={selectedRescue.location.lat} anchor="bottom" offset={24} closeOnClick={false} onClose={() => setSelectedRescue(null)} className="tactical-popup"><div className="popup-heading rescue"><AlertTriangle aria-hidden="true" /> {selectedRescue.id}</div><strong className="popup-target">{selectedRescue.target}</strong><dl><div><dt>Priority</dt><dd>{selectedRescue.priority}</dd></div><div><dt>Status</dt><dd>{selectedRescue.status}</dd></div>{selectedRescue.address && <div><dt>Location</dt><dd>{selectedRescue.address}</dd></div>}{selectedRescue.incidentType && <div><dt>Incident</dt><dd>{selectedRescue.incidentType}</dd></div>}{selectedRescue.requestorName && <div><dt>Requestor</dt><dd><UserRound aria-hidden="true" /> {selectedRescue.requestorName}</dd></div>}{selectedRescue.requestorContact && <div><dt>Contact</dt><dd>{selectedRescue.requestorContact}</dd></div>}{selectedRescue.providerName && <div><dt>Provider</dt><dd>{selectedRescue.providerName}{selectedRescue.providerEtaMinutes ? ` · ${selectedRescue.providerEtaMinutes}m ETA` : ""}</dd></div>}</dl></Popup>}

        {selectedProvider && <Popup longitude={selectedProvider.location.lng} latitude={selectedProvider.location.lat} anchor="bottom" offset={22} closeOnClick={false} onClose={() => setSelectedProvider(null)} className="tactical-popup"><div className="popup-heading provider"><Wrench aria-hidden="true" /> Provider</div><strong className="popup-target">{selectedProvider.name}</strong><dl><div><dt>Status</dt><dd>{selectedProvider.availability || "Unknown"}</dd></div>{selectedProvider.rating != null && <div><dt>Rating</dt><dd>{selectedProvider.rating.toFixed(1)}</dd></div>}{selectedProvider.currentLoad != null && <div><dt>Active load</dt><dd>{selectedProvider.currentLoad}</dd></div>}{selectedProvider.specialties?.length ? <div><dt>Specialties</dt><dd>{selectedProvider.specialties.join(", ")}</dd></div> : null}</dl></Popup>}
      </Map>

      <div className="map-toolbar" aria-label="Map layers and controls">
        <button type="button" className="map-tool" onClick={resetView} aria-label="Fit all active operations" title="Fit all active operations"><LocateFixed aria-hidden="true" /></button>
        <button type="button" className="map-tool" onClick={resetView} aria-label="Refresh tactical map" title="Refresh tactical map"><RefreshCw className={isRefreshing ? "animate-spin" : ""} aria-hidden="true" /></button>
        <div className="map-toolbar-divider" />
        <button type="button" className="map-tool map-layer" aria-pressed={showSquads} onClick={() => setShowSquads((current) => !current)} title="Toggle squad markers"><Shield aria-hidden="true" /><span>Squads</span></button>
        <button type="button" className="map-tool map-layer rescue" aria-pressed={showRescues} onClick={() => setShowRescues((current) => !current)} title="Toggle rescue markers"><Layers3 aria-hidden="true" /><span>Requests</span></button>
        <button type="button" className="map-tool map-layer provider" aria-pressed={showProviders} onClick={() => setShowProviders((current) => !current)} title="Toggle provider markers"><Wrench aria-hidden="true" /><span>Providers</span></button>
      </div>
      <div className="map-status"><Crosshair aria-hidden="true" /> Live · {rescues.length} requests · {providers.length} providers</div>
    </div>
  );
}
