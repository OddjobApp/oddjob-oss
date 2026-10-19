import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/router";
import { motion, AnimatePresence } from "framer-motion";
import { MapPin, Search, Navigation, AlertTriangle, Compass, Crosshair } from "lucide-react";
import { LocationMap, type MapMarker } from "../components/LocationMap";

interface LocationData {
  id: string;
  name: string;
  category?: string;
  status?: string;
  lat: number;
  lng: number;
  distance?: number;
}

// Fallback mock data if the dataset is empty or not found
const MOCK_LOCATIONS: LocationData[] = [
  { id: "LOC-001", name: "Sector 7 Hub", category: "Base", status: "Active", lat: 34.0522, lng: -118.2437 },
  { id: "LOC-002", name: "Echo Point", category: "Outpost", status: "Offline", lat: 34.0689, lng: -118.2451 },
  { id: "LOC-003", name: "Bravo Station", category: "Base", status: "Active", lat: 33.9522, lng: -118.1437 },
  { id: "LOC-004", name: "Delta Node", category: "Relay", status: "Maintenance", lat: 34.1522, lng: -118.3437 },
];

function getDistanceInMiles(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 3958.8; // Radius of the earth in miles
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export default function LocationSearch() {
  const router = useRouter();
  const cycleId = (router.query.cycleId as string) || "global";
  const locationsCollection = "locations_dataset" + (cycleId !== "global" ? "_" + cycleId : "");

  const [locations, setLocations] = useState<LocationData[]>(MOCK_LOCATIONS);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  
  // Geolocation state
  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLng, setUserLng] = useState<number | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [isLocating, setIsLocating] = useState(false);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const res = await fetch(`/api/oddjob/datasets?collection=${locationsCollection}`);
        if (res.ok) {
          const data = await res.json();
          if (data && data.length > 0) {
            setLocations(data);
          }
        }
      } catch (err) {
        console.error("Failed to fetch locations, using mock data", err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [locationsCollection]);

  // Prompt for location automatically or on button click
  const requestLocation = () => {
    setIsLocating(true);
    setGeoError(null);
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLat(position.coords.latitude);
          setUserLng(position.coords.longitude);
          setIsLocating(false);
        },
        (error) => {
          console.error("Error getting location:", error);
          setGeoError(error.message || "Failed to get location");
          setIsLocating(false);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    } else {
      setGeoError("Geolocation is not supported by your browser");
      setIsLocating(false);
    }
  };

  // Process and sort locations
  const processedLocations = useMemo(() => {
    let filtered = locations.filter(loc => 
      loc.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (loc.category && loc.category.toLowerCase().includes(searchQuery.toLowerCase()))
    );

    // If we have user location, calculate distance and sort (closest first)
    if (userLat !== null && userLng !== null) {
      return filtered.map(loc => {
        const dist = getDistanceInMiles(userLat, userLng, loc.lat, loc.lng);
        return { ...loc, distance: dist };
      }).sort((a, b) => (a.distance || 0) - (b.distance || 0));
    }

    // Otherwise sort alphabetically
    return filtered.sort((a, b) => a.name.localeCompare(b.name));
  }, [locations, searchQuery, userLat, userLng]);

  // Convert processed locations to MapMarkers
  const mapMarkers = useMemo<MapMarker[]>(() => {
    const markers: MapMarker[] = processedLocations.map(loc => ({
      id: loc.id,
      lat: loc.lat,
      lng: loc.lng,
      label: loc.name,
      category: loc.category
    }));
    
    if (userLat !== null && userLng !== null) {
      markers.push({
        id: 'user-location',
        lat: userLat,
        lng: userLng,
        label: 'You are here',
        isUserLocation: true
      });
    }
    return markers;
  }, [processedLocations, userLat, userLng]);

  // Determine map center
  const mapCenter = useMemo(() => {
    if (userLat !== null && userLng !== null) return { lat: userLat, lng: userLng };
    if (processedLocations.length > 0) return { lat: processedLocations[0].lat, lng: processedLocations[0].lng };
    return { lat: 34.0522, lng: -118.2437 }; // Default LA
  }, [userLat, userLng, processedLocations]);

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-emerald-50 p-6 font-sans">
      <header className="mb-12 flex flex-col md:flex-row md:items-center justify-between gap-6 border-b border-indigo-900/30 pb-8 relative">
        <div className="absolute -bottom-px left-0 w-32 h-px bg-indigo-500 shadow-[0_0_10px_#6366f1]" />
        
        <div className="flex items-center gap-6">
          <div className="bg-indigo-500/10 p-4 rounded-xl border border-indigo-500/20 relative group overflow-hidden">
            <Compass className="w-8 h-8 text-indigo-400 group-hover:rotate-180 transition-transform duration-1000" />
            <div className="absolute inset-0 bg-indigo-500/5 animate-pulse rounded-xl" />
          </div>
          <div>
            <h1 className="text-3xl font-black uppercase tracking-tighter text-white">Location Index</h1>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-indigo-500 text-[10px] font-black uppercase tracking-[0.2em] flex items-center gap-2">
                 <div className="w-2 h-2 rounded-full bg-indigo-500 animate-ping" /> Global Sync
              </span>
              <div className="w-px h-3 bg-indigo-900" />
              <span className="text-indigo-500/40 text-[10px] uppercase font-bold tracking-widest">Dataset: {cycleId}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button 
            onClick={requestLocation}
            disabled={isLocating}
            className={`flex items-center gap-2 px-6 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
              userLat ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' : 
              geoError ? 'bg-rose-500/10 text-rose-400 border border-rose-500/30' :
              'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20'
            }`}
          >
            {isLocating ? <Navigation className="w-4 h-4 animate-spin" /> : <Crosshair className="w-4 h-4" />}
            {userLat ? "Location Active" : "Find Nearby"}
          </button>
        </div>
      </header>

      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Search Bar */}
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-6 flex items-center pointer-events-none">
            <Search className="w-5 h-5 text-indigo-500/50" />
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="SEARCH LOCATIONS OR CATEGORIES..."
            className="w-full bg-[#020202] border border-indigo-500/20 rounded-2xl py-6 pl-16 pr-6 text-white placeholder:text-indigo-500/30 text-sm font-black tracking-widest focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all"
          />
        </div>

        {geoError && (
          <div className="bg-rose-500/10 border border-rose-500/20 p-4 rounded-xl flex items-center gap-3 text-rose-400 text-xs font-bold uppercase tracking-widest">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {geoError}
          </div>
        )}

        {/* Map View */}
        <div className="h-[400px] w-full">
          <LocationMap 
            center={mapCenter} 
            markers={mapMarkers}
            zoom={userLat !== null ? 12 : 9}
          />
        </div>

        {/* Results Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <AnimatePresence>
            {processedLocations.map((loc, i) => (
              <motion.div
                key={loc.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.3, delay: i * 0.05 }}
                className="bg-[#020202] border border-indigo-500/10 hover:border-indigo-500/30 p-6 rounded-3xl relative overflow-hidden group"
              >
                <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:opacity-10 transition-opacity">
                  <MapPin className="w-24 h-24 text-indigo-500" />
                </div>
                
                <div className="relative z-10">
                  <div className="flex justify-between items-start mb-6">
                    <span className="text-[10px] font-black uppercase tracking-widest text-indigo-500/40">
                      {loc.id}
                    </span>
                    {loc.status && (
                      <span className={`px-2 py-1 rounded text-[9px] font-black uppercase tracking-tighter ${
                        loc.status === 'Active' ? 'bg-emerald-500/10 text-emerald-400' :
                        loc.status === 'Offline' ? 'bg-rose-500/10 text-rose-400' :
                        'bg-amber-500/10 text-amber-400'
                      }`}>
                        {loc.status}
                      </span>
                    )}
                  </div>
                  
                  <h3 className="text-xl font-black text-white mb-1">{loc.name}</h3>
                  {loc.category && (
                    <div className="text-indigo-400/60 text-[10px] font-bold uppercase tracking-widest mb-6">
                      {loc.category}
                    </div>
                  )}

                  <div className="pt-6 border-t border-indigo-500/10 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-indigo-500/50 text-[10px] font-mono">
                      {loc.lat.toFixed(4)}, {loc.lng.toFixed(4)}
                    </div>
                    
                    {loc.distance !== undefined && (
                      <div className="flex items-center gap-1.5 text-indigo-300 font-black text-sm bg-indigo-500/10 px-3 py-1.5 rounded-lg border border-indigo-500/20">
                        <Navigation className="w-3.5 h-3.5" />
                        {loc.distance < 0.1 ? "Here" : `${loc.distance.toFixed(1)} mi`}
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          
          {processedLocations.length === 0 && !loading && (
            <div className="col-span-full py-20 text-center text-indigo-500/40 text-sm font-black uppercase tracking-widest border border-indigo-500/10 border-dashed rounded-3xl">
              No Locations Found
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
