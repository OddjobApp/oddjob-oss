"use client";

import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import useEmblaCarousel from "embla-carousel-react";
// @ts-ignore
import Autoplay from "embla-carousel-autoplay";
import { Quote, Star, ChevronLeft, ChevronRight, AlertCircle, Loader2 } from "lucide-react";
import { Card, CardContent } from "../ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { Badge } from "../ui/badge";
import { Skeleton } from "../ui/skeleton";
import { cn } from "@/lib/utils";

interface Testimonial {
  id: string;
  quote: string;
  author: string;
  role?: string;
  company?: string;
  avatar?: string;
  rating?: number;
  verified?: boolean;
}

interface PlatformTestimonialCarouselBlockProps {
  collection?: string;
  testimonials?: Testimonial[];
  autoPlay?: boolean;
  interval?: number;
  showArrows?: boolean;
  showDots?: boolean;
  variant?: "carousel" | "grid" | "masonry";
  quoteField?: string;
  authorField?: string;
  roleField?: string;
  companyField?: string;
  avatarField?: string;
  ratingField?: string;
}

const defaultTestimonials: Testimonial[] = [
  {
    id: "1",
    quote: "This platform has completely transformed how we operate. The automation features alone have saved us countless hours every week.",
    author: "Sarah Chen",
    role: "CTO",
    company: "TechStart Inc.",
    rating: 5,
    verified: true,
  },
  {
    id: "2",
    quote: "The best investment we've made this year. Our team's productivity has increased by 40% since we started using this tool.",
    author: "Michael Rodriguez",
    role: "Operations Director",
    company: "Global Solutions",
    rating: 5,
    verified: true,
  },
  {
    id: "3",
    quote: "Incredible support team and a product that actually delivers on its promises. Highly recommend for any growing business.",
    author: "Emily Watson",
    role: "Founder",
    company: "Creative Studios",
    rating: 5,
    verified: true,
  },
];

export default function PlatformTestimonialCarouselBlock({
  collection,
  testimonials: providedTestimonials,
  autoPlay = true,
  interval = 6000,
  showArrows = true,
  showDots = true,
  variant = "carousel",
  quoteField = "quote",
  authorField = "author",
  roleField = "role",
  companyField = "company",
  avatarField = "avatar",
  ratingField = "rating",
}: PlatformTestimonialCarouselBlockProps) {
  const [testimonials, setTestimonials] = useState<Testimonial[]>(providedTestimonials || []);
  const [loading, setLoading] = useState(!providedTestimonials && !!collection);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const [emblaRef, emblaApi] = useEmblaCarousel(
    { loop: true, align: "center" },
    autoPlay ? [Autoplay({ delay: interval, stopOnInteraction: false })] : []
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

  useEffect(() => {
    if (providedTestimonials || !collection) {
      setLoading(false);
      return;
    }

    const fetchTestimonials = async () => {
      try {
        const res = await fetch(`/api/oddjob/datasets?collection=${encodeURIComponent(collection)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const records = Array.isArray(data) ? data : data.records || [];

        const mapped: Testimonial[] = records.map((record: any, idx: number) => ({
          id: record.id || `testimonial-${idx}`,
          quote: record[quoteField] || record.quote || record.text || "",
          author: record[authorField] || record.author || record.name || "Anonymous",
          role: record[roleField] || record.role || record.title,
          company: record[companyField] || record.company || record.organization,
          avatar: record[avatarField] || record.avatar || record.image,
          rating: record[ratingField] || record.rating || 5,
          verified: record.verified || false,
        }));

        setTestimonials(mapped.length > 0 ? mapped : defaultTestimonials);
      } catch (e: any) {
        setError(e.message);
        setTestimonials(defaultTestimonials);
      } finally {
        setLoading(false);
      }
    };

    fetchTestimonials();
  }, [collection, providedTestimonials, quoteField, authorField, roleField, companyField, avatarField, ratingField]);

  const renderStars = (rating: number) => {
    return Array.from({ length: 5 }).map((_, i) => (
      <Star
        key={i}
        className={cn(
          "w-4 h-4",
          i < rating ? "fill-yellow-400 text-yellow-400" : "text-gray-300"
        )}
      />
    ));
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-[300px] w-full" />
      </div>
    );
  }

  if (variant === "grid") {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {testimonials.map((t, idx) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
          >
            <Card className="h-full">
              <CardContent className="p-6">
                <Quote className="w-8 h-8 text-primary/20 mb-4" />
                <p className="text-lg mb-4">&ldquo;{t.quote}&rdquo;</p>
                {t.rating && <div className="flex gap-1 mb-4">{renderStars(t.rating)}</div>}
                <div className="flex items-center gap-3">
                  <Avatar>
                    <AvatarImage src={t.avatar} />
                    <AvatarFallback>{t.author[0]}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-semibold">{t.author}</p>
                    <p className="text-sm text-muted-foreground">
                      {t.role}{t.role && t.company && ", "}{t.company}
                    </p>
                  </div>
                  {t.verified && (
                    <Badge variant="secondary" className="ml-auto">Verified</Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="overflow-hidden" ref={emblaRef}>
        <div className="flex">
          {testimonials.map((testimonial) => (
            <div
              key={testimonial.id}
              className="flex-[0_0_100%] min-w-0 pl-4 first:pl-0"
            >
              <Card className="mx-4 md:mx-12">
                <CardContent className="p-8 md:p-12 text-center">
                  <Quote className="w-12 h-12 text-primary/20 mx-auto mb-6" />
                  
                  <p className="text-xl md:text-2xl mb-6 leading-relaxed">
                    &ldquo;{testimonial.quote}&rdquo;
                  </p>
                  
                  {testimonial.rating && (
                    <div className="flex justify-center gap-1 mb-6">
                      {renderStars(testimonial.rating)}
                    </div>
                  )}
                  
                  <div className="flex flex-col items-center gap-2">
                    <Avatar className="w-16 h-16">
                      <AvatarImage src={testimonial.avatar} />
                      <AvatarFallback className="text-lg">{testimonial.author[0]}</AvatarFallback>
                    </Avatar>
                    
                    <div>
                      <p className="font-semibold text-lg">{testimonial.author}</p>
                      <p className="text-muted-foreground">
                        {testimonial.role}
                        {testimonial.role && testimonial.company && " at "}
                        {testimonial.company}
                      </p>
                    </div>
                    
                    {testimonial.verified && (
                      <Badge variant="secondary">Verified Customer</Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          ))}
        </div>
      </div>

      {/* Navigation */}
      {showArrows && testimonials.length > 1 && (
        <>
          <button
            onClick={scrollPrev}
            aria-label="Previous testimonial"
            className="absolute left-0 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/80 shadow-lg hover:bg-white transition-colors"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <button
            onClick={scrollNext}
            aria-label="Next testimonial"
            className="absolute right-0 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/80 shadow-lg hover:bg-white transition-colors"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        </>
      )}

      {/* Dots */}
      {showDots && testimonials.length > 1 && (
        <div className="flex justify-center gap-2 mt-6">
          {testimonials.map((_, index) => (
            <button
              key={index}
              onClick={() => scrollTo(index)}
              aria-label={`Go to testimonial ${index + 1}`}
              className={cn(
                "w-2 h-2 rounded-full transition-all",
                selectedIndex === index
                  ? "bg-primary w-6"
                  : "bg-primary/30 hover:bg-primary/50"
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}
