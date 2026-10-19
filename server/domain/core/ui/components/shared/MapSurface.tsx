import React, { useState, useMemo, useEffect, useCallback } from "react";
import Map, { Layer, Marker, NavigationControl, Source, ViewStateChangeEvent } from "react-map-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import {
  MapPin,
  Compass,
  Layers,
  Globe,
  Maximize2,
  X,
  ExternalLink,
  Crosshair,
  Loader2,
} from "lucide-react";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  MAP_LIB,
  MAPBOX_TOKEN,
  CARTO_DARK_STYLE,
  SATELLITE_RASTER_STYLE,
  describeMapError,
} from "./LocationPicker";

export interface MapMarker {
  lat: number;
  lng: number;
  label?: string;
  description?: string;
  color?: string;
}

export interface MapRoute {
  /** Ordered [lng, lat] pairs of the path to draw. */
  points?: Array<[number, number]>;
  /** Ordered stops the route passes through; rendered as numbered pins. */
  waypoints?: MapMarker[];
  /** True when `points` came from a routing provider; false draws a dashed straight line. */
  snapped?: boolean;
  distanceKm?: number;
  durationMin?: number;
  color?: string;
}

export interface MapSurfaceProps {
  title?: string;
  description?: string;
  markers?: MapMarker[];
  route?: MapRoute | null;
  center?: { lat: number; lng: number };
  zoom?: number;
  mapStyle?: "dark" | "satellite" | "streets";
  className?: string;
}

