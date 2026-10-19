import React, { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight, Quote, Star, User } from "lucide-react";
import { Card, CardContent } from '../ui/card.js';
import { Button } from '../ui/button.js';
import { Badge } from '../ui/badge.js';
import { Skeleton } from '../ui/skeleton.js';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar.js';

export interface ContentItem {
  id: string;
  title?: string;
  content: string;
  author?: string;
  role?: string;
  company?: string;
  avatar?: string;
  rating?: number;
  tags?: string[];
  cta?: {
    label: string;
    url: string;
  };
  metadata?: Record<string, any>;
}

interface PlatformContentCarouselBlockProps {
  /** Items supplied directly (e.g. by an instant-app call). Bypasses the dataset fetch. */
  items?: ContentItem[];
  /** Oddjob platform dataset collection name */
  collection?: string;
  /** Field containing the main content/text */
  contentField?: string;
  /** Field for item title/heading */
  titleField?: string;
  /** Field for author name */
  authorField?: string;
  /** Field for author role/title */
  roleField?: string;
  /** Field for company name */
  companyField?: string;
  /** Field for author avatar URL */
  avatarField?: string;
  /** Field for star rating (1-5) */
  ratingField?: string;
  /** Field for category tags (array or comma-separated) */
  tagsField?: string;
  /** Card template style */
  cardTemplate?: "testimonial" | "feature" | "news" | "quote" | "custom";
  /** Auto-play carousel */
  autoPlay?: boolean;
  /** Auto-play interval in seconds */
  interval?: number;
  /** Show navigation indicators */
  showIndicators?: boolean;
  /** Show navigation arrows */
  showArrows?: boolean;
  /** Number of items to show per slide (1-3) */
  itemsPerSlide?: 1 | 2 | 3;
  /** Block title */
  title?: string;
  /** Filter by tag */
  filterTag?: string;
  /** Maximum items to display */
  maxItems?: number;
  /** Custom CSS class for cards */
  cardClassName?: string;
}

