
import Map, { Marker, NavigationControl, ViewStateChangeEvent, Source, Layer } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { cellToBoundary, cellToLatLng } from 'h3-js';
import { useState, useMemo, useEffect, useRef } from 'react';
import { MapPin, Navigation, Plus, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MAP_LIB } from '@domain-ui/core/ui/components/shared/LocationPicker';

const MAPBOX_TOKEN =
  (typeof process !== "undefined" && process?.env
    ? process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN || process.env.MAPBOX_ACCESS_TOKEN
    : "") ||
  (typeof import.meta !== "undefined" && (import.meta as any).env
    ? (import.meta as any).env.VITE_MAPBOX_ACCESS_TOKEN || (import.meta as any).env.VITE_MAPBOX_TOKEN || (import.meta as any).env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN
    : "") ||
  "";

export interface MapMarker {
    id: string | number;
    lat: number;
    lng: number;
    type?: 'user' | 'helper' | 'distress' | 'parcel';
    label?: string;
    sublabel?: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
    apn?: string;
    specs?: string;
    estimatedValue?: string;
    badge?: string;
    jurisdiction?: string;
    delinquencyAmount?: string;
    filingDate?: string;
    photoUrl?: string;
    lender?: string;
    auctionDate?: string;
    purchaseDate?: string;
    purchasePrice?: string;
    interestRate?: number;
    loanType?: string;
    originalLoanAmount?: string;
    remainingPrincipal?: string;
    monthlyPayment?: string;
    equitySpread?: string;
    ltv?: number;
    rawEvent?: any;
    severity?: string;
    category?: string;
    confidenceScore?: number;
    h3Index?: string;
    onClick?: () => void;
}

/**
 * One H3 cell in the risk field, as produced by the H3 hexagonal spatial engine
 * (`h3_hexagonal_spatial_evaluate`). `risk` is the 0..1 flux density the engine
 * assigns the cell.
 */
export interface HexCell {
    h3Index: string;
    risk: number;
}

interface RescueMapProps {
    center?: { lat: number; lng: number };
    zoom?: number;
    markers?: MapMarker[];
    routePoints?: Array<[number, number]>; // [lng, lat]
    /**
     * H3 risk field to shade over the map. The spatial engine has always been
     * able to compute this; nothing rendered it, so the output was only ever
     * visible as numbers in a tool response.
     */
    hexCells?: HexCell[];
    interactive?: boolean;
    onMove?: (lat: number, lng: number) => void;
    className?: string;
    mapStyle?: string;
}