export function MapSurface({
  title = "Geographic Map",
  description,
  markers = [],
  route,
  center,
  zoom,
  mapStyle = "dark",
  className,
}: MapSurfaceProps) {
  const validMarkers = useMemo(() => {
    return (Array.isArray(markers) ? markers : []).filter(
      (m) =>
        m &&
        typeof m.lat === "number" &&
        typeof m.lng === "number" &&
        !isNaN(m.lat) &&
        !isNaN(m.lng)
    );
  }, [markers]);

  const routePoints = useMemo(() => {
    if (Array.isArray(route?.points) && route.points.length >= 2) {
      return route.points.filter(
        (p) => Array.isArray(p) && typeof p[0] === "number" && typeof p[1] === "number"
      ) as Array<[number, number]>;
    }
    if (Array.isArray(route?.waypoints) && route.waypoints.length >= 2) {
      return route.waypoints
        .filter((w) => w && typeof w.lat === "number" && typeof w.lng === "number" && !isNaN(w.lat) && !isNaN(w.lng))
        .map((w) => [w.lng, w.lat] as [number, number]);
    }
    return [];
  }, [route]);

  const routeWaypoints = useMemo(() => {
    const wps = Array.isArray(route?.waypoints) ? route!.waypoints! : [];
    return wps.filter(
      (w) => w && typeof w.lat === "number" && typeof w.lng === "number" && !isNaN(w.lat) && !isNaN(w.lng)
    );
  }, [route]);

  const routeColor = route?.color || "#a855f7";

  const routeGeoJson = useMemo(
    () =>
      routePoints.length >= 2
        ? ({
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates: routePoints },
          } as const)
        : null,
    [routePoints]
  );

  const routeSpan = useMemo(() => {
    if (routePoints.length < 2) return 0;
    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const [lng, lat] of routePoints) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
    return Math.max(maxLng - minLng, maxLat - minLat);
  }, [routePoints]);

  const [userLocation, setUserLocation] = useState<MapMarker | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [locationPermission, setLocationPermission] = useState<
    "idle" | "granted" | "denied" | "unavailable"
  >("idle");

  const initialCenter = useMemo(() => {
    if (center && typeof center.lat === "number" && typeof center.lng === "number") {
      return center;
    }
    if (validMarkers.length > 0) {
      const avgLat =
        validMarkers.reduce((acc, m) => acc + m.lat, 0) / validMarkers.length;
      const avgLng =
        validMarkers.reduce((acc, m) => acc + m.lng, 0) / validMarkers.length;
      return { lat: avgLat, lng: avgLng };
    }
    if (routePoints.length > 0) {
      const avgLat = routePoints.reduce((acc, p) => acc + p[1], 0) / routePoints.length;
      const avgLng = routePoints.reduce((acc, p) => acc + p[0], 0) / routePoints.length;
      return { lat: avgLat, lng: avgLng };
    }
    if (userLocation) {
      return { lat: userLocation.lat, lng: userLocation.lng };
    }
    return { lat: 34.0522, lng: -118.2437 };
  }, [center, validMarkers, routePoints, userLocation]);

  const initialZoom = useMemo(() => {
    if (typeof zoom === "number") return zoom;
    if (routeSpan > 0) {
      return routeSpan > 20 ? 4 : routeSpan > 10 ? 5 : routeSpan > 5 ? 6 : routeSpan > 2 ? 7
        : routeSpan > 1 ? 8 : routeSpan > 0.5 ? 9 : routeSpan > 0.25 ? 10 : routeSpan > 0.1 ? 11 : 12;
    }
    return validMarkers.length > 1 ? 11 : 13;
  }, [zoom, validMarkers.length, routeSpan]);

  const [viewState, setViewState] = useState({
    latitude: initialCenter.lat,
    longitude: initialCenter.lng,
    zoom: initialZoom,
  });

  const [activeStyle, setActiveStyle] = useState<"dark" | "satellite">(
    mapStyle === "satellite" ? "satellite" : "dark"
  );
  const [selectedMarker, setSelectedMarker] = useState<MapMarker | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);

  const requestUserLocation = useCallback(() => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setLocationPermission("unavailable");
      return;
    }

    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setLocationPermission("granted");

        let resolvedAddr = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
        try {
          const res = await fetch(`/api/geo/reverse-geocode?lat=${lat}&lng=${lng}`);
          if (res.ok) {
            const data = await res.json();
            if (data?.address) resolvedAddr = data.address;
          }
        } catch {
          // ignore reverse-geocode fallback failure
        }

        const userLoc: MapMarker = {
          lat,
          lng,
          label: "Your Current Location",
          description: resolvedAddr,
          color: "#06b6d4", // cyan
        };
        setUserLocation(userLoc);
        setIsLocating(false);

        // Center on user location
        setViewState({
          latitude: lat,
          longitude: lng,
          zoom: 14,
        });
      },
      (err) => {
        setIsLocating(false);
        if (err.code === 1) {
          // GeolocationPositionError.PERMISSION_DENIED
          setLocationPermission("denied");
        } else {
          setLocationPermission("unavailable");
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  }, []);

  // When no locations are present on the displayed map, automatically request location permission
  useEffect(() => {
    if (validMarkers.length === 0 && routePoints.length === 0 && routeWaypoints.length === 0 && !userLocation && locationPermission === "idle") {
      requestUserLocation();
    }
  }, [validMarkers.length, routePoints.length, routeWaypoints.length, userLocation, locationPermission, requestUserLocation]);

  const handleSelectMarker = (m: MapMarker) => {
    setSelectedMarker(m);
    setViewState((v) => ({
      ...v,
      latitude: m.lat,
      longitude: m.lng,
      zoom: Math.max(v.zoom, 14),
    }));
  };

  const handleFitAll = () => {
    setSelectedMarker(null);
    setViewState({
      latitude: initialCenter.lat,
      longitude: initialCenter.lng,
      zoom: initialZoom,
    });
  };

  const allDisplayMarkers = useMemo(() => {
    if (!userLocation) return validMarkers;
    const exists = validMarkers.some(
      (m) =>
        Math.abs(m.lat - userLocation.lat) < 0.0001 &&
        Math.abs(m.lng - userLocation.lng) < 0.0001
    );
    return exists ? validMarkers : [...validMarkers, userLocation];
  }, [validMarkers, userLocation]);

  return (
    <div
      className={cn(
        "space-y-3 rounded-xl border border-border/80 bg-card/70 p-4 shadow-md backdrop-blur-md",
        className
      )}
      data-testid="assistant-map-surface"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <div className="grid h-7 w-7 place-items-center rounded-lg bg-primary/15 text-primary shrink-0">
            <Compass className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-xs font-bold text-foreground">{title}</h3>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                {validMarkers.length > 0
                  ? `${validMarkers.length} ${validMarkers.length === 1 ? "pin" : "pins"}`
                  : routeWaypoints.length > 0
                    ? `${routeWaypoints.length} ${routeWaypoints.length === 1 ? "stop" : "stops"}`
                    : userLocation
                      ? "Current Location"
                      : "No Locations"}
              </Badge>
              {routeGeoJson && (
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0 h-4 border-purple-500/40 text-purple-600 dark:text-purple-400"
                  data-testid="map-route-badge"
                >
                  {typeof route?.distanceKm === "number" && typeof route?.durationMin === "number"
                    ? `${route.distanceKm} km · ${route.durationMin} min`
                    : route?.snapped
                      ? "Route"
                      : "Direct line"}
                </Badge>
              )}
              {userLocation && (
                <span className="inline-flex items-center gap-1 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.2 text-[9px] font-medium text-cyan-600 dark:text-cyan-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
                  GPS Active
                </span>
              )}
            </div>
            {description ? (
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground max-w-md">
                {description}
              </p>
            ) : validMarkers.length === 0 && userLocation ? (
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground max-w-md">
                No location pins provided. Centered on your current GPS location.
              </p>
            ) : null}
          </div>
        </div>

        {/* Map Controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={requestUserLocation}
            disabled={isLocating}
            className={cn(
              "h-7 px-2 text-[10px] gap-1 border border-border/40 bg-card/40 transition-colors",
              userLocation ? "text-cyan-600 dark:text-cyan-400 border-cyan-500/30" : "text-muted-foreground hover:text-foreground"
            )}
            title="Locate My Position"
            data-testid="map-locate-me-btn"
          >
            {isLocating ? (
              <Loader2 className="h-3 w-3 animate-spin text-cyan-500" />
            ) : (
              <Crosshair className="h-3 w-3 text-cyan-500" />
            )}
            <span className="hidden sm:inline">
              {isLocating ? "Locating…" : userLocation ? "My Location" : "Locate Me"}
            </span>
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setActiveStyle((s) => (s === "dark" ? "satellite" : "dark"))}
            className="h-7 px-2 text-[10px] text-muted-foreground hover:text-foreground gap-1 border border-border/40 bg-card/40"
            title="Toggle Map Style"
            data-testid="map-style-toggle"
          >
            {activeStyle === "dark" ? (
              <>
                <Layers className="h-3 w-3 text-primary" />
                <span>Dark</span>
              </>
            ) : (
              <>
                <Globe className="h-3 w-3 text-emerald-400" />
                <span>Satellite</span>
              </>
            )}
          </Button>

          {validMarkers.length > 1 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleFitAll}
              className="h-7 px-2 text-[10px] text-muted-foreground hover:text-foreground gap-1 border border-border/40 bg-card/40"
              title="Reset View"
              data-testid="map-reset-view"
            >
              <Maximize2 className="h-3 w-3" />
              <span>Center</span>
            </Button>
          )}
        </div>
      </div>

      {/* Mapbox Map Container */}
      <div className="relative h-64 w-full overflow-hidden rounded-lg border border-border/70 bg-black/40 shadow-inner">
        <Map
          {...viewState}
          mapLib={MAP_LIB}
          onMove={(evt: ViewStateChangeEvent) => setViewState(evt.viewState)}
          onError={(evt: any) =>
            setMapError((prev) => prev ?? describeMapError(evt?.error ?? evt))
          }
          mapboxAccessToken={MAPBOX_TOKEN || undefined}
          mapStyle={
            activeStyle === "satellite"
              ? MAPBOX_TOKEN
                ? "mapbox://styles/mapbox/satellite-streets-v12"
                : SATELLITE_RASTER_STYLE
              : MAPBOX_TOKEN
                ? "mapbox://styles/mapbox/dark-v11"
                : CARTO_DARK_STYLE
          }
          style={{ width: "100%", height: "100%" }}
          attributionControl={false}
        >
          <NavigationControl position="bottom-right" showCompass={false} />

          {/* Route polyline — solid when road-snapped, dashed for straight-line fallback */}
          {routeGeoJson && (
            <Source id="route-source" type="geojson" data={routeGeoJson}>
              <Layer
                id="route-line"
                type="line"
                layout={{ "line-join": "round", "line-cap": "round" }}
                paint={{
                  "line-color": routeColor,
                  "line-width": 4,
                  "line-opacity": 0.85,
                  ...(route?.snapped === false ? { "line-dasharray": [1.5, 1.5] } : {}),
                }}
              />
            </Source>
          )}

          {/* Numbered waypoint stop pins */}
          {routeWaypoints.map((wp, idx) => (
            <Marker
              key={`route-stop-${wp.lat}-${wp.lng}-${idx}`}
              latitude={wp.lat}
              longitude={wp.lng}
              anchor="center"
              onClick={(e) => {
                e.originalEvent.stopPropagation();
                handleSelectMarker(wp);
              }}
            >
              <div
                className="group relative cursor-pointer"
                data-testid="map-waypoint-pin"
                title={wp.label || (idx === 0 ? "Origin" : idx === routeWaypoints.length - 1 ? "Destination" : `Stop ${idx + 1}`)}
              >
                <div className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 hidden whitespace-nowrap rounded bg-popover/95 px-2 py-0.5 text-[10px] font-medium text-foreground shadow-lg border border-border/60 group-hover:block z-30">
                  {wp.label || (idx === 0 ? "Origin" : idx === routeWaypoints.length - 1 ? "Destination" : `Stop ${idx + 1}`)}
                </div>
                <div
                  className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-background text-[10px] font-bold text-primary-foreground shadow-lg"
                  style={{ backgroundColor: idx === 0 ? "#10b981" : idx === routeWaypoints.length - 1 ? "#ef4444" : routeColor }}
                >
                  {idx + 1}
                </div>
              </div>
            </Marker>
          ))}

          {/* User Location Pulsing Pin */}
          {userLocation && (
            <Marker
              latitude={userLocation.lat}
              longitude={userLocation.lng}
              anchor="center"
              onClick={(e) => {
                e.originalEvent.stopPropagation();
                handleSelectMarker(userLocation);
              }}
            >
              <div
                className="group relative cursor-pointer"
                data-testid="map-user-location-pin"
                title="Your Current Location"
              >
                <div className="relative flex items-center justify-center">
                  <span className="absolute -inset-2 rounded-full bg-cyan-500/30 animate-ping" />
                  <div className="relative flex h-6 w-6 items-center justify-center rounded-full bg-cyan-500 text-primary-foreground shadow-lg border-2 border-background">
                    <Crosshair className="h-3.5 w-3.5" />
                  </div>
                </div>
              </div>
            </Marker>
          )}

          {/* Regular Marker Pins */}
          {validMarkers.map((marker, idx) => {
            const isSelected =
              selectedMarker?.lat === marker.lat && selectedMarker?.lng === marker.lng;
            return (
              <Marker
                key={`${marker.lat}-${marker.lng}-${idx}`}
                latitude={marker.lat}
                longitude={marker.lng}
                anchor="bottom"
                onClick={(e) => {
                  e.originalEvent.stopPropagation();
                  handleSelectMarker(marker);
                }}
              >
                <div
                  className="group relative cursor-pointer"
                  data-testid="map-marker-pin"
                  title={marker.label || `Marker ${idx + 1}`}
                >
                  <div className="relative flex flex-col items-center">
                    {/* Tooltip on hover */}
                    <div className="pointer-events-none absolute -top-7 mb-1 hidden whitespace-nowrap rounded bg-popover/95 px-2 py-0.5 text-[10px] font-medium text-foreground shadow-lg border border-border/60 group-hover:block z-30">
                      {marker.label || `Pin ${idx + 1}`}
                    </div>
                    {/* Pin icon with glow */}
                    <div
                      className={cn(
                        "flex items-center justify-center rounded-full p-1.5 text-primary-foreground shadow-md transition-all duration-200 group-hover:scale-125",
                        isSelected
                          ? "ring-2 ring-primary ring-offset-2 ring-offset-background scale-110"
                          : ""
                      )}
                      style={{
                        backgroundColor: marker.color || (idx === 0 ? "#6366f1" : "#3b82f6"),
                      }}
                    >
                      <MapPin className="h-4 w-4" />
                    </div>
                    {/* Base dot */}
                    <div className="h-1.5 w-1.5 rounded-full bg-background shadow-xs mt-0.5" />
                  </div>
                </div>
              </Marker>
            );
          })}
        </Map>

        {/* Selected Marker Detail Overlay */}
        {selectedMarker && (
          <div
            className="absolute top-2 left-2 right-2 max-w-sm rounded-lg border border-border/80 bg-card/95 p-3 shadow-lg backdrop-blur-md z-20 animate-in fade-in slide-in-from-top-2 duration-150"
            data-testid="map-marker-card"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span className="font-semibold text-xs text-foreground truncate">
                    {selectedMarker.label || "Selected Location"}
                  </span>
                </div>
                {selectedMarker.description && (
                  <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
                    {selectedMarker.description}
                  </p>
                )}
                <div className="mt-1.5 flex items-center gap-2 text-[10px] font-mono text-muted-foreground/80">
                  <span>{selectedMarker.lat.toFixed(5)}, {selectedMarker.lng.toFixed(5)}</span>
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${selectedMarker.lat},${selectedMarker.lng}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-0.5 text-primary hover:underline ml-1"
                    title="Open in Google Maps"
                  >
                    <span>External</span>
                    <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedMarker(null)}
                className="rounded p-1 text-muted-foreground hover:text-foreground transition-colors shrink-0"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Geolocation Prompt Overlay when no markers are present and location not yet granted */}
        {validMarkers.length === 0 && routeWaypoints.length === 0 && routePoints.length === 0 && !userLocation && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-4 bg-background/80 backdrop-blur-xs text-center z-10">
            <div className="grid h-10 w-10 place-items-center rounded-full bg-cyan-500/15 text-cyan-500 mb-2">
              <Crosshair className={cn("h-5 w-5", isLocating && "animate-spin")} />
            </div>
            <h4 className="text-xs font-semibold text-foreground">
              {isLocating
                ? "Locating your position…"
                : locationPermission === "denied"
                  ? "Location permission denied"
                  : "No locations on this map"}
            </h4>
            <p className="mt-1 text-[11px] text-muted-foreground max-w-xs leading-relaxed">
              {isLocating
                ? "Requesting GPS coordinate access from your browser to center the map."
                : locationPermission === "denied"
                  ? "Allow location access in your browser settings to display your current position."
                  : "Allow location permission to view and center this map around your current position."}
            </p>
            {locationPermission !== "denied" && !isLocating && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={requestUserLocation}
                className="mt-3 h-8 text-xs gap-1.5 border-cyan-500/40 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/10"
                data-testid="map-prompt-locate-btn"
              >
                <Crosshair className="h-3.5 w-3.5" />
                <span>Show My Location</span>
              </Button>
            )}
          </div>
        )}

        {/* Map error notice */}
        {mapError && (
          <div className="absolute inset-x-2 bottom-2 rounded border border-amber-500/30 bg-amber-950/80 p-2 text-[10px] text-amber-200 z-10 backdrop-blur-sm">
            <span className="font-semibold">Map Basemap Notice:</span> {mapError}
          </div>
        )}
      </div>

      {/* Marker Cards List */}
      {allDisplayMarkers.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1">
            Pin Locations ({allDisplayMarkers.length})
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto pr-1">
            {allDisplayMarkers.map((marker, idx) => {
              const isSelected =
                selectedMarker?.lat === marker.lat && selectedMarker?.lng === marker.lng;
              const isUserLoc = marker === userLocation;
              return (
                <button
                  key={`${marker.lat}-${marker.lng}-${idx}`}
                  type="button"
                  onClick={() => handleSelectMarker(marker)}
                  className={cn(
                    "flex items-start gap-2.5 rounded-lg border p-2 text-left transition-all text-xs",
                    isSelected
                      ? "border-primary/50 bg-primary/10 shadow-xs"
                      : isUserLoc
                        ? "border-cyan-500/40 bg-cyan-500/5 hover:bg-cyan-500/10"
                        : "border-border/60 bg-card/40 hover:bg-muted/40 hover:border-border"
                  )}
                  data-testid={`map-marker-item-${idx}`}
                >
                  <span
                    className={cn(
                      "grid h-6 w-6 shrink-0 place-items-center rounded text-[10px] font-bold text-primary-foreground shadow-xs mt-0.5",
                      isUserLoc && "bg-cyan-500"
                    )}
                    style={{
                      backgroundColor: isUserLoc ? undefined : marker.color || (idx === 0 ? "#6366f1" : "#3b82f6"),
                    }}
                  >
                    {isUserLoc ? <Crosshair className="h-3 w-3" /> : idx + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-foreground truncate">
                        {marker.label || `Location ${idx + 1}`}
                      </span>
                      {isUserLoc && (
                        <span className="rounded bg-cyan-500/15 px-1 text-[9px] font-medium text-cyan-600 dark:text-cyan-400">
                          You
                        </span>
                      )}
                    </div>
                    {marker.description && (
                      <span className="block text-[11px] text-muted-foreground truncate">
                        {marker.description}
                      </span>
                    )}
                    <span className="block font-mono text-[10px] text-muted-foreground/70 mt-0.5">
                      {marker.lat.toFixed(4)}, {marker.lng.toFixed(4)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default MapSurface;
