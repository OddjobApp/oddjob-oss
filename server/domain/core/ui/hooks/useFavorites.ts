/**
 * useFavorites Hook
 * 
 * Manages user favorites/pinned items with localStorage persistence.
 * Supports different item types (jobs, pipelines, schedules, etc.)
 */

import { useState, useCallback, useEffect } from 'react';

export type FavoriteType = 'job' | 'pipeline' | 'schedule' | 'dataset' | 'topic';

export interface FavoriteItem {
    id: number | string;
    type: FavoriteType;
    name: string;
    addedAt: string;
}

const STORAGE_KEY = 'oddjob_favorites';

/**
 * Load favorites from localStorage
 */
function loadFavorites(): FavoriteItem[] {
    if (typeof window === 'undefined') return [];
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch (e) {
        console.error('Failed to load favorites:', e);
        return [];
    }
}

/**
 * Save favorites to localStorage
 */
function saveFavorites(favorites: FavoriteItem[]): void {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites));
    } catch (e) {
        console.error('Failed to save favorites:', e);
    }
}

export interface UseFavoritesReturn {
    /** All favorite items */
    favorites: FavoriteItem[];
    /** Get favorites of a specific type */
    getFavoritesByType: (type: FavoriteType) => FavoriteItem[];
    /** Check if an item is favorited */
    isFavorite: (id: number | string, type: FavoriteType) => boolean;
    /** Add an item to favorites */
    addFavorite: (item: Omit<FavoriteItem, 'addedAt'>) => void;
    /** Remove an item from favorites */
    removeFavorite: (id: number | string, type: FavoriteType) => void;
    /** Toggle favorite status */
    toggleFavorite: (item: Omit<FavoriteItem, 'addedAt'>) => void;
    /** Clear all favorites */
    clearFavorites: () => void;
    /** Clear favorites of a specific type */
    clearFavoritesByType: (type: FavoriteType) => void;
    /** Reorder favorites */
    reorderFavorites: (favorites: FavoriteItem[]) => void;
}

/**
 * Hook for managing favorites
 * 
 * @example
 * ```tsx
 * const { isFavorite, toggleFavorite, getFavoritesByType } = useFavorites();
 * 
 * // Toggle favorite
 * <Button onClick={() => toggleFavorite({ id: job.id, type: 'job', name: job.name })}>
 *   {isFavorite(job.id, 'job') ? <StarFilled /> : <Star />}
 * </Button>
 * 
 * // Get all favorited jobs
 * const favoriteJobs = getFavoritesByType('job');
 * ```
 */
export function useFavorites(): UseFavoritesReturn {
    const [favorites, setFavorites] = useState<FavoriteItem[]>([]);

    // Load favorites on mount
    useEffect(() => {
        setFavorites(loadFavorites());
    }, []);

    // Save favorites whenever they change
    useEffect(() => {
        saveFavorites(favorites);
    }, [favorites]);

    const getFavoritesByType = useCallback((type: FavoriteType): FavoriteItem[] => {
        return favorites.filter(f => f.type === type);
    }, [favorites]);

    const isFavorite = useCallback((id: number | string, type: FavoriteType): boolean => {
        return favorites.some(f => f.id === id && f.type === type);
    }, [favorites]);

    const addFavorite = useCallback((item: Omit<FavoriteItem, 'addedAt'>) => {
        setFavorites(prev => {
            // Don't add duplicates
            if (prev.some(f => f.id === item.id && f.type === item.type)) {
                return prev;
            }
            return [...prev, { ...item, addedAt: new Date().toISOString() }];
        });
    }, []);

    const removeFavorite = useCallback((id: number | string, type: FavoriteType) => {
        setFavorites(prev => prev.filter(f => !(f.id === id && f.type === type)));
    }, []);

    const toggleFavorite = useCallback((item: Omit<FavoriteItem, 'addedAt'>) => {
        if (isFavorite(item.id, item.type)) {
            removeFavorite(item.id, item.type);
        } else {
            addFavorite(item);
        }
    }, [isFavorite, addFavorite, removeFavorite]);

    const clearFavorites = useCallback(() => {
        setFavorites([]);
    }, []);

    const clearFavoritesByType = useCallback((type: FavoriteType) => {
        setFavorites(prev => prev.filter(f => f.type !== type));
    }, []);

    const reorderFavorites = useCallback((newOrder: FavoriteItem[]) => {
        setFavorites(newOrder);
    }, []);

    return {
        favorites,
        getFavoritesByType,
        isFavorite,
        addFavorite,
        removeFavorite,
        toggleFavorite,
        clearFavorites,
        clearFavoritesByType,
        reorderFavorites,
    };
}

export default useFavorites;
