"use client";

import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  MessageCircle,
  Heart,
  Share2,
  ExternalLink,
  Loader2,
  AlertCircle,
  User,
  Clock,
  RefreshCw,
  Image as ImageIcon,
  Video,
  Link as LinkIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "../ui/card";
import { Button } from "../ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { Badge } from "../ui/badge";
import { Skeleton } from "../ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import { ScrollArea } from "../ui/scroll-area";

interface SocialPost {
  id: string;
  platform: "twitter" | "instagram" | "linkedin" | "facebook" | "tiktok" | "generic";
  username: string;
  userHandle?: string;
  userAvatar?: string;
  content: string;
  mediaUrls?: string[];
  mediaType?: "image" | "video" | "link";
  likes?: number;
  comments?: number;
  shares?: number;
  postedAt: string;
  postUrl?: string;
  tags?: string[];
  verified?: boolean;
}

interface PlatformSocialFeedBlockProps {
  collection?: string;
  posts?: SocialPost[];
  platform?: "all" | "twitter" | "instagram" | "linkedin" | "facebook" | "tiktok";
  usernameField?: string;
  contentField?: string;
  mediaField?: string;
  likesField?: string;
  dateField?: string;
  platformField?: string;
  maxItems?: number;
  showEngagement?: boolean;
  autoRefresh?: boolean;
  refreshInterval?: number;
}

const platformIcons: Record<string, string> = {
  twitter: "𝕏",
  instagram: "📷",
  linkedin: "💼",
  facebook: "f",
  tiktok: "🎵",
  generic: "💬",
};

const platformColors: Record<string, string> = {
  twitter: "bg-card",
  instagram: "bg-gradient-to-br from-purple-500 to-pink-500",
  linkedin: "bg-blue-600",
  facebook: "bg-blue-800",
  tiktok: "bg-background",
  generic: "bg-gray-500",
};

