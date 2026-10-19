"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import { motion } from "framer-motion";
import { AlertCircle, Loader2 } from "lucide-react";
import { Skeleton } from "../ui/skeleton";

interface PlatformImageComparisonBlockProps {
  collection?: string;
  beforeImage?: string;
  afterImage?: string;
  beforeLabel?: string;
  afterLabel?: string;
  orientation?: "horizontal" | "vertical";
  height?: string;
  showLabels?: boolean;
  beforeField?: string;
  afterField?: string;
  labelField?: string;
}

export default function PlatformImageComparisonBlock({
  collection,
  beforeImage: providedBefore,
  afterImage: providedAfter,
  beforeLabel = "Before",
  afterLabel = "After",
  orientation = "horizontal",
  height = "400px",
  showLabels = true,
  beforeField = "beforeImage",
  afterField = "afterImage",
  labelField = "label",
}: PlatformImageComparisonBlockProps) {
  const [beforeImage, setBeforeImage] = useState(providedBefore || "");
  const [afterImage, setAfterImage] = useState(providedAfter || "");
  const [label, setLabel] = useState("");
  const [loading, setLoading] = useState(!providedBefore && !!collection);
  const [error, setError] = useState<string | null>(null);
  const [sliderPosition, setSliderPosition] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch from dataset if collection provided
  useEffect(() => {
    if (providedBefore || !collection) {
      setLoading(false);
      return;
    }

    const fetchImages = async () => {
      try {
        const res = await fetch(`/api/oddjob/datasets?collection=${encodeURIComponent(collection)}&limit=1`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const records = Array.isArray(data) ? data : data.records || [];
        
        if (records.length > 0) {
          const record = records[0];
          setBeforeImage(record[beforeField] || record.beforeImage || "");
          setAfterImage(record[afterField] || record.afterImage || "");
          setLabel(record[labelField] || "");
        }
      } catch (e: any) {
        setError(e.message || "Failed to load images");
      } finally {
        setLoading(false);
      }
    };

    fetchImages();
  }, [collection, providedBefore, beforeField, afterField, labelField]);

  const handleMove = useCallback(
    (clientX: number, clientY: number) => {
      if (!containerRef.current) return;
      
      const rect = containerRef.current.getBoundingClientRect();
      
      if (orientation === "horizontal") {
        const x = clientX - rect.left;
        const percentage = (x / rect.width) * 100;
        setSliderPosition(Math.max(0, Math.min(100, percentage)));
      } else {
        const y = clientY - rect.top;
        const percentage = (y / rect.height) * 100;
        setSliderPosition(Math.max(0, Math.min(100, percentage)));
      }
    },
    [orientation]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging) return;
      handleMove(e.clientX, e.clientY);
    },
    [isDragging, handleMove]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!isDragging) return;
      const touch = e.touches[0];
      handleMove(touch.clientX, touch.clientY);
    },
    [isDragging, handleMove]
  );

  const handleStart = useCallback(() => setIsDragging(true), []);
  const handleEnd = useCallback(() => setIsDragging(false), []);

  // Global mouse/touch up handlers
  useEffect(() => {
    const handleGlobalEnd = () => setIsDragging(false);
    window.addEventListener("mouseup", handleGlobalEnd);
    window.addEventListener("touchend", handleGlobalEnd);
    return () => {
      window.removeEventListener("mouseup", handleGlobalEnd);
      window.removeEventListener("touchend", handleGlobalEnd);
    };
  }, []);
  const styleBlock = (
    <style>{`
      .image-comparison-height {
        height: ${height};
      }
      .slider-position-style {
        --slider-pos: ${sliderPosition}%;
      }
    `}</style>
  );

  if (loading) {
    return (
      <>
        {styleBlock}
        <div className="w-full image-comparison-height">
          <Skeleton className="w-full h-full" />
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        {styleBlock}
        <div className="w-full flex items-center justify-center image-comparison-height">
          <div className="flex items-center gap-2 text-red-400">
            <AlertCircle className="w-5 h-5" />
            <span>{error}</span>
          </div>
        </div>
      </>
    );
  }

  if (!beforeImage || !afterImage) {
    return (
      <div className="w-full flex items-center justify-center bg-muted h-[300px]">
        <p className="text-muted-foreground">Please provide both before and after images</p>
      </div>
    );
  }

  const isHorizontal = orientation === "horizontal";

  return (
    <div className="w-full">
      {styleBlock}
      {label && (
        <h3 className="text-lg font-semibold mb-2 text-center">{label}</h3>
      )}
      
      <div
        ref={containerRef}
        className="relative overflow-hidden rounded-lg cursor-ew-reslect touch-none select-none image-comparison-height slider-position-style"
        onMouseMove={handleMouseMove}
        onTouchMove={handleTouchMove}
        onMouseLeave={handleEnd}
      >
        {/* After Image (Full background) */}
        <div className="absolute inset-0">
          <img
            src={afterImage}
            alt="After"
            className="w-full h-full object-cover"
            draggable={false}
          />
          {showLabels && (
            <span className={`absolute ${isHorizontal ? "right-4" : "bottom-4 left-4"} px-3 py-1 bg-black/50 text-white text-sm rounded backdrop-blur-sm`}>
              {afterLabel}
            </span>
          )}
        </div>

        {/* Before Image (Clipped) */}
        <div
          className={`absolute inset-0 overflow-hidden ${isHorizontal ? "[clip-path:inset(0_calc(100%_-_var(--slider-pos))_0_0)]" : "[clip-path:inset(0_0_calc(100%_-_var(--slider-pos))_0)]"}`}
        >
          <img
            src={beforeImage}
            alt="Before"
            className="w-full h-full object-cover"
            draggable={false}
          />
          {showLabels && (
            <span className={`absolute ${isHorizontal ? "left-4" : "top-4 left-4"} px-3 py-1 bg-black/50 text-white text-sm rounded backdrop-blur-sm`}>
              {beforeLabel}
            </span>
          )}
        </div>

        {/* Slider Handle */}
        <div
          className={`absolute z-10 bg-[rgba(255,255,255,0.8)] ${
            isHorizontal
              ? "left-[var(--slider-pos)] top-0 w-[4px] h-full cursor-ew-resize -translate-x-1/2"
              : "top-[var(--slider-pos)] left-0 h-[4px] w-full cursor-ns-resize -translate-y-1/2"
          }`}
          onMouseDown={handleStart}
          onTouchStart={handleStart}
        >
          {/* Handle Button */}
          <div
            className={`absolute ${isHorizontal ? "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" : "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"} w-10 h-10 bg-white rounded-full shadow-lg flex items-center justify-center`}
          >
            <div className={`flex ${isHorizontal ? "flex-col" : "flex-row"} gap-0.5`}>
              <div className="w-1 h-1 bg-gray-400 rounded-full" />
              <div className="w-1 h-1 bg-gray-400 rounded-full" />
              <div className="w-1 h-1 bg-gray-400 rounded-full" />
            </div>
          </div>
        </div>

        {/* Instructions */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1 bg-black/50 text-white text-xs rounded backdrop-blur-sm opacity-50 hover:opacity-100 transition-opacity">
          Drag to compare
        </div>
      </div>
    </div>
  );
}
