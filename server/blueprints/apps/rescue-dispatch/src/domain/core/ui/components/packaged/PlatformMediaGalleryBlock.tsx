import React, { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ChevronLeft, ChevronRight, ZoomIn, Grid3X3, Columns, Play, Image as ImageIcon, Film } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card.js';
import { Button } from '../ui/button.js';
import { Badge } from '../ui/badge.js';
import { Skeleton } from '../ui/skeleton.js';
import { Dialog, DialogContent } from '../ui/dialog.js';
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs.js';

export interface MediaItem {
  id: string;
  url: string;
  thumbnail?: string;
  title?: string;
  description?: string;
  type: "image" | "video";
  metadata?: Record<string, any>;
}

interface PlatformMediaGalleryBlockProps {
  /** Oddjob platform dataset collection name containing media URLs */
  collection: string;
  /** Field containing the media URL (image or video) */
  mediaField: string;
  /** Optional field for thumbnail URL */
  thumbnailField?: string;
  /** Field for item title */
  titleField?: string;
  /** Field for item description */
  descriptionField?: string;
  /** Field indicating media type ('image' | 'video') - auto-detected if not provided */
  typeField?: string;
  /** Gallery layout mode */
  layout?: "grid" | "carousel" | "masonry";
  /** Number of columns in grid mode (1-6) */
  columns?: 1 | 2 | 3 | 4 | 5 | 6;
  /** Enable lightbox on click */
  lightbox?: boolean;
  /** Auto-play carousel */
  autoPlay?: boolean;
  /** Auto-play interval in seconds */
  autoPlayInterval?: number;
  /** Gallery title */
  title?: string;
  /** Filter by media type */
  filterType?: "all" | "image" | "video";
  /** Maximum items to display */
  maxItems?: number;
  /** Enable search/filter */
  searchable?: boolean;
  /** Custom CSS height for the gallery container */
  height?: string;
}

const DEFAULT_THUMBNAIL = "/placeholder-image.svg";

function getMediaType(url: string, explicitType?: string): "image" | "video" {
  if (explicitType) return explicitType as "image" | "video";
  const videoExtensions = [".mp4", ".webm", ".ogg", ".mov", ".avi"];
  const lowerUrl = url.toLowerCase();
  if (videoExtensions.some((ext) => lowerUrl.includes(ext))) return "video";
  return "image";
}