export default function PlatformSocialFeedBlock({
  collection,
  posts: providedPosts,
  platform = "all",
  usernameField = "username",
  contentField = "content",
  mediaField = "mediaUrls",
  likesField = "likes",
  dateField = "postedAt",
  platformField = "platform",
  maxItems = 20,
  showEngagement = true,
  autoRefresh = false,
  refreshInterval = 60,
}: PlatformSocialFeedBlockProps) {
  const [posts, setPosts] = useState<SocialPost[]>(providedPosts || []);
  const [loading, setLoading] = useState(!providedPosts && !!collection);
  const [error, setError] = useState<string | null>(null);
  const [selectedPlatform, setSelectedPlatform] = useState(platform);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const fetchPosts = async () => {
    if (!collection) return;

    try {
      setLoading(true);
      const res = await fetch(`/api/oddjob/datasets?collection=${encodeURIComponent(collection)}&limit=${maxItems}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const records = Array.isArray(data) ? data : data.records || [];

      const mappedPosts: SocialPost[] = records.map((record: any, idx: number) => ({
        id: record.id || `post-${idx}`,
        platform: record[platformField] || record.platform || "generic",
        username: record[usernameField] || record.author || "Unknown",
        userHandle: record.userHandle || record.handle,
        userAvatar: record.userAvatar || record.avatar,
        content: record[contentField] || record.text || record.message || "",
        mediaUrls: parseMediaUrls(record[mediaField] || record.media),
        mediaType: record.mediaType || "image",
        likes: record[likesField] || record.likes || 0,
        comments: record.comments || 0,
        shares: record.shares || record.retweets || 0,
        postedAt: record[dateField] || record.createdAt || new Date().toISOString(),
        postUrl: record.postUrl || record.url,
        tags: record.tags || record.hashtags || [],
        verified: record.verified || false,
      }));

      setPosts(mappedPosts);
      setLastRefresh(new Date());
    } catch (e: any) {
      setError(e.message || "Failed to load posts");
    } finally {
      setLoading(false);
    }
  };

  const parseMediaUrls = (media: any): string[] => {
    if (!media) return [];
    if (typeof media === "string") return [media];
    if (Array.isArray(media)) return media;
    return [];
  };

  // Initial fetch
  useEffect(() => {
    if (providedPosts || !collection) {
      setLoading(false);
      return;
    }
    fetchPosts();
  }, [collection, providedPosts]);

  // Auto refresh
  useEffect(() => {
    if (!autoRefresh || !collection) return;

    const interval = setInterval(fetchPosts, refreshInterval * 1000);
    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, collection]);

  // Filter by platform
  const filteredPosts = selectedPlatform === "all"
    ? posts
    : posts.filter((p) => p.platform === selectedPlatform);

  // Format timestamp
  const formatTime = (dateStr: string): string => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
  };

  // Get available platforms
  const availablePlatforms = ["all", ...new Set(posts.map((p) => p.platform))];

  if (loading && posts.length === 0) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, idx) => (
          <Card key={idx}>
            <CardHeader className="flex flex-row items-center gap-4">
              <Skeleton className="w-10 h-10 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-24" />
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </CardContent>
          </Card>
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

  if (posts.length === 0) {
    return (
      <div className="flex items-center justify-center p-8 bg-muted rounded-lg">
        <p className="text-muted-foreground">No social posts available</p>
      </div>
    );
  }

  return (
    <div className="w-full space-y-4">
      {/* Header with platform filter */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <MessageCircle className="w-5 h-5" />
          <h3 className="font-semibold">Social Feed ({filteredPosts.length})</h3>
        </div>
        
        <div className="flex items-center gap-2">
          <Tabs value={selectedPlatform} onValueChange={(v) => setSelectedPlatform(v as any)}>
            <TabsList>
              {availablePlatforms.map((p) => (
                <TabsTrigger key={p} value={p} className="capitalize">
                  {p === "all" ? "All" : platformIcons[p] || p}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          
          {collection && (
            <Button
              variant="ghost"
              size="icon"
              onClick={fetchPosts}
              disabled={loading}
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          )}
        </div>
      </div>

      {/* Posts */}
      <ScrollArea className="h-[600px]">
        <div className="space-y-4 pr-4">
          {filteredPosts.slice(0, maxItems).map((post, idx) => (
            <motion.div
              key={post.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
            >
              <Card className="overflow-hidden">
                <CardHeader className="flex flex-row items-start gap-4 pb-3">
                  <Avatar className="w-10 h-10">
                    <AvatarImage src={post.userAvatar} />
                    <AvatarFallback className={`${platformColors[post.platform]} text-foreground`}>
                      {post.username[0]?.toUpperCase() || "U"}
                    </AvatarFallback>
                  </Avatar>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold truncate">{post.username}</span>
                      {post.verified && (
                        <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-800">
                          ✓
                        </Badge>
                      )}
                      <Badge variant="outline" className="text-xs capitalize">
                        {platformIcons[post.platform] || "💬"} {post.platform}
                      </Badge>
                    </div>
                    
                    {post.userHandle && (
                      <p className="text-sm text-muted-foreground">@{post.userHandle}</p>
                    )}
                    
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                      <Clock className="w-3 h-3" />
                      {formatTime(post.postedAt)}
                    </div>
                  </div>

                  {post.postUrl && (
                    <Button variant="ghost" size="icon" asChild>
                      <a href={post.postUrl} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    </Button>
                  )}
                </CardHeader>

                <CardContent className="pt-0">
                  {/* Content */}
                  <p className="whitespace-pre-wrap mb-3">{post.content}</p>

                  {/* Tags */}
                  {post.tags && post.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-3">
                      {post.tags.map((tag, i) => (
                        <Badge key={i} variant="secondary" className="text-xs">
                          #{tag}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {/* Media */}
                  {post.mediaUrls && post.mediaUrls.length > 0 && (
                    <div className={`grid gap-2 mb-3 ${post.mediaUrls.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
                      {post.mediaUrls.slice(0, 4).map((url, i) => (
                        <div key={i} className="relative aspect-square rounded-lg overflow-hidden bg-muted">
                          {post.mediaType === "video" ? (
                            <div className="w-full h-full flex items-center justify-center">
                              <Video className="w-8 h-8 text-muted-foreground" />
                            </div>
                          ) : (
                            <img
                              src={url}
                              alt={`Media ${i + 1}`}
                              className="w-full h-full object-cover"
                            />
                          )}
                          {post.mediaUrls!.length > 4 && i === 3 && (
                            <div className="absolute inset-0 bg-background/50 flex items-center justify-center text-foreground font-semibold">
                              +{post.mediaUrls!.length - 4}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Engagement */}
                  {showEngagement && (
                    <div className="flex items-center gap-4 pt-3 border-t">
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Heart className="w-4 h-4" />
                        <span>{formatNumber(post.likes || 0)}</span>
                      </div>
                      
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <MessageCircle className="w-4 h-4" />
                        <span>{formatNumber(post.comments || 0)}</span>
                      </div>
                      
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Share2 className="w-4 h-4" />
                        <span>{formatNumber(post.shares || 0)}</span>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </ScrollArea>

      {/* Footer */}
      {autoRefresh && (
        <p className="text-xs text-muted-foreground text-center">
          Auto-refreshing every {refreshInterval}s • Last updated {lastRefresh.toLocaleTimeString()}
        </p>
      )}
    </div>
  );
}

function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}