export default function PlatformContentCarouselBlock({
  items: providedItems,
  collection,
  contentField,
  titleField,
  authorField,
  roleField,
  companyField,
  avatarField,
  ratingField,
  tagsField,
  cardTemplate = "testimonial",
  autoPlay = true,
  interval = 6,
  showIndicators = true,
  showArrows = true,
  itemsPerSlide = 1,
  title,
  filterTag,
  maxItems,
  cardClassName,
}: PlatformContentCarouselBlockProps) {
  const [items, setItems] = useState<ContentItem[]>(providedItems || []);
  const [loading, setLoading] = useState(!(providedItems && providedItems.length > 0));
  const [error, setError] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);

  const fetchContent = useCallback(async () => {
    if (!collection || !contentField) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/oddjob/datasets?collection=${encodeURIComponent(collection)}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const records = Array.isArray(data) ? data : data.records ?? data.items ?? [];

      const contentItems: ContentItem[] = records
        .map((record: any, idx: number) => {
          const content = record[contentField];
          if (!content) return null;

          const tags = tagsField
            ? Array.isArray(record[tagsField])
              ? record[tagsField]
              : record[tagsField]?.split(",").map((t: string) => t.trim()) || []
            : [];

          return {
            id: record.id || `item-${idx}`,
            content: String(content),
            title: titleField ? record[titleField] : undefined,
            author: authorField ? record[authorField] : undefined,
            role: roleField ? record[roleField] : undefined,
            company: companyField ? record[companyField] : undefined,
            avatar: avatarField ? record[avatarField] : undefined,
            rating: ratingField ? Number(record[ratingField]) || undefined : undefined,
            tags,
            metadata: record,
          };
        })
        .filter(Boolean) as ContentItem[];

      setItems(contentItems);
    } catch (e: any) {
      setError(e.message || "Failed to load content.");
    } finally {
      setLoading(false);
    }
  }, [collection, contentField, titleField, authorField, roleField, companyField, avatarField, ratingField, tagsField]);

  useEffect(() => {
    if (providedItems && providedItems.length > 0) {
      setItems(providedItems);
      setLoading(false);
      return;
    }
    fetchContent();
  }, [fetchContent, providedItems]);

  // Auto-play
  useEffect(() => {
    if (!autoPlay || items.length <= itemsPerSlide) return;
    const timer = setInterval(() => {
      setCurrentIndex((prev) =>
        prev + itemsPerSlide >= filteredItems.length ? 0 : prev + itemsPerSlide
      );
    }, interval * 1000);
    return () => clearInterval(timer);
  }, [autoPlay, interval, items.length, itemsPerSlide]);

  const filteredItems = items
    .filter((item) => {
      if (filterTag && !item.tags?.includes(filterTag)) return false;
      return true;
    })
    .slice(0, maxItems);

  const totalSlides = Math.ceil(filteredItems.length / itemsPerSlide);
  const currentSlide = Math.floor(currentIndex / itemsPerSlide);

  const navigate = (direction: "prev" | "next") => {
    if (direction === "prev") {
      setCurrentIndex((prev) =>
        prev === 0
          ? Math.max(0, filteredItems.length - itemsPerSlide)
          : Math.max(0, prev - itemsPerSlide)
      );
    } else {
      setCurrentIndex((prev) =>
        prev + itemsPerSlide >= filteredItems.length ? 0 : prev + itemsPerSlide
      );
    }
  };

  const goToSlide = (slideIndex: number) => {
    setCurrentIndex(slideIndex * itemsPerSlide);
  };

  const visibleItems = filteredItems.slice(
    currentIndex,
    currentIndex + itemsPerSlide
  );

  const renderStars = (rating: number) => {
    return (
      <div className="flex gap-0.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Star
            key={i}
            className={`w-4 h-4 ${
              i < rating
                ? "fill-amber-400 text-amber-400"
                : "text-foreground/20"
            }`}
          />
        ))}
      </div>
    );
  };

  const renderCard = (item: ContentItem) => {
    const baseClasses = `h-full ${cardClassName || ""}`;

    switch (cardTemplate) {
      case "testimonial":
        return (
          <Card className={`${baseClasses} bg-gradient-to-br from-white/5 to-white/[0.02] border-foreground/10`}>
            <CardContent className="p-6 flex flex-col h-full">
              <Quote className="w-8 h-8 text-primary/30 mb-4" />
              <p className="text-foreground/80 text-lg leading-relaxed flex-grow italic">
                &ldquo;{item.content}&rdquo;
              </p>
              <div className="mt-6 pt-4 border-t border-foreground/10 flex items-center gap-3">
                <Avatar className="w-12 h-12">
                  <AvatarImage src={item.avatar} />
                  <AvatarFallback className="bg-primary/20">
                    <User className="w-6 h-6 text-primary" />
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-medium text-foreground">{item.author || "Anonymous"}</p>
                  <p className="text-sm text-foreground/50">
                    {item.role}
                    {item.role && item.company && " at "}
                    {item.company}
                  </p>
                </div>
                {item.rating && (
                  <div className="ml-auto">
                    {renderStars(item.rating)}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        );

      case "feature":
        return (
          <Card className={`${baseClasses} overflow-hidden group`}>
            {item.avatar && (
              <div className="aspect-video overflow-hidden">
                <img
                  src={item.avatar}
                  alt={item.title || ""}
                  className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
              </div>
            )}
            <CardContent className="p-6">
              {item.tags && item.tags.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {item.tags.slice(0, 3).map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-[10px]">
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}
              <h3 className="text-xl font-semibold mb-2">{item.title}</h3>
              <p className="text-foreground/60 line-clamp-3">{item.content}</p>
            </CardContent>
          </Card>
        );

      case "news":
        return (
          <Card className={`${baseClasses}`}>
            <CardContent className="p-6">
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-16 h-16 rounded-lg bg-primary/10 flex items-center justify-center">
                  <span className="text-2xl font-bold text-primary">
                    {new Date(item.metadata?.createdAt).getDate() || "N"}
                  </span>
                </div>
                <div className="flex-grow">
                  <p className="text-sm text-foreground/50 mb-1">
                    {item.company || "News"}
                  </p>
                  <h3 className="text-lg font-medium mb-2">{item.title}</h3>
                  <p className="text-sm text-foreground/60 line-clamp-2">
                    {item.content}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        );

      case "quote":
        return (
          <Card className={`${baseClasses} bg-primary/5 border-primary/20`}>
            <CardContent className="p-8 text-center">
              <Quote className="w-10 h-10 text-primary/40 mx-auto mb-4" />
              <blockquote className="text-2xl font-light leading-relaxed text-foreground/90 mb-6">
                {item.content}
              </blockquote>
              {item.author && (
                <footer>
                  <p className="font-medium">— {item.author}</p>
                  {item.role && <p className="text-sm text-foreground/50">{item.role}</p>}
                </footer>
              )}
            </CardContent>
          </Card>
        );

      case "custom":
      default:
        return (
          <Card className={baseClasses}>
            <CardContent className="p-6">
              {item.title && <h3 className="font-semibold mb-2">{item.title}</h3>}
              <p className="text-foreground/70">{item.content}</p>
              {item.author && (
                <p className="text-sm text-foreground/50 mt-4">— {item.author}</p>
              )}
            </CardContent>
          </Card>
        );
    }
  };

  if (loading) {
    return (
      <div className="w-full">
        <Skeleton className="h-8 w-48 mb-4" />
        <div className={`grid gap-4 ${itemsPerSlide === 1 ? "grid-cols-1" : itemsPerSlide === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
          {Array.from({ length: itemsPerSlide }).map((_, i) => (
            <Skeleton key={i} className="h-64 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <Card className="w-full border-red-500/30 bg-red-500/5">
        <CardContent className="p-6 text-center">
          <p className="text-red-400 font-medium">{error}</p>
          <Button variant="outline" size="sm" onClick={fetchContent} className="mt-3">
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
          <Quote className="w-12 h-12 mx-auto text-foreground/20 mb-3" />
          <p className="text-foreground/50">No content items found in &quot;{collection}&quot;</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="w-full">
      {title && (
        <h2 className="text-2xl font-bold mb-6 text-center">{title}</h2>
      )}

      <div className="relative">
        {/* Navigation Arrows */}
        {showArrows && filteredItems.length > itemsPerSlide && (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="absolute -left-4 top-1/2 -translate-y-1/2 z-10 bg-background/50 hover:bg-background/70 rounded-full"
              onClick={() => navigate("prev")}
            >
              <ChevronLeft className="w-6 h-6" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="absolute -right-4 top-1/2 -translate-y-1/2 z-10 bg-background/50 hover:bg-background/70 rounded-full"
              onClick={() => navigate("next")}
            >
              <ChevronRight className="w-6 h-6" />
            </Button>
          </>
        )}

        {/* Carousel Content */}
        <div className="overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentIndex}
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -50 }}
              transition={{ duration: 0.3 }}
              className={`grid gap-4 ${
                itemsPerSlide === 1
                  ? "grid-cols-1"
                  : itemsPerSlide === 2
                  ? "grid-cols-1 md:grid-cols-2"
                  : "grid-cols-1 md:grid-cols-2 lg:grid-cols-3"
              }`}
            >
              {visibleItems.map((item) => (
                <div key={item.id}>{renderCard(item)}</div>
              ))}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Indicators */}
        {showIndicators && totalSlides > 1 && (
          <div className="flex justify-center gap-2 mt-6">
            {Array.from({ length: totalSlides }).map((_, idx) => (
              <button
                key={idx}
                onClick={() => goToSlide(idx)}
                className={`w-2.5 h-2.5 rounded-full transition-all ${
                  idx === currentSlide
                    ? "bg-primary w-6"
                    : "bg-foreground/30 hover:bg-foreground/50"
                }`}
              />
            ))}
          </div>
        )}

        {/* Tag Filter (if tags present) */}
        {!filterTag && items.some((i) => i.tags && i.tags.length > 0) && (
          <div className="flex flex-wrap justify-center gap-2 mt-4">
            {Array.from(
              new Set(items.flatMap((i) => i.tags || []))
            ).slice(0, 5).map((tag) => (
              <Badge
                key={tag}
                variant="outline"
                className="cursor-pointer hover:bg-foreground/10"
              >
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
