
import Map, { Marker, NavigationControl, ViewStateChangeEvent, Source, Layer } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useState, useMemo, useEffect } from 'react';
import { MapPin, Navigation } from 'lucide-react';
import { cn } from '@/lib/utils';

// Default to a public test token or empty (user will need to provide one in .env)
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN || '';

interface MapMarker {
    id: string | number;
    lat: number;
    lng: number;
    type: 'user' | 'helper';
    label?: string;
}

interface RescueMapProps {
    center?: { lat: number; lng: number };
    zoom?: number;
    markers?: MapMarker[];
    routePoints?: Array<[number, number]>; // [lng, lat]
    interactive?: boolean;
    onMove?: (lat: number, lng: number) => void;
    className?: string;
}

export function RescueMap({
    center = { lat: 40.7484, lng: -73.9857 },
    zoom = 13,
    markers = [],
    routePoints = [],
    interactive = true,
    onMove,
    className
}: RescueMapProps) {
    const [viewState, setViewState] = useState({
        longitude: center.lng,
        latitude: center.lat,
        zoom: zoom
    });

    // Sync viewport when the center prop changes (e.g., live provider location updates)
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

    const routeData: any = useMemo(() => {
        if (!routePoints || routePoints.length < 2) return null;
        return {
            type: 'Feature',
            properties: {},
            geometry: {
                type: 'LineString',
                coordinates: routePoints
            }
        };
    }, [routePoints]);

    if (!MAPBOX_TOKEN) {
        const userMarker = markers.find(m => m.type === 'user') || { lat: center.lat, lng: center.lng, label: 'Requestor' };
        const helperMarker = markers.find(m => m.type === 'helper');

        return (
            <div className={cn("relative w-full h-full min-h-[180px] overflow-hidden rounded-2xl bg-background border border-foreground/10 p-4 flex flex-col justify-between select-none", className)}>
                {/* Background Tactical Grid */}
                <div className="absolute inset-0 bg-[linear-gradient(to_right,#1f2937_1px,transparent_1px),linear-gradient(to_bottom,#1f2937_1px,transparent_1px)] bg-[size:1.5rem_1.5rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] opacity-30 pointer-events-none" />
                
                {/* Vector Map Container */}
                <div className="relative w-full h-full flex items-center justify-between px-6 py-4">
                    {/* SVG Connector Line */}
                    <svg className="absolute inset-0 w-full h-full pointer-events-none z-0">
                        <line 
                            x1="20%" 
                            y1="50%" 
                            x2={helperMarker ? "80%" : "20%"} 
                            y2="50%" 
                            stroke="#818cf8" 
                            strokeWidth="2.5" 
                            strokeDasharray="6 4" 
                        />
                    </svg>

                    {/* Requestor Pin */}
                    <div className="relative z-10 flex flex-col items-center gap-1.5">
                        <div className="relative flex items-center justify-center">
                            <div className="absolute -inset-2 bg-emerald-500/20 rounded-full animate-ping" />
                            <div className="h-9 w-9 bg-emerald-500 rounded-full border-2 border-white flex items-center justify-center shadow-lg shadow-emerald-500/30">
                                <MapPin className="h-4 w-4 text-zinc-950 fill-zinc-950" />
                            </div>
                        </div>
                        <span className="text-[10px] font-mono font-black text-foreground bg-background/80 px-2 py-0.5 rounded-full border border-foreground/10 shadow">
                            {userMarker.label || 'Requestor Site'}
                        </span>
                    </div>

                    {/* Enroute Provider Pin */}
                    {helperMarker ? (
                        <div className="relative z-10 flex flex-col items-center gap-1.5">
                            <div className="relative flex items-center justify-center">
                                <div className="absolute -inset-2 bg-indigo-500/30 rounded-full animate-ping" />
                                <div className="h-9 w-9 bg-indigo-500 rounded-full border-2 border-white flex items-center justify-center shadow-lg shadow-indigo-500/40">
                                    <Navigation className="h-4 w-4 text-foreground fill-white transform rotate-45" />
                                </div>
                            </div>
                            <span className="text-[10px] font-mono font-black text-indigo-700 dark:text-indigo-300 bg-indigo-950/90 px-2.5 py-0.5 rounded-full border border-indigo-500/40 shadow">
                                🚑 {helperMarker.label || 'Provider En Route'}
                            </span>
                        </div>
                    ) : (
                        <div className="relative z-10 flex flex-col items-center gap-1">
                            <div className="h-8 w-8 rounded-full border border-dashed border-foreground/20 flex items-center justify-center bg-background/40">
                                <div className="h-2 w-2 rounded-full bg-amber-400 animate-ping" />
                            </div>
                            <span className="text-[9px] font-mono text-amber-400/80 uppercase tracking-wider">
                                Dispatching...
                            </span>
                        </div>
                    )}
                </div>

                {/* HUD Footer Status Bar */}
                <div className="relative z-10 flex items-center justify-between pt-2 border-t border-foreground/10 text-[9px] font-mono text-foreground/50">
                    <div className="flex items-center gap-1.5 text-emerald-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        LIVE TELEMETRY ACTIVE
                    </div>
                    <div>
                        {helperMarker ? 'EST. ARRIVAL: ~4 MINS (0.8 MI)' : 'SEARCHING NEAREST UNITS...'}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className={cn("relative w-full h-full overflow-hidden rounded-lg border border-foreground/10", className)}>
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

                {routeData && (
                    <Source id="route-source" type="geojson" data={routeData}>
                        <Layer
                            id="route-layer"
                            type="line"
                            layout={{
                                'line-join': 'round',
                                'line-cap': 'round'
                            }}
                            paint={{
                                'line-color': '#a855f7', // Indigo/Purple
                                'line-width': 4,
                                'line-opacity': 0.6,
                                'line-dasharray': [1, 2]
                            }}
                        />
                    </Source>
                )}

                {markers.map((marker) => (
                    <Marker
                        key={`${marker.type}-${marker.id}`}
                        latitude={marker.lat}
                        longitude={marker.lng}
                        anchor="bottom"
                    >
                        {marker.type === 'user' ? (
                            <div className="relative group">
                                <div className="absolute -inset-2 bg-primary/20 rounded-full animate-ping" />
                                <div className="h-6 w-6 bg-primary rounded-full border-2 border-white flex items-center justify-center shadow-lg transform transition-transform group-hover:scale-110">
                                    <MapPin className="h-3 w-3 text-foreground fill-white" />
                                </div>
                                {marker.label && (
                                    <div className="absolute top-full mt-1 left-1/2 -translate-x-1/2 bg-background/80 backdrop-blur-md px-2 py-0.5 rounded text-[8px] text-foreground font-mono whitespace-nowrap border border-foreground/10 opacity-0 group-hover:opacity-100 transition-opacity">
                                        {marker.label}
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="relative group">
                                <div className="h-6 w-6 bg-indigo-500 rounded-full border-2 border-white flex items-center justify-center shadow-lg transform transition-transform group-hover:scale-110">
                                    <Navigation className="h-3 w-3 text-foreground fill-white" />
                                </div>
                                {marker.label && (
                                    <div className="absolute top-full mt-1 left-1/2 -translate-x-1/2 bg-indigo-600/80 backdrop-blur-md px-2 py-0.5 rounded text-[8px] text-foreground font-mono whitespace-nowrap border border-foreground/10 opacity-0 group-hover:opacity-100 transition-opacity">
                                        {marker.label}
                                    </div>
                                )}
                            </div>
                        )}
                    </Marker>
                ))}
            </Map>

            {/* Overlay for premium feel */}
            <div className="absolute inset-0 pointer-events-none shadow-[inset_0_0_100px_rgba(0,0,0,0.5)]" />
        </div>
    );
}