export default function PlatformMediaGalleryBlock({
  collection,
  mediaField,
  thumbnailField,
  titleField,
  descriptionField,
  typeField,
  layout = "grid",
  columns = 3,
  lightbox = true,
  autoPlay = false,
  autoPlayInterval = 5,
  title,
  filterType = "all",
  maxItems,
  searchable = false,
  height = "auto",
}: PlatformMediaGalleryBlockProps) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [currentLayout, setCurrentLayout] = useState(layout);
  const [searchQuery, setSearchQuery] = useState("");
  const [carouselIndex, setCarouselIndex] = useState(0);

  const fetchMedia = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/oddjob/datasets?collection=${encodeURIComponent(collection)}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const records = Array.isArray(data) ? data : data.records ?? data.items ?? [];

      const mediaItems: MediaItem[] = records
        .map((record: any, idx: number) => {
          const url = record[mediaField];
          if (!url) return null;

          const mediaType = typeField
            ? record[typeField]
            : getMediaType(url);

          return {
            id: record.id || `item-${idx}`,
            url,
            thumbnail: thumbnailField ? record[thumbnailField] : undefined,
            title: titleField ? record[titleField] : undefined,
            description: descriptionField ? record[descriptionField] : undefined,
            type: mediaType || "image",
            metadata: record,
          };
        })
        .filter(Boolean) as MediaItem[];

      setItems(mediaItems);
    } catch (e: any) {
      setError(e.message || "Failed to load media.");
    } finally {
      setLoading(false);
    }
  }, [collection, mediaField, thumbnailField, titleField, descriptionField, typeField]);

  useEffect(() => {
    fetchMedia();
  }, [fetchMedia]);

  // Carousel auto-play
  useEffect(() => {
    if (currentLayout !== "carousel" || !autoPlay) return;
    const timer = setInterval(() => {
      setCarouselIndex((prev) => (prev + 1) % filteredItems.length);
    }, autoPlayInterval * 1000);
    return () => clearInterval(timer);
  }, [currentLayout, autoPlay, autoPlayInterval, items.length]);

  const filteredItems = items.filter((item) => {
    if (filterType !== "all" && item.type !== filterType) return false;
    if (searchQuery && searchable) {
      const searchLower = searchQuery.toLowerCase();
      return (
        item.title?.toLowerCase().includes(searchLower) ||
        item.description?.toLowerCase().includes(searchLower)
      );
    }
    return true;
  }).slice(0, maxItems);

  const openLightbox = (index: number) => {
    if (lightbox) {
      setSelectedIndex(index);
    }
  };

  const closeLightbox = () => setSelectedIndex(null);

  const navigateLightbox = (direction: "prev" | "next") => {
    if (selectedIndex === null) return;
    const newIndex =
      direction === "prev"
        ? (selectedIndex - 1 + filteredItems.length) % filteredItems.length
        : (selectedIndex + 1) % filteredItems.length;
    setSelectedIndex(newIndex);
  };

  const getGridCols = () => {
    const colClasses: Record<number, string> = {
      1: "grid-cols-1",
      2: "grid-cols-1 md:grid-cols-2",
      3: "grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
      4: "grid-cols-1 md:grid-cols-2 lg:grid-cols-4",
      5: "grid-cols-1 md:grid-cols-3 lg:grid-cols-5",
      6: "grid-cols-2 md:grid-cols-3 lg:grid-cols-6",
    };
    return colClasses[columns] || "grid-cols-3";
  };

  if (loading) {
    return (
      <Card className="w-full">
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-32" />
        </CardHeader>
        <CardContent>
          <div className={`grid ${getGridCols()} gap-4`}>
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="aspect-square rounded-lg" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="w-full border-red-500/30 bg-red-500/5">
        <CardContent className="p-6 text-center">
          <ImageIcon className="w-12 h-12 mx-auto text-red-400/50 mb-3" />
          <p className="text-red-400 font-medium">{error}</p>
          <Button variant="outline" size="sm" onClick={fetchMedia} className="mt-3">
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (items.length === 0) {
    return (
      <Card className="w-full">
        <CardContent className="p-8 text-center">
          <ImageIcon className="w-12 h-12 mx-auto text-white/20 mb-3" />
          <p className="text-white/50">No media items found in &quot;{collection}&quot;</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full overflow-hidden" style={{ height }}>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <ImageIcon className="w-5 h-5 text-primary" />
            {title || `${collection} Gallery`}
          </CardTitle>
          <p className="text-xs text-white/50 mt-1">
            {filteredItems.length} {filterType !== "all" ? filterType : ""} items
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Tabs value={currentLayout} onValueChange={(v) => setCurrentLayout(v as any)}>
            <TabsList className="bg-white/5">
              <TabsTrigger value="grid" className="px-3">
                <Grid3X3 className="w-4 h-4" />
              </TabsTrigger>
              <TabsTrigger value="carousel" className="px-3">
                <Columns className="w-4 h-4" />
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </CardHeader>

      <CardContent>
        {currentLayout === "grid" && (
          <div className={`grid ${getGridCols()} gap-4`}>
            <AnimatePresence>
              {filteredItems.map((item, index) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ delay: index * 0.05 }}
                  className="group relative aspect-square overflow-hidden rounded-lg bg-slate-900 cursor-pointer"
                  onClick={() => openLightbox(index)}
                >
                  {item.type === "video" ? (
                    <>
                      <video
                        src={item.thumbnail || item.url}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                        preload="metadata"
                      />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                        <Play className="w-12 h-12 text-white/80" />
                      </div>
                    </>
                  ) : (
                    <img
                      src={item.url}
                      alt={item.title || ""}
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = DEFAULT_THUMBNAIL;
                      }}
                    />
                  )}

                  {/* Hover Overlay */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                    <div className="absolute bottom-0 left-0 right-0 p-3">
                      {item.title && (
                        <p className="text-sm font-medium text-white truncate">
                          {item.title}
                        </p>
                      )}
                      {item.description && (
                        <p className="text-xs text-white/60 line-clamp-2 mt-1">
                          {item.description}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-2">
                        <Badge variant="outline" className="text-[10px]">
                          {item.type === "video" ? (
                            <><Film className="w-3 h-3 mr-1" /> Video</>
                          ) : (
                            <><ImageIcon className="w-3 h-3 mr-1" /> Image</>
                          )}
                        </Badge>
                      </div>
                    </div>
                    <div className="absolute top-2 right-2">
                      <ZoomIn className="w-5 h-5 text-white/80" />
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}

        {currentLayout === "carousel" && (
          <div className="relative">
            <div className="overflow-hidden rounded-lg">
              <AnimatePresence mode="wait">
                <motion.div
                  key={carouselIndex}
                  initial={{ opacity: 0, x: 100 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -100 }}
                  transition={{ duration: 0.3 }}
                  className="relative aspect-video bg-slate-900 rounded-lg overflow-hidden"
                >
                  {filteredItems[carouselIndex]?.type === "video" ? (
                    <video
                      src={filteredItems[carouselIndex].url}
                      controls
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <img
                      src={filteredItems[carouselIndex]?.url}
                      alt={filteredItems[carouselIndex]?.title || ""}
                      className="w-full h-full object-contain"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = DEFAULT_THUMBNAIL;
                      }}
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Carousel Controls */}
            <Button
              variant="ghost"
              size="icon"
              className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70"
              onClick={() =>
                setCarouselIndex((prev) =>
                  prev === 0 ? filteredItems.length - 1 : prev - 1
                )
              }
            >
              <ChevronLeft className="w-6 h-6" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70"
              onClick={() =>
                setCarouselIndex((prev) =>
                  prev === filteredItems.length - 1 ? 0 : prev + 1
                )
              }
            >
              <ChevronRight className="w-6 h-6" />
            </Button>

            {/* Indicators */}
            <div className="flex justify-center gap-2 mt-3">
              {filteredItems.map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => setCarouselIndex(idx)}
                  className={`w-2 h-2 rounded-full transition-colors ${
                    idx === carouselIndex ? "bg-primary" : "bg-white/30"
                  }`}
                />
              ))}
            </div>

            {/* Item Info */}
            {filteredItems[carouselIndex]?.title && (
              <div className="mt-4 text-center">
                <p className="font-medium">{filteredItems[carouselIndex].title}</p>
                {filteredItems[carouselIndex].description && (
                  <p className="text-sm text-white/50 mt-1">
                    {filteredItems[carouselIndex].description}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>

      {/* Lightbox */}
      <Dialog open={selectedIndex !== null} onOpenChange={closeLightbox}>
        <DialogContent className="max-w-[95vw] max-h-[95vh] p-0 bg-black/95 border-none">
          <div className="relative w-full h-full flex items-center justify-center">
            {selectedIndex !== null && filteredItems[selectedIndex]?.type === "video" ? (
              <video
                src={filteredItems[selectedIndex].url}
                controls
                autoPlay
                className="max-w-full max-h-[85vh]"
              />
            ) : (
              <img
                src={filteredItems[selectedIndex ?? 0]?.url}
                alt={filteredItems[selectedIndex ?? 0]?.title || ""}
                className="max-w-full max-h-[85vh] object-contain"
              />
            )}

            {/* Lightbox Navigation */}
            <Button
              variant="ghost"
              size="icon"
              className="absolute left-4 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70"
              onClick={(e) => {
                e.stopPropagation();
                navigateLightbox("prev");
              }}
            >
              <ChevronLeft className="w-8 h-8" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-4 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70"
              onClick={(e) => {
                e.stopPropagation();
                navigateLightbox("next");
              }}
            >
              <ChevronRight className="w-8 h-8" />
            </Button>

            {/* Lightbox Info */}
            <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black/80 to-transparent">
              <p className="text-lg font-medium">
                {filteredItems[selectedIndex ?? 0]?.title}
              </p>
              <p className="text-sm text-white/60 mt-1">
                {filteredItems[selectedIndex ?? 0]?.description}
              </p>
              <p className="text-xs text-white/40 mt-2">
                {selectedIndex !== null ? selectedIndex + 1 : 0} of {filteredItems.length}
              </p>
            </div>

            {/* Close Button */}
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-4 right-4 bg-black/50 hover:bg-black/70"
              onClick={closeLightbox}
            >
              <X className="w-6 h-6" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
