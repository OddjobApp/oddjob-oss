import { useState, useEffect } from "react";
import { useRoute } from "wouter";
import { LocationResolution } from '../components/LocationResolution.js';
import { RescueStatusCard } from '../components/RescueStatusCard.js';
import { Loader2, ShieldCheck, AlertTriangle } from "lucide-react";

export default function RescuePublicPage() {
    const [, params] = useRoute("/r/:token");
    const token = params?.token;
    const [sessionId, setSessionId] = useState<number | null>(null);
    const [isResolvingLocation, setIsResolvingLocation] = useState(true);
    const [tokenError, setTokenError] = useState<string | null>(null);

    // Resolve the public token -> session ID via the API
    useEffect(() => {
        if (!token) return;
        let cancelled = false;
        fetch(`/api/rescue/resolve-token/${encodeURIComponent(token)}`)
            .then(async (res) => {
                if (!res.ok) throw new Error(`Token invalid or expired (${res.status})`);
                return res.json();
            })
            .then((data) => {
                if (!cancelled) setSessionId(data.sessionId);
            })
            .catch((err) => {
                if (!cancelled) setTokenError(err.message);
            });
        return () => { cancelled = true; };
    }, [token]);

    const handleLocationConfirm = (location: { lat: number; lng: number; address?: string; resolvedBy: string }) => {
        console.log("Location Confirmed:", location);
        setIsResolvingLocation(false);
        // Here we would update the session with the user's location via API
    };

    if (!token || tokenError) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center p-6 text-center">
                <div className="space-y-4 max-w-sm">
                    <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto" />
                    <h1 className="text-xl font-bold text-foreground">Invalid Access Token</h1>
                    <p className="text-sm text-foreground/40">
                        {tokenError ?? "This rescue link is invalid or has expired. Please contact support if you believe this is an error."}
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 sm:p-6 space-y-6">
            {/* Header Branding */}
            <div className="flex items-center gap-2 mb-2">
                <div className="h-8 w-8 bg-primary rounded flex items-center justify-center shadow-lg shadow-primary/20">
                    <ShieldCheck className="h-5 w-5 text-foreground" />
                </div>
                <h2 className="text-lg font-bold tracking-tighter text-foreground uppercase italic">Oddjob Rescue</h2>
            </div>

            {isResolvingLocation ? (
                <LocationResolution
                    onConfirm={handleLocationConfirm}
                />
            ) : sessionId ? (
                <RescueStatusCard sessionId={sessionId} />
            ) : (
                <div className="flex flex-col items-center justify-center p-20 space-y-4">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <p className="text-xs text-foreground/40 font-mono">Initializing Secure Handshake...</p>
                </div>
            )}

            {/* Footer Attribution */}
            <div className="fixed bottom-6 left-0 right-0 text-center">
                <p className="text-[10px] text-foreground/20 font-mono uppercase tracking-[0.2em]">
                    Powered by Oddjob Autonomous Coordination
                </p>
            </div>
        </div>
    );
}
