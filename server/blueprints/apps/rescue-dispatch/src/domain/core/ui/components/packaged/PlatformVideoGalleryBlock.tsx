"use client";

import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  ChevronLeft,
  ChevronRight,
  Grid3X3,
  List,
  AlertCircle,
  Loader2,
  Clock,
  Eye,
} from "lucide-react";
import { Card, CardContent } from "../ui/card";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Skeleton } from "../ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";

interface VideoItem {
  id: string;
  title: string;
  description?: string;
  videoUrl: string;
  thumbnailUrl?: string;
  duration?: string;
  views?: number;
  platform?: "youtube" | "vimeo" | "direct";
  tags?: string[];
}

interface PlatformVideoGalleryBlockProps {
  collection?: string;
  videos?: VideoItem[];
  layout?: "grid" | "list" | "carousel";
  itemsPerPage?: number;
  autoPlay?: boolean;
  showThumbnails?: boolean;
  thumbnailField?: string;
  videoField?: string;
  titleField?: string;
  descriptionField?: string;
  durationField?: string;
  tagsField?: string;
}

export default function PlatformVideoGalleryBlock({
  collection,
  videos: providedVideos,
  layout = "grid",
  itemsPerPage = 6,
  autoPlay = false,
  showThumbnails = true,
  thumbnailField = "thumbnailUrl",
  videoField = "videoUrl",
  titleField = "title",
  descriptionField = "description",
  durationField = "duration",
  tagsField = "tags",
}: PlatformVideoGalleryBlockProps) {
  const [videos, setVideos] = useState<VideoItem[]>(providedVideos || []);
  const [loading, setLoading] = useState(!providedVideos && !!collection);
  const [error, setError] = useState<string | null>(null);
  const [selectedVideo, setSelectedVideo] = useState<VideoItem | null>(null);
  const [currentLayout, setCurrentLayout] = useState(layout);
  const [currentPage, setCurrentPage] = useState(1);
  const [playingVideo, setPlayingVideo] = useState<string | null>(null);

  // Fetch videos from dataset
  useEffect(() => {
    if (providedVideos || !collection) {
      setLoading(false);
      return;
    }

    const fetchVideos = async () => {
      try {
        const res = await fetch(`/api/oddjob/datasets?collection=${encodeURIComponent(collection)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const records = Array.isArray(data) ? data : data.records || [];

        const mappedVideos: VideoItem[] = records.map((record: any, idx: number) => ({
          id: record.id || `video-${idx}`,
          title: record[titleField] || record.name || "Untitled",
          description: record[descriptionField] || "",
          videoUrl: record[videoField] || record.video || "",
          thumbnailUrl: record[thumbnailField] || record.thumbnail,
          duration: record[durationField] || record.duration,
          views: record.views || 0,
          platform: detectPlatform(record[videoField] || record.video),
          tags: record[tagsField] || record.tags || [],
        }));

        setVideos(mappedVideos);
        if (mappedVideos.length > 0 && autoPlay) {
          setSelectedVideo(mappedVideos[0]);
        }
      } catch (e: any) {
        setError(e.message || "Failed to load videos");
      } finally {
        setLoading(false);
      }
    };

    fetchVideos();
  }, [collection, providedVideos, thumbnailField, videoField, titleField, descriptionField, durationField, tagsField, autoPlay]);

  // Detect video platform from URL
  const detectPlatform = (url: string): "youtube" | "vimeo" | "direct" => {
    if (!url) return "direct";
    if (url.includes("youtube.com") || url.includes("youtu.be")) return "youtube";
    if (url.includes("vimeo.com")) return "vimeo";
    return "direct";
  };

  // Get embed URL for YouTube/Vimeo
  const getEmbedUrl = (video: VideoItem): string => {
    if (video.platform === "youtube") {
      const videoId = extractYoutubeId(video.videoUrl);
      return `https://www.youtube.com/embed/${videoId}?autoplay=1`;
    }
    if (video.platform === "vimeo") {
      const videoId = extractVimeoId(video.videoUrl);
      return `https://player.vimeo.com/video/${videoId}?autoplay=1`;
    }
    return video.videoUrl;
  };

  const extractYoutubeId = (url: string): string => {
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/);
    return match?.[1] || "";
  };

  const extractVimeoId = (url: string): string => {
    const match = url.match(/vimeo\.com\/(\d+)/);
    return match?.[1] || "";
  };

  // Pagination
  const totalPages = Math.ceil(videos.length / itemsPerPage);
  const paginatedVideos = videos.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, idx) => (
          <Skeleton key={idx} className="aspect-video" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="flex items-center gap-2 text-red-400">
          <AlertCircle className="w-5 h-5" />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  if (videos.length === 0) {
    return (
      <div className="flex items-center justify-center p-8 bg-muted rounded-lg">
        <p className="text-muted-foreground">No videos available</p>
      </div>
    );
  }

  return (
    <div className="w-full space-y-4">
      {/* Header with layout toggle */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Video Gallery ({videos.length})</h3>
        <Tabs value={currentLayout} onValueChange={(v) => setCurrentLayout(v as any)}>
          <TabsList>
            <TabsTrigger value="grid">
              <Grid3X3 className="w-4 h-4" />
            </TabsTrigger>
            <TabsTrigger value="list">
              <List className="w-4 h-4" />
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Main Player */}
      <AnimatePresence>
        {selectedVideo && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="relative"
          >
            <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
              <iframe
                src={getEmbedUrl(selectedVideo)}
                title={selectedVideo.title}
                className="absolute inset-0 w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
            <div className="mt-3">
              <h4 className="text-lg font-semibold">{selectedVideo.title}</h4>
              {selectedVideo.description && (
                <p className="text-muted-foreground mt-1">{selectedVideo.description}</p>
              )}
              <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                {selectedVideo.duration && (
                  <span className="flex items-center gap-1">
                    <Clock className="w-4 h-4" />
                    {selectedVideo.duration}
                  </span>
                )}
                {selectedVideo.views !== undefined && selectedVideo.views > 0 && (
                  <span className="flex items-center gap-1">
                    <Eye className="w-4 h-4" />
                    {selectedVideo.views.toLocaleString()} views
                  </span>
                )}
                {selectedVideo.platform && (
                  <Badge variant="outline">{selectedVideo.platform}</Badge>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Video Grid/List */}
      <div className={currentLayout === "grid" ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" : "space-y-2"}>
        {paginatedVideos.map((video, idx) => (
          <motion.div
            key={video.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.05 }}
          >
            <Card
              className={`cursor-pointer transition-all hover:shadow-md ${
                selectedVideo?.id === video.id ? "ring-2 ring-primary" : ""
              } ${currentLayout === "list" ? "flex" : ""}`}
              onClick={() => setSelectedVideo(video)}
            >
              {/* Thumbnail */}
              <div className={`relative ${currentLayout === "list" ? "w-48 shrink-0" : ""}`}>
                <div className={`relative bg-muted ${currentLayout === "list" ? "h-full" : "aspect-video"}`}>
                  {video.thumbnailUrl ? (
                    <img
                      src={video.thumbnailUrl}
                      alt={video.title}
                      className="w-full h-full object-cover rounded-t-lg"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Play className="w-8 h-8 text-muted-foreground" />
                    </div>
                  )}
                  {/* Play Overlay */}
                  <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 hover:opacity-100 transition-opacity">
                    <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center">
                      <Play className="w-6 h-6 text-gray-900 ml-1" />
                    </div>
                  </div>
                  {/* Duration Badge */}
                  {video.duration && (
                    <Badge className="absolute bottom-2 right-2 bg-black/70 text-white">
                      {video.duration}
                    </Badge>
                  )}
                </div>
              </div>

              {/* Info */}
              <CardContent className={`p-3 ${currentLayout === "list" ? "flex-1" : ""}`}>
                <h4 className="font-medium line-clamp-2">{video.title}</h4>
                {video.description && currentLayout === "list" && (
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                    {video.description}
                  </p>
                )}
                {video.tags && video.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {video.tags.slice(0, 3).map((tag, i) => (
                      <Badge key={i} variant="secondary" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {currentPage} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