const SATELLITE_RASTER_STYLE: any = {
    version: 8,
    sources: {
        'satellite-tiles': {
            type: 'raster',
            tiles: [
                'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            ],
            tileSize: 256,
            attribution: 'Esri, Maxar, Earthstar Geographics',
        },
    },
    layers: [
        {
            id: 'satellite-tiles-layer',
            type: 'raster',
            source: 'satellite-tiles',
            minzoom: 0,
            maxzoom: 22,
        },
    ],
};

const CARTO_DARK_STYLE: any = {
    version: 8,
    sources: {
        'carto-dark': {
            type: 'raster',
            tiles: [
                'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
                'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
                'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
            ],
            tileSize: 256,
        },
    },
    layers: [
        {
            id: 'carto-dark-layer',
            type: 'raster',
            source: 'carto-dark',
            minzoom: 0,
            maxzoom: 22,
        },
    ],
};

export function RescueMap({
    center = { lat: 40.7484, lng: -73.9857 },
    zoom = 13,
    markers = [],
    routePoints = [],
    hexCells = [],
    interactive = true,
    onMove,
    className,
    mapStyle: customMapStyle
}: RescueMapProps) {
    const [viewState, setViewState] = useState({
        longitude: center.lng,
        latitude: center.lat,
        zoom: zoom
    });
    const [hoveredMarkerId, setHoveredMarkerId] = useState<string | number | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const dragRef = useRef<{ startX: number; startY: number; startLng: number; startLat: number } | null>(null);

    // Sync viewport when center or zoom props change, without overriding while user is actively dragging
    useEffect(() => {
        if (isDragging) return;
        setViewState(v => ({ ...v, longitude: center.lng, latitude: center.lat, zoom }));
    }, [center.lng, center.lat, zoom, isDragging]);

    const handleMove = (evt: ViewStateChangeEvent) => {
        setViewState(evt.viewState);
        if (onMove) {
            onMove(evt.viewState.latitude, evt.viewState.longitude);
        }
    };

    const mapStyle = useMemo(() => {
        if (customMapStyle) {
            if (typeof customMapStyle === 'string' && customMapStyle.startsWith('mapbox://') && !MAPBOX_TOKEN) {
                return customMapStyle.includes('satellite') ? SATELLITE_RASTER_STYLE : CARTO_DARK_STYLE;
            }
            return customMapStyle;
        }
        return MAPBOX_TOKEN
            ? "mapbox://styles/mapbox/satellite-streets-v12"
            : CARTO_DARK_STYLE;
    }, [customMapStyle]);

    /**
     * H3 indexes -> GeoJSON polygons.
     *
     * cellToBoundary returns [lat, lng] pairs; GeoJSON wants [lng, lat], and the
     * ring has to be closed by repeating the first vertex. Getting either wrong
     * yields hexes that are silently mirrored across the diagonal or refuse to
     * fill, so both are handled explicitly here rather than at the call site.
     */
    const hexData: any = useMemo(() => {
        if (!hexCells || hexCells.length === 0) return null;

        const features = hexCells
            .map((cell) => {
                try {
                    const boundary = cellToBoundary(cell.h3Index); // [[lat, lng], ...]
                    if (!boundary?.length) return null;
                    const ring = boundary.map(([lat, lng]) => [lng, lat]);
                    ring.push(ring[0]);
                    return {
                        type: 'Feature',
                        properties: {
                            risk: Math.max(0, Math.min(1, Number(cell.risk) || 0)),
                            h3Index: cell.h3Index,
                        },
                        geometry: { type: 'Polygon', coordinates: [ring] },
                    };
                } catch {
                    // A malformed index shouldn't take the whole overlay down.
                    return null;
                }
            })
            .filter(Boolean);

        return features.length ? { type: 'FeatureCollection', features } : null;
    }, [hexCells]);

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

    const containerRef = useRef<HTMLDivElement>(null);
    const [dimensions, setDimensions] = useState<{ width: number; height: number }>({ width: 900, height: 560 });

    useEffect(() => {
        if (!containerRef.current) return;
        const updateSize = () => {
            if (containerRef.current) {
                const rect = containerRef.current.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                    setDimensions({
                        width: Math.round(rect.width),
                        height: Math.round(rect.height),
                    });
                }
            }
        };
        updateSize();
        const observer = new ResizeObserver(updateSize);
        observer.observe(containerRef.current);
        return () => observer.disconnect();
    }, []);

    // High-definition CartoDB raster map engine (No API token required)
    if (true) {
        // Drag handlers
        const handleMouseDown = (e: React.MouseEvent) => {
            if (!interactive || e.button !== 0) return;
            e.preventDefault();
            setIsDragging(true);
            dragRef.current = {
                startX: e.clientX,
                startY: e.clientY,
                startLng: viewState.longitude,
                startLat: viewState.latitude,
            };
        };

        useEffect(() => {
            if (!isDragging) return;

            const handleMouseMove = (e: MouseEvent) => {
                if (!dragRef.current) return;
                const deltaX = e.clientX - dragRef.current.startX;
                const deltaY = e.clientY - dragRef.current.startY;

                const W = 256 * Math.pow(2, viewState.zoom);
                if (W <= 0) return;

                // Longitude calculation (exact Web Mercator EPSG:3857)
                const newLng = Number((dragRef.current.startLng - (deltaX / W) * 360).toFixed(5));

                // Latitude calculation (exact inverse Web Mercator)
                const startLatRad = (Math.max(-85, Math.min(85, dragRef.current.startLat)) * Math.PI) / 180;
                const startTileY = ((1 - Math.log(Math.tan(Math.PI / 4 + startLatRad / 2)) / Math.PI) / 2) * W;
                const curTileY = startTileY - deltaY;
                const yNorm = Math.max(0.0001, Math.min(0.9999, curTileY / W));
                const newLatRad = 2 * Math.atan(Math.exp(Math.PI * (1 - 2 * yNorm))) - Math.PI / 2;
                const newLat = Number(((newLatRad * 180) / Math.PI).toFixed(5));

                setViewState(v => ({ ...v, longitude: newLng, latitude: newLat }));
            };

            const handleMouseUp = () => {
                if (!isDragging) return;
                setIsDragging(false);
                if (dragRef.current) {
                    onMove?.(viewState.latitude, viewState.longitude);
                }
                dragRef.current = null;
            };

            window.addEventListener("mousemove", handleMouseMove);
            window.addEventListener("mouseup", handleMouseUp);
            return () => {
                window.removeEventListener("mousemove", handleMouseMove);
                window.removeEventListener("mouseup", handleMouseUp);
            };
        }, [isDragging, viewState.zoom, viewState.latitude, viewState.longitude, onMove]);

        const handleTouchStart = (e: React.TouchEvent) => {
            if (!interactive || e.touches.length !== 1) return;
            const touch = e.touches[0];
            setIsDragging(true);
            dragRef.current = {
                startX: touch.clientX,
                startY: touch.clientY,
                startLng: viewState.longitude,
                startLat: viewState.latitude,
            };
        };

        const handleTouchMove = (e: React.TouchEvent) => {
            if (!isDragging || !dragRef.current || e.touches.length !== 1) return;
            const touch = e.touches[0];
            const deltaX = touch.clientX - dragRef.current.startX;
            const deltaY = touch.clientY - dragRef.current.startY;

            const W = 256 * Math.pow(2, viewState.zoom);
            if (W <= 0) return;

            const newLng = Number((dragRef.current.startLng - (deltaX / W) * 360).toFixed(5));
            const startLatRad = (Math.max(-85, Math.min(85, dragRef.current.startLat)) * Math.PI) / 180;
            const startTileY = ((1 - Math.log(Math.tan(Math.PI / 4 + startLatRad / 2)) / Math.PI) / 2) * W;
            const curTileY = startTileY - deltaY;
            const yNorm = Math.max(0.0001, Math.min(0.9999, curTileY / W));
            const newLatRad = 2 * Math.atan(Math.exp(Math.PI * (1 - 2 * yNorm))) - Math.PI / 2;
            const newLat = Number(((newLatRad * 180) / Math.PI).toFixed(5));

            setViewState(v => ({ ...v, longitude: newLng, latitude: newLat }));
        };

        const handleTouchEnd = () => {
            if (!isDragging) return;
            setIsDragging(false);
            if (dragRef.current) {
                onMove?.(viewState.latitude, viewState.longitude);
            }
            dragRef.current = null;
        };

        const handleWheel = (e: React.WheelEvent) => {
            if (!interactive) return;
            const zoomDelta = e.deltaY < 0 ? 0.5 : -0.5;
            const newZoom = Number(Math.max(5, Math.min(18, viewState.zoom + zoomDelta)).toFixed(1));
            setViewState(v => ({ ...v, zoom: newZoom }));
        };

        const cx = dimensions.width / 2;
        const cy = dimensions.height / 2;

        const zoomInt = Math.floor(viewState.zoom);
        const worldSize = 256 * Math.pow(2, zoomInt);
        const centerLatRad = (Math.max(-85, Math.min(85, viewState.latitude)) * Math.PI) / 180;
        const exactTileX = ((viewState.longitude + 180) / 360) * Math.pow(2, zoomInt);
        const exactTileY = ((1 - Math.log(Math.tan(Math.PI / 4 + centerLatRad / 2)) / Math.PI) / 2) * Math.pow(2, zoomInt);

        const tileX = Math.floor(exactTileX);
        const tileY = Math.floor(exactTileY);

        const pixelOffsetX = (exactTileX - tileX) * 256;
        const pixelOffsetY = (exactTileY - tileY) * 256;

        const centerTileScreenLeft = cx - pixelOffsetX;
        const centerTileScreenTop = cy - pixelOffsetY;

        const latLngToScreenPx = (lat: number, lng: number) => {
            const ptTilePxX = ((lng + 180) / 360) * worldSize;
            const ptRad = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
            const ptTilePxY = ((1 - Math.log(Math.tan(Math.PI / 4 + ptRad / 2)) / Math.PI) / 2) * worldSize;

            const centerTilePxX = ((viewState.longitude + 180) / 360) * worldSize;
            const centerTilePxY = ((1 - Math.log(Math.tan(Math.PI / 4 + centerLatRad / 2)) / Math.PI) / 2) * worldSize;

            const x = cx + (ptTilePxX - centerTilePxX);
            const y = cy + (ptTilePxY - centerTilePxY);
            return { x, y };
        };

        const colRange = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5];
        const rowRange = [-3, -2, -1, 0, 1, 2, 3];

        return (
            <div
                ref={containerRef}
                onMouseDown={handleMouseDown}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onWheel={handleWheel}
                className={cn(
                    "relative w-full h-full overflow-hidden rounded-2xl bg-background border border-primary/20 select-none touch-none",
                    isDragging ? "cursor-grabbing" : "cursor-grab",
                    className
                )}
            >{/* theme-lint-ignore: fixed-dark map canvas — low-opacity overlays are drawn directly on it and wash out on a light surface */}
                {/* Interactive Map Controls (Zoom In, Zoom Out) */}
                {interactive && (
                    <div className="absolute top-4 right-4 z-30 flex flex-col gap-1.5 bg-background/85 backdrop-blur-md p-1 rounded-xl border border-border shadow-lg">
                        <button
                            type="button"
                            aria-label="Zoom in"
                            onClick={(e) => {
                                e.stopPropagation();
                                setViewState(v => ({ ...v, zoom: Math.min(18, v.zoom + 1) }));
                            }}
                            className="p-1.5 rounded-lg hover:bg-muted text-foreground transition-colors"
                        >
                            <Plus className="w-4 h-4" />
                        </button>
                        <button
                            type="button"
                            aria-label="Zoom out"
                            onClick={(e) => {
                                e.stopPropagation();
                                setViewState(v => ({ ...v, zoom: Math.max(5, v.zoom - 1) }));
                            }}
                            className="p-1.5 rounded-lg hover:bg-muted text-foreground transition-colors"
                        >
                            <Minus className="w-4 h-4" />
                        </button>
                    </div>
                )}
                {/* Seamless Multi-Tile Raster Grid with zero-drift absolute positioning */}
                <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
                    {rowRange.flatMap((dy) =>
                        colRange.map((dx) => {
                            const x = tileX + dx;
                            const y = tileY + dy;
                            const maxTile = Math.pow(2, zoomInt);
                            if (y < 0 || y >= maxTile) return null;
                            const normalizedX = ((x % maxTile) + maxTile) % maxTile;
                            const sub = ['a', 'b', 'c', 'd'][Math.abs(normalizedX + y) % 4];
                            const tileUrl = MAPBOX_TOKEN
                                ? `https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/256/${zoomInt}/${normalizedX}/${y}?access_token=${MAPBOX_TOKEN}`
                                : `https://${sub}.basemaps.cartocdn.com/dark_all/${zoomInt}/${normalizedX}/${y}.png`;

                            return (
                                <img
                                    key={`tile-${normalizedX}-${y}`}
                                    src={tileUrl}
                                    alt="Map Tile"
                                    draggable={false}
                                    style={{
                                        position: 'absolute',
                                        left: `${centerTileScreenLeft + dx * 256}px`,
                                        top: `${centerTileScreenTop + dy * 256}px`,
                                        width: '256px',
                                        height: '256px',
                                    }}
                                    className="object-cover filter brightness-[1.05] contrast-[1.05] pointer-events-none select-none"
                                    onError={(e) => {
                                        const img = e.target as HTMLImageElement;
                                        if (!img.src.includes('cartocdn')) {
                                            img.src = `https://${sub}.basemaps.cartocdn.com/dark_all/${zoomInt}/${normalizedX}/${y}.png`;
                                        } else {
                                            img.src = `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/${zoomInt}/${y}/${normalizedX}`;
                                        }
                                    }}
                                />
                            );
                        })
                    )}
                </div>

                {/* SVG Layer: H3 Hexagons & Grounded Spatial Markers (1:1 with screen pixels) */}
                {((hexCells && hexCells.length > 0) || (markers && markers.length > 0)) && (
                    <div className="absolute inset-0 z-10 pointer-events-none">
                        <svg className="w-full h-full relative z-10 select-none">
                            <defs>
                                <filter id="hexGlow" x="-30%" y="-30%" width="160%" height="160%">
                                    <feGaussianBlur stdDeviation="5" result="blur" />
                                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                                </filter>
                                <filter id="markerGlow" x="-50%" y="-50%" width="200%" height="200%">
                                    <feGaussianBlur stdDeviation="3" result="blur" />
                                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                                </filter>
                            </defs>
                            {hexCells?.map((cell) => {
                                try {
                                    const boundary = cellToBoundary(cell.h3Index); // [[lat, lng], ...]
                                    if (!boundary?.length) return null;
                                    const boundaryPx = boundary.map(([lat, lng]) => latLngToScreenPx(lat, lng));
                                    const polygonPoints = boundaryPx.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
                                    const centerCoords = cellToLatLng(cell.h3Index);
                                    const centerPx = latLngToScreenPx(centerCoords[0], centerCoords[1]);
                                    const risk = Math.max(0, Math.min(1, Number(cell.risk) || 0));
                                    const color = risk > 0.75 ? "#ef4444" : risk > 0.5 ? "#f59e0b" : "#10b981";

                                    return (
                                        <g key={cell.h3Index} className="pointer-events-auto cursor-pointer">
                                            <polygon
                                                points={polygonPoints}
                                                fill={color}
                                                fillOpacity={0.08}
                                                stroke={color}
                                                strokeWidth={1.2}
                                                filter="url(#hexGlow)"
                                            />
                                            <g transform={`translate(${centerPx.x}, ${centerPx.y})`}>
                                                <rect x="-26" y="-7" width="52" height="14" rx="7" fill="#090d16" fillOpacity="0.88" stroke={color} strokeWidth="0.9" />
                                                <text textAnchor="middle" y="3.5" fill="#f8fafc" fontSize="8" fontWeight="800" className="font-mono">
                                                    {cell.h3Index.slice(0, 7)}
                                                </text>
                                            </g>
                                        </g>
                                    );
                                } catch {
                                    return null;
                                }
                            })}
                            {markers?.map((marker) => {
                                const pos = latLngToScreenPx(marker.lat, marker.lng);
                                if (pos.x < -100 || pos.x > dimensions.width + 100 || pos.y < -100 || pos.y > dimensions.height + 100) return null;
                                const isDistress = marker.type === 'distress' || marker.type === 'parcel';
                                const pinColor = isDistress ? "#f59e0b" : marker.type === 'user' ? "#10b981" : "#818cf8";
                                const isHovered = hoveredMarkerId === marker.id;

                                return (
                                    <g
                                        key={`raster-marker-${marker.id}`}
                                        transform={`translate(${pos.x}, ${pos.y})`}
                                        className="pointer-events-auto cursor-pointer"
                                        onClick={() => marker.onClick?.()}
                                        onMouseEnter={() => setHoveredMarkerId(marker.id)}
                                        onMouseLeave={() => setHoveredMarkerId(null)}
                                    >
                                        {/* Outer pulse */}
                                        <circle r="12" fill={pinColor} fillOpacity="0.2" className="animate-ping" />
                                        {/* Main marker pin */}
                                        <circle r="7" fill={pinColor} stroke="#ffffff" strokeWidth="2" filter="url(#markerGlow)" />
                                        <circle r="2.5" fill="#ffffff" />

                                        {/* Minimal Anchor Pill Tag (non-colliding) */}
                                        {marker.label && !isHovered && (
                                            <g transform="translate(0, 10)">
                                                <rect
                                                    x="-42"
                                                    y="0"
                                                    width="84"
                                                    height="13"
                                                    rx="6.5"
                                                    fill="#090d16"
                                                    fillOpacity="0.85"
                                                    stroke={pinColor}
                                                    strokeWidth="0.8"
                                                />
                                                <text
                                                    textAnchor="middle"
                                                    y="9"
                                                    fill="#ffffff"
                                                    fontSize="7"
                                                    fontWeight="bold"
                                                    className="font-sans"
                                                >
                                                    {marker.label.length > 15 ? `${marker.label.slice(0, 14)}…` : marker.label}
                                                </text>
                                            </g>
                                        )}

                                        {/* Rich Interactive Dossier Card (expands cleanly on hover or click) */}
                                        {marker.label && isHovered && (
                                            <g transform="translate(0, -18)" className="z-50">
                                                <rect
                                                    x="-90"
                                                    y="-38"
                                                    width="180"
                                                    height={marker.sublabel ? "46" : "28"}
                                                    rx="7"
                                                    fill="#090d16"
                                                    fillOpacity="0.98"
                                                    stroke={pinColor}
                                                    strokeWidth="1.5"
                                                />
                                                <text
                                                    textAnchor="middle"
                                                    y="-22"
                                                    fill="#ffffff"
                                                    fontSize="9"
                                                    fontWeight="bold"
                                                    className="font-sans"
                                                >
                                                    {marker.label.length > 28 ? `${marker.label.slice(0, 26)}…` : marker.label}
                                                </text>
                                                {(marker.address || marker.sublabel) && (
                                                    <text
                                                        textAnchor="middle"
                                                        y="-8"
                                                        fill="#94a3b8"
                                                        fontSize="7.5"
                                                        className="font-mono"
                                                    >
                                                        {((marker.address || marker.sublabel)!).length > 38 ? `${(marker.address || marker.sublabel)!.slice(0, 36)}…` : (marker.address || marker.sublabel)}
                                                    </text>
                                                )}
                                                {marker.badge && (
                                                    <g transform="translate(0, 4)">
                                                        <rect x="-56" y="-12" width="112" height="12" rx="3" fill="#f59e0b" fillOpacity="0.25" stroke="#f59e0b" strokeWidth="0.8" />
                                                        <text textAnchor="middle" y="-3" fill="#fbbf24" fontSize="7" fontWeight="900" className="font-mono">
                                                            {marker.badge}
                                                        </text>
                                                    </g>
                                                )}
                                            </g>
                                        )}
                                    </g>
                                );
                            })}
                        </svg>
                    </div>
                )}

                {/* Map Control Tools Bar */}
                <div className="absolute bottom-4 right-4 z-20 flex items-center gap-2 rounded-lg bg-background/90 px-3 py-1.5 backdrop-blur-md border border-border/50 text-xs font-mono shadow-lg">
                    <span className="text-emerald-400 font-bold">CARTO Dark Tiles (Active)</span>
                    <span className="text-muted-foreground">• Z{viewState.zoom}</span>
                </div>
            </div>
        );
    }

    return (
        <div className={cn("relative w-full h-full overflow-hidden rounded-lg border border-foreground/10", className)}>
            <Map
                {...viewState}
                mapLib={MAP_LIB}
                onMove={handleMove}
                mapboxAccessToken={MAPBOX_TOKEN || undefined}
                mapStyle={mapStyle}
                style={{ width: '100%', height: '100%' }}
                interactive={interactive}
                attributionControl={false}
            >
                {interactive && <NavigationControl position="bottom-right" showCompass={false} />}

                {/*
                  H3 risk field. Rendered before the route so the dispatch line and
                  markers stay legible on top of it. Colour is interpolated from the
                  per-cell `risk` property, so the shading is the engine's actual
                  output rather than a fixed palette applied by category.
                */}
                {hexData && (
                    <Source id="h3-risk-source" type="geojson" data={hexData}>
                        <Layer
                            id="h3-risk-fill"
                            type="fill"
                            paint={{
                                'fill-color': [
                                    'interpolate', ['linear'], ['get', 'risk'],
                                    0,    '#10b981', // emerald — clear
                                    0.5,  '#f59e0b', // amber — elevated
                                    1,    '#ef4444', // red — critical
                                ],
                                // Keep low-risk cells faint so the field reads as a
                                // gradient instead of a wall of colour over the map.
                                'fill-opacity': [
                                    'interpolate', ['linear'], ['get', 'risk'],
                                    0, 0.02,
                                    1, 0.08,
                                ],
                            }}
                        />
                        <Layer
                            id="h3-risk-outline"
                            type="line"
                            paint={{
                                'line-color': '#64748b',
                                'line-width': 0.5,
                                'line-opacity': 0.35,
                            }}
                        />
                    </Source>
                )}

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
                        {marker.type === 'distress' || marker.type === 'parcel' ? (
                            <div className="relative group cursor-pointer" onClick={() => marker.onClick?.()}>
                                <div className="absolute -inset-2 bg-amber-500/20 rounded-full animate-ping" />
                                <div className="h-6 w-6 bg-amber-500 rounded-full border-2 border-white flex items-center justify-center shadow-lg transform transition-transform group-hover:scale-110">
                                    <MapPin className="h-3 w-3 text-amber-950 fill-white" />
                                </div>
                                {marker.label && (
                                    <div className="absolute top-full mt-1 left-1/2 -translate-x-1/2 bg-background/90 backdrop-blur-md px-2 py-1 rounded text-[9px] text-foreground font-sans whitespace-nowrap border border-amber-500/40 shadow-xl opacity-90 group-hover:opacity-100 transition-opacity z-30">
                                        <div className="font-bold">{marker.label}</div>
                                        {marker.sublabel && <div className="text-[7.5px] text-muted-foreground font-mono">{marker.sublabel}</div>}
                                        {marker.badge && (
                                            <div className="mt-0.5 inline-block px-1 py-0.2 bg-amber-500/20 text-amber-400 font-mono text-[7px] font-bold rounded border border-amber-500/40">
                                                {marker.badge}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        ) : marker.type === 'user' ? (
                            <div className="relative group cursor-pointer" onClick={() => marker.onClick?.()}>
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
                            <div className="relative group cursor-pointer" onClick={() => marker.onClick?.()}>
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
