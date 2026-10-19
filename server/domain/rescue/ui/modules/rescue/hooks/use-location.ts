import { useState, useCallback } from 'react';

export interface LocationState {
    lat: number;
    lng: number;
    address?: string;
    resolvedBy: 'gps' | 'map' | 'manual';
    error?: string;
    isDetecting: boolean;
}

export function useLocation() {
    const [state, setState] = useState<LocationState>({
        lat: 0,
        lng: 0,
        isDetecting: false,
        resolvedBy: 'manual'
    });

    const detectLocation = useCallback(async () => {
        setState(prev => ({ ...prev, isDetecting: true, error: undefined }));

        if (!navigator.geolocation) {
            setState(prev => ({
                ...prev,
                isDetecting: false,
                error: "Geolocation is not supported by your browser"
            }));
            return;
        }

        // JS-level timeout fallback: browser's built-in 'timeout' option is unreliable
        const timeoutId = setTimeout(() => {
            setState(prev => ({
                ...prev,
                isDetecting: false,
                error: "GPS signal timed out. Please enter your location manually."
            }));
        }, 12000);

        navigator.geolocation.getCurrentPosition(
            async (position) => {
                clearTimeout(timeoutId);
                const { latitude, longitude } = position.coords;

                try {
                    // Reverse geocode to get address
                    const response = await fetch(`/api/rescue/reverse-geocode?lat=${latitude}&lng=${longitude}`);
                    if (!response.ok) throw new Error(`Reverse geocode ${response.status}`);
                    const data = await response.json();

                    setState({
                        lat: latitude,
                        lng: longitude,
                        address: data.address,
                        resolvedBy: 'gps',
                        isDetecting: false
                    });
                } catch {
                    // GPS coordinates obtained but address lookup failed — still usable
                    setState({
                        lat: latitude,
                        lng: longitude,
                        resolvedBy: 'gps',
                        isDetecting: false
                    });
                }
            },
            (error) => {
                clearTimeout(timeoutId);
                setState(prev => ({
                    ...prev,
                    isDetecting: false,
                    error: error.message
                }));
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    }, []);

    const setManualLocation = useCallback((lat: number, lng: number, address?: string) => {
        setState({
            lat,
            lng,
            address,
            resolvedBy: 'manual',
            isDetecting: false
        });
    }, []);

    return {
        ...state,
        detectLocation,
        setManualLocation
    };
}
