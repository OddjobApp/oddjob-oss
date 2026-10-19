"use client";

import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import useEmblaCarousel from "embla-carousel-react";
// @ts-ignore
import Autoplay from "embla-carousel-autoplay";
import {
  ChevronLeft,
  ChevronRight,
  ArrowRight,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { Card } from "../ui/card";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";

interface HeroSlide {
  id: string;
  title: string;
  subtitle?: string;
  description?: string;
  imageUrl: string;
  ctaText?: string;
  ctaUrl?: string;
  secondaryCtaText?: string;
  secondaryCtaUrl?: string;
  overlay?: boolean;
  overlayOpacity?: number;
}

interface PlatformHeroSliderBlockProps {
  collection?: string;
  slides?: HeroSlide[];
  height?: string;
  autoPlay?: boolean;
  interval?: number;
  showIndicators?: boolean;
  showArrows?: boolean;
  overlay?: boolean;
  overlayOpacity?: number;
  textPosition?: "left" | "center" | "right";
  textColor?: "light" | "dark";
  ctaField?: string;
  titleField?: string;
  subtitleField?: string;
  imageField?: string;
  descriptionField?: string;
}
// Removed getOpacityClass as we use inline styles for opacity now

export default function PlatformHeroSliderBlock({
  collection,
  slides: providedSlides,
  height = "600px",
  autoPlay = true,
  interval = 5000,
  showIndicators = true,
  showArrows = true,
  overlay = true,
  overlayOpacity = 0.5,
  textPosition = "left",
  textColor = "light",
  ctaField = "ctaText",
  titleField = "title",
  subtitleField = "subtitle",
  imageField = "imageUrl",
  descriptionField = "description",
}: PlatformHeroSliderBlockProps) {
  const [slides, setSlides] = useState<HeroSlide[]>(providedSlides || []);
  const [loading, setLoading] = useState(!providedSlides && !!collection);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const autoplayPlugin = React.useMemo(() => {
    return autoPlay ? [Autoplay({ delay: interval, stopOnInteraction: false })] : [];
  }, [autoPlay, interval]);

  const [emblaRef, emblaApi] = useEmblaCarousel(
    { loop: true, align: "start" },
    autoplayPlugin
  );

  const scrollPrev = useCallback(() => emblaApi?.scrollPrev(), [emblaApi]);
  const scrollNext = useCallback(() => emblaApi?.scrollNext(), [emblaApi]);
  const scrollTo = useCallback((index: number) => emblaApi?.scrollTo(index), [emblaApi]);

  const onSelect = useCallback(() => {
    if (!emblaApi) return;
    setSelectedIndex(emblaApi.selectedScrollSnap());
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    onSelect();
    emblaApi.on("select", onSelect);
    return () => {
      emblaApi.off("select", onSelect);
    };
  }, [emblaApi, onSelect]);

  // Fetch slides from dataset if collection provided
  useEffect(() => {
    if (providedSlides || !collection) {
      setLoading(false);
      return;
    }

    const fetchSlides = async () => {
      try {
        const res = await fetch(`/api/oddjob/datasets?collection=${encodeURIComponent(collection)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const records = Array.isArray(data) ? data : data.records || [];

        const mappedSlides: HeroSlide[] = records.map((record: any, idx: number) => ({
          id: record.id || `slide-${idx}`,
          title: record[titleField] || record.name || "",
          subtitle: record[subtitleField] || "",
          description: record[descriptionField] || "",
          imageUrl: record[imageField] || record.image || "",
          ctaText: record[ctaField] || "Learn More",
          ctaUrl: record.ctaUrl || "#",
          secondaryCtaText: record.secondaryCtaText,
          secondaryCtaUrl: record.secondaryCtaUrl,
          overlay,
          overlayOpacity,
        }));

        setSlides(mappedSlides);
      } catch (e: any) {
        setError(e.message || "Failed to load slides");
      } finally {
        setLoading(false);
      }
    };

    fetchSlides();
  }, [collection, providedSlides, ctaField, titleField, subtitleField, imageField, descriptionField, overlay, overlayOpacity]);

  if (loading) {
    return (
      <div className="w-full" style={{ height }}>
        <Skeleton className="w-full h-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full flex items-center justify-center h-[400px]">
        <div className="flex items-center gap-2 text-red-400">
          <AlertCircle className="w-5 h-5" />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  if (slides.length === 0) {
    return (
      <div className="w-full flex items-center justify-center bg-muted h-[400px]">
        <p className="text-muted-foreground">No slides available</p>
      </div>
    );
  }

  const textAlignment = {
    left: "items-start text-left",
    center: "items-center text-center",
    right: "items-end text-right",
  }[textPosition];

  const textClasses = textColor === "light" ? "text-white" : "text-gray-900";

  return (
    <div className="relative w-full overflow-hidden" style={{ height }}>
      <div className="overflow-hidden h-full" ref={emblaRef}>
        <div className="flex h-full">
          {slides.map((slide, index) => (
            <div
              key={slide.id}
              className="flex-[0_0_100%] min-w-0 relative h-full"
            >
              {/* Background Image */}
              <img
                src={slide.imageUrl}
                alt={slide.title}
                className="absolute inset-0 w-full h-full object-cover object-center"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = "https://images.unsplash.com/photo-1518770660439-4636190af475?q=80&w=2070";
                }}
              />

              {/* Overlay */}
              {(slide.overlay ?? overlay) && (
                <div
                  className={`absolute inset-0 ${
                    textPosition === "left"
                      ? "bg-gradient-to-r from-black/80 via-black/40 to-transparent"
                      : textPosition === "right"
                      ? "bg-gradient-to-l from-black/80 via-black/40 to-transparent"
                      : "bg-gradient-to-t from-black/80 via-black/30 to-transparent"
                  }`}
                  style={{ opacity: slide.overlayOpacity ?? overlayOpacity }}
                />
              )}

              {/* Content */}
              <div className={`relative z-10 h-full flex flex-col justify-center px-8 md:px-16 lg:px-24 ${textAlignment}`}>
                <div className="max-w-2xl">
                  {slide.subtitle && (
                    <motion.p
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: selectedIndex === index ? 0.9 : 0, y: selectedIndex === index ? 0 : 20 }}
                      transition={{ duration: 0.5, delay: 0.1 }}
                      className={`text-lg md:text-xl mb-2 ${textClasses}`}
                    >
                      {slide.subtitle}
                    </motion.p>
                  )}
                  <motion.h2
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: selectedIndex === index ? 1 : 0, y: selectedIndex === index ? 0 : 20 }}
                    transition={{ duration: 0.5, delay: 0.2 }}
                    className={`text-4xl md:text-5xl lg:text-6xl font-bold mb-4 ${textClasses}`}
                  >
                    {slide.title}
                  </motion.h2>
                  {slide.description && (
                    <motion.p
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: selectedIndex === index ? 0.8 : 0, y: selectedIndex === index ? 0 : 20 }}
                      transition={{ duration: 0.5, delay: 0.3 }}
                      className={`text-lg md:text-xl mb-8 max-w-xl ${textClasses}`}
                    >
                      {slide.description}
                    </motion.p>
                  )}
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: selectedIndex === index ? 1 : 0, y: selectedIndex === index ? 0 : 20 }}
                    transition={{ duration: 0.5, delay: 0.4 }}
                    className={`flex gap-4 ${textPosition === "center" ? "justify-center" : textPosition === "right" ? "justify-end" : "justify-start"}`}
                  >
                    {slide.ctaText && (
                      <Button
                        size="lg"
                        className="bg-white text-gray-900 hover:bg-gray-100 transition-all hover:scale-105"
                        asChild
                      >
                        <a href={slide.ctaUrl || "#"}>
                          {slide.ctaText}
                          <ArrowRight className="ml-2 w-4 h-4" />
                        </a>
                      </Button>
                    )}
                    {slide.secondaryCtaText && (
                      <Button
                        size="lg"
                        variant="outline"
                        className={`border-2 transition-all hover:scale-105 ${textColor === "light" ? "border-white text-white hover:bg-white/10" : "border-gray-900 text-gray-900 hover:bg-gray-100"}`}
                        asChild
                      >
                        <a href={slide.secondaryCtaUrl || "#"}>
                          {slide.secondaryCtaText}
                        </a>
                      </Button>
                    )}
                  </motion.div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Navigation Arrows */}
      {showArrows && slides.length > 1 && (
        <>
          <button
            onClick={scrollPrev}
            aria-label="Previous slide"
            className="absolute left-4 top-1/2 -translate-y-1/2 z-20 p-2 rounded-full bg-white/20 backdrop-blur-sm hover:bg-white/30 transition-colors"
          >
            <ChevronLeft className={`w-6 h-6 ${textColor === "light" ? "text-white" : "text-gray-900"}`} />
          </button>
          <button
            onClick={scrollNext}
            aria-label="Next slide"
            className="absolute right-4 top-1/2 -translate-y-1/2 z-20 p-2 rounded-full bg-white/20 backdrop-blur-sm hover:bg-white/30 transition-colors"
          >
            <ChevronRight className={`w-6 h-6 ${textColor === "light" ? "text-white" : "text-gray-900"}`} />
          </button>
        </>
      )}

      {/* Indicators */}
      {showIndicators && slides.length > 1 && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex gap-2">
          {slides.map((_, index) => (
            <button
              key={index}
              onClick={() => scrollTo(index)}
              aria-label={`Go to slide ${index + 1}`}
              className={`w-2 h-2 rounded-full transition-all ${
                selectedIndex === index
                  ? "bg-white w-6"
                  : "bg-white/50 hover:bg-white/75"
              }`}
            />
          ))}
        </div>
      )}

      {/* Progress Bar */}
      {autoPlay && slides.length > 1 && (
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/10 z-30">
          <motion.div
            key={selectedIndex}
            initial={{ width: "0%" }}
            animate={{ width: "100%" }}
            transition={{ duration: interval / 1000, ease: "linear" }}
            className="h-full bg-white/60"
          />
        </div>
      )}
      </div>
  );
}
