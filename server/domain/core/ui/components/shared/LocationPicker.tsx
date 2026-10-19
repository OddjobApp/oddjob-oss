import React, { useState, useEffect, useCallback, useRef } from "react";
import Map, { Marker, NavigationControl, ViewStateChangeEvent } from "react-map-gl";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import {
  MapPin,
  Search,
  Crosshair,
  Loader2,
  Navigation,
  Check,
  Compass,
  Layers,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { cn } from "@/lib/utils";

export interface LocationValue {
  address: string;
  lat: number;
  lng: number;
  resolvedAddress?: string;
  accuracy?: string;
}

interface LocationPickerProps {
  value?: string | LocationValue | null;
  onChange: (value: LocationValue | string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Whether to output structured JSON LocationValue or plain address string. Defaults to false (outputs string/JSON-compatible). */
  outputFormat?: "object" | "string";
  /** Default map center coordinates if empty. Default is Los Angeles (34.0522, -118.2437). */
  defaultCenter?: { lat: number; lng: number };
}

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

export const CARTO_DARK_STYLE: any = {
  version: 8,
  sources: {
    "carto-dark": {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
    },
  },
  layers: [
    {
      id: "carto-dark-layer",
      type: "raster",
      source: "carto-dark",
      minzoom: 0,
      maxzoom: 22,
    },
  ],
};

export const MAPBOX_TOKEN =
  (typeof process !== "undefined" && process?.env
    ? process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN
    : "") ||
  (typeof import.meta !== "undefined" && (import.meta as any).env
    ? (import.meta as any).env.VITE_MAPBOX_ACCESS_TOKEN || (import.meta as any).env.VITE_MAPBOX_TOKEN
    : "") ||
  "";

// react-map-gl v7 gates map creation on `mapboxgl.supported(props)`, but
// mapbox-gl v3 reads that argument as its `failIfMajorPerformanceCaveat` flag
// rather than as an options object. A props object is always truthy, so the
// strict check runs and any browser on software WebGL — a VM, a remote desktop
// session, a blocklisted GPU — is reported unsupported and no map mounts at
// all, even though mapbox-gl renders there fine. Ask the lenient question the
// Map constructor itself defaults to (failIfMajorPerformanceCaveat: false).
export const MAP_LIB: any = {
  ...(mapboxgl as any),
  supported: () => (mapboxgl as any).supported?.() ?? true,
};

/** Turn a mapbox-gl error into something a form-filler can act on. */
export function describeMapError(err: unknown): string {
  const message = (err as any)?.message ? String((err as any).message) : String(err ?? "");
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return "Could not reach api.mapbox.com. A VPN, proxy, or blocking browser extension is the usual cause.";
  }
  if (/401|unauthorized|access token/i.test(message)) {
    return "Mapbox rejected the access token for this deployment.";
  }
  return message.slice(0, 160) || "The basemap failed to load.";
}

function parseInitialValue(
  val?: string | LocationValue | null,
  fallbackCenter = { lat: 34.0522, lng: -118.2437 }
): LocationValue {
  if (!val) {
    return { address: "", lat: fallbackCenter.lat, lng: fallbackCenter.lng };
  }
  if (typeof val === "object" && "lat" in val && "lng" in val) {
    return {
      address: val.address || `${val.lat.toFixed(4)}, ${val.lng.toFixed(4)}`,
      lat: Number(val.lat) || fallbackCenter.lat,
      lng: Number(val.lng) || fallbackCenter.lng,
      resolvedAddress: val.resolvedAddress,
    };
  }
  if (typeof val === "string") {
    // Check if JSON
    try {
      const parsed = JSON.parse(val);
      if (parsed && typeof parsed === "object" && "lat" in parsed && "lng" in parsed) {
        return {
          address: parsed.address || `${parsed.lat.toFixed(4)}, ${parsed.lng.toFixed(4)}`,
          lat: Number(parsed.lat) || fallbackCenter.lat,
          lng: Number(parsed.lng) || fallbackCenter.lng,
          resolvedAddress: parsed.resolvedAddress,
        };
      }
    } catch {
      // Plain text address
    }
    return { address: val, lat: fallbackCenter.lat, lng: fallbackCenter.lng };
  }
  return { address: "", lat: fallbackCenter.lat, lng: fallbackCenter.lng };
}

export function LocationPicker({
  value,
  onChange,
  placeholder = "Search street, landmark, city, or coordinates...",
  disabled = false,
  className,
  outputFormat = "object",
  defaultCenter = { lat: 34.0522, lng: -118.2437 },
}: LocationPickerProps) {
  const [currentLoc, setCurrentLoc] = useState<LocationValue>(() =>
    parseInitialValue(value, defaultCenter)
  );
  const [searchQuery, setSearchQuery] = useState<string>(currentLoc.address || "");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showManualCoords, setShowManualCoords] = useState(false);
  const [hasSelectedPin, setHasSelectedPin] = useState(
    Boolean(currentLoc.address && currentLoc.address.trim())
  );
  // The basemap is decoration over the coordinates, so a broken basemap must
  // say so rather than leave an empty black rectangle that reads as "no map".
  const [mapError, setMapError] = useState<string | null>(null);

  const [viewState, setViewState] = useState({
    longitude: currentLoc.lng,
    latitude: currentLoc.lat,
    zoom: currentLoc.address ? 13 : 11,
  });

  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Sync external value changes
  useEffect(() => {
    const parsed = parseInitialValue(value, defaultCenter);
    setCurrentLoc(parsed);
    if (parsed.address && parsed.address !== searchQuery) {
      setSearchQuery(parsed.address);
      setHasSelectedPin(true);
    }
  }, [value]);

  // Click outside suggestions dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const emitChange = (loc: LocationValue) => {
    setCurrentLoc(loc);
    setHasSelectedPin(true);
    if (outputFormat === "string") {
      onChange(loc.address || `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`);
    } else {
      onChange(loc);
    }
  };

  // Fetch Autocomplete Suggestions
  const fetchSuggestions = useCallback(async (query: string) => {
    if (!query || query.trim().length < 3) {
      setSuggestions([]);
      return;
    }
    setIsSearching(true);
    try {
      const res = await fetch(`/api/geo/geocode/suggest?q=${encodeURIComponent(query.trim())}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setSuggestions(data);
          setShowSuggestions(true);
        }
      }
    } catch (err) {
      console.warn("[LocationPicker] Suggest failed:", err);
    } finally {
      setIsSearching(false);
    }
  }, []);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery && searchQuery !== currentLoc.address) {
        fetchSuggestions(searchQuery);
      }
    }, 280);
    return () => clearTimeout(timer);
  }, [searchQuery, currentLoc.address, fetchSuggestions]);

  // Select a suggestion or geocode search query
  const handleSelectAddress = async (selectedAddress: string) => {
    setSearchQuery(selectedAddress);
    setShowSuggestions(false);
    setIsSearching(true);
    try {
      const res = await fetch(`/api/geo/geocode?address=${encodeURIComponent(selectedAddress)}`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.location) {
          const newLoc: LocationValue = {
            address: data.resolvedAddress || selectedAddress,
            lat: data.location.lat,
            lng: data.location.lng,
            resolvedAddress: data.resolvedAddress,
            accuracy: data.accuracy,
          };
          emitChange(newLoc);
          setViewState((v) => ({
            ...v,
            latitude: newLoc.lat,
            longitude: newLoc.lng,
            zoom: 14,
          }));
        }
      }
    } catch (err) {
      console.warn("[LocationPicker] Geocoding failed:", err);
    } finally {
      setIsSearching(false);
    }
  };

  // HTML5 Browser Geolocation ("Use My Location")
  const handleGetMyLocation = () => {
    if (!("geolocation" in navigator)) {
      alert("Geolocation is not supported by your browser");
      return;
    }
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;

        try {
          const res = await fetch(`/api/geo/reverse-geocode?lat=${lat}&lng=${lng}`);
          if (res.ok) {
            const data = await res.json();
            const addr = data.address || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
            setSearchQuery(addr);
            const newLoc: LocationValue = {
              address: addr,
              lat,
              lng,
              resolvedAddress: data.address,
              accuracy: data.resolvedBy,
            };
            emitChange(newLoc);
            setViewState((v) => ({ ...v, latitude: lat, longitude: lng, zoom: 15 }));
          }
        } catch (err) {
          const fallbackAddr = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
          setSearchQuery(fallbackAddr);
          emitChange({ address: fallbackAddr, lat, lng });
          setViewState((v) => ({ ...v, latitude: lat, longitude: lng, zoom: 15 }));
        } finally {
          setIsLocating(false);
        }
      },
      (err) => {
        console.warn("[LocationPicker] Geolocation error:", err);
        setIsLocating(false);
        alert(`Location access failed: ${err.message}`);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  // Map click to drop/move marker
  const handleMapClick = async (e: any) => {
    if (disabled) return;
    const lat = e.lngLat.lat;
    const lng = e.lngLat.lng;
    const initialAddr = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

    // Immediately update local and form state
    setSearchQuery(initialAddr);
    emitChange({ address: initialAddr, lat, lng });
    setViewState((v) => ({ ...v, latitude: lat, longitude: lng }));

    // Non-blocking reverse geocode enhancement
    try {
      const res = await fetch(`/api/geo/reverse-geocode?lat=${lat}&lng=${lng}`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.address) {
          setSearchQuery(data.address);
          emitChange({ address: data.address, lat, lng, resolvedAddress: data.address, accuracy: data.resolvedBy });
        }
      }
    } catch {
      // Keep initial address
    }
  };

  return (
    <div className={cn("space-y-3 rounded-xl border border-border/80 bg-card/60 p-3.5 backdrop-blur-md shadow-sm", className)}>
      {/* Search Bar & GPS Locate Button */}
      <div className="relative flex items-center gap-2" ref={searchContainerRef}>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => {
              const text = e.target.value;
              setSearchQuery(text);
              emitChange({ ...currentLoc, address: text });
            }}
            onFocus={() => {
              if (suggestions.length > 0) setShowSuggestions(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSelectAddress(searchQuery);
              }
            }}
            placeholder={placeholder}
            disabled={disabled}
            className="pl-9 pr-8 text-xs h-9 bg-background/80 border-border"
          />
          {isSearching && (
            <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-primary" />
          )}
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleGetMyLocation}
          disabled={disabled || isLocating}
          className="h-9 text-xs px-2.5 border-border hover:border-primary/50 text-foreground shrink-0"
          title="Use My Current GPS Location"
        >
          {isLocating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1 text-primary" />
          ) : (
            <Crosshair className="h-3.5 w-3.5 mr-1 text-emerald-400" />
          )}
          <span>Locate Me</span>
        </Button>
      </div>

      {/* Autocomplete Suggestions Dropdown */}
      {showSuggestions && suggestions.length > 0 && (
        <div className="relative z-50">
          <div className="absolute top-0 left-0 right-0 max-h-48 overflow-y-auto rounded-lg border border-border bg-popover/95 p-1 shadow-xl backdrop-blur-md">
            {suggestions.map((sug, i) => (
              <button
                key={`${sug}-${i}`}
                type="button"
                className="w-full text-left px-3 py-2 text-xs rounded-md hover:bg-muted/80 text-foreground flex items-center gap-2 transition-colors truncate"
                onClick={() => handleSelectAddress(sug)}
              >
                <MapPin className="h-3.5 w-3.5 text-primary shrink-0" />
                <span className="truncate">{sug}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Interactive Map Preview */}
      <div className="relative h-48 w-full overflow-hidden rounded-lg border border-border/70 bg-black/40">
        <Map
          {...viewState}
          mapLib={MAP_LIB}
          onMove={(evt: ViewStateChangeEvent) => setViewState(evt.viewState)}
          onClick={handleMapClick}
          onError={(evt: any) =>
            setMapError((prev) => prev ?? describeMapError(evt?.error ?? evt))
          }
          mapboxAccessToken={MAPBOX_TOKEN || undefined}
          mapStyle={MAPBOX_TOKEN ? "mapbox://styles/mapbox/satellite-streets-v12" : SATELLITE_RASTER_STYLE}
          style={{ width: "100%", height: "100%" }}
          interactive={!disabled}
          attributionControl={false}
        >
          <NavigationControl position="bottom-right" showCompass={false} />

          {/* Location Marker */}
          {hasSelectedPin && (
            <Marker
              latitude={currentLoc.lat}
              longitude={currentLoc.lng}
              anchor="bottom"
              draggable={!disabled}
              onDragEnd={(e) => {
                const lat = e.lngLat.lat;
                const lng = e.lngLat.lng;
                handleMapClick({ lngLat: { lat, lng } });
              }}
            >
              <div className="relative group cursor-grab active:cursor-grabbing">
                <div className="absolute -inset-1.5 bg-primary/40 rounded-full animate-ping" />
                <div className="text-primary drop-shadow-[0_0_10px_rgba(99,102,241,0.8)]">
                  <MapPin className="h-7 w-7 fill-indigo-600 stroke-white stroke-2" />
                </div>
              </div>
            </Marker>
          )}
        </Map>

        {/* Basemap failure notice — the pin and coordinates below remain valid */}
        {mapError && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-1 bg-background/85 px-6 text-center backdrop-blur-sm">
            <Layers className="h-4 w-4 text-amber-400" />
            <span className="text-[11px] font-medium text-foreground">Basemap unavailable</span>
            <span className="text-[10px] leading-snug text-muted-foreground">{mapError}</span>
            <span className="text-[10px] text-muted-foreground/80">
              Search and coordinates still work.
            </span>
          </div>
        )}

        {/* Map Overlay Badge */}
        <div className="absolute top-2 left-2 z-10 flex items-center gap-1.5 pointer-events-none">
          <Badge variant="secondary" className="text-[10px] bg-background/80 backdrop-blur-md border border-border shadow font-mono">
            <Compass className="h-3 w-3 mr-1 text-primary" />
            {currentLoc.lat.toFixed(4)}, {currentLoc.lng.toFixed(4)}
          </Badge>
        </div>

        {/* Click to drop hint */}
        {!disabled && (
          <div className="absolute bottom-2 left-2 z-10 pointer-events-none">
            <span className="text-[9px] text-muted-foreground/80 bg-background/70 px-2 py-0.5 rounded backdrop-blur-sm border border-border/40">
              Click or drag pin to adjust coordinates
            </span>
          </div>
        )}
      </div>

      {/* Manual Coordinates Toggle */}
      <div className="flex items-center justify-between pt-1 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-1.5 truncate max-w-[70%]">
          {hasSelectedPin && (
            <>
              <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
              <span className="truncate text-foreground font-medium">{currentLoc.address || "Location pinned"}</span>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => setShowManualCoords(!showManualCoords)}
          className="flex items-center gap-1 text-[10px] hover:text-foreground text-primary/80 transition-colors"
        >
          <span>{showManualCoords ? "Hide Coordinates" : "Edit Coordinates"}</span>
          {showManualCoords ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
      </div>

      {/* Manual Lat/Lng Inputs */}
      {showManualCoords && (
        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/40">
          <div>
            <label className="text-[10px] text-muted-foreground uppercase font-mono">Latitude</label>
            <Input
              type="number"
              step="any"
              value={currentLoc.lat}
              onChange={(e) => {
                const newLat = parseFloat(e.target.value) || 0;
                const newLoc = { ...currentLoc, lat: newLat };
                emitChange(newLoc);
                setViewState((v) => ({ ...v, latitude: newLat }));
              }}
              disabled={disabled}
              className="text-xs h-7 mt-0.5 font-mono"
            />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase font-mono">Longitude</label>
            <Input
              type="number"
              step="any"
              value={currentLoc.lng}
              onChange={(e) => {
                const newLng = parseFloat(e.target.value) || 0;
                const newLoc = { ...currentLoc, lng: newLng };
                emitChange(newLoc);
                setViewState((v) => ({ ...v, longitude: newLng }));
              }}
              disabled={disabled}
              className="text-xs h-7 mt-0.5 font-mono"
            />
          </div>
        </div>
      )}
    </div>
  );
}
export default LocationPicker;
