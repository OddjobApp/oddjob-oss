import Map, { Marker, NavigationControl, ViewStateChangeEvent } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useState, useEffect } from 'react';
import { MapPin } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || '';

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  label: string;
  category?: string;
  isUserLocation?: boolean;
}

interface LocationMapProps {
  center?: { lat: number; lng: number };
  zoom?: number;
  markers?: MapMarker[];
  interactive?: boolean;
  onMove?: (lat: number, lng: number) => void;
  className?: string;
}

export function LocationMap({
  center = { lat: 34.0522, lng: -118.2437 }, // Default LA
  zoom = 10,
  markers = [],
  interactive = true,
  onMove,
  className
}: LocationMapProps) {
  const [viewState, setViewState] = useState({
    longitude: center.lng,
    latitude: center.lat,
    zoom: zoom
  });

  useEffect(() => {
    setViewState(v => ({ ...v, longitude: center.lng, latitude: center.lat }));
  }, [center.lng, center.lat]);

  const handleMove = (evt: ViewStateChangeEvent) => {
    setViewState(evt.viewState);
    if (onMove) {
      onMove(evt.viewState.latitude, evt.viewState.longitude);
    }
  };

  const mapStyle = "mapbox://styles/mapbox/dark-v11";

  if (!MAPBOX_TOKEN) {
    return (
      <div className={cn("flex flex-col items-center justify-center bg-[#020202] border border-indigo-500/20 rounded-2xl text-center p-6 space-y-2 h-full", className)}>
        <MapPin className="h-8 w-8 text-indigo-500/40" />
        <p className="text-xs text-white/60 font-mono italic">MAPBOX_TOKEN_MISSING</p>
        <p className="text-[10px] text-white/30 max-w-[200px]">Please provide NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN to enable maps.</p>
      </div>
    );
  }

  return (
    <div className={cn("relative w-full h-full overflow-hidden rounded-2xl border border-indigo-500/20", className)}>
      <Map
        {...viewState}
        onMove={handleMove}
        mapboxAccessToken={MAPBOX_TOKEN}
        mapStyle={mapStyle}
        style={{ width: '100%', height: '100%' }}
        interactive={interactive}
        attributionControl={false}
      >
        {interactive && <NavigationControl position="bottom-right" showCompass={false} />}

        {markers.map((marker) => (
          <Marker
            key={marker.id}
            latitude={marker.lat}
            longitude={marker.lng}
            anchor="bottom"
          >
            {marker.isUserLocation ? (
              <div className="relative group">
                <div className="absolute -inset-2 bg-emerald-500/30 rounded-full animate-ping" />
                <div className="h-4 w-4 bg-emerald-500 rounded-full border-2 border-white shadow-lg" />
              </div>
            ) : (
              <div className="relative group cursor-pointer">
                <div className="text-indigo-500 hover:text-indigo-400 drop-shadow-[0_0_8px_rgba(99,102,241,0.5)] transition-colors">
                  <MapPin className="h-8 w-8 fill-indigo-950" />
                </div>
                <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-[#020202]/90 backdrop-blur-md px-3 py-1.5 rounded-xl text-[10px] text-white font-black uppercase tracking-widest border border-indigo-500/20 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none shadow-xl">
                  {marker.label}
                  {marker.category && <div className="text-indigo-400 font-medium text-[8px]">{marker.category}</div>}
                </div>
              </div>
            )}
          </Marker>
        ))}
      </Map>
      <div className="absolute inset-0 pointer-events-none shadow-[inset_0_0_50px_rgba(0,0,0,0.5)]" />
    </div>
  );
}
