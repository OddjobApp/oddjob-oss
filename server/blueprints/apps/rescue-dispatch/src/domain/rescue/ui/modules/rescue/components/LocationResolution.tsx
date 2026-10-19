import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { MapPin, Navigation, Search, Check, AlertCircle, Loader2, X } from "lucide-react";
import { useLocation } from '../hooks/use-location.js';
import { RescueMap } from './RescueMap.js';
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { useDebounce } from "@domain-ui/core/ui/hooks/useDebounce";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";

interface LocationResolutionProps {
    onConfirm: (location: { lat: number; lng: number; address?: string; resolvedBy: string }) => void;
    onCancel?: () => void;
    initialAddress?: string;
}

export function LocationResolution({ onConfirm, onCancel, initialAddress }: LocationResolutionProps) {
    const { lat, lng, address, resolvedBy, error, isDetecting, detectLocation, setManualLocation } = useLocation();
    const [searchQuery, setSearchQuery] = useState(initialAddress || "");
    const [isSearching, setIsSearching] = useState(false);
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [step, setStep] = useState<'DETECTING' | 'CONFIRMING' | 'SEARCHING'>(initialAddress ? 'SEARCHING' : 'DETECTING');

    const debouncedSearch = useDebounce(searchQuery, 500);

    useEffect(() => {
        if (step === 'DETECTING') {
            detectLocation();
        }
    }, [step, detectLocation]);

    useEffect(() => {
        if (lat !== 0 && lng !== 0 && step === 'DETECTING') {
            setStep('CONFIRMING');
        }
    }, [lat, lng, step]);

    useEffect(() => {
        if (error && step === 'DETECTING') {
            setStep('SEARCHING');
        }
    }, [error, step]);

    useEffect(() => {
        if (step !== 'SEARCHING') return;

        const controller = new AbortController();

        const performSearch = async () => {
            if (!debouncedSearch || debouncedSearch.length < 3) {
                setSearchResults([]);
                return;
            }

            setIsSearching(true);
            try {
                const response = await fetch(
                    `/api/rescue/geocode?address=${encodeURIComponent(debouncedSearch)}`,
                    { signal: controller.signal }
                );
                if (response.ok) {
                    const data = await response.json();
                    setSearchResults([data]);
                } else {
                    setSearchResults([]);
                }
            } catch (err: any) {
                if (err.name !== 'AbortError') {
                    console.error("Geocoding failed:", err);
                }
            } finally {
                setIsSearching(false);
            }
        };

        performSearch();
        return () => { controller.abort(); };
    }, [debouncedSearch, step]);

    const handleSelectResult = (result: any) => {
        setManualLocation(result.location.lat, result.location.lng, result.resolvedAddress);
        setStep('CONFIRMING');
    };

    return (
        <Card className="w-full max-w-md glass-panel-deep border-foreground/10 bg-background/40 shadow-2xl rounded-[2.5rem] overflow-hidden relative">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.05] via-transparent to-transparent pointer-events-none" />
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary to-transparent opacity-30 shadow-[0_0_20px_rgba(var(--primary),0.5)]" />

            <CardHeader className="p-8 pb-4 border-b border-foreground/5 bg-foreground/[0.02]">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className="p-2.5 rounded-2xl bg-primary/10 border border-primary/20 shadow-lg shadow-primary/10 animate-pulse">
                            <MapPin className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                            <CardTitle className="text-xl font-black tracking-tighter uppercase italic text-foreground leading-none">Location Resolution</CardTitle>
                            <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest mt-1.5 flex items-center gap-1.5">
                                <span className={cn(
                                    "w-1.5 h-1.5 rounded-full",
                                    step === 'DETECTING' ? "bg-amber-500 animate-pulse" : "bg-emerald-500"
                                )} />
                                Phase: {step.replace('_', ' ')}
                            </p>
                        </div>
                    </div>
                    {onCancel && (
                        <Button variant="ghost" size="icon" className="h-10 w-10 rounded-2xl text-foreground/40 hover:text-foreground hover:bg-foreground/5 transition-all" onClick={onCancel}>
                            <X className="h-5 w-5" />
                        </Button>
                    )}
                </div>
            </CardHeader>

            <CardContent className="p-8 space-y-6">
                <AnimatePresence mode="wait">
                    {step === 'DETECTING' && (
                        <motion.div 
                            key="detecting"
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 1.05 }}
                            className="flex flex-col items-center justify-center py-12 space-y-8 text-center"
                        >
                            <div className="relative">
                                <Navigation className="h-12 w-12 text-primary animate-pulse relative z-10" />
                                <div className="absolute inset-0 h-12 w-12 bg-primary/20 blur-xl animate-pulse" />
                                <div className="absolute -inset-4 border-2 border-dashed border-primary/20 rounded-full animate-[spin_10s_linear_infinite]" />
                            </div>
                            <div className="space-y-3">
                                <h3 className="text-xl font-black italic text-foreground uppercase tracking-tighter">Detecting GPS...</h3>
                                <p className="text-foreground/40 text-[10px] uppercase font-bold tracking-[0.2em] max-w-[200px] leading-relaxed">Awaiting satellite lock or browser synchronization protocol.</p>
                            </div>
                            <Button variant="outline" className="h-10 px-6 rounded-xl border-foreground/10 text-[9px] font-black uppercase tracking-widest hover:bg-foreground/5 text-foreground/60 transition-all active:scale-95" onClick={() => setStep('SEARCHING')}>
                                Manual Intervention
                            </Button>
                        </motion.div>
                    )}

                    {step === 'CONFIRMING' && (
                        <motion.div 
                            key="confirming"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            className="space-y-6"
                        >
                            <div className="aspect-video rounded-[2rem] overflow-hidden relative border border-foreground/10 bg-background group shadow-inner">
                                <RescueMap
                                    center={{ lat, lng }}
                                    zoom={15}
                                    markers={[{ id: 'user', lat, lng, type: 'user' as const, label: 'Your Location' }]}
                                    className="w-full h-full grayscale-[0.4] contrast-[1.1]"
                                    interactive={true}
                                    onMove={(newLat, newLng) => setManualLocation(newLat, newLng, address)}
                                />
                                <div className="absolute inset-0 pointer-events-none border-[1px] border-foreground/10 rounded-[2rem]" />
                                <div className="absolute bottom-4 left-4 right-4 bg-background/60 backdrop-blur-md border border-foreground/10 p-3 rounded-xl text-[10px] text-foreground/80 font-black uppercase tracking-widest flex items-center gap-3 pointer-events-none">
                                    <div className="p-1.5 rounded-lg bg-primary/20">
                                        <AlertCircle className="h-3.5 w-3.5 text-primary shadow-[0_0_8px_rgba(var(--primary),0.5)]" />
                                    </div>
                                    <div className="flex-1 truncate">
                                        {address || "Coordinates Synchronized"}
                                    </div>
                                </div>
                            </div>
                            
                            <div className="space-y-4">
                                <div className="flex justify-between items-center text-[9px] uppercase tracking-[0.4em] text-foreground/30 font-black">
                                    <span>Resolution Protocol</span>
                                    <span className="text-primary italic">{resolvedBy}</span>
                                </div>
                                <div className="text-sm text-foreground font-black italic bg-foreground/[0.03] border border-foreground/5 p-5 rounded-[1.5rem] shadow-inner font-mono tracking-tight">
                                    {address || `${lat.toFixed(6)}, ${lng.toFixed(6)}`}
                                </div>
                            </div>
                            
                            <div className="flex gap-4 pt-2">
                                <Button variant="outline" className="flex-1 h-12 rounded-2xl border-foreground/10 bg-foreground/[0.02] text-foreground/60 font-black uppercase tracking-widest text-[9px] hover:bg-foreground/10 transition-all active:scale-95" onClick={() => setStep('SEARCHING')}>
                                    Refine Match
                                </Button>
                                <Button className="flex-1 h-12 rounded-2xl bg-primary hover:bg-primary/90 text-primary-foreground font-black uppercase tracking-widest text-[9px] shadow-2xl shadow-primary/20 transition-all active:scale-95" onClick={() => onConfirm({ lat, lng, address, resolvedBy })}>
                                    <Check className="h-4 w-4 mr-2" /> Synchronize
                                </Button>
                            </div>
                        </motion.div>
                    )}

                    {step === 'SEARCHING' && (
                        <motion.div 
                            key="searching"
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 10 }}
                            className="space-y-6"
                        >
                            <div className="relative group">
                                <Search className="absolute left-5 top-1/2 -translate-y-1/2 h-4 w-4 text-primary group-focus-within:text-foreground transition-colors" />
                                <Input
                                    placeholder="Incident address or landmark..."
                                    className="h-14 pl-14 pr-12 rounded-2xl bg-foreground/[0.03] border-foreground/10 text-foreground font-black italic tracking-tight placeholder:text-foreground/20 focus-visible:ring-primary shadow-inner"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    autoFocus
                                />
                                {isSearching && <Loader2 className="absolute right-5 top-1/2 -translate-y-1/2 h-4 w-4 text-primary animate-spin" />}
                            </div>

                            <div className="space-y-3 max-h-[260px] overflow-y-auto pr-2 custom-scrollbar">
                                <AnimatePresence mode="popLayout">
                                    {searchResults.length > 0 ? (
                                        searchResults.map((result, idx) => (
                                            <motion.button
                                                key={idx}
                                                initial={{ opacity: 0, y: 10 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                transition={{ delay: idx * 0.05 }}
                                                className="w-full p-6 flex flex-col items-start gap-2 rounded-[1.5rem] bg-foreground/[0.03] border border-foreground/5 hover:bg-primary/10 hover:border-primary/40 transition-all text-left group relative overflow-hidden shadow-inner"
                                                onClick={() => handleSelectResult(result)}
                                            >
                                                <div className="absolute top-0 left-0 w-1 h-full bg-primary/0 group-hover:bg-primary transition-colors" />
                                                <span className="text-sm font-black text-foreground group-hover:text-primary transition-colors tracking-tight uppercase italic">{result.resolvedAddress}</span>
                                                <div className="flex items-center gap-3">
                                                    <Badge variant="outline" className="text-[8px] font-black uppercase tracking-widest border-primary/20 text-primary px-2 py-0 rounded-md">Precision High</Badge>
                                                    <span className="text-[9px] text-foreground/20 font-black uppercase tracking-widest italic">{result.accuracy}</span>
                                                </div>
                                            </motion.button>
                                        ))
                                    ) : searchQuery.length > 3 && !isSearching ? (
                                        <motion.div 
                                            initial={{ opacity: 0 }}
                                            animate={{ opacity: 1 }}
                                            className="p-12 flex flex-col items-center justify-center text-center space-y-4 rounded-3xl border border-dashed border-foreground/10"
                                        >
                                            <div className="p-4 rounded-full bg-foreground/5">
                                                <Search className="h-8 w-8 text-foreground/20" />
                                            </div>
                                            <div className="space-y-1">
                                                <p className="text-xs font-black uppercase tracking-widest text-foreground/40">Zero Matches Found</p>
                                                <p className="text-[10px] text-foreground/20 font-bold uppercase tracking-widest max-w-[180px]">Try Imperial Palace or coordinates.</p>
                                            </div>
                                        </motion.div>
                                    ) : (
                                        <div className="space-y-4">
                                            <p className="text-[9px] font-black uppercase tracking-[0.4em] text-foreground/20 px-2">Operational Cache</p>
                                            <div className="p-8 text-[10px] font-black text-foreground/10 uppercase tracking-[0.2em] italic text-center rounded-[1.5rem] border border-dashed border-foreground/5">
                                                Clear Search History
                                            </div>
                                        </div>
                                    )}
                                </AnimatePresence>
                            </div>

                            <Button variant="ghost" className="w-full h-12 rounded-2xl text-[9px] font-black uppercase tracking-[0.3em] text-foreground/30 hover:text-primary hover:bg-primary/5 transition-all" onClick={() => setStep('DETECTING')}>
                                <Navigation className="h-4 w-4 mr-3" /> Re-trigger GPS Lock
                            </Button>
                        </motion.div>
                    )}
                </AnimatePresence>
            </CardContent>

            <CardFooter className="p-6 bg-foreground/[0.02] border-t border-foreground/5 relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/5 via-transparent to-transparent opacity-50" />
                <div className="flex items-center justify-between relative z-10 w-full">
                    <p className="text-[8px] font-black uppercase tracking-[0.4em] text-foreground/20 italic">
                        RES COORD SYSTEM // SYNCHRONIZED
                    </p>
                    <div className="flex gap-1">
                        <div className="w-3 h-1 bg-primary/20 rounded-full" />
                        <div className={cn(
                            "w-8 h-1 rounded-full",
                            step === 'CONFIRMING' ? "bg-primary animate-pulse shadow-[0_0_8px_rgba(var(--primary),0.5)]" : "bg-primary/20"
                        )} />
                        <div className="w-3 h-1 bg-primary/20 rounded-full" />
                    </div>
                </div>
            </CardFooter>
        </Card>
    );
}

