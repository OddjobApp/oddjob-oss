import React from 'react';
import { MapSurface, type MapMarker, type MapRoute } from '../shared/MapSurface.js';
import { cn } from '@/lib/utils';

export interface MapPodProps {
  title?: string;
  description?: string;
  markers?: MapMarker[];
  route?: MapRoute | null;
  center?: { lat: number; lng: number };
  zoom?: number;
  mapStyle?: 'dark' | 'satellite' | 'streets';
  className?: string;
}

export default function MapPod({
  title = 'Interactive Map',
  description,
  markers = [],
  route,
  center,
  zoom,
  mapStyle = 'dark',
  className,
}: MapPodProps) {
  return (
    <div className={cn("w-full min-h-[380px] rounded-xl overflow-hidden", className)}>
      <MapSurface
        title={title}
        description={description}
        markers={markers}
        route={route}
        center={center}
        zoom={zoom}
        mapStyle={mapStyle}
      />
    </div>
  );
}

export { MapPod };
